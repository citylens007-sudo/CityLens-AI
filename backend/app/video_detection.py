import json
import logging
import math
import re
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.database import get_session_factory
from app.dependencies import CurrentUser, DatabaseSession, require_roles, require_trusted_origin
from app.models import (
    AuditLog,
    DefectStatus,
    Evidence,
    EvidenceType,
    Observation,
    RoadDefect,
    RoadDetection,
    RoadDetectionJob,
    User,
    UserRole,
)
from app.settings import settings


logger = logging.getLogger(__name__)
router = APIRouter(dependencies=[Depends(require_trusted_origin)])
RoadEngineer = Annotated[
    User, Depends(require_roles(UserRole.ADMIN, UserRole.MUNICIPAL_ENGINEER))
]

ROAD_DAMAGE_CLASSES = {
    "pothole": "Pothole",
    "crack": "Crack",
    "longitudinal crack": "Longitudinal crack",
    "transverse crack": "Transverse crack",
    "alligator crack": "Alligator crack",
    "rutting": "Rutting",
    "d00": "Longitudinal crack",
    "d10": "Transverse crack",
    "d20": "Alligator crack",
    "d40": "Pothole",
}
VIDEO_TYPES = {
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
}
VIDEO_UPLOAD_CHUNK_BYTES = 1024 * 1024
MAX_SIDECAR_BYTES = 64 * 1024


class DetectorUnavailable(Exception):
    pass


class VideoProcessingError(Exception):
    pass


class DetectionConfirmation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    severity: Literal["High", "Medium", "Low"]
    description: str | None = Field(default=None, max_length=4000)


def _normalise_class_name(name: str) -> str:
    return re.sub(r"\s+", " ", name.strip().lower().replace("_", " "))


@lru_cache(maxsize=2)
def _load_detector(model_path: str) -> tuple[object, dict[int, tuple[str, str]], object]:
    path = Path(model_path)
    if not path.is_file():
        raise DetectorUnavailable("Configure ROAD_DAMAGE_MODEL_PATH with a local road-damage model file.")
    try:
        import cv2
        from ultralytics import YOLO
    except ImportError as error:
        raise DetectorUnavailable(
            "Install the optional OpenCV and Ultralytics dependencies to enable video detection."
        ) from error

    try:
        model = YOLO(str(path))
        names = model.names
    except Exception as error:
        logger.error("Configured road-damage model failed to load (%s).", type(error).__name__)
        raise DetectorUnavailable(
            "The configured model could not be loaded. Check its format and backend logs."
        ) from error

    class_names = names.items() if isinstance(names, dict) else enumerate(names)
    compatible: dict[int, tuple[str, str]] = {}
    for class_id, name in class_names:
        actual_name = str(name).strip()
        label = ROAD_DAMAGE_CLASSES.get(_normalise_class_name(actual_name))
        if label is not None:
            compatible[int(class_id)] = (actual_name, label)
    if not compatible:
        raise DetectorUnavailable(
            "The configured model has no supported road-damage classes; supported labels include "
            "pothole, crack, longitudinal crack, transverse crack, alligator crack, rutting, D00, D10, D20 and D40."
        )
    return model, compatible, cv2


def detector_availability() -> dict[str, object]:
    if settings.road_damage_model_path is None:
        return {
            "available": False,
            "message": "Configure ROAD_DAMAGE_MODEL_PATH with a compatible road-damage model.",
            "classes": [],
        }
    try:
        _, classes, _ = _load_detector(str(settings.road_damage_model_path.resolve()))
    except DetectorUnavailable as error:
        return {"available": False, "message": str(error), "classes": []}
    return {
        "available": True,
        "message": "Compatible road-damage model is ready.",
        "classes": sorted({actual_name for actual_name, _ in classes.values()}),
    }


