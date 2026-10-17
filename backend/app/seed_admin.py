from sqlalchemy import select

from app.database import get_session_factory
from app.models import User, UserRole
from app.security import hash_password
from app.settings import settings


def seed_admin() -> None:
    if settings.app_env.lower() != "development":
        raise SystemExit("Admin seeding is available only when APP_ENV=development.")
    if not settings.admin_bootstrap_email or not settings.admin_bootstrap_password:
        raise SystemExit("Set ADMIN_BOOTSTRAP_EMAIL and ADMIN_BOOTSTRAP_PASSWORD before seeding.")
    if len(settings.admin_bootstrap_password) < 12:
        raise SystemExit("ADMIN_BOOTSTRAP_PASSWORD must be at least 12 characters.")

    email = settings.admin_bootstrap_email.strip().lower()
    with get_session_factory()() as db:
        existing = db.scalar(select(User).where(User.email == email))
        if existing is not None:
            print("Development administrator already exists; no changes were made.")
            return
        db.add(
            User(
                email=email,
                display_name=settings.admin_bootstrap_name,
                password_hash=hash_password(settings.admin_bootstrap_password),
                role=UserRole.ADMIN,
            )
        )
        db.commit()
    print("Development administrator created.")


if __name__ == "__main__":
    seed_admin()