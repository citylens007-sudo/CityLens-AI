from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.dependencies import CurrentUser, DatabaseSession, require_roles, require_trusted_origin
from app.models import (
    AlertStatus,
    AuditLog,
    DefectStatus,
    Evidence,
    EvidenceType,
    IncidentReviewStatus,
    PoliceAlert,
    RepairAssignment,
    RepairStatus,
    RoadDefect,
    TrafficIncident,
    User,
    UserRole,
)
from app.schemas import (
    ActivityRead,
    AlertCreateRequest,
    AlertRead,
    AlertUpdateRequest,
    DashboardSummary,
    DefectCreateRequest,
    DefectRead,
    DefectUpdateRequest,
    EvidenceRead,
    IncidentCreateRequest,
    IncidentRead,
    IncidentUpdateRequest,
    PaginatedResponse,
    RepairCreateRequest,
    RepairRead,
    RepairUpdateRequest,
    UserRead,
)
from app.settings import settings


router = APIRouter(dependencies=[Depends(require_trusted_origin)])
admin_or_engineer = require_roles(UserRole.ADMIN, UserRole.MUNICIPAL_ENGINEER)
engineer_or_maintenance = require_roles(
    UserRole.ADMIN, UserRole.MUNICIPAL_ENGINEER, UserRole.MAINTENANCE_TEAM
)
controller_only = require_roles(UserRole.ADMIN, UserRole.TRAFFIC_CONTROLLER)


def _audit(db: Session, actor: User, action: str, entity_type: str, entity_id: UUID) -> None:
    db.add(
        AuditLog(
            actor_user_id=actor.id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
        )
    )


def _page[T](db: Session, statement, count_statement, limit: int, offset: int) -> PaginatedResponse[T]:
    items = list(db.scalars(statement.limit(limit).offset(offset)).all())
    total = db.scalar(count_statement) or 0
    return PaginatedResponse(items=items, total=total, limit=limit, offset=offset)


def _page_params(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> tuple[int, int]:
    return limit, offset


@router.get(
    "/dashboard/summary",
    response_model=DashboardSummary,
    dependencies=[Depends(require_roles(
        UserRole.ADMIN,
        UserRole.MUNICIPAL_ENGINEER,
        UserRole.TRAFFIC_CONTROLLER,
    ))],
)
def dashboard_summary(_: CurrentUser, db: DatabaseSession) -> DashboardSummary:
    return DashboardSummary(
        road_defects=db.scalar(select(func.count()).select_from(RoadDefect)) or 0,
        high_priority_defects=db.scalar(
            select(func.count()).select_from(RoadDefect).where(func.lower(RoadDefect.severity) == "high")
        )
        or 0,
        pending_repairs=db.scalar(
            select(func.count())
            .select_from(RepairAssignment)
            .where(RepairAssignment.status != RepairStatus.CLOSED)
        )
        or 0,
        open_incidents=db.scalar(
            select(func.count())
            .select_from(TrafficIncident)
            .where(
                TrafficIncident.review_status.notin_(
                    [IncidentReviewStatus.REVIEWED, IncidentReviewStatus.REJECTED]
                )
            )
        )
        or 0,
    )


@router.get(
    "/dashboard/recent-activity",
    response_model=PaginatedResponse[ActivityRead],
    dependencies=[Depends(require_roles(UserRole.ADMIN))],
)
def recent_activity(
    _: CurrentUser,
    db: DatabaseSession,
    page: tuple[int, int] = Depends(_page_params),
) -> PaginatedResponse[ActivityRead]:
    limit, offset = page
    return _page(
        db,
        select(AuditLog).order_by(AuditLog.created_at.desc()),
        select(func.count()).select_from(AuditLog),
        limit,
        offset,
    )


@router.post(
    "/defects",
    response_model=DefectRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(engineer_or_maintenance)],
)
def create_defect(
    payload: DefectCreateRequest,
    db: DatabaseSession,
    actor: CurrentUser,
) -> RoadDefect:
    defect = RoadDefect(
        **payload.model_dump(exclude={"detected_at"}),
        detected_at=payload.detected_at or datetime.now(UTC),
        created_by=actor.id,
    )
    db.add(defect)
    db.flush()
    _audit(db, actor, "created", "road_defect", defect.id)
    db.commit()
    db.refresh(defect)
    return defect