def _serialise_detection(detection: RoadDetection) -> dict[str, object]:
    return {
        "id": str(detection.id),
        "job_id": str(detection.job_id),
        "class_name": detection.class_name,
        "confidence": detection.confidence,
        "video_timestamp_seconds": detection.video_timestamp_seconds,
        "bounding_box": {
            "x1": detection.bbox_x1,
            "y1": detection.bbox_y1,
            "x2": detection.bbox_x2,
            "y2": detection.bbox_y2,
        },
        "evidence_id": str(detection.evidence_id) if detection.evidence_id else None,
        "evidence_url": (
            f"/api/v1/detection-jobs/{detection.job_id}/evidence/{detection.evidence_id}"
            if detection.evidence_id
            else None
        ),
        "review_status": detection.review_status,
        "defect_id": str(detection.defect_id) if detection.defect_id else None,
        "created_at": detection.created_at.isoformat(),
    }


def _serialise_job(job: RoadDetectionJob, include_detections: bool = True) -> dict[str, object]:
    result: dict[str, object] = {
        "id": str(job.id),
        "status": job.status,
        "progress": job.progress,
        "status_message": job.status_message,
        "original_filename": job.original_filename,
        "video_url": f"/api/v1/detection-jobs/{job.id}/video",
        "latitude": job.latitude,
        "longitude": job.longitude,
        "location_source": job.location_source,
        "created_at": job.created_at.isoformat(),
        "started_at": job.started_at.isoformat() if job.started_at else None,
        "completed_at": job.completed_at.isoformat() if job.completed_at else None,
    }
    if include_detections:
        result["detections"] = [
            _serialise_detection(detection)
            for detection in sorted(job.detections, key=lambda item: item.video_timestamp_seconds)
        ]
    return result


def _safe_original_filename(filename: str | None) -> str:
    name = (filename or "").replace("\\", "/").rsplit("/", 1)[-1]
    name = "".join(character for character in name if character.isprintable()).strip()
    return name[:255]


def _read_sidecar(file: UploadFile) -> tuple[float, float]:
    if Path(file.filename or "").suffix.lower() != ".json":
        raise HTTPException(status_code=415, detail="GPS sidecar must be a JSON file")
    if file.content_type not in {"application/json", "text/json"}:
        raise HTTPException(status_code=415, detail="GPS sidecar must use the JSON content type")
    raw = file.file.read(MAX_SIDECAR_BYTES + 1)
    if len(raw) > MAX_SIDECAR_BYTES:
        raise HTTPException(status_code=413, detail="GPS sidecar exceeds the 64 KB limit")
    try:
        payload = json.loads(raw)
        latitude = payload["latitude"]
        longitude = payload["longitude"]
    except (json.JSONDecodeError, KeyError, TypeError) as error:
        raise HTTPException(
            status_code=422, detail="GPS sidecar must contain latitude and longitude numbers"
        ) from error
    if (
        isinstance(latitude, bool)
        or isinstance(longitude, bool)
        or not isinstance(latitude, (int, float))
        or not isinstance(longitude, (int, float))
        or not math.isfinite(latitude)
        or not math.isfinite(longitude)
        or not -90 <= latitude <= 90
        or not -180 <= longitude <= 180
    ):
        raise HTTPException(status_code=422, detail="GPS sidecar coordinates are outside valid ranges")
    return float(latitude), float(longitude)


def _store_video(file: UploadFile, extension: str) -> tuple[Path, int]:
    root = settings.road_video_storage_path.resolve()
    try:
        root.mkdir(parents=True, exist_ok=True)
    except OSError as error:
        raise HTTPException(status_code=500, detail="Private video storage is unavailable") from error

    upload_id = uuid4()
    path = root / f"{upload_id}{extension}"
    temporary_path = root / f".{upload_id}.upload"
    size = 0
    prefix = bytearray()
    try:
        with temporary_path.open("xb") as destination:
            while chunk := file.file.read(VIDEO_UPLOAD_CHUNK_BYTES):
                size += len(chunk)
                if size > settings.road_video_max_upload_bytes:
                    raise HTTPException(
                        status_code=413, detail="Video exceeds the configured upload limit"
                    )
                if len(prefix) < 16:
                    prefix.extend(chunk[: 16 - len(prefix)])
                destination.write(chunk)
        if size == 0 or len(prefix) < 8 or prefix[4:8] != b"ftyp":
            raise HTTPException(status_code=415, detail="Video contents do not match MP4 or MOV format")
        if temporary_path.parent.resolve() != root:
            raise HTTPException(status_code=400, detail="Invalid video storage path")
        temporary_path.replace(path)
        return path, size
    except (HTTPException, OSError):
        temporary_path.unlink(missing_ok=True)
        raise
    finally:
        file.file.close()


