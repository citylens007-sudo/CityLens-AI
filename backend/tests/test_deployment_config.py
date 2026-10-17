from collections.abc import Generator
from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app import database
from app import bootstrap_admin as bootstrap_module
from app.models import Base, User, UserRole
from app.security import verify_password
from app.settings import Settings, settings


@pytest.fixture
def deployment_session_factory(tmp_path: Path) -> Generator[sessionmaker[Session], None, None]:
    engine = database.create_engine(f"sqlite:///{tmp_path / 'deployment-test.db'}")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    yield factory
    engine.dispose()


def test_neon_postgresql_url_uses_installed_psycopg_driver(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database.get_engine.cache_clear()
    monkeypatch.setattr(
        settings,
        "database_url",
        "postgresql://placeholder:placeholder@ep-example-pooler.neon.tech/citylens?sslmode=require",
    )
    try:
        engine = database.get_engine()
        assert engine.url.drivername == "postgresql+psycopg"
        assert engine.url.query["sslmode"] == "require"
        assert engine.pool._pre_ping
    finally:
        database.get_engine.cache_clear()


def test_production_cors_requires_exact_https_origins() -> None:
    Settings(app_env="production", frontend_origins="https://app.citylens.example").validate_frontend_origins()
    with pytest.raises(ValueError, match="wildcard"):
        Settings(app_env="production", frontend_origins="*").validate_frontend_origins()
    with pytest.raises(ValueError, match="HTTPS"):
        Settings(app_env="production", frontend_origins="http://app.citylens.example").validate_frontend_origins()
    with pytest.raises(ValueError, match="exact scheme and host"):
        Settings(app_env="production", frontend_origins="https://app.citylens.example/path").validate_frontend_origins()


def test_production_admin_bootstrap_is_one_time_and_hashes_password(
    deployment_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    def use_test_database() -> sessionmaker[Session]:
        return deployment_session_factory

    monkeypatch.setattr(bootstrap_module, "get_session_factory", use_test_database)
    monkeypatch.setattr(settings, "app_env", "production")
    monkeypatch.setattr(settings, "admin_bootstrap_email", "first-admin@example.com")
    monkeypatch.setattr(settings, "admin_bootstrap_password", "Very-Strong-bootstrap-123!")
    monkeypatch.setattr(settings, "admin_bootstrap_name", "Initial Administrator")

    bootstrap_module.bootstrap_admin()
    output = capsys.readouterr().out
    assert "Very-Strong-bootstrap-123!" not in output
    with deployment_session_factory() as db:
        users = db.scalars(select(User)).all()
        assert len(users) == 1
        assert users[0].role == UserRole.ADMIN
        assert verify_password("Very-Strong-bootstrap-123!", users[0].password_hash)

    with pytest.raises(SystemExit, match="already exists"):
        bootstrap_module.bootstrap_admin()
    with deployment_session_factory() as db:
        assert len(db.scalars(select(User)).all()) == 1