@router.get("/defects", response_model=PaginatedResponse[DefectRead])
def list_defects(
    actor: CurrentUser,
    db: DatabaseSession,
    page: tuple[int, int] = Depends(_page_params),
    status_filter: DefectStatus | None = Query(default=None, alias="status"),
    severity: str | None = Query(default=None, min_length=1, max_length=20),
) -> PaginatedResponse[DefectRead]:
    limit, offset = page
    statement = select(RoadDefect)
    count_statement = select(func.count()).select_from(RoadDefect)
    if status_filter is not None:
        statement = statement.where(RoadDefect.status == status_filter)
        count_statement = count_statement.where(RoadDefect.status == status_filter)
    if severity is not None:
        statement = statement.where(func.lower(RoadDefect.severity) == severity.strip().lower())
        count_statement = count_statement.where(func.lower(RoadDefect.severity) == severity.strip().lower())
    if actor.role == UserRole.PUBLIC_USER:
        statement = statement.where(RoadDefect.created_by == actor.id)
        count_statement = count_statement.where(RoadDefect.created_by == actor.id)
    return _page(
        db,
        statement.order_by(RoadDefect.detected_at.desc()),
        count_statement,
        limit,
        offset,
    )


@router.get("/defects/map", response_model=list[DefectRead])
def map_defects(actor: CurrentUser, db: DatabaseSession) -> list[RoadDefect]:
    if actor.role == UserRole.PUBLIC_USER:
        raise HTTPException(status_code=403, detail="Public accounts cannot access the staff defect map")
    return list(
        db.scalars(
            select(RoadDefect)
            .where(RoadDefect.latitude.is_not(None), RoadDefect.longitude.is_not(None))
            .order_by(RoadDefect.detected_at.desc())
            .limit(500)
        ).all()
    )


@router.get("/defects/{defect_id}", response_model=DefectRead)
def get_defect(defect_id: UUID, actor: CurrentUser, db: DatabaseSession) -> RoadDefect:
    defect = db.get(RoadDefect, defect_id)
    if defect is None:
        raise HTTPException(status_code=404, detail="Road defect not found")
    if actor.role == UserRole.PUBLIC_USER and defect.created_by != actor.id:
        raise HTTPException(status_code=404, detail="Road defect not found")
    return defect


@router.patch(
    "/defects/{defect_id}",
    response_model=DefectRead,
    dependencies=[Depends(admin_or_engineer)],
)
def update_defect(
    defect_id: UUID,
    payload: DefectUpdateRequest,
    db: DatabaseSession,
    actor: CurrentUser,
) -> RoadDefect:
    defect = db.get(RoadDefect, defect_id)
    if defect is None:
        raise HTTPException(status_code=404, detail="Road defect not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(defect, field, value)
    _audit(db, actor, "updated", "road_defect", defect.id)
    db.commit()
    db.refresh(defect)
    return defect


def _check_repair_access(repair: RepairAssignment, actor: User) -> None:
    if actor.role == UserRole.MAINTENANCE_TEAM and repair.assigned_team_id != actor.id:
        raise HTTPException(status_code=403, detail="Repair is not assigned to your team")
    if actor.role not in {
        UserRole.ADMIN,
        UserRole.MUNICIPAL_ENGINEER,
        UserRole.MAINTENANCE_TEAM,
    }:
        raise HTTPException(status_code=403, detail="Insufficient role permissions")


@router.post(
    "/repairs",
    response_model=RepairRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(admin_or_engineer)],
)
def create_repair(
    payload: RepairCreateRequest,
    db: DatabaseSession,
    actor: CurrentUser,
) -> RepairAssignment:
    defect = db.get(RoadDefect, payload.defect_id)
    if defect is None:
        raise HTTPException(status_code=404, detail="Road defect not found")
    team = db.get(User, payload.assigned_team_id)
    if team is None or team.role != UserRole.MAINTENANCE_TEAM or not team.is_active:
        raise HTTPException(status_code=422, detail="assigned_team_id must identify an active Maintenance Team user")
    if defect.status == DefectStatus.CLOSED:
        raise HTTPException(status_code=409, detail="A closed defect cannot be assigned")
    repair = RepairAssignment(
        defect_id=defect.id,
        assigned_team_id=team.id,
        assigned_by=actor.id,
        status=RepairStatus.ASSIGNED,
        notes=payload.notes,
    )
    defect.status = DefectStatus.ASSIGNED
    db.add(repair)
    db.flush()
    _audit(db, actor, "assigned", "repair_assignment", repair.id)
    db.commit()
    db.refresh(repair)
    return repair


