"""Add verified resident accounts."""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0003_resident_email_verification"
down_revision: Union[str, None] = "0002_road_detection_jobs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint("user_role", "users", type_="check")
    op.create_check_constraint(
        "user_role",
        "users",
        "role IN ('Admin', 'Municipal Engineer', 'Maintenance Team', "
        "'Traffic Controller', 'Police Team', 'Resident')",
    )
    op.add_column(
        "users",
        sa.Column("email_verified", sa.Boolean(), server_default=sa.true(), nullable=False),
    )
    op.create_table(
        "email_verifications",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
        sa.UniqueConstraint("user_id"),
    )
    op.create_index(
        "ix_email_verifications_expires_at",
        "email_verifications",
        ["expires_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_email_verifications_expires_at", table_name="email_verifications")
    op.drop_table("email_verifications")
    op.drop_column("users", "email_verified")
    op.drop_constraint("user_role", "users", type_="check")
    op.create_check_constraint(
        "user_role",
        "users",
        "role IN ('Admin', 'Municipal Engineer', 'Maintenance Team', "
        "'Traffic Controller', 'Police Team')",
    )