def _job_accessible(job: RoadDetectionJob, actor: User) -> bool:
    return actor.role in {UserRole.ADMIN, UserRole.MUNICIPAL_ENGINEER} or job.uploaded_by == actor.id


def _save_failed_job(job_id: UUID, message: str) -> None:
    with get_session_factory()() as db:
        job = db.get(RoadDetectionJob, job_id)
        if job is not None:
            job.status = "Failed"
            job.status_message = message
            job.completed_at = datetime.now(UTC)
            db.commit()


def _box_values(box: object) -> tuple[float, float, float, float, float, int]:
    xyxy = box.xyxy[0].cpu().tolist()
    confidence = float(box.conf[0].item())
    class_id = int(box.cls[0].item())
    values = (*xyxy, confidence)
    if len(xyxy) != 4 or not all(math.isfinite(float(value)) for value in values):
        raise VideoProcessingError("The model returned invalid detection coordinates.")
    return float(xyxy[0]), float(xyxy[1]), float(xyxy[2]), float(xyxy[3]), confidence, class_id


def process_detection_job(job_id: str) -> None:
    parsed_id = UUID(job_id)
    with get_session_factory()() as db:
        job = db.get(RoadDetectionJob, parsed_id)
        if job is None or job.status != "Pending":
            return
        job.status = "Processing"
        job.started_at = datetime.now(UTC)
        job.status_message = "Preparing video analysis."
        db.commit()
        video_path = Path(job.video_path).resolve()
        video_root = settings.road_video_storage_path.resolve()
        if video_path.parent != video_root or not video_path.is_file():
            _save_failed_job(parsed_id, "The uploaded video is unavailable in private storage.")
            return

        try:
            model, compatible_classes, cv2 = _load_detector(
                str(settings.road_damage_model_path.resolve())
                if settings.road_damage_model_path is not None
                else ""
            )
            capture = cv2.VideoCapture(str(video_path))
            try:
                if not capture.isOpened():
                    raise VideoProcessingError(
                        "The video could not be decoded. Check its codec and file integrity."
                    )
                fps = float(capture.get(cv2.CAP_PROP_FPS))
                frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
                if not math.isfinite(fps) or fps <= 0 or frame_count <= 0:
                    raise VideoProcessingError("Video duration or frame-rate metadata is invalid.")
                duration_seconds = frame_count / fps
                if duration_seconds > settings.road_video_max_duration_seconds:
                    raise VideoProcessingError("Video exceeds the configured processing duration limit.")

                interval = settings.road_damage_sample_interval_seconds
                if not math.isfinite(interval) or interval <= 0:
                    raise VideoProcessingError("Video frame-sampling interval is not configured correctly.")
                sample_count = max(1, math.ceil(duration_seconds / interval))
                samples_done = 0
                sample_second = 0.0
                while sample_second < duration_seconds:
                    capture.set(cv2.CAP_PROP_POS_MSEC, sample_second * 1000)
                    read_ok, frame = capture.read()
                    if not read_ok or frame is None:
                        raise VideoProcessingError("The video ended unexpectedly while decoding sampled frames.")
                    frame_result = model(frame, verbose=False)[0]
                    boxes = list(frame_result.boxes or [])
                    frame_detections: list[tuple[float, float, float, float, float, str]] = []
                    for box in boxes:
                        x1, y1, x2, y2, confidence, class_id = _box_values(box)
                        class_details = compatible_classes.get(class_id)
                        if class_details is None:
                            continue
                        class_name = class_details[1]
                        frame_detections.append((x1, y1, x2, y2, confidence, class_name))

                    if frame_detections:
                        for x1, y1, x2, y2, confidence, class_name in frame_detections:
                            cv2.rectangle(frame, (round(x1), round(y1)), (round(x2), round(y2)), (0, 180, 80), 2)
                            cv2.putText(
                                frame,
                                f"{class_name} {confidence:.2f}",
                                (round(x1), max(18, round(y1) - 6)),
                                cv2.FONT_HERSHEY_SIMPLEX,
                                0.55,
                                (0, 180, 80),
                                2,
                            )
                        evidence_id = uuid4()
                        evidence_root = settings.evidence_storage_path.resolve()
                        evidence_root.mkdir(parents=True, exist_ok=True)
                        evidence_path = evidence_root / f"{evidence_id}.jpg"
                        if not cv2.imwrite(str(evidence_path), frame):
                            raise VideoProcessingError("A detection evidence frame could not be saved.")
                        db.add(
                            Evidence(
                                id=evidence_id,
                                evidence_type=EvidenceType.IMAGE,
                                file_path=str(evidence_path),
                                original_filename=f"detection-{evidence_id}.jpg",
                                content_type="image/jpeg",
                                uploaded_by=job.uploaded_by,
                            )
                        )
                        for x1, y1, x2, y2, confidence, class_name in frame_detections:
                            db.add(
                                RoadDetection(
                                    job_id=job.id,
                                    class_name=class_name,
                                    confidence=max(0.0, min(1.0, confidence)),
                                    video_timestamp_seconds=sample_second,
                                    bbox_x1=max(0.0, x1),
                                    bbox_y1=max(0.0, y1),
                                    bbox_x2=max(max(0.0, x1), x2),
                                    bbox_y2=max(max(0.0, y1), y2),
                                    evidence_id=evidence_id,
                                )
                            )

                    samples_done += 1
                    job.progress = min(99, round(samples_done * 100 / sample_count))
                    job.status_message = f"Processed {samples_done} of {sample_count} sampled frames."
                    if samples_done % 5 == 0 or sample_second + interval >= duration_seconds:
                        db.commit()
                    sample_second += interval
            finally:
                capture.release()
            job = db.get(RoadDetectionJob, parsed_id)
            if job is not None:
                job.status = "Completed"
                job.progress = 100
                job.status_message = None
                job.completed_at = datetime.now(UTC)
                db.commit()
        except DetectorUnavailable as error:
            db.rollback()
            _save_failed_job(parsed_id, str(error))
        except VideoProcessingError as error:
            db.rollback()
            _save_failed_job(parsed_id, str(error))
        except (OSError, SQLAlchemyError):
            db.rollback()
            logger.error("Video processing failed for job %s (storage or database error).", parsed_id)
            _save_failed_job(parsed_id, "Video processing failed. Check backend logs.")
        except Exception:
            db.rollback()
            logger.error("Video inference failed for job %s (unexpected inference error).", parsed_id)
            _save_failed_job(parsed_id, "Video processing failed. Check backend logs.")