@router.get("/repairs", response_model=PaginatedResponse[RepairRead])
def list_repairs(
    actor: CurrentUser,
    db: DatabaseSession,
    page: tuple[int, int] = Depends(_page_params),
    status_filter: RepairStatus | None = Query(default=None, alias="status"),
) -> PaginatedResponse[RepairRead]:
    if actor.role not in {
        UserRole.ADMIN,
        UserRole.MUNICIPAL_ENGINEER,
        UserRole.MAINTENANCE_TEAM,
    }:
        raise HTTPException(status_code=403, detail="Insufficient role permissions")
    limit, offset = page
    statement = select(RepairAssignment)
    count_statement = select(func.count()).select_from(RepairAssignment)
    if actor.role == UserRole.MAINTENANCE_TEAM:
        statement = statement.where(RepairAssignment.assigned_team_id == actor.id)
        count_statement = count_statement.where(RepairAssignment.assigned_team_id == actor.id)
    if status_filter is not None:
        statement = statement.where(RepairAssignment.status == status_filter)
        count_statement = count_statement.where(RepairAssignment.status == status_filter)
    return _page(
        db,
        statement.order_by(RepairAssignment.assigned_at.desc()),
        count_statement,
        limit,
        offset,
    )


@router.get("/repairs/teams", response_model=list[UserRead], dependencies=[Depends(admin_or_engineer)])
def list_maintenance_teams(db: DatabaseSession) -> list[User]:
    return list(
        db.scalars(
            select(User)
            .where(User.role == UserRole.MAINTENANCE_TEAM, User.is_active.is_(True))
            .order_by(User.display_name)
        ).all()
    )


@router.get("/repairs/{repair_id}", response_model=RepairRead)
def get_repair(repair_id: UUID, actor: CurrentUser, db: DatabaseSession) -> RepairAssignment:
    repair = db.get(RepairAssignment, repair_id)
    if repair is None:
        raise HTTPException(status_code=404, detail="Repair assignment not found")
    _check_repair_access(repair, actor)
    return repair


@router.patch("/repairs/{repair_id}", response_model=RepairRead)
def update_repair(
    repair_id: UUID,
    payload: RepairUpdateRequest,
    actor: CurrentUser,
    db: DatabaseSession,
) -> RepairAssignment:
    repair = db.get(RepairAssignment, repair_id)
    if repair is None:
        raise HTTPException(status_code=404, detail="Repair assignment not found")
    _check_repair_access(repair, actor)
    if actor.role == UserRole.MAINTENANCE_TEAM and payload.status not in {
        RepairStatus.IN_PROGRESS,
        RepairStatus.AWAITING_VERIFICATION,
    }:
        raise HTTPException(status_code=403, detail="Maintenance teams can only start or submit repairs for verification")
    if actor.role == UserRole.MAINTENANCE_TEAM and payload.status != repair.status:
        allowed_transitions = {
            RepairStatus.ASSIGNED: {RepairStatus.IN_PROGRESS},
            RepairStatus.IN_PROGRESS: {RepairStatus.AWAITING_VERIFICATION},
            RepairStatus.AWAITING_VERIFICATION: {RepairStatus.IN_PROGRESS},
            RepairStatus.CLOSED: set(),
        }
        if payload.status not in allowed_transitions[repair.status]:
            raise HTTPException(status_code=409, detail="Repair status must follow the maintenance workflow")
    repair.status = payload.status
    if "notes" in payload.model_fields_set:
        repair.notes = payload.notes
    if payload.status == RepairStatus.CLOSED:
        repair.completed_at = datetime.now(UTC)
        repair.defect.status = DefectStatus.CLOSED
    else:
        repair.completed_at = None
        if payload.status == RepairStatus.AWAITING_VERIFICATION:
            repair.defect.status = DefectStatus.AWAITING_VERIFICATION
        elif payload.status == RepairStatus.IN_PROGRESS:
            repair.defect.status = DefectStatus.IN_PROGRESS
    _audit(db, actor, "updated", "repair_assignment", repair.id)
    db.commit()
    db.refresh(repair)
    return repair


