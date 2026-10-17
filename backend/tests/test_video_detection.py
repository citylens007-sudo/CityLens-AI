from collections.abc import Generator
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.database import get_db
from app.main import app
from app.models import (
    Base,
    Evidence,
    EvidenceType,
    RoadDefect,
    RoadDetection,
    RoadDetectionJob,
    User,
    UserRole,
)
from app.security import hash_password
from app.settings import settings
import app.video_detection as video_detection


@pytest.fixture
def video_client(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> Generator[tuple[TestClient, dict[str, UUID], sessionmaker[Session]], None, None]:
    engine = create_engine(f"sqlite:///{tmp_path / 'video-test.db'}")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, expire_on_commit=False)

    def override_get_db() -> Generator[Session, None, None]:
        with session_factory() as db:
            yield db

    app.dependency_overrides[get_db] = override_get_db
    monkeypatch.setattr(video_detection, "get_session_factory", lambda: session_factory)
    monkeypatch.setattr(settings, "auth_cookie_name", "citylens_video_test_session")
    monkeypatch.setattr(settings, "auth_session_ttl_minutes", 15)
    monkeypatch.setattr(settings, "app_env", "test")
    monkeypatch.setattr(settings, "frontend_origins", "http://localhost:5173")
    monkeypatch.setattr(settings, "evidence_storage_path", tmp_path / "private-evidence")
    monkeypatch.setattr(settings, "road_video_storage_path", tmp_path / "private-videos")
    monkeypatch.setattr(settings, "road_video_max_upload_bytes", 1024)
    monkeypatch.setattr(settings, "road_video_max_duration_seconds", 60)
    monkeypatch.setattr(settings, "road_damage_model_path", None)

    with session_factory() as db:
        engineer = User(
            email="video-engineer@city.gov",
            display_name="Video Engineer",
            password_hash=hash_password("CityLens-test-password-123!"),
            role=UserRole.MUNICIPAL_ENGINEER,
        )
        maintenance = User(
            email="video-maintenance@city.gov",
            display_name="Video Maintenance",
            password_hash=hash_password("CityLens-test-password-123!"),
            role=UserRole.MAINTENANCE_TEAM,
        )
        db.add_all([engineer, maintenance])
        db.commit()
        user_ids = {"engineer": engineer.id, "maintenance": maintenance.id}

    with TestClient(app) as client:
        yield client, user_ids, session_factory
    app.dependency_overrides.clear()
    engine.dispose()


def _login(client: TestClient, email: str = "video-engineer@city.gov") -> None:
    response = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "CityLens-test-password-123!"},
    )
    assert response.status_code == 200


def _valid_video() -> tuple[str, bytes, str]:
    return ("road.mp4", b"\x00\x00\x00\x18ftypisom\x00\x00\x00\x00", "video/mp4")


def test_detection_routes_require_engineer_authentication(video_client) -> None:
    client, _, _ = video_client
    assert client.get("/api/v1/detection/availability").status_code == 401
    _login(client, "video-maintenance@city.gov")
    assert client.get("/api/v1/detection/availability").status_code == 403
    assert client.post(
        "/api/v1/detection-jobs",
        files={"file": _valid_video()},
    ).status_code == 403


def test_model_missing_keeps_detection_unavailable(video_client) -> None:
    client, _, _ = video_client
    _login(client)
    availability = client.get("/api/v1/detection/availability")
    assert availability.status_code == 200
    assert availability.json()["available"] is False
    assert "ROAD_DAMAGE_MODEL_PATH" in availability.json()["message"]
    assert client.post(
        "/api/v1/detection-jobs",
        files={"file": _valid_video()},
    ).status_code == 503


def test_model_class_names_must_include_road_damage_labels(video_client, monkeypatch, tmp_path) -> None:
    client, _, _ = video_client
    _login(client)
    weights = tmp_path / "generic.pt"
    weights.write_bytes(b"placeholder")
    monkeypatch.setattr(settings, "road_damage_model_path", weights)
    fake_cv2 = ModuleType("cv2")
    fake_ultralytics = ModuleType("ultralytics")
    fake_ultralytics.YOLO = lambda _: SimpleNamespace(names={0: "person", 1: "car"})
    monkeypatch.setitem(sys.modules, "cv2", fake_cv2)
    monkeypatch.setitem(sys.modules, "ultralytics", fake_ultralytics)
    video_detection._load_detector.cache_clear()
    try:
        availability = client.get("/api/v1/detection/availability").json()
        assert availability["available"] is False
        assert "no supported road-damage classes" in availability["message"]
        fake_ultralytics.YOLO = lambda _: SimpleNamespace(names={0: "D40"})
        video_detection._load_detector.cache_clear()
        compatible = client.get("/api/v1/detection/availability").json()
    finally:
        video_detection._load_detector.cache_clear()
    assert compatible["available"] is True
    assert compatible["classes"] == ["D40"]