@router.get("/detection/availability")
def get_detection_availability(_: RoadEngineer) -> dict[str, object]:
    return detector_availability()


@router.post(
    "/detection-jobs",
    status_code=status.HTTP_202_ACCEPTED,
)
def upload_detection_video(
    background_tasks: BackgroundTasks,
    actor: RoadEngineer,
    db: DatabaseSession,
    file: UploadFile = File(...),
    latitude: float | None = Form(default=None),
    longitude: float | None = Form(default=None),
    location_verified: bool = Form(default=False),
    gps_sidecar: UploadFile | None = File(default=None),
) -> dict[str, object]:
    availability = detector_availability()
    if not availability["available"]:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=availability["message"],
        )

    original_name = _safe_original_filename(file.filename)
    extension = Path(original_name).suffix.lower()
    expected_type = VIDEO_TYPES.get(extension)
    if expected_type is None or file.content_type != expected_type:
        raise HTTPException(status_code=415, detail="Upload an MP4 or MOV video with a matching content type")

    if gps_sidecar is not None and (latitude is not None or longitude is not None):
        raise HTTPException(
            status_code=422, detail="Provide verified coordinates or a GPS sidecar, not both"
        )
    location_source: str | None = None
    if gps_sidecar is not None:
        latitude, longitude = _read_sidecar(gps_sidecar)
        location_source = "sidecar"
    elif latitude is not None or longitude is not None:
        if latitude is None or longitude is None or not location_verified:
            raise HTTPException(
                status_code=422,
                detail="Provide both coordinates and confirm they are verified, or omit the location",
            )
        if (
            not math.isfinite(latitude)
            or not math.isfinite(longitude)
            or not -90 <= latitude <= 90
            or not -180 <= longitude <= 180
        ):
            raise HTTPException(status_code=422, detail="Coordinates are outside valid ranges")
        location_source = "user_verified"
    elif location_verified:
        raise HTTPException(status_code=422, detail="Verified coordinates are required")

    video_path, _ = _store_video(file, extension)
    job_id = uuid4()
    job = RoadDetectionJob(
        id=job_id,
        uploaded_by=actor.id,
        original_filename=original_name,
        video_path=str(video_path),
        latitude=latitude,
        longitude=longitude,
        location_source=location_source,
    )
    db.add(job)
    db.add(
        AuditLog(
            actor_user_id=actor.id,
            action="uploaded",
            entity_type="road_detection_job",
            entity_id=job_id,
        )
    )
    try:
        db.commit()
    except SQLAlchemyError as error:
        db.rollback()
        video_path.unlink(missing_ok=True)
        raise HTTPException(status_code=503, detail="Video job could not be saved") from error
    db.refresh(job)
    background_tasks.add_task(process_detection_job, str(job.id))
    return _serialise_job(job, include_detections=False)


