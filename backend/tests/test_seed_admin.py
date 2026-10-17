from collections.abc import Generator
from pathlib import Path

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from app.models import Base, User, UserRole
from app.security import verify_password
from app.seed_admin import seed_admin
from app.settings import settings


@pytest.fixture
def seed_session_factory(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> Generator[sessionmaker[Session], None, None]:
    engine = create_engine(f"sqlite:///{tmp_path / 'seed-test.db'}")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    monkeypatch.setattr("app.seed_admin.get_session_factory", lambda: factory)
    monkeypatch.setattr(settings, "app_env", "development")
    monkeypatch.setattr(settings, "admin_bootstrap_email", "  ADMIN@CITY.GOV ")
    monkeypatch.setattr(settings, "admin_bootstrap_password", "Secure-test-password-123!")
    monkeypatch.setattr(settings, "admin_bootstrap_name", "Development Administrator")
    yield factory
    engine.dispose()


def test_development_admin_seed_creates_once_and_is_safe_to_rerun(
    seed_session_factory: sessionmaker[Session],
    capsys: pytest.CaptureFixture[str],
) -> None:
    seed_admin()
    first_output = capsys.readouterr().out
    assert "created" in first_output.lower()
    assert "Secure-test-password-123!" not in first_output

    seed_admin()
    second_output = capsys.readouterr().out
    assert "already exists" in second_output.lower()

    with seed_session_factory() as db:
        users = list(db.scalars(select(User)))
        assert len(users) == 1
        assert users[0].email == "admin@city.gov"
        assert users[0].role == UserRole.ADMIN
        assert verify_password("Secure-test-password-123!", users[0].password_hash)


def test_development_admin_seed_is_disabled_outside_development(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "app_env", "production")

    with pytest.raises(SystemExit, match="only when APP_ENV=development"):
        seed_admin()