@router.post(
    "/incidents",
    response_model=IncidentRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(controller_only)],
)
def create_incident(
    payload: IncidentCreateRequest,
    db: DatabaseSession,
    actor: CurrentUser,
) -> TrafficIncident:
    incident = TrafficIncident(
        **payload.model_dump(),
        assigned_controller_id=actor.id,
        review_status=IncidentReviewStatus.PENDING_REVIEW,
    )
    db.add(incident)
    db.flush()
    _audit(db, actor, "created", "traffic_incident", incident.id)
    db.commit()
    db.refresh(incident)
    return incident


def _incident_query(actor: User):
    statement = select(TrafficIncident)
    count_statement = select(func.count()).select_from(TrafficIncident)
    if actor.role == UserRole.POLICE_OFFICER:
        authorized_incidents = select(PoliceAlert.incident_id).where(
            PoliceAlert.assigned_police_user_id == actor.id
        )
        statement = statement.where(TrafficIncident.id.in_(authorized_incidents))
        count_statement = count_statement.where(TrafficIncident.id.in_(authorized_incidents))
    return statement, count_statement


@router.get("/incidents", response_model=PaginatedResponse[IncidentRead])
def list_incidents(
    actor: CurrentUser,
    db: DatabaseSession,
    page: tuple[int, int] = Depends(_page_params),
    review_status: IncidentReviewStatus | None = None,
) -> PaginatedResponse[IncidentRead]:
    if actor.role not in {
        UserRole.ADMIN,
        UserRole.TRAFFIC_CONTROLLER,
        UserRole.POLICE_OFFICER,
    }:
        raise HTTPException(status_code=403, detail="Insufficient role permissions")
    limit, offset = page
    statement, count_statement = _incident_query(actor)
    if review_status is not None:
        statement = statement.where(TrafficIncident.review_status == review_status)
        count_statement = count_statement.where(TrafficIncident.review_status == review_status)
    return _page(
        db,
        statement.order_by(TrafficIncident.incident_timestamp.desc()),
        count_statement,
        limit,
        offset,
    )


@router.get("/incidents/{incident_id}", response_model=IncidentRead)
def get_incident(incident_id: UUID, actor: CurrentUser, db: DatabaseSession) -> TrafficIncident:
    if actor.role not in {
        UserRole.ADMIN,
        UserRole.TRAFFIC_CONTROLLER,
        UserRole.POLICE_OFFICER,
    }:
        raise HTTPException(status_code=403, detail="Insufficient role permissions")
    incident = db.get(TrafficIncident, incident_id)
    if incident is None:
        raise HTTPException(status_code=404, detail="Traffic incident not found")
    _incident_query(actor)
    if actor.role == UserRole.POLICE_OFFICER and db.scalar(
        select(PoliceAlert.id).where(
            PoliceAlert.incident_id == incident.id,
            PoliceAlert.assigned_police_user_id == actor.id,
        )
    ) is None:
        raise HTTPException(status_code=403, detail="Incident is not assigned to your police team")
    return incident


