from collections.abc import Generator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from app.database import get_db
from app.main import app
from app.models import AuditLog, AuthSession, Base, DefectStatus, RoadDefect, User, UserRole
from app.security import hash_password
from app.settings import settings


@pytest.fixture
def auth_session_factory(tmp_path: Path) -> Generator[sessionmaker[Session], None, None]:
    engine = create_engine(f"sqlite:///{tmp_path / 'auth-test.db'}")
    Base.metadata.create_all(engine)
    test_session_factory = sessionmaker(bind=engine, expire_on_commit=False)
    yield test_session_factory
    engine.dispose()


@pytest.fixture
def auth_client(
    auth_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> Generator[TestClient, None, None]:

    def override_get_db() -> Generator[Session, None, None]:
        with auth_session_factory() as db:
            yield db

    app.dependency_overrides[get_db] = override_get_db
    monkeypatch.setattr(settings, "auth_cookie_name", "citylens_test_session")
    monkeypatch.setattr(settings, "auth_session_ttl_minutes", 15)
    monkeypatch.setattr(settings, "app_env", "test")
    monkeypatch.setattr(settings, "frontend_origins", "http://localhost:5173")

    with auth_session_factory() as db:
        db.add(
            User(
                email="engineer@city.gov",
                display_name="Morgan Engineer",
                password_hash=hash_password("Engineer-password-123!"),
                role=UserRole.MUNICIPAL_ENGINEER,
            )
        )
        db.add(
            User(
                email="admin@city.gov",
                display_name="Avery Admin",
                password_hash=hash_password("Admin-password-123!"),
                role=UserRole.ADMIN,
            )
        )
        db.commit()

    with TestClient(app) as client:
        yield client

    app.dependency_overrides.clear()


def test_login_uses_argon2_and_sets_http_only_session_cookie(
    auth_client: TestClient,
    auth_session_factory: sessionmaker[Session],
) -> None:
    response = auth_client.post(
        "/api/v1/auth/login",
        json={"email": "ENGINEER@CITY.GOV", "password": "Engineer-password-123!"},
    )

    assert response.status_code == 200
    assert response.json()["email"] == "engineer@city.gov"
    assert response.json()["role"] == "Municipal Engineer"
    assert "password_hash" not in response.json()
    cookie_header = response.headers["set-cookie"].lower()
    assert "httponly" in cookie_header
    assert "samesite=lax" in cookie_header
    raw_token = auth_client.cookies.get("citylens_test_session")
    assert raw_token
    with auth_session_factory() as db:
        user = db.scalar(select(User).where(User.email == "engineer@city.gov"))
        assert user is not None
        session = db.scalar(select(AuthSession).where(AuthSession.user_id == user.id))
        assert user.password_hash.startswith("$argon2id$")
        assert session is not None
        assert session.token_hash != raw_token
        assert len(session.token_hash) == 64


def test_production_session_cookie_is_secure(auth_client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "app_env", "production")

    response = auth_client.post(
        "/api/v1/auth/login",
        json={"email": "engineer@city.gov", "password": "Engineer-password-123!"},
    )

    assert response.status_code == 200
    cookie_header = response.headers["set-cookie"].lower()
    assert "secure" in cookie_header
    assert "samesite=none" in cookie_header


def test_incorrect_password_does_not_create_a_session(auth_client: TestClient) -> None:
    response = auth_client.post(
        "/api/v1/auth/login",
        json={"email": "engineer@city.gov", "password": "incorrect-password"},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid email or password"
    assert auth_client.cookies.get("citylens_test_session") is None


def test_unknown_email_has_the_same_safe_login_error(auth_client: TestClient) -> None:
    response = auth_client.post(
        "/api/v1/auth/login",
        json={"email": "unknown@city.gov", "password": "Engineer-password-123!"},
    )

    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid email or password"}
    assert auth_client.cookies.get("citylens_test_session") is None


def test_inactive_account_cannot_log_in(auth_client: TestClient, auth_session_factory) -> None:
    with auth_session_factory() as db:
        user = db.scalar(select(User).where(User.email == "engineer@city.gov"))
        assert user is not None
        user.is_active = False
        db.commit()

    response = auth_client.post(
        "/api/v1/auth/login",
        json={"email": "engineer@city.gov", "password": "Engineer-password-123!"},
    )

    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid email or password"}
    assert auth_client.cookies.get("citylens_test_session") is None
    with auth_session_factory() as db:
        assert db.scalar(select(AuthSession.id)) is None


def test_all_six_roles_can_log_in_with_valid_accounts(
    auth_client: TestClient,
    auth_session_factory,
) -> None:
    additional_roles = [
        UserRole.MAINTENANCE_TEAM,
        UserRole.TRAFFIC_CONTROLLER,
        UserRole.POLICE_TEAM,
        UserRole.PUBLIC_USER,
    ]
    with auth_session_factory() as db:
        for role in additional_roles:
            role_slug = role.value.lower().replace(" ", "-")
            db.add(
                User(
                    email=f"{role_slug}@city.gov",
                    display_name=role.value,
                    password_hash=hash_password("CityLens-role-password-123!"),
                    role=role,
                )
            )
        db.commit()

    credentials = [
        ("engineer@city.gov", "Engineer-password-123!", UserRole.MUNICIPAL_ENGINEER),
        ("admin@city.gov", "Admin-password-123!", UserRole.ADMIN),
        ("maintenance-team@city.gov", "CityLens-role-password-123!", UserRole.MAINTENANCE_TEAM),
        ("traffic-controller@city.gov", "CityLens-role-password-123!", UserRole.TRAFFIC_CONTROLLER),
        ("police-officer@city.gov", "CityLens-role-password-123!", UserRole.POLICE_OFFICER),
        ("public-user@city.gov", "CityLens-role-password-123!", UserRole.PUBLIC_USER),
    ]
    for email, password, role in credentials:
        auth_client.post("/api/v1/auth/logout")
        response = auth_client.post(
            "/api/v1/auth/login",
            json={"email": email, "password": password},
        )
        assert response.status_code == 200
        assert response.json()["role"] == role.value
        if role != UserRole.ADMIN:
            with auth_session_factory() as db:
                admin_id = db.scalar(select(User.id).where(User.email == "admin@city.gov"))
                assert admin_id is not None
            assert auth_client.delete(f"/api/v1/auth/users/{admin_id}").status_code == 403


def test_untrusted_origin_cannot_create_a_session(auth_client: TestClient) -> None:
    response = auth_client.post(
        "/api/v1/auth/login",
        headers={"Origin": "https://untrusted.example"},
        json={"email": "engineer@city.gov", "password": "Engineer-password-123!"},
    )

    assert response.status_code == 403
    assert auth_client.cookies.get("citylens_test_session") is None


def test_private_endpoints_reject_missing_or_forged_frontend_roles(auth_client: TestClient) -> None:
    response = auth_client.get("/api/v1/auth/me", headers={"X-User-Role": "Admin"})

    assert response.status_code == 401
    assert auth_client.get("/api/v1/auth/users", headers={"X-User-Role": "Admin"}).status_code == 401


def test_logout_revokes_session_and_clears_cookie(auth_client: TestClient) -> None:
    auth_client.post(
        "/api/v1/auth/login",
        json={"email": "engineer@city.gov", "password": "Engineer-password-123!"},
    )
    assert auth_client.get("/api/v1/auth/me").status_code == 200

    response = auth_client.post("/api/v1/auth/logout")

    assert response.status_code == 204
    assert "max-age=0" in response.headers["set-cookie"].lower()
    assert auth_client.get("/api/v1/auth/me").status_code == 401


def test_expired_session_is_rejected(auth_client: TestClient, auth_session_factory: sessionmaker[Session]) -> None:
    auth_client.post(
        "/api/v1/auth/login",
        json={"email": "engineer@city.gov", "password": "Engineer-password-123!"},
    )
    with auth_session_factory() as db:
        session = db.scalar(select(AuthSession))
        assert session is not None
        session.expires_at = datetime.now(UTC) - timedelta(minutes=1)
        db.commit()

    assert auth_client.get("/api/v1/auth/me").status_code == 401


def test_deactivated_account_loses_existing_session(
    auth_client: TestClient,
    auth_session_factory: sessionmaker[Session],
) -> None:
    auth_client.post(
        "/api/v1/auth/login",
        json={"email": "engineer@city.gov", "password": "Engineer-password-123!"},
    )
    with auth_session_factory() as db:
        engineer = db.scalar(select(User).where(User.email == "engineer@city.gov"))
        assert engineer is not None
        engineer.is_active = False
        db.commit()

    assert auth_client.get("/api/v1/auth/me").status_code == 401


def test_non_admin_cannot_list_or_create_users(auth_client: TestClient) -> None:
    auth_client.post(
        "/api/v1/auth/login",
        json={"email": "engineer@city.gov", "password": "Engineer-password-123!"},
    )

    assert auth_client.get("/api/v1/auth/users").status_code == 403
    response = auth_client.post(
        "/api/v1/auth/users",
        json={
            "email": "new-user@city.gov",
            "display_name": "New User",
            "password": "New-user-password-123!",
            "role": "Admin",
        },
    )
    assert response.status_code == 403


def test_admin_can_create_users_but_password_is_only_stored_as_hash(
    auth_client: TestClient, auth_session_factory: sessionmaker[Session]
) -> None:
    auth_client.post(
        "/api/v1/auth/login",
        json={"email": "admin@city.gov", "password": "Admin-password-123!"},
    )

    response = auth_client.post(
        "/api/v1/auth/users",
        json={
            "email": "new-user@city.gov",
            "display_name": "New User",
            "password": "New-user-password-123!",
            "role": "Police Officer",
        },
    )

    assert response.status_code == 201
    assert response.json()["role"] == "Police Officer"
    with auth_session_factory() as db:
        user = db.scalar(select(User).where(User.email == "new-user@city.gov"))
        assert user is not None
        assert user.password_hash.startswith("$argon2id$")
        assert "New-user-password-123!" not in user.password_hash


def test_duplicate_email_and_weak_password_are_rejected(auth_client: TestClient) -> None:
    auth_client.post(
        "/api/v1/auth/login",
        json={"email": "admin@city.gov", "password": "Admin-password-123!"},
    )
    duplicate = auth_client.post(
        "/api/v1/auth/users",
        json={
            "email": "ENGINEER@CITY.GOV",
            "display_name": "Duplicate",
            "password": "Another-password-123!",
            "role": "Police Officer",
        },
    )
    weak_password = auth_client.post(
        "/api/v1/auth/users",
        json={
            "email": "weak@city.gov",
            "display_name": "Weak Password",
            "password": "short",
            "role": "Police Officer",
        },
    )
    invalid_role = auth_client.post(
        "/api/v1/auth/users",
        json={
            "email": "invalid-role@city.gov",
            "display_name": "Invalid Role",
            "password": "Long-enough-password-123!",
            "role": "Super Administrator",
        },
    )

    assert duplicate.status_code == 409
    assert weak_password.status_code == 422
    assert invalid_role.status_code == 422


def test_cannot_remove_last_active_admin(auth_client: TestClient, auth_session_factory: sessionmaker[Session]) -> None:
    auth_client.post(
        "/api/v1/auth/login",
        json={"email": "admin@city.gov", "password": "Admin-password-123!"},
    )
    with auth_session_factory() as db:
        admin = db.scalar(select(User).where(User.email == "admin@city.gov"))
        assert admin is not None
        admin_id = admin.id

    response = auth_client.patch(f"/api/v1/auth/users/{admin_id}", json={"is_active": False})
    delete_self = auth_client.delete(f"/api/v1/auth/users/{admin_id}")

    assert response.status_code == 400
    assert delete_self.status_code == 400


def test_admin_soft_deletes_accounts_and_preserves_report_and_audit_history(
    auth_client: TestClient,
    auth_session_factory: sessionmaker[Session],
) -> None:
    with auth_session_factory() as db:
        engineer = db.scalar(select(User).where(User.email == "engineer@city.gov"))
        admin = db.scalar(select(User).where(User.email == "admin@city.gov"))
        assert engineer is not None and admin is not None
        engineer_id = engineer.id
        report = RoadDefect(
            defect_type="Pothole",
            description="Report ownership must remain intact",
            severity="Medium",
            confidence=0,
            latitude=40,
            longitude=-70,
            detected_at=datetime.now(UTC),
            status=DefectStatus.REPORTED,
            created_by=engineer.id,
        )
        db.add(report)
        db.commit()
        report_id = report.id

    auth_client.post(
        "/api/v1/auth/login",
        json={"email": "engineer@city.gov", "password": "Engineer-password-123!"},
    )
    assert auth_client.get("/api/v1/auth/me").status_code == 200
    auth_client.post("/api/v1/auth/logout")
    auth_client.post(
        "/api/v1/auth/login",
        json={"email": "admin@city.gov", "password": "Admin-password-123!"},
    )

    response = auth_client.delete(f"/api/v1/auth/users/{engineer_id}")

    assert response.status_code == 204
    assert auth_client.get("/api/v1/auth/users?limit=1&offset=0").status_code == 200
    with auth_session_factory() as db:
        engineer = db.get(User, engineer_id)
        assert engineer is not None
        assert engineer.deleted_at is not None
        assert engineer.is_active is False
        assert db.get(RoadDefect, report_id).created_by == engineer_id
        assert db.scalar(
            select(AuthSession.id).where(AuthSession.user_id == engineer_id)
        ) is None
        deletion_log = db.scalar(
            select(AuditLog).where(
                AuditLog.action == "soft_deleted",
                AuditLog.entity_type == "user",
                AuditLog.entity_id == engineer_id,
            )
        )
        assert deletion_log is not None


def test_public_registration_rejects_a_manipulated_staff_role(auth_client: TestClient) -> None:
    response = auth_client.post(
        "/api/v1/auth/register",
        json={
            "email": "attacker@example.com",
            "display_name": "Public Registrant",
            "password": "Public-user-password-123!",
            "confirm_password": "Public-user-password-123!",
            "role": "Admin",
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"][-1] == "role"