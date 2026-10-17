import re

from sqlalchemy import select

from app.database import get_session_factory
from app.models import User, UserRole
from app.security import hash_password
from app.settings import settings


def bootstrap_admin() -> None:
    if settings.app_env.lower() not in {"production", "staging"}:
        raise SystemExit("Use the development seed command outside production or staging.")
    if not settings.admin_bootstrap_email or not settings.admin_bootstrap_password:
        raise SystemExit("Set ADMIN_BOOTSTRAP_EMAIL and ADMIN_BOOTSTRAP_PASSWORD temporarily.")
    if not 12 <= len(settings.admin_bootstrap_password) <= 128:
        raise SystemExit("ADMIN_BOOTSTRAP_PASSWORD must be between 12 and 128 characters.")

    email = settings.admin_bootstrap_email.strip().lower()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        raise SystemExit("ADMIN_BOOTSTRAP_EMAIL must be a valid email address.")
    display_name = settings.admin_bootstrap_name.strip()
    if not display_name or len(display_name) > 120:
        raise SystemExit("ADMIN_BOOTSTRAP_NAME must contain 1 to 120 characters.")

    with get_session_factory()() as db:
        active_admin = db.scalar(
            select(User.id).where(
                User.role == UserRole.ADMIN,
                User.is_active.is_(True),
                User.deleted_at.is_(None),
            ).limit(1)
        )
        if active_admin is not None:
            raise SystemExit("An active administrator already exists; no changes were made.")
        existing_user = db.scalar(select(User.id).where(User.email == email))
        if existing_user is not None:
            raise SystemExit("That email already belongs to an account; no changes were made.")
        db.add(
            User(
                email=email,
                display_name=display_name,
                password_hash=hash_password(settings.admin_bootstrap_password),
                role=UserRole.ADMIN,
                is_active=True,
                email_verified=True,
            )
        )
        db.commit()
    print("Initial administrator created. Remove the temporary bootstrap credentials.")


if __name__ == "__main__":
    bootstrap_admin()
