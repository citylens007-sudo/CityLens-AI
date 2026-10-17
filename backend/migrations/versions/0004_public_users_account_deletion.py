"""Normalize public and police roles and support safe user/report management."""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0004_user_accounts"
down_revision: Union[str, None] = "0003_resident_email_verification"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint("user_role", "users", type_="check")
    op.execute(
        sa.text(
            "UPDATE users SET role = CASE role "
            "WHEN 'Resident' THEN 'Public User' "
            "WHEN 'Police Team' THEN 'Police Officer' "
            "ELSE role END"
        )
    )
    op.create_check_constraint(
        "user_role",
        "users",
        "role IN ('Admin', 'Municipal Engineer', 'Maintenance Team', "
        "'Traffic Controller', 'Police Officer', 'Public User')",
    )
    op.add_column("police_alerts", sa.Column("investigation_notes", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_users_deleted_at", "users", ["deleted_at"])

    op.drop_constraint("defect_status", "road_defects", type_="check")
    op.create_check_constraint(
        "defect_status",
        "road_defects",
        "status IN ('Reported', 'Verified', 'Assigned', 'In Progress', "
        "'Awaiting Verification', 'Closed', 'Withdrawn')",
    )


def downgrade() -> None:
    bind = op.get_bind()
    deleted_users = bind.scalar(sa.text("SELECT count(*) FROM users WHERE deleted_at IS NOT NULL")) or 0
    withdrawn_reports = bind.scalar(
        sa.text("SELECT count(*) FROM road_defects WHERE status = 'Withdrawn'")
    ) or 0
    if deleted_users or withdrawn_reports:
        raise RuntimeError(
            "Downgrade is blocked because it would discard soft-deletion or report-withdrawal state."
        )

    op.drop_column("police_alerts", "investigation_notes")
    op.drop_constraint("defect_status", "road_defects", type_="check")
    op.create_check_constraint(
        "defect_status",
        "road_defects",
        "status IN ('Reported', 'Verified', 'Assigned', 'In Progress', "
        "'Awaiting Verification', 'Closed')",
    )
    op.drop_index("ix_users_deleted_at", table_name="users")
    op.drop_column("users", "deleted_at")
    op.drop_constraint("user_role", "users", type_="check")
    op.execute(
        sa.text(
            "UPDATE users SET role = CASE role "
            "WHEN 'Public User' THEN 'Resident' "
            "WHEN 'Police Officer' THEN 'Police Team' "
            "ELSE role END"
        )
    )
    op.create_check_constraint(
        "user_role",
        "users",
        "role IN ('Admin', 'Municipal Engineer', 'Maintenance Team', "
        "'Traffic Controller', 'Police Team', 'Resident')",
    )
