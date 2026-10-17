from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select

from app.dependencies import CurrentUser, DatabaseSession, require_roles, require_trusted_origin
from app.models import AuditLog, DefectStatus, Evidence, RoadDefect, UserRole
from app.schemas import (
    PublicDefectRead,
    PublicReportCreateRequest,
    PublicReportRead,
    PublicReportUpdateRequest,
)


router = APIRouter(
    prefix="/residents",
    tags=["resident access"],
    dependencies=[
        Depends(require_roles(UserRole.PUBLIC_USER)),
        Depends(require_trusted_origin),
    ],
)
PUBLIC_STATUSES = (
    DefectStatus.VERIFIED,
    DefectStatus.ASSIGNED,
    DefectStatus.IN_PROGRESS,
    DefectStatus.AWAITING_VERIFICATION,
    DefectStatus.CLOSED,
)
def _report_read(report: RoadDefect, db: DatabaseSession) -> PublicReportRead:
    evidence_ids = list(
        db.scalars(select(Evidence.id).where(Evidence.defect_id == report.id).order_by(Evidence.created_at))
    )
    return PublicReportRead(
        id=report.id,
        defect_type=report.defect_type,
        description=report.description,
        severity=report.severity,
        latitude=report.latitude,
        longitude=report.longitude,
        detected_at=report.detected_at,
        status=report.status,
        created_at=report.created_at,
        evidence_ids=evidence_ids,
    )


@router.get("/defects")
def list_public_defects(
    db: DatabaseSession,
    _: CurrentUser,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> dict[str, object]:
    base_filter = RoadDefect.status.in_(PUBLIC_STATUSES)
    items = list(
        db.scalars(
            select(RoadDefect)
            .where(base_filter)
            .order_by(RoadDefect.detected_at.desc())
            .limit(limit)
            .offset(offset)
        )
    )
    total = db.scalar(
        select(func.count()).select_from(RoadDefect).where(base_filter)
    ) or 0
    return {
        "items": [PublicDefectRead.model_validate(item).model_dump(mode="json") for item in items],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.post(
    "/my/reports",
    response_model=PublicReportRead,
    status_code=status.HTTP_201_CREATED,
)
def create_my_report(
    payload: PublicReportCreateRequest,
    actor: CurrentUser,
    db: DatabaseSession,
) -> PublicReportRead:
    report = RoadDefect(
        defect_type=payload.defect_type,
        description=payload.description,
        severity=payload.severity,
        confidence=0,
        latitude=payload.latitude,
        longitude=payload.longitude,
        detected_at=datetime.now(UTC),
        status=DefectStatus.REPORTED,
        created_by=actor.id,
    )
    db.add(report)
    db.flush()
    db.add(AuditLog(actor_user_id=actor.id, action="submitted", entity_type="road_defect", entity_id=report.id))
    db.commit()
    db.refresh(report)
    return _report_read(report, db)


@router.get("/my/reports")
def list_my_reports(
    db: DatabaseSession,
    actor: CurrentUser,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> dict[str, object]:
    base_filter = RoadDefect.created_by == actor.id
    reports = list(
        db.scalars(
            select(RoadDefect)
            .where(base_filter)
            .order_by(RoadDefect.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
    )
    total = db.scalar(select(func.count()).select_from(RoadDefect).where(base_filter)) or 0
    return {
        "items": [_report_read(report, db) for report in reports],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.patch(
    "/my/reports/{report_id}",
    response_model=PublicReportRead,
)
def update_my_report(
    report_id: UUID,
    payload: PublicReportUpdateRequest,
    db: DatabaseSession,
    actor: CurrentUser,
) -> PublicReportRead:
    report = db.get(RoadDefect, report_id)
    if report is None or report.created_by != actor.id:
        raise HTTPException(status_code=404, detail="Report not found")
    if report.status != DefectStatus.REPORTED:
        raise HTTPException(status_code=409, detail="Only reports awaiting review can be edited.")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(report, field, value)
    db.add(AuditLog(actor_user_id=actor.id, action="updated", entity_type="road_defect", entity_id=report.id))
    db.commit()
    db.refresh(report)
    return _report_read(report, db)


@router.post("/my/reports/{report_id}/withdraw", response_model=PublicReportRead)
def withdraw_my_report(
    report_id: UUID,
    db: DatabaseSession,
    actor: CurrentUser,
) -> PublicReportRead:
    report = db.get(RoadDefect, report_id)
    if report is None or report.created_by != actor.id:
        raise HTTPException(status_code=404, detail="Report not found")
    if report.status != DefectStatus.REPORTED:
        raise HTTPException(status_code=409, detail="Only reports awaiting review can be withdrawn.")
    report.status = DefectStatus.WITHDRAWN
    db.add(AuditLog(actor_user_id=actor.id, action="withdrawn", entity_type="road_defect", entity_id=report.id))
    db.commit()
    db.refresh(report)
    return _report_read(report, db)