@router.patch("/incidents/{incident_id}", response_model=IncidentRead)
def update_incident(
    incident_id: UUID,
    payload: IncidentUpdateRequest,
    actor: CurrentUser,
    db: DatabaseSession,
) -> TrafficIncident:
    incident = db.get(TrafficIncident, incident_id)
    if incident is None:
        raise HTTPException(status_code=404, detail="Traffic incident not found")
    if actor.role not in {UserRole.ADMIN, UserRole.TRAFFIC_CONTROLLER}:
        raise HTTPException(status_code=403, detail="Only traffic controllers can review incidents")
    if (
        actor.role == UserRole.TRAFFIC_CONTROLLER
        and incident.assigned_controller_id not in (None, actor.id)
    ):
        raise HTTPException(status_code=403, detail="Incident is assigned to another controller")
    incident.review_status = payload.review_status
    if "description" in payload.model_fields_set:
        incident.description = payload.description
    if incident.assigned_controller_id is None:
        incident.assigned_controller_id = actor.id
    _audit(db, actor, "reviewed", "traffic_incident", incident.id)
    db.commit()
    db.refresh(incident)
    return incident


@router.post(
    "/alerts",
    response_model=AlertRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(controller_only)],
)
def create_alert(
    payload: AlertCreateRequest,
    db: DatabaseSession,
    actor: CurrentUser,
) -> PoliceAlert:
    incident = db.get(TrafficIncident, payload.incident_id)
    if incident is None:
        raise HTTPException(status_code=404, detail="Traffic incident not found")
    if incident.review_status != IncidentReviewStatus.REVIEWED:
        raise HTTPException(status_code=409, detail="An incident must be reviewed before an alert is authorized")
    police_user = db.get(User, payload.assigned_police_user_id)
    if police_user is None or police_user.role != UserRole.POLICE_TEAM or not police_user.is_active:
        raise HTTPException(status_code=422, detail="assigned_police_user_id must identify an active Police Officer")
    alert = PoliceAlert(
        incident_id=incident.id,
        authorized_by=actor.id,
        assigned_police_user_id=police_user.id,
        alert_status=AlertStatus.AUTHORIZED,
    )
    db.add(alert)
    db.flush()
    _audit(db, actor, "authorized", "police_alert", alert.id)
    db.commit()
    db.refresh(alert)
    return alert


@router.get(
    "/alerts/police-teams",
    response_model=list[UserRead],
    dependencies=[Depends(controller_only)],
)
def list_police_teams(db: DatabaseSession) -> list[User]:
    return list(
        db.scalars(
            select(User)
            .where(User.role == UserRole.POLICE_TEAM, User.is_active.is_(True))
            .order_by(User.display_name)
        ).all()
    )


@router.get("/alerts", response_model=PaginatedResponse[AlertRead])
def list_alerts(
    actor: CurrentUser,
    db: DatabaseSession,
    page: tuple[int, int] = Depends(_page_params),
    alert_status: AlertStatus | None = None,
) -> PaginatedResponse[AlertRead]:
    if actor.role not in {UserRole.ADMIN, UserRole.TRAFFIC_CONTROLLER, UserRole.POLICE_TEAM}:
        raise HTTPException(status_code=403, detail="Insufficient role permissions")
    limit, offset = page
    statement = select(PoliceAlert)
    count_statement = select(func.count()).select_from(PoliceAlert)
    if actor.role == UserRole.POLICE_TEAM:
        statement = statement.where(PoliceAlert.assigned_police_user_id == actor.id)
        count_statement = count_statement.where(PoliceAlert.assigned_police_user_id == actor.id)
    if alert_status is not None:
        statement = statement.where(PoliceAlert.alert_status == alert_status)
        count_statement = count_statement.where(PoliceAlert.alert_status == alert_status)
    return _page(
        db,
        statement.order_by(PoliceAlert.authorized_at.desc()),
        count_statement,
        limit,
        offset,
    )


