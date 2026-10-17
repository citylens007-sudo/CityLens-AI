"""Create missing CityLens tables and preserve existing authentication tables.

Revision ID: 0001_citylens
Revises:
"""
from alembic import context, op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0001_citylens"
down_revision = None
branch_labels = None
depends_on = None


def _has_table(table_name: str) -> bool:
    return False if context.is_offline_mode() else inspect(op.get_bind()).has_table(table_name)


def _create_index_if_missing(
    index_name: str,
    table_name: str,
    columns: list[str],
    *,
    unique: bool = False,
) -> None:
    if context.is_offline_mode() or index_name not in {
        index["name"] for index in inspect(op.get_bind()).get_indexes(table_name)
    }:
        op.create_index(index_name, table_name, columns, unique=unique)


def upgrade() -> None:
    if not _has_table("users"):
        op.create_table(
            "users",
            sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
            sa.Column("email", sa.String(320), nullable=False),
            sa.Column("display_name", sa.String(120), nullable=False),
            sa.Column("password_hash", sa.String(512), nullable=False),
            sa.Column("role", sa.String(18), nullable=False),
            sa.Column("is_active", sa.Boolean(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
            sa.CheckConstraint(
                "role IN ('Admin', 'Municipal Engineer', 'Maintenance Team', "
                "'Traffic Controller', 'Police Team')",
                name="user_role",
            ),
            sa.PrimaryKeyConstraint("id"),
        )
    _create_index_if_missing("ix_users_email", "users", ["email"], unique=True)

    if not _has_table("auth_sessions"):
        op.create_table(
            "auth_sessions",
            sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
            sa.Column("user_id", sa.Uuid(as_uuid=True), nullable=False),
            sa.Column("token_hash", sa.String(64), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
    _create_index_if_missing("ix_auth_sessions_user_id", "auth_sessions", ["user_id"])
    _create_index_if_missing("ix_auth_sessions_token_hash", "auth_sessions", ["token_hash"], unique=True)
    _create_index_if_missing("ix_auth_sessions_expires_at", "auth_sessions", ["expires_at"])

    if not _has_table("road_defects"):
        op.create_table(
            "road_defects",
            sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
            sa.Column("defect_type", sa.String(120), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("severity", sa.String(20), nullable=False),
            sa.Column("confidence", sa.Float(), nullable=False),
            sa.Column("latitude", sa.Float(), nullable=True),
            sa.Column("longitude", sa.Float(), nullable=True),
            sa.Column("detected_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("status", sa.String(21), nullable=False),
            sa.Column("created_by", sa.Uuid(as_uuid=True), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.CheckConstraint("confidence >= 0 AND confidence <= 100", name="ck_defect_confidence"),
            sa.CheckConstraint("severity IN ('High', 'Medium', 'Low')", name="ck_defect_severity"),
            sa.CheckConstraint("latitude >= -90 AND latitude <= 90", name="ck_defect_latitude"),
            sa.CheckConstraint("longitude >= -180 AND longitude <= 180", name="ck_defect_longitude"),
            sa.CheckConstraint(
                "status IN ('Reported', 'Verified', 'Assigned', 'In Progress', "
                "'Awaiting Verification', 'Closed')",
                name="defect_status",
            ),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="RESTRICT"),
            sa.PrimaryKeyConstraint("id"),
        )
    _create_index_if_missing(
        "ix_road_defects_status_detected_at", "road_defects", ["status", "detected_at"]
    )

    if not _has_table("traffic_incidents"):
        op.create_table(
            "traffic_incidents",
            sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
            sa.Column("incident_type", sa.String(120), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("latitude", sa.Float(), nullable=True),
            sa.Column("longitude", sa.Float(), nullable=True),
            sa.Column("incident_timestamp", sa.DateTime(timezone=True), nullable=False),
            sa.Column("review_status", sa.String(23), nullable=False),
            sa.Column("assigned_controller_id", sa.Uuid(as_uuid=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.CheckConstraint("latitude >= -90 AND latitude <= 90", name="ck_incident_latitude"),
            sa.CheckConstraint("longitude >= -180 AND longitude <= 180", name="ck_incident_longitude"),
            sa.CheckConstraint(
                "review_status IN ('Pending Review', 'Under Review', 'More Evidence Requested', "
                "'Reviewed', 'Rejected')",
                name="incident_review_status",
            ),
            sa.ForeignKeyConstraint(["assigned_controller_id"], ["users.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
        )
    _create_index_if_missing(
        "ix_traffic_incidents_review_timestamp",
        "traffic_incidents",
        ["review_status", "incident_timestamp"],
    )
    _create_index_if_missing(
        "ix_traffic_incidents_assigned_controller_id",
        "traffic_incidents",
        ["assigned_controller_id"],
    )

    if not _has_table("audit_logs"):
        op.create_table(
            "audit_logs",
            sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
            sa.Column("actor_user_id", sa.Uuid(as_uuid=True), nullable=True),
            sa.Column("action", sa.String(80), nullable=False),
            sa.Column("entity_type", sa.String(80), nullable=False),
            sa.Column("entity_id", sa.Uuid(as_uuid=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
        )
    _create_index_if_missing("ix_audit_logs_created_at", "audit_logs", ["created_at"])
    _create_index_if_missing("ix_audit_logs_actor_user_id", "audit_logs", ["actor_user_id"])

    if not _has_table("observations"):
        op.create_table(
            "observations",
            sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
            sa.Column("defect_id", sa.Uuid(as_uuid=True), nullable=False),
            sa.Column("source_id", sa.String(120), nullable=True),
            sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
            sa.Column("latitude", sa.Float(), nullable=True),
            sa.Column("longitude", sa.Float(), nullable=True),
            sa.Column("evidence_path", sa.String(512), nullable=True),
            sa.CheckConstraint("latitude >= -90 AND latitude <= 90", name="ck_observation_latitude"),
            sa.CheckConstraint("longitude >= -180 AND longitude <= 180", name="ck_observation_longitude"),
            sa.ForeignKeyConstraint(["defect_id"], ["road_defects.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
    _create_index_if_missing(
        "ix_observations_defect_timestamp", "observations", ["defect_id", "timestamp"]
    )

    if not _has_table("evidence"):
        op.create_table(
            "evidence",
            sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
            sa.Column("evidence_type", sa.String(8), nullable=False),
            sa.Column("file_path", sa.String(512), nullable=False),
            sa.Column("original_filename", sa.String(255), nullable=False),
            sa.Column("content_type", sa.String(120), nullable=False),
            sa.Column("uploaded_by", sa.Uuid(as_uuid=True), nullable=False),
            sa.Column("defect_id", sa.Uuid(as_uuid=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.CheckConstraint(
                "evidence_type IN ('Image', 'Video', 'Document')",
                name="evidence_type",
            ),
            sa.ForeignKeyConstraint(["uploaded_by"], ["users.id"], ondelete="RESTRICT"),
            sa.ForeignKeyConstraint(["defect_id"], ["road_defects.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("file_path"),
        )
    _create_index_if_missing("ix_evidence_defect_id", "evidence", ["defect_id"])
    _create_index_if_missing(
        "ix_evidence_defect_created_at", "evidence", ["defect_id", "created_at"]
    )

    if not _has_table("repair_assignments"):
        op.create_table(
            "repair_assignments",
            sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
            sa.Column("defect_id", sa.Uuid(as_uuid=True), nullable=False),
            sa.Column("assigned_team_id", sa.Uuid(as_uuid=True), nullable=False),
            sa.Column("assigned_by", sa.Uuid(as_uuid=True), nullable=False),
            sa.Column("status", sa.String(21), nullable=False),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("assigned_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["defect_id"], ["road_defects.id"], ondelete="RESTRICT"),
            sa.ForeignKeyConstraint(["assigned_team_id"], ["users.id"], ondelete="RESTRICT"),
            sa.ForeignKeyConstraint(["assigned_by"], ["users.id"], ondelete="RESTRICT"),
            sa.PrimaryKeyConstraint("id"),
            sa.CheckConstraint(
                "status IN ('Assigned', 'In Progress', 'Awaiting Verification', 'Closed')",
                name="repair_status",
            ),
        )
    _create_index_if_missing(
        "ix_repair_assignments_team_status",
        "repair_assignments",
        ["assigned_team_id", "status"],
    )
    _create_index_if_missing("ix_repair_assignments_defect", "repair_assignments", ["defect_id"])

    if not _has_table("police_alerts"):
        op.create_table(
            "police_alerts",
            sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
            sa.Column("incident_id", sa.Uuid(as_uuid=True), nullable=False),
            sa.Column("authorized_by", sa.Uuid(as_uuid=True), nullable=False),
            sa.Column("assigned_police_user_id", sa.Uuid(as_uuid=True), nullable=False),
            sa.Column("alert_status", sa.String(13), nullable=False),
            sa.Column("authorized_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["incident_id"], ["traffic_incidents.id"], ondelete="RESTRICT"),
            sa.ForeignKeyConstraint(["authorized_by"], ["users.id"], ondelete="RESTRICT"),
            sa.ForeignKeyConstraint(["assigned_police_user_id"], ["users.id"], ondelete="RESTRICT"),
            sa.PrimaryKeyConstraint("id"),
            sa.CheckConstraint(
                "alert_status IN ('Authorized', 'Acknowledged', 'Investigating', 'Closed')",
                name="alert_status",
            ),
        )
    _create_index_if_missing(
        "ix_police_alerts_assignee_status",
        "police_alerts",
        ["assigned_police_user_id", "alert_status"],
    )


def downgrade() -> None:
    for table_name in (
        "police_alerts",
        "repair_assignments",
        "evidence",
        "observations",
        "audit_logs",
        "traffic_incidents",
        "road_defects",
    ):
        if context.is_offline_mode() or _has_table(table_name):
            op.drop_table(table_name)