@router.get("/detection-jobs")
def list_detection_jobs(
    actor: RoadEngineer,
    db: DatabaseSession,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> dict[str, object]:
    statement = select(RoadDetectionJob)
    count_statement = select(func.count()).select_from(RoadDetectionJob)
    jobs = list(
        db.scalars(statement.order_by(RoadDetectionJob.created_at.desc()).limit(limit).offset(offset))
    )
    return {
        "items": [_serialise_job(job, include_detections=False) for job in jobs],
        "total": db.scalar(count_statement) or 0,
        "limit": limit,
        "offset": offset,
    }


@router.get("/detection-jobs/{job_id}")
def get_detection_job(job_id: UUID, actor: RoadEngineer, db: DatabaseSession) -> dict[str, object]:
    job = db.get(RoadDetectionJob, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Video processing job not found")
    if not _job_accessible(job, actor):
        raise HTTPException(status_code=403, detail="You cannot access this video processing job")
    return _serialise_job(job)


@router.get("/detection-jobs/{job_id}/video")
def get_detection_video(job_id: UUID, actor: RoadEngineer, db: DatabaseSession) -> FileResponse:
    job = db.get(RoadDetectionJob, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Video processing job not found")
    if not _job_accessible(job, actor):
        raise HTTPException(status_code=403, detail="You cannot access this video processing job")
    root = settings.road_video_storage_path.resolve()
    path = Path(job.video_path).resolve()
    media_type = VIDEO_TYPES.get(path.suffix.lower())
    if path.parent != root or media_type is None or not path.is_file():
        raise HTTPException(status_code=404, detail="Uploaded video is unavailable")
    return FileResponse(path, media_type=media_type, content_disposition_type="inline")


@router.get("/detection-jobs/{job_id}/evidence/{evidence_id}")
def get_detection_evidence(
    job_id: UUID,
    evidence_id: UUID,
    actor: RoadEngineer,
    db: DatabaseSession,
) -> FileResponse:
    job = db.get(RoadDetectionJob, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Video processing job not found")
    if not _job_accessible(job, actor):
        raise HTTPException(status_code=403, detail="You cannot access this evidence")
    detection = db.scalar(
        select(RoadDetection).where(
            RoadDetection.job_id == job_id,
            RoadDetection.evidence_id == evidence_id,
        )
    )
    evidence = db.get(Evidence, evidence_id)
    if detection is None or evidence is None:
        raise HTTPException(status_code=404, detail="Detection evidence not found")
    root = settings.evidence_storage_path.resolve()
    path = Path(evidence.file_path).resolve()
    if path.parent != root or not path.is_file():
        raise HTTPException(status_code=404, detail="Detection evidence is unavailable")
    return FileResponse(path, media_type="image/jpeg", content_disposition_type="inline")


@router.post("/detections/{detection_id}/confirm")
def confirm_detection(
    detection_id: UUID,
    payload: DetectionConfirmation,
    actor: RoadEngineer,
    db: DatabaseSession,
) -> dict[str, object]:
    detection = db.get(RoadDetection, detection_id)
    if detection is None:
        raise HTTPException(status_code=404, detail="Road detection not found")
    job = db.get(RoadDetectionJob, detection.job_id)
    if job is None or not _job_accessible(job, actor):
        raise HTTPException(status_code=404, detail="Road detection not found")
    if detection.review_status != "Pending Review":
        raise HTTPException(status_code=409, detail="Road detection has already been reviewed")

    defect = RoadDefect(
        defect_type=detection.class_name,
        description=payload.description,
        severity=payload.severity,
        confidence=detection.confidence * 100,
        latitude=job.latitude,
        longitude=job.longitude,
        detected_at=datetime.now(UTC),
        status=DefectStatus.REPORTED,
        created_by=actor.id,
    )
    db.add(defect)
    db.flush()
    if detection.evidence is not None:
        detection.evidence.defect_id = defect.id
        db.add(
            Observation(
                defect_id=defect.id,
                source_id=str(job.id),
                timestamp=defect.detected_at,
                latitude=job.latitude,
                longitude=job.longitude,
                evidence_path=detection.evidence.file_path,
            )
        )
    detection.review_status = "Confirmed"
    detection.defect_id = defect.id
    db.add(
        AuditLog(
            actor_user_id=actor.id,
            action="confirmed",
            entity_type="road_detection",
            entity_id=detection.id,
        )
    )
    db.add(
        AuditLog(
            actor_user_id=actor.id,
            action="created_from_video_detection",
            entity_type="road_defect",
            entity_id=defect.id,
        )
    )
    try:
        db.commit()
    except SQLAlchemyError as error:
        db.rollback()
        raise HTTPException(status_code=503, detail="Confirmed road report could not be saved") from error
    db.refresh(defect)
    return {
        "detection": _serialise_detection(detection),
        "defect": {
            "id": str(defect.id),
            "defect_type": defect.defect_type,
            "status": defect.status.value,
            "confidence": defect.confidence,
        },
    }


@router.post("/detections/{detection_id}/reject")
def reject_detection(
    detection_id: UUID,
    actor: RoadEngineer,
    db: DatabaseSession,
) -> dict[str, object]:
    detection = db.get(RoadDetection, detection_id)
    if detection is None:
        raise HTTPException(status_code=404, detail="Road detection not found")
    job = db.get(RoadDetectionJob, detection.job_id)
    if job is None or not _job_accessible(job, actor):
        raise HTTPException(status_code=404, detail="Road detection not found")
    if detection.review_status != "Pending Review":
        raise HTTPException(status_code=409, detail="Road detection has already been reviewed")
    detection.review_status = "Rejected"
    db.add(
        AuditLog(
            actor_user_id=actor.id,
            action="rejected",
            entity_type="road_detection",
            entity_id=detection.id,
        )
    )
    db.commit()
    return _serialise_detection(detection)
