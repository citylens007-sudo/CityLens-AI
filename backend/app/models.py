from datetime import UTC, datetime
from enum import Enum
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Enum as SqlEnum,
    Float,
    ForeignKey,
    Index,
    String,
    Text,
    Uuid,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def utc_now() -> datetime:
    return datetime.now(UTC)


class Base(DeclarativeBase):
    pass


class UserRole(str, Enum):
    ADMIN = "Admin"
    MUNICIPAL_ENGINEER = "Municipal Engineer"
    MAINTENANCE_TEAM = "Maintenance Team"
    TRAFFIC_CONTROLLER = "Traffic Controller"
    POLICE_OFFICER = "Police Officer"
    POLICE_TEAM = "Police Officer"
    PUBLIC_USER = "Public User"
    RESIDENT = "Public User"


class DefectStatus(str, Enum):
    REPORTED = "Reported"
    VERIFIED = "Verified"
    ASSIGNED = "Assigned"
    IN_PROGRESS = "In Progress"
    AWAITING_VERIFICATION = "Awaiting Verification"
    CLOSED = "Closed"
    WITHDRAWN = "Withdrawn"


class RepairStatus(str, Enum):
    ASSIGNED = "Assigned"
    IN_PROGRESS = "In Progress"
    AWAITING_VERIFICATION = "Awaiting Verification"
    CLOSED = "Closed"


class IncidentReviewStatus(str, Enum):
    PENDING_REVIEW = "Pending Review"
    UNDER_REVIEW = "Under Review"
    MORE_EVIDENCE_REQUESTED = "More Evidence Requested"
    REVIEWED = "Reviewed"
    REJECTED = "Rejected"


class AlertStatus(str, Enum):
    AUTHORIZED = "Authorized"
    ACKNOWLEDGED = "Acknowledged"
    INVESTIGATING = "Investigating"
    CLOSED = "Closed"


class EvidenceType(str, Enum):
    IMAGE = "Image"
    VIDEO = "Video"
    DOCUMENT = "Document"


def enum_column(enum_type: type[Enum], name: str) -> SqlEnum:
    return SqlEnum(
        enum_type,
        name=name,
        native_enum=False,
        create_constraint=True,
        values_callable=lambda values: [value.value for value in values],
    )