def test_upload_rejects_unsupported_video_and_oversized_file(video_client, monkeypatch) -> None:
    client, _, _ = video_client
    _login(client)
    monkeypatch.setattr(
        video_detection,
        "detector_availability",
        lambda: {"available": True, "message": "ready", "classes": ["Pothole"]},
    )
    unsupported = client.post(
        "/api/v1/detection-jobs",
        files={"file": ("road.avi", b"video", "video/x-msvideo")},
    )
    assert unsupported.status_code == 415
    oversized = client.post(
        "/api/v1/detection-jobs",
        files={"file": ("road.mp4", b"\x00\x00\x00\x18ftyp" + b"x" * 1100, "video/mp4")},
    )
    assert oversized.status_code == 413
    assert list(settings.road_video_storage_path.iterdir()) == []


def test_corrupted_video_is_marked_failed(video_client, monkeypatch) -> None:
    client, _, _ = video_client
    _login(client)

    class InvalidCapture:
        def isOpened(self) -> bool:
            return False

        def release(self) -> None:
            pass

    fake_cv2 = SimpleNamespace(VideoCapture=lambda _: InvalidCapture())
    monkeypatch.setattr(
        video_detection,
        "detector_availability",
        lambda: {"available": True, "message": "ready", "classes": ["Pothole"]},
    )
    monkeypatch.setattr(
        video_detection,
        "_load_detector",
        lambda _: (object(), {0: ("pothole", "Pothole")}, fake_cv2),
    )
    uploaded = client.post(
        "/api/v1/detection-jobs",
        files={"file": _valid_video()},
    )
    assert uploaded.status_code == 202
    failed = client.get(f"/api/v1/detection-jobs/{uploaded.json()['id']}").json()
    assert failed["status"] == "Failed"
    assert "could not be decoded" in failed["status_message"]


def test_sampled_model_output_persists_detection_and_annotated_evidence(
    video_client,
    monkeypatch,
) -> None:
    _, user_ids, session_factory = video_client
    video_path = settings.road_video_storage_path / "sample.mp4"
    video_path.parent.mkdir(parents=True, exist_ok=True)
    video_path.write_bytes(b"test fixture")
    with session_factory() as db:
        job = RoadDetectionJob(
            uploaded_by=user_ids["engineer"],
            original_filename="sample.mp4",
            video_path=str(video_path),
            status="Pending",
        )
        db.add(job)
        db.commit()
        job_id = job.id

    class FakeCapture:
        def isOpened(self) -> bool:
            return True

        def get(self, property_id: int) -> float:
            return 1.0

        def set(self, property_id: int, value: float) -> bool:
            return True

        def read(self) -> tuple[bool, object]:
            return True, object()

        def release(self) -> None:
            pass

    class FakeModel:
        names = {0: "pothole"}

        def __call__(self, frame: object, verbose: bool) -> list[object]:
            box = SimpleNamespace(
                xyxy=[SimpleNamespace(cpu=lambda: SimpleNamespace(tolist=lambda: [1, 2, 10, 12]))],
                conf=[SimpleNamespace(item=lambda: 0.91)],
                cls=[SimpleNamespace(item=lambda: 0)],
            )
            return [SimpleNamespace(boxes=[box])]

    def save_frame(path: str, frame: object) -> bool:
        Path(path).write_bytes(b"annotated-fixture")
        return True

    fake_cv2 = SimpleNamespace(
        CAP_PROP_FPS=1,
        CAP_PROP_FRAME_COUNT=2,
        CAP_PROP_POS_MSEC=3,
        FONT_HERSHEY_SIMPLEX=0,
        VideoCapture=lambda _: FakeCapture(),
        rectangle=lambda *args: None,
        putText=lambda *args: None,
        imwrite=save_frame,
    )
    monkeypatch.setattr(
        video_detection,
        "_load_detector",
        lambda _: (FakeModel(), {0: ("pothole", "Pothole")}, fake_cv2),
    )
    video_detection.process_detection_job(str(job_id))

    with session_factory() as db:
        job = db.get(RoadDetectionJob, job_id)
        assert job is not None
        assert job.status == "Completed"
        assert job.progress == 100
        detection = db.query(RoadDetection).filter_by(job_id=job_id).one()
        assert detection.class_name == "Pothole"
        assert detection.confidence == pytest.approx(0.91)
        assert detection.video_timestamp_seconds == 0
        assert detection.evidence is not None
        assert Path(detection.evidence.file_path).read_bytes() == b"annotated-fixture"


