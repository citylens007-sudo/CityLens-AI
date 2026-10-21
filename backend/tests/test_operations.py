from collections.abc import Generator
from pathlib import Path
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.database import get_db
from app.main import app
from app.models import Base, User, UserRole
from app.security import hash_password
from app.settings import settings


@pytest.fixture
def operations_client(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> Generator[tuple[TestClient, dict[str, UUID]], None, None]:
    engine = create_engine(f"sqlite:///{tmp_path / 'operations-test.db'}")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, expire_on_commit=False)

    def override_get_db() -> Generator[Session, None, None]:
        with session_factory() as db:
            yield db

    app.dependency_overrides[get_db] = override_get_db
    monkeypatch.setattr(settings, "auth_cookie_name", "citylens_test_session")
    monkeypatch.setattr(settings, "auth_session_ttl_minutes", 15)
    monkeypatch.setattr(settings, "app_env", "test")
    monkeypatch.setattr(settings, "frontend_origins", "http://localhost:5173")
    monkeypatch.setattr(settings, "evidence_storage_path", tmp_path / "private-evidence")
    users = {
        "engineer": ("engineer@city.gov", UserRole.MUNICIPAL_ENGINEER),
        "maintenance": ("maintenance@city.gov", UserRole.MAINTENANCE_TEAM),
        "other_maintenance": ("other-maintenance@city.gov", UserRole.MAINTENANCE_TEAM),
        "controller": ("controller@city.gov", UserRole.TRAFFIC_CONTROLLER),
        "police": ("police@city.gov", UserRole.POLICE_TEAM),
        "other_police": ("other-police@city.gov", UserRole.POLICE_TEAM),
        "admin": ("admin@city.gov", UserRole.ADMIN),
    }
    with session_factory() as db:
        user_ids: dict[str, UUID] = {}
        for key, (email, role) in users.items():
            user = User(
                email=email,
                display_name=key.replace("_", " ").title(),
                password_hash=hash_password("CityLens-test-password-123!"),
                role=role,
            )
            db.add(user)
            db.flush()
            user_ids[key] = user.id
        db.commit()

    with TestClient(app) as client:
        yield client, user_ids
    app.dependency_overrides.clear()
    engine.dispose()


def _login(client: TestClient, email: str) -> None:
    response = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "CityLens-test-password-123!"},
    )
    assert response.status_code == 200


def test_defect_crud_validation_and_map(operations_client) -> None:
    client, _ = operations_client
    _login(client, "engineer@city.gov")

    invalid = client.post(
        "/api/defects",
        json={
            "defect_type": "Pothole",
            "severity": "High",
            "confidence": 90,
            "latitude": 91,
            "longitude": 10,
        },
    )
    assert invalid.status_code == 422

    created = client.post(
        "/api/defects",
        json={
            "defect_type": "Pothole",
            "description": "Northbound lane",
            "severity": "High",
            "confidence": 94.5,
            "latitude": 45.5,
            "longitude": -73.6,
        },
    )
    assert created.status_code == 201
    defect_id = created.json()["id"]
    assert client.get(f"/api/defects/{defect_id}").json()["status"] == "Reported"
    assert client.get("/api/defects?severity=high&limit=1").json()["total"] == 1
    assert len(client.get("/api/defects/map").json()) == 1

    updated = client.patch(f"/api/defects/{defect_id}", json={"status": "Verified"})
    assert updated.status_code == 200
    assert updated.json()["status"] == "Verified"


def test_repair_assignment_is_team_scoped_and_role_limited(operations_client) -> None:
    client, user_ids = operations_client
    _login(client, "engineer@city.gov")
    assert client.get("/api/repairs/teams").json()[0]["role"] == "Maintenance Team"
    defect = client.post(
        "/api/defects",
        json={"defect_type": "Cracking", "severity": "Medium", "confidence": 70},
    ).json()
    repair_response = client.post(
        "/api/repairs",
        json={"defect_id": defect["id"], "assigned_team_id": str(user_ids["maintenance"])},
    )
    assert repair_response.status_code == 201
    repair_id = repair_response.json()["id"]

    client.post("/api/v1/auth/logout")
    _login(client, "other-maintenance@city.gov")
    assert client.get("/api/repairs").json()["total"] == 0
    assert client.patch(
        f"/api/repairs/{repair_id}",
        json={"status": "In Progress"},
    ).status_code == 403

    client.post("/api/v1/auth/logout")
    _login(client, "maintenance@city.gov")
    assert client.patch(
        f"/api/repairs/{repair_id}",
        json={"status": "Awaiting Verification"},
    ).status_code == 409
    assert client.patch(
        f"/api/repairs/{repair_id}",
        json={"status": "In Progress", "notes": "Crew dispatched"},
    ).json()["status"] == "In Progress"
    assert client.patch(
        f"/api/repairs/{repair_id}",
        json={"status": "Closed"},
    ).status_code == 403


