"""Add persisted road video processing jobs and detections."""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0002_road_detection_jobs"
down_revision: Union[str, None] = "0001_citylens"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "road_detection_jobs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("uploaded_by", sa.Uuid(), nullable=False),
        sa.Column("original_filename", sa.String(length=255), nullable=False),
        sa.Column("video_path", sa.String(length=512), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("progress", sa.Integer(), nullable=False),
        sa.Column("status_message", sa.String(length=240), nullable=True),
        sa.Column("latitude", sa.Float(), nullable=True),
        sa.Column("longitude", sa.Float(), nullable=True),
        sa.Column("location_source", sa.String(length=20), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('Pending', 'Processing', 'Completed', 'Failed')",
            name="ck_road_detection_job_status",
        ),
        sa.CheckConstraint("progress >= 0 AND progress <= 100", name="ck_road_detection_job_progress"),
        sa.CheckConstraint(
            "latitude IS NULL OR (latitude >= -90 AND latitude <= 90)",
            name="ck_road_detection_job_latitude",
        ),
        sa.CheckConstraint(
            "longitude IS NULL OR (longitude >= -180 AND longitude <= 180)",
            name="ck_road_detection_job_longitude",
        ),
        sa.CheckConstraint(
            "(latitude IS NULL AND longitude IS NULL) OR "
            "(latitude IS NOT NULL AND longitude IS NOT NULL)",
            name="ck_road_detection_job_coordinates",
        ),
        sa.ForeignKeyConstraint(["uploaded_by"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("video_path"),
    )
    op.create_index(
        "ix_road_detection_jobs_uploader_created_at",
        "road_detection_jobs",
        ["uploaded_by", "created_at"],
    )
    op.create_index(
        "ix_road_detection_jobs_status_created_at",
        "road_detection_jobs",
        ["status", "created_at"],
    )
    op.create_table(
        "road_detections",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("job_id", sa.Uuid(), nullable=False),
        sa.Column("class_name", sa.String(length=120), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("video_timestamp_seconds", sa.Float(), nullable=False),
        sa.Column("bbox_x1", sa.Float(), nullable=False),
        sa.Column("bbox_y1", sa.Float(), nullable=False),
        sa.Column("bbox_x2", sa.Float(), nullable=False),
        sa.Column("bbox_y2", sa.Float(), nullable=False),
        sa.Column("evidence_id", sa.Uuid(), nullable=True),
        sa.Column("review_status", sa.String(length=20), nullable=False),
        sa.Column("defect_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("confidence >= 0 AND confidence <= 1", name="ck_road_detection_confidence"),
        sa.CheckConstraint("video_timestamp_seconds >= 0", name="ck_road_detection_timestamp"),
        sa.CheckConstraint("bbox_x1 >= 0 AND bbox_y1 >= 0", name="ck_road_detection_bbox_min"),
        sa.CheckConstraint(
            "bbox_x2 >= bbox_x1 AND bbox_y2 >= bbox_y1", name="ck_road_detection_bbox_max"
        ),
        sa.CheckConstraint(
            "review_status IN ('Pending Review', 'Confirmed', 'Rejected')",
            name="ck_road_detection_review_status",
        ),
        sa.ForeignKeyConstraint(["defect_id"], ["road_defects.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["evidence_id"], ["evidence.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["job_id"], ["road_detection_jobs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_road_detections_evidence_id", "road_detections", ["evidence_id"])
    op.create_index("ix_road_detections_defect_id", "road_detections", ["defect_id"])
    op.create_index(
        "ix_road_detections_job_timestamp",
        "road_detections",
        ["job_id", "video_timestamp_seconds"],
    )
    op.create_index(
        "ix_road_detections_review_created_at",
        "road_detections",
        ["review_status", "created_at"],
    )


def downgrade() -> None:
    op.drop_table("road_detections")
    op.drop_table("road_detection_jobs")