def test_upload_persists_private_job_and_verified_sidecar_coordinates(
    video_client,
    monkeypatch,
) -> None:
    client, user_ids, session_factory = video_client
    _login(client)
    monkeypatch.setattr(
        video_detection,
        "detector_availability",
        lambda: {"available": True, "message": "ready", "classes": ["Pothole"]},
    )
    monkeypatch.setattr(video_detection, "process_detection_job", lambda _: None)
    response = client.post(
        "/api/v1/detection-jobs",
        files={
            "file": ("../../road.mp4", _valid_video()[1], "video/mp4"),
            "gps_sidecar": ("position.json", b'{"latitude": 45.5, "longitude": -73.6}', "application/json"),
        },
    )
    assert response.status_code == 202
    job = response.json()
    assert job["status"] == "Pending"
    assert job["latitude"] == 45.5
    assert job["longitude"] == -73.6
    assert job["location_source"] == "sidecar"
    assert job["original_filename"] == "road.mp4"
    assert "video_path" not in job
    with session_factory() as db:
        stored = db.get(RoadDetectionJob, UUID(job["id"]))
        assert stored is not None
        assert Path(stored.video_path).parent == settings.road_video_storage_path.resolve()
        assert stored.uploaded_by == user_ids["engineer"]
    assert client.get(f"/api/v1/detection-jobs/{job['id']}").json()["detections"] == []


def test_invalid_sidecar_coordinates_are_rejected(video_client, monkeypatch) -> None:
    client, _, _ = video_client
    _login(client)
    monkeypatch.setattr(
        video_detection,
        "detector_availability",
        lambda: {"available": True, "message": "ready", "classes": ["Pothole"]},
    )
    response = client.post(
        "/api/v1/detection-jobs",
        files={
            "file": _valid_video(),
            "gps_sidecar": ("position.json", b'{"latitude": 91, "longitude": -73.6}', "application/json"),
        },
    )
    assert response.status_code == 422
    assert not settings.road_video_storage_path.exists()


def test_detection_evidence_is_private_and_role_protected(video_client) -> None:
    client, user_ids, session_factory = video_client
    evidence_path = settings.evidence_storage_path / "frame.jpg"
    evidence_path.parent.mkdir(parents=True)
    evidence_path.write_bytes(b"private-frame")
    with session_factory() as db:
        job = RoadDetectionJob(
            uploaded_by=user_ids["engineer"],
            original_filename="road.mp4",
            video_path=str(settings.road_video_storage_path / "source.mp4"),
            status="Completed",
        )
        db.add(job)
        db.flush()
        evidence = Evidence(
            evidence_type=EvidenceType.IMAGE,
            file_path=str(evidence_path),
            original_filename="frame.jpg",
            content_type="image/jpeg",
            uploaded_by=user_ids["engineer"],
        )
        db.add(evidence)
        db.flush()
        detection = RoadDetection(
            job_id=job.id,
            class_name="Pothole",
            confidence=0.8,
            video_timestamp_seconds=0,
            bbox_x1=1,
            bbox_y1=1,
            bbox_x2=10,
            bbox_y2=10,
            evidence_id=evidence.id,
        )
        db.add(detection)
        db.commit()
        job_id = job.id
        evidence_id = evidence.id

    _login(client)
    image = client.get(f"/api/v1/detection-jobs/{job_id}/evidence/{evidence_id}")
    assert image.status_code == 200
    assert image.content == b"private-frame"
    client.post("/api/v1/auth/logout")
    _login(client, "video-maintenance@city.gov")
    assert client.get(f"/api/v1/detection-jobs/{job_id}/evidence/{evidence_id}").status_code == 403


def test_processing_fails_closed_without_model_and_confirmation_creates_report(
    video_client,
    monkeypatch,
) -> None:
    client, user_ids, session_factory = video_client
    _login(client)
    monkeypatch.setattr(
        video_detection,
        "detector_availability",
        lambda: {"available": True, "message": "ready", "classes": ["Pothole"]},
    )
    uploaded = client.post(
        "/api/v1/detection-jobs",
        files={"file": _valid_video()},
    )
    assert uploaded.status_code == 202
    failed_job = client.get(f"/api/v1/detection-jobs/{uploaded.json()['id']}").json()
    assert failed_job["status"] == "Failed"
    assert "model" in failed_job["status_message"].lower()
    assert settings.road_video_storage_path.resolve().as_posix() not in failed_job["status_message"]

    with session_factory() as db:
        job = db.get(RoadDetectionJob, UUID(uploaded.json()["id"]))
        assert job is not None
        job.status = "Completed"
        detection = RoadDetection(
            job_id=job.id,
            class_name="Pothole",
            confidence=0.93,
            video_timestamp_seconds=2.5,
            bbox_x1=1,
            bbox_y1=2,
            bbox_x2=50,
            bbox_y2=60,
        )
        db.add(detection)
        db.commit()
        detection_id = detection.id

    confirmed = client.post(
        f"/api/v1/detections/{detection_id}/confirm",
        json={"severity": "High"},
    )
    assert confirmed.status_code == 200
    assert confirmed.json()["detection"]["review_status"] == "Confirmed"
    with session_factory() as db:
        saved_detection = db.get(RoadDetection, detection_id)
        assert saved_detection is not None
        assert saved_detection.defect_id is not None
        defect = db.get(RoadDefect, saved_detection.defect_id)
        assert defect is not None
        assert defect.created_by == user_ids["engineer"]
        assert defect.confidence == pytest.approx(93)