def test_incident_review_precedes_police_alert_and_alerts_are_scoped(operations_client) -> None:
    client, user_ids = operations_client
    _login(client, "controller@city.gov")
    assert client.get("/api/alerts/police-teams").json()[0]["role"] == "Police Officer"
    incident = client.post(
        "/api/incidents",
        json={"incident_type": "Road obstruction", "incident_timestamp": "2026-10-16T10:00:00Z"},
    )
    assert incident.status_code == 201
    incident_id = incident.json()["id"]
    alert_payload = {
        "incident_id": incident_id,
        "assigned_police_user_id": str(user_ids["police"]),
    }
    assert client.post("/api/alerts", json=alert_payload).status_code == 409
    assert client.patch(
        f"/api/incidents/{incident_id}",
        json={"review_status": "Reviewed"},
    ).status_code == 200
    alert = client.post("/api/alerts", json=alert_payload)
    assert alert.status_code == 201

    client.post("/api/v1/auth/logout")
    _login(client, "other-police@city.gov")
    assert client.get("/api/alerts").json()["total"] == 0
    assert client.get(f"/api/incidents/{incident_id}").status_code == 403

    client.post("/api/v1/auth/logout")
    _login(client, "police@city.gov")
    assert client.patch(
        f"/api/alerts/{alert.json()['id']}",
        json={"alert_status": "Investigating"},
    ).status_code == 409
    assert client.patch(
        f"/api/alerts/{alert.json()['id']}",
        json={"alert_status": "Acknowledged"},
    ).json()["alert_status"] == "Acknowledged"
    saved_notes = client.patch(
        f"/api/alerts/{alert.json()['id']}",
        json={"investigation_notes": "Officer inspected the reported intersection."},
    )
    assert saved_notes.status_code == 200
    assert saved_notes.json()["investigation_notes"] == "Officer inspected the reported intersection."
    client.post("/api/v1/auth/logout")
    _login(client, "other-police@city.gov")
    denied_notes = client.patch(
        f"/api/alerts/{alert.json()['id']}",
        json={"investigation_notes": "Should not be accepted"},
    )
    assert denied_notes.status_code == 403


def test_evidence_upload_is_private_validated_and_uses_safe_storage(
    operations_client,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, _ = operations_client
    _login(client, "engineer@city.gov")
    defect = client.post(
        "/api/defects",
        json={"defect_type": "Pothole", "severity": "Low", "confidence": 50},
    ).json()
    uploaded = client.post(
        "/api/evidence/upload",
        data={"defect_id": defect["id"]},
        files={"file": ("../../road.png", b"\x89PNG\r\n\x1a\nprivate-image-data", "image/png")},
    )
    assert uploaded.status_code == 201
    evidence = uploaded.json()
    assert evidence["original_filename"] == "road.png"
    assert "file_path" not in evidence
    assert client.get(f"/api/evidence/{evidence['id']}").status_code == 200
    gallery = client.get("/api/evidence/images")
    assert gallery.status_code == 200
    assert [item["id"] for item in gallery.json()["items"]] == [evidence["id"]]
    preview = client.get(f"/api/evidence/{evidence['id']}/preview")
    assert preview.status_code == 200
    assert preview.headers["content-type"] == "image/png"
    download = client.get(f"/api/evidence/{evidence['id']}/download")
    assert download.status_code == 200
    assert download.content.startswith(b"\x89PNG\r\n\x1a\n")

    invalid = client.post(
        "/api/evidence/upload",
        files={"file": ("not-an-image.png", b"plain text", "image/png")},
    )
    assert invalid.status_code == 415
    monkeypatch.setattr(settings, "evidence_max_upload_bytes", 10)
    too_large = client.post(
        "/api/evidence/upload",
        files={"file": ("too-large.png", b"x" * 11, "image/png")},
    )
    assert too_large.status_code == 413
    client.post("/api/v1/auth/logout")
    _login(client, "police@city.gov")
    assert client.get(f"/api/evidence/{evidence['id']}").status_code == 403
    assert client.get(f"/api/evidence/{evidence['id']}/download").status_code == 403
    assert client.get("/api/evidence/images").status_code == 403


def test_operations_require_auth_and_expose_root_health_and_docs(operations_client) -> None:
    client, _ = operations_client
    assert client.get("/api/dashboard/summary").status_code == 401
    assert client.get("/health").status_code == 200
    assert client.get("/docs").status_code == 200

    response = client.post(
        "/api/auth/login",
        json={"email": "engineer@city.gov", "password": "CityLens-test-password-123!"},
    )
    assert response.status_code == 200
    assert client.get("/api/auth/me").status_code == 200
    assert client.get("/api/v1/dashboard/summary").status_code == 200