@router.patch("/alerts/{alert_id}", response_model=AlertRead)
def update_alert(
    alert_id: UUID,
    payload: AlertUpdateRequest,
    actor: CurrentUser,
    db: DatabaseSession,
) -> PoliceAlert:
    alert = db.get(PoliceAlert, alert_id)
    if alert is None:
        raise HTTPException(status_code=404, detail="Police alert not found")
    if actor.role != UserRole.POLICE_OFFICER or alert.assigned_police_user_id != actor.id:
        raise HTTPException(status_code=403, detail="Only the assigned Police Officer can update this alert")
    if payload.alert_status == AlertStatus.AUTHORIZED:
        raise HTTPException(status_code=422, detail="Police teams cannot re-authorize an alert")
    allowed_transitions = {
        AlertStatus.AUTHORIZED: AlertStatus.ACKNOWLEDGED,
        AlertStatus.ACKNOWLEDGED: AlertStatus.INVESTIGATING,
        AlertStatus.INVESTIGATING: AlertStatus.CLOSED,
        AlertStatus.CLOSED: None,
    }
    if payload.alert_status is not None and payload.alert_status != allowed_transitions[alert.alert_status]:
        raise HTTPException(status_code=409, detail="Alert status must advance through the investigation workflow")
    if payload.alert_status is not None:
        alert.alert_status = payload.alert_status
        if alert.acknowledged_at is None:
            alert.acknowledged_at = datetime.now(UTC)
    if "investigation_notes" in payload.model_fields_set:
        alert.investigation_notes = payload.investigation_notes
    _audit(db, actor, "updated", "police_alert", alert.id)
    db.commit()
    db.refresh(alert)
    return alert


_ALLOWED_UPLOADS: dict[str, tuple[str, EvidenceType, bytes | None]] = {
    ".jpg": ("image/jpeg", EvidenceType.IMAGE, b"\xff\xd8\xff"),
    ".jpeg": ("image/jpeg", EvidenceType.IMAGE, b"\xff\xd8\xff"),
    ".png": ("image/png", EvidenceType.IMAGE, b"\x89PNG\r\n\x1a\n"),
    ".webp": ("image/webp", EvidenceType.IMAGE, b"RIFF"),
    ".pdf": ("application/pdf", EvidenceType.DOCUMENT, b"%PDF-"),
    ".mp4": ("video/mp4", EvidenceType.VIDEO, None),
    ".webm": ("video/webm", EvidenceType.VIDEO, b"\x1aE\xdf\xa3"),
}


def _can_access_evidence(evidence: Evidence, actor: User, db: Session) -> bool:
    if actor.id == evidence.uploaded_by or actor.role in {
        UserRole.ADMIN,
        UserRole.MUNICIPAL_ENGINEER,
        UserRole.TRAFFIC_CONTROLLER,
    }:
        return True
    if actor.role == UserRole.MAINTENANCE_TEAM and evidence.defect_id is not None:
        return db.scalar(
            select(RepairAssignment.id).where(
                RepairAssignment.defect_id == evidence.defect_id,
                RepairAssignment.assigned_team_id == actor.id,
            )
        ) is not None
    return False