class User(Base):
    __tablename__ = "users"

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(120), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(512), nullable=False)
    role: Mapped[UserRole] = mapped_column(
        SqlEnum(
            UserRole,
            name="user_role",
            native_enum=False,
            create_constraint=True,
            values_callable=lambda roles: [role.value for role in roles],
        ),
        nullable=False,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    email_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now
    )
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sessions: Mapped[list["AuthSession"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    email_verification: Mapped["EmailVerification | None"] = relationship(
        back_populates="user", cascade="all, delete-orphan", uselist=False
    )


class EmailVerification(Base):
    __tablename__ = "email_verifications"
    __table_args__ = (Index("ix_email_verifications_expires_at", "expires_at"),)

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, server_default=func.now()
    )
    user: Mapped[User] = relationship(back_populates="email_verification")


class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"
    __table_args__ = (
        Index("ix_password_reset_tokens_user_id", "user_id"),
        Index("ix_password_reset_tokens_expires_at", "expires_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, server_default=func.now()
    )


class PasswordResetRateLimit(Base):
    __tablename__ = "password_reset_rate_limits"
    __table_args__ = (
        Index("ix_password_reset_rate_limits_lookup", "request_hash", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, server_default=func.now()
    )


class AuthSession(Base):
    __tablename__ = "auth_sessions"

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    user: Mapped[User] = relationship(back_populates="sessions")


class RoadDefect(Base):
    __tablename__ = "road_defects"
    __table_args__ = (
        CheckConstraint("confidence >= 0 AND confidence <= 100", name="ck_defect_confidence"),
        CheckConstraint("severity IN ('High', 'Medium', 'Low')", name="ck_defect_severity"),
        CheckConstraint("latitude >= -90 AND latitude <= 90", name="ck_defect_latitude"),
        CheckConstraint("longitude >= -180 AND longitude <= 180", name="ck_defect_longitude"),
        Index("ix_road_defects_status_detected_at", "status", "detected_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    defect_type: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    severity: Mapped[str] = mapped_column(String(20), nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    latitude: Mapped[float | None] = mapped_column(Float)
    longitude: Mapped[float | None] = mapped_column(Float)
    detected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    status: Mapped[DefectStatus] = mapped_column(
        enum_column(DefectStatus, "defect_status"), nullable=False, default=DefectStatus.REPORTED
    )
    created_by: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, server_default=func.now()
    )
    creator: Mapped[User] = relationship()
    observations: Mapped[list["Observation"]] = relationship(
        back_populates="defect", cascade="all, delete-orphan"
    )
    repairs: Mapped[list["RepairAssignment"]] = relationship(back_populates="defect")
    evidence: Mapped[list["Evidence"]] = relationship(back_populates="defect")


class Observation(Base):
    __tablename__ = "observations"
    __table_args__ = (
        CheckConstraint("latitude >= -90 AND latitude <= 90", name="ck_observation_latitude"),
        CheckConstraint("longitude >= -180 AND longitude <= 180", name="ck_observation_longitude"),
        Index("ix_observations_defect_timestamp", "defect_id", "timestamp"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    defect_id: Mapped[UUID] = mapped_column(
        ForeignKey("road_defects.id", ondelete="CASCADE"), nullable=False
    )
    source_id: Mapped[str | None] = mapped_column(String(120))
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    latitude: Mapped[float | None] = mapped_column(Float)
    longitude: Mapped[float | None] = mapped_column(Float)
    evidence_path: Mapped[str | None] = mapped_column(String(512))
    defect: Mapped[RoadDefect] = relationship(back_populates="observations")


class Evidence(Base):
    __tablename__ = "evidence"
    __table_args__ = (Index("ix_evidence_defect_created_at", "defect_id", "created_at"),)

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    evidence_type: Mapped[EvidenceType] = mapped_column(
        enum_column(EvidenceType, "evidence_type"), nullable=False
    )
    file_path: Mapped[str] = mapped_column(String(512), nullable=False, unique=True)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str] = mapped_column(String(120), nullable=False)
    uploaded_by: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    defect_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("road_defects.id", ondelete="SET NULL"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, server_default=func.now()
    )
    uploader: Mapped[User] = relationship()
    defect: Mapped[RoadDefect | None] = relationship(back_populates="evidence")


class RepairAssignment(Base):
    __tablename__ = "repair_assignments"
    __table_args__ = (
        Index("ix_repair_assignments_team_status", "assigned_team_id", "status"),
        Index("ix_repair_assignments_defect", "defect_id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    defect_id: Mapped[UUID] = mapped_column(
        ForeignKey("road_defects.id", ondelete="RESTRICT"), nullable=False
    )
    assigned_team_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    assigned_by: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    status: Mapped[RepairStatus] = mapped_column(
        enum_column(RepairStatus, "repair_status"), nullable=False, default=RepairStatus.ASSIGNED
    )
    notes: Mapped[str | None] = mapped_column(Text)
    assigned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    defect: Mapped[RoadDefect] = relationship(back_populates="repairs")
    assigned_team: Mapped[User] = relationship(foreign_keys=[assigned_team_id])
    assigner: Mapped[User] = relationship(foreign_keys=[assigned_by])


class TrafficIncident(Base):
    __tablename__ = "traffic_incidents"
    __table_args__ = (
        CheckConstraint("latitude >= -90 AND latitude <= 90", name="ck_incident_latitude"),
        CheckConstraint("longitude >= -180 AND longitude <= 180", name="ck_incident_longitude"),
        Index("ix_traffic_incidents_review_timestamp", "review_status", "incident_timestamp"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    incident_type: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    latitude: Mapped[float | None] = mapped_column(Float)
    longitude: Mapped[float | None] = mapped_column(Float)
    incident_timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    review_status: Mapped[IncidentReviewStatus] = mapped_column(
        enum_column(IncidentReviewStatus, "incident_review_status"),
        nullable=False,
        default=IncidentReviewStatus.PENDING_REVIEW,
    )
    assigned_controller_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, server_default=func.now()
    )
    assigned_controller: Mapped[User | None] = relationship()
    alerts: Mapped[list["PoliceAlert"]] = relationship(back_populates="incident")


class PoliceAlert(Base):
    __tablename__ = "police_alerts"
    __table_args__ = (
        Index("ix_police_alerts_assignee_status", "assigned_police_user_id", "alert_status"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    incident_id: Mapped[UUID] = mapped_column(
        ForeignKey("traffic_incidents.id", ondelete="RESTRICT"), nullable=False
    )
    authorized_by: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    assigned_police_user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    alert_status: Mapped[AlertStatus] = mapped_column(
        enum_column(AlertStatus, "alert_status"), nullable=False, default=AlertStatus.AUTHORIZED
    )
    investigation_notes: Mapped[str | None] = mapped_column(Text)
    authorized_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    incident: Mapped[TrafficIncident] = relationship(back_populates="alerts")
    authorizer: Mapped[User] = relationship(foreign_keys=[authorized_by])
    assigned_police_user: Mapped[User] = relationship(foreign_keys=[assigned_police_user_id])


class AuditLog(Base):
    __tablename__ = "audit_logs"
    __table_args__ = (Index("ix_audit_logs_created_at", "created_at"),)

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    actor_user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    action: Mapped[str] = mapped_column(String(80), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(80), nullable=False)
    entity_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, server_default=func.now()
    )
    actor: Mapped[User | None] = relationship()


class RoadDetectionJob(Base):
    __tablename__ = "road_detection_jobs"
    __table_args__ = (
        CheckConstraint(
            "status IN ('Pending', 'Processing', 'Completed', 'Failed')",
            name="ck_road_detection_job_status",
        ),
        CheckConstraint("progress >= 0 AND progress <= 100", name="ck_road_detection_job_progress"),
        CheckConstraint(
            "latitude IS NULL OR (latitude >= -90 AND latitude <= 90)",
            name="ck_road_detection_job_latitude",
        ),
        CheckConstraint(
            "longitude IS NULL OR (longitude >= -180 AND longitude <= 180)",
            name="ck_road_detection_job_longitude",
        ),
        CheckConstraint(
            "(latitude IS NULL AND longitude IS NULL) OR "
            "(latitude IS NOT NULL AND longitude IS NOT NULL)",
            name="ck_road_detection_job_coordinates",
        ),
        Index("ix_road_detection_jobs_uploader_created_at", "uploaded_by", "created_at"),
        Index("ix_road_detection_jobs_status_created_at", "status", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    uploaded_by: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    video_path: Mapped[str] = mapped_column(String(512), nullable=False, unique=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="Pending")
    progress: Mapped[int] = mapped_column(nullable=False, default=0)
    status_message: Mapped[str | None] = mapped_column(String(240))
    latitude: Mapped[float | None] = mapped_column(Float)
    longitude: Mapped[float | None] = mapped_column(Float)
    location_source: Mapped[str | None] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, server_default=func.now()
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    detections: Mapped[list["RoadDetection"]] = relationship(
        back_populates="job", cascade="all, delete-orphan"
    )
    uploader: Mapped[User] = relationship()


class RoadDetection(Base):
    __tablename__ = "road_detections"
    __table_args__ = (
        CheckConstraint("confidence >= 0 AND confidence <= 1", name="ck_road_detection_confidence"),
        CheckConstraint("video_timestamp_seconds >= 0", name="ck_road_detection_timestamp"),
        CheckConstraint("bbox_x1 >= 0 AND bbox_y1 >= 0", name="ck_road_detection_bbox_min"),
        CheckConstraint("bbox_x2 >= bbox_x1 AND bbox_y2 >= bbox_y1", name="ck_road_detection_bbox_max"),
        CheckConstraint(
            "review_status IN ('Pending Review', 'Confirmed', 'Rejected')",
            name="ck_road_detection_review_status",
        ),
        Index("ix_road_detections_job_timestamp", "job_id", "video_timestamp_seconds"),
        Index("ix_road_detections_review_created_at", "review_status", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    job_id: Mapped[UUID] = mapped_column(
        ForeignKey("road_detection_jobs.id", ondelete="CASCADE"), nullable=False
    )
    class_name: Mapped[str] = mapped_column(String(120), nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    video_timestamp_seconds: Mapped[float] = mapped_column(Float, nullable=False)
    bbox_x1: Mapped[float] = mapped_column(Float, nullable=False)
    bbox_y1: Mapped[float] = mapped_column(Float, nullable=False)
    bbox_x2: Mapped[float] = mapped_column(Float, nullable=False)
    bbox_y2: Mapped[float] = mapped_column(Float, nullable=False)
    evidence_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("evidence.id", ondelete="SET NULL"), index=True
    )
    review_status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="Pending Review"
    )
    defect_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("road_defects.id", ondelete="SET NULL"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, server_default=func.now()
    )
    job: Mapped[RoadDetectionJob] = relationship(back_populates="detections")
    evidence: Mapped[Evidence | None] = relationship()
    defect: Mapped[RoadDefect | None] = relationship()