from collections.abc import Generator
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from app import auth
from app.database import get_db
from app.main import app
from app.models import Base, DefectStatus, EmailVerification, RoadDefect, User, UserRole
from app.security import hash_password
from app.settings import settings


@pytest.fixture
def resident_session_factory(tmp_path: Path) -> Generator[sessionmaker[Session], None, None]:
    engine = create_engine(f"sqlite:///{tmp_path / 'resident-test.db'}")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    yield factory
    engine.dispose()


@pytest.fixture
def resident_client(
    resident_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> Generator[TestClient, None, None]:
    def override_get_db() -> Generator[Session, None, None]:
        with resident_session_factory() as db:
            yield db

    app.dependency_overrides[get_db] = override_get_db
    monkeypatch.setattr(settings, "auth_cookie_name", "citylens_resident_test_session")
    monkeypatch.setattr(settings, "auth_session_ttl_minutes", 15)
    monkeypatch.setattr(settings, "app_env", "test")
    monkeypatch.setattr(settings, "frontend_origins", "http://localhost:5173")
    with resident_session_factory() as db:
        db.add_all([
            User(
                email="engineer@city.gov",
                display_name="Morgan Engineer",
                password_hash=hash_password("Engineer-password-123!"),
                role=UserRole.MUNICIPAL_ENGINEER,
            ),
            User(
                email="admin@city.gov",
                display_name="Avery Admin",
                password_hash=hash_password("Admin-password-123!"),
                role=UserRole.ADMIN,
            ),
        ])
        db.commit()
    with TestClient(app) as client:
        yield client
    app.dependency_overrides.clear()


def _resident(db: Session, email: str = "resident@example.com") -> User:
    user = User(
        email=email,
        display_name="Casey Resident",
        password_hash=hash_password("Resident-password-123!"),
        role=UserRole.RESIDENT,
        email_verified=True,
    )
    db.add(user)
    db.commit()
    return user


def test_resident_registration_requires_email_delivery(
    resident_client: TestClient,
    monkeypatch,
) -> None:
    monkeypatch.setattr(settings, "smtp_host", None)

    response = resident_client.post(
        "/api/v1/auth/register",
        json={
            "email": "resident@example.com",
            "display_name": "Casey Resident",
            "password": "Resident-password-123!",
            "confirm_password": "Resident-password-123!",
        },
    )

    assert response.status_code == 503
    assert "email delivery is not configured" in response.json()["detail"]


def test_resident_registration_verification_and_login(
    resident_client: TestClient,
    resident_session_factory: sessionmaker[Session],
    monkeypatch,
) -> None:
    sent: list[tuple[str, str]] = []

    def capture_verification_email(email: str, token: str) -> None:
        sent.append((email, token))

    monkeypatch.setattr(settings, "smtp_host", "smtp.example.com")
    monkeypatch.setattr(settings, "smtp_from_email", "no-reply@example.com")
    monkeypatch.setattr(settings, "public_app_url", "https://citylens.example.com")
    monkeypatch.setattr(auth, "_send_verification_email", capture_verification_email)

    registration = resident_client.post(
        "/api/v1/auth/register",
        json={
            "email": "Resident@Example.com",
            "display_name": "Casey Resident",
            "password": "Resident-password-123!",
            "confirm_password": "Resident-password-123!",
        },
    )

    assert registration.status_code == 202
    assert registration.json()["message"] == auth.RESIDENT_REGISTRATION_MESSAGE
    assert sent[0][0] == "resident@example.com"
    with resident_session_factory() as db:
        user = db.scalar(select(User).where(User.email == "resident@example.com"))
        assert user is not None
        assert not user.is_active
        assert not user.email_verified
        assert user.role == UserRole.RESIDENT
        verification = db.scalar(
            select(EmailVerification).where(EmailVerification.user_id == user.id)
        )
        assert verification is not None
        assert verification.token_hash != sent[0][1]

    blocked_login = resident_client.post(
        "/api/v1/auth/login",
        json={"email": "resident@example.com", "password": "Resident-password-123!"},
    )
    assert blocked_login.status_code == 401

    verified = resident_client.post(
        "/api/v1/auth/verify-email",
        params={"token": sent[0][1]},
    )
    assert verified.status_code == 200

    login = resident_client.post(
        "/api/v1/auth/login",
        json={"email": "resident@example.com", "password": "Resident-password-123!"},
    )
    assert login.status_code == 200
    assert login.json()["role"] == UserRole.RESIDENT.value
    assert "email_verified" not in login.json()


def test_residents_see_only_reviewed_defects_and_sanitized_fields(
    resident_client: TestClient,
    resident_session_factory: sessionmaker[Session],
) -> None:
    with resident_session_factory() as db:
        resident = _resident(db)
        engineer = db.scalar(select(User).where(User.email == "engineer@city.gov"))
        assert engineer is not None
        db.add_all([
            RoadDefect(
                defect_type="Pothole",
                description="Private internal report",
                severity="High",
                confidence=92,
                latitude=40.7,
                longitude=-73.9,
                detected_at=datetime.now(UTC),
                status=DefectStatus.VERIFIED,
                created_by=engineer.id,
            ),
            RoadDefect(
                defect_type="Unreviewed report",
                description="Not public yet",
                severity="Low",
                confidence=51,
                latitude=None,
                longitude=None,
                detected_at=datetime.now(UTC),
                status=DefectStatus.REPORTED,
                created_by=engineer.id,
            ),
        ])
        db.commit()
        credentials = (resident.email, "Resident-password-123!")

    login = resident_client.post(
        "/api/v1/auth/login",
        json={"email": credentials[0], "password": credentials[1]},
    )
    assert login.status_code == 200

    response = resident_client.get("/api/v1/residents/defects?limit=10&offset=0")

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 1
    assert len(payload["items"]) == 1
    public_record = payload["items"][0]
    assert public_record["defect_type"] == "Pothole"
    assert public_record["latitude"] == 40.7
    assert "description" not in public_record
    assert "created_by" not in public_record
    assert "confidence" not in public_record
    forbidden_write = resident_client.post(
        "/api/v1/defects",
        json={
            "defect_type": "Pothole",
            "severity": "High",
            "confidence": 90,
        },
    )
    assert forbidden_write.status_code == 403


def test_non_resident_cannot_access_resident_records(resident_client: TestClient) -> None:
    login = resident_client.post(
        "/api/v1/auth/login",
        json={"email": "engineer@city.gov", "password": "Engineer-password-123!"},
    )
    assert login.status_code == 200

    response = resident_client.get("/api/v1/residents/defects")

    assert response.status_code == 403


def test_public_defects_endpoint_requires_authentication(resident_client: TestClient) -> None:
    response = resident_client.get("/api/v1/residents/defects")

    assert response.status_code == 401


def test_public_user_can_submit_upload_edit_withdraw_and_only_view_own_reports(
    resident_client: TestClient,
    resident_session_factory: sessionmaker[Session],
) -> None:
    with resident_session_factory() as db:
        first = _resident(db)
        first_email = first.email
        _resident(db, "another-resident@example.com")

    login = resident_client.post(
        "/api/v1/auth/login",
        json={"email": first_email, "password": "Resident-password-123!"},
    )
    assert login.status_code == 200
    create = resident_client.post(
        "/api/v1/residents/my/reports",
        json={
            "defect_type": "Pothole",
            "description": "Large pothole outside the library",
            "severity": "High",
            "latitude": 40.7,
            "longitude": -73.9,
            "status": "Verified",
            "created_by": "not-client-controlled",
        },
    )
    assert create.status_code == 422
    create = resident_client.post(
        "/api/v1/residents/my/reports",
        json={
            "defect_type": "Pothole",
            "description": "Large pothole outside the library",
            "severity": "High",
            "latitude": 40.7,
            "longitude": -73.9,
        },
    )
    assert create.status_code == 201
    report = create.json()
    assert report["status"] == "Reported"
    report_id = report["id"]
    with resident_session_factory() as db:
        stored = db.get(RoadDefect, UUID(report_id))
        assert stored is not None
        assert stored.confidence == 0
        assert stored.created_by == first.id

    photo = resident_client.post(
        "/api/v1/evidence/upload",
        data={"defect_id": report_id},
        files={"file": ("damage.jpg", b"\xff\xd8\xffphoto", "image/jpeg")},
    )
    assert photo.status_code == 201
    assert photo.json()["defect_id"] == report_id

    edit = resident_client.patch(
        f"/api/v1/residents/my/reports/{report_id}",
        json={"description": "Updated description"},
    )
    assert edit.status_code == 200
    assert edit.json()["description"] == "Updated description"
    assert len(resident_client.get("/api/v1/residents/my/reports").json()["items"][0]["evidence_ids"]) == 1

    resident_client.post("/api/v1/auth/logout")
    second_login = resident_client.post(
        "/api/v1/auth/login",
        json={"email": "another-resident@example.com", "password": "Resident-password-123!"},
    )
    assert second_login.status_code == 200
    assert resident_client.get("/api/v1/residents/my/reports").json()["total"] == 0
    assert resident_client.patch(
        f"/api/v1/residents/my/reports/{report_id}",
        json={"description": "Unauthorized edit"},
    ).status_code == 404
    assert resident_client.get("/api/v1/defects").json()["total"] == 0
    assert resident_client.get("/api/v1/incidents").status_code == 403
    assert resident_client.get("/api/v1/auth/users").status_code == 403

    resident_client.post("/api/v1/auth/logout")
    resident_client.post(
        "/api/v1/auth/login",
        json={"email": first_email, "password": "Resident-password-123!"},
    )
    withdrawn = resident_client.post(f"/api/v1/residents/my/reports/{report_id}/withdraw")
    assert withdrawn.status_code == 200
    assert withdrawn.json()["status"] == "Withdrawn"