@router.post(
    "/evidence/upload",
    response_model=EvidenceRead,
    status_code=status.HTTP_201_CREATED,
)
def upload_evidence(
    actor: CurrentUser,
    db: DatabaseSession,
    file: UploadFile = File(...),
    defect_id: UUID | None = Form(default=None),
) -> Evidence:
    if actor.role not in {
        UserRole.ADMIN,
        UserRole.MUNICIPAL_ENGINEER,
        UserRole.MAINTENANCE_TEAM,
        UserRole.PUBLIC_USER,
    }:
        raise HTTPException(status_code=403, detail="Your role cannot upload road evidence")
    defect: RoadDefect | None = None
    if defect_id is not None:
        defect = db.get(RoadDefect, defect_id)
        if defect is None:
            raise HTTPException(status_code=404, detail="Road defect not found")
        if actor.role == UserRole.MAINTENANCE_TEAM and db.scalar(
            select(RepairAssignment.id).where(
                RepairAssignment.defect_id == defect_id,
                RepairAssignment.assigned_team_id == actor.id,
            )
        ) is None:
            raise HTTPException(status_code=403, detail="Evidence can only be added to your team's assigned repair")
        if actor.role == UserRole.PUBLIC_USER and (
            defect.created_by != actor.id or defect.status != DefectStatus.REPORTED
        ):
            raise HTTPException(status_code=403, detail="Public evidence can only be added to your report awaiting review")
    elif actor.role == UserRole.MAINTENANCE_TEAM:
        raise HTTPException(status_code=422, detail="Maintenance evidence must be linked to an assigned defect")

    original_name = (file.filename or "evidence").replace("\\", "/").rsplit("/", 1)[-1]
    original_name = "".join(character for character in original_name if character.isprintable())[:255]
    extension = Path(original_name).suffix.lower()
    allowed = _ALLOWED_UPLOADS.get(extension)
    if allowed is None or file.content_type != allowed[0]:
        raise HTTPException(status_code=415, detail="Upload an allowed JPEG, PNG, WebP, PDF, MP4, or WebM file")
    if actor.role == UserRole.PUBLIC_USER and allowed[1] != EvidenceType.IMAGE:
        raise HTTPException(status_code=415, detail="Public reports accept photographs only")

    root = settings.evidence_storage_path.resolve()
    try:
        root.mkdir(parents=True, exist_ok=True)
    except OSError as error:
        raise HTTPException(status_code=500, detail="Evidence storage is unavailable") from error
    file_id = uuid4()
    saved_path = root / f"{file_id}{extension}"
    temporary_path = root / f".{file_id}.upload"
    size = 0
    prefix = bytearray()
    try:
        with temporary_path.open("xb") as destination:
            while chunk := file.file.read(1024 * 1024):
                size += len(chunk)
                if size > settings.evidence_max_upload_bytes:
                    raise HTTPException(status_code=413, detail="Evidence file exceeds the configured upload limit")
                if len(prefix) < 16:
                    prefix.extend(chunk[: 16 - len(prefix)])
                destination.write(chunk)
        magic = allowed[2]
        valid_signature = prefix.startswith(magic) if magic is not None else (
            len(prefix) >= 8 and prefix[4:8] == b"ftyp"
        )
        if extension == ".webp":
            valid_signature = valid_signature and prefix[8:12] == b"WEBP"
        if not valid_signature or size == 0:
            raise HTTPException(status_code=415, detail="File contents do not match the selected file type")
        temporary_path.replace(saved_path)
    except HTTPException:
        temporary_path.unlink(missing_ok=True)
        raise
    except OSError as error:
        temporary_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail="Evidence could not be stored") from error
    finally:
        file.file.close()

    evidence = Evidence(
        id=file_id,
        evidence_type=allowed[1],
        file_path=str(saved_path),
        original_filename=original_name,
        content_type=allowed[0],
        uploaded_by=actor.id,
        defect_id=defect.id if defect is not None else None,
    )
    db.add(evidence)
    _audit(db, actor, "uploaded", "evidence", file_id)
    try:
        db.commit()
    except SQLAlchemyError as error:
        db.rollback()
        saved_path.unlink(missing_ok=True)
        raise HTTPException(status_code=503, detail="Evidence metadata could not be saved") from error
    db.refresh(evidence)
    return evidence


@router.get("/evidence/{evidence_id}", response_model=EvidenceRead)
def get_evidence(evidence_id: UUID, actor: CurrentUser, db: DatabaseSession) -> Evidence:
    evidence = db.get(Evidence, evidence_id)
    if evidence is None:
        raise HTTPException(status_code=404, detail="Evidence not found")
    if not _can_access_evidence(evidence, actor, db):
        raise HTTPException(status_code=403, detail="You cannot access this evidence")
    return evidence


@router.get("/evidence/{evidence_id}/download")
def download_evidence(evidence_id: UUID, actor: CurrentUser, db: DatabaseSession) -> FileResponse:
    evidence = db.get(Evidence, evidence_id)
    if evidence is None:
        raise HTTPException(status_code=404, detail="Evidence not found")
    if not _can_access_evidence(evidence, actor, db):
        raise HTTPException(status_code=403, detail="You cannot access this evidence")
    root = settings.evidence_storage_path.resolve()
    path = Path(evidence.file_path).resolve()
    if path.parent != root or not path.is_file():
        raise HTTPException(status_code=404, detail="Evidence file is unavailable")
    return FileResponse(
        path,
        media_type=evidence.content_type,
        filename=evidence.original_filename,
        content_disposition_type="attachment",
    )
