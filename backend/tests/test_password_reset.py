from collections.abc import Generator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from app import auth
from app.database import get_db
from app.main import app
from app.models import (
    AuditLog,
    AuthSession,
    Base,
    PasswordResetRateLimit,
    PasswordResetToken,
    User,
    UserRole,
)
from app.security import hash_password, hash_session_token, verify_password
from app.settings import settings


@pytest.fixture
def reset_session_factory(tmp_path: Path) -> Generator[sessionmaker[Session], None, None]:
    engine = create_engine(f"sqlite:///{tmp_path / 'password-reset-test.db'}")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    yield factory
    engine.dispose()


@pytest.fixture
def reset_client(
    reset_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> Generator[TestClient, None, None]:
    def override_get_db() -> Generator[Session, None, None]:
        with reset_session_factory() as db:
            yield db

    app.dependency_overrides[get_db] = override_get_db
    monkeypatch.setattr(settings, "auth_cookie_name", "citylens_password_reset_test_session")
    monkeypatch.setattr(settings, "auth_session_ttl_minutes", 15)
    monkeypatch.setattr(settings, "app_env", "test")
    monkeypatch.setattr(settings, "frontend_origins", "http://localhost:5173")
    with reset_session_factory() as db:
        db.add(
            User(
                email="resident@example.com",
                display_name="Casey Resident",
                password_hash=hash_password("Resident-password-123!"),
                role=UserRole.PUBLIC_USER,
                is_active=True,
                email_verified=True,
            )
        )
        db.commit()
    with TestClient(app) as client:
        yield client
    app.dependency_overrides.clear()


def test_registration_requires_strong_password_and_rejects_role_escalation(
    reset_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(auth, "_email_delivery_available", lambda: True)

    weak_password = reset_client.post(
        "/api/v1/auth/register",
        json={
            "email": "new@example.com",
            "display_name": "New Public User",
            "password": "weak-password-only",
            "confirm_password": "weak-password-only",
        },
    )
    role_escalation = reset_client.post(
        "/api/v1/auth/register",
        json={
            "email": "new@example.com",
            "display_name": "New Public User",
            "password": "Strong-password-123!",
            "confirm_password": "Strong-password-123!",
            "role": "Admin",
        },
    )
    mismatched_passwords = reset_client.post(
        "/api/v1/auth/register",
        json={
            "email": "new@example.com",
            "display_name": "New Public User",
            "password": "Strong-password-123!",
            "confirm_password": "Other-password-123!",
        },
    )

    assert weak_password.status_code == 422
    assert role_escalation.status_code == 422
    assert mismatched_passwords.status_code == 422


def test_registration_duplicate_email_keeps_existing_account(
    reset_client: TestClient,
    reset_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sent: list[str] = []
    monkeypatch.setattr(auth, "_email_delivery_available", lambda: True)
    monkeypatch.setattr(auth, "_send_verification_email", lambda _email, token: sent.append(token))

    response = reset_client.post(
        "/api/v1/auth/register",
        json={
            "email": "RESIDENT@example.com",
            "display_name": "Different Person",
            "password": "Different-password-456!",
            "confirm_password": "Different-password-456!",
        },
    )

    assert response.status_code == 202
    assert response.json() == {"message": auth.RESIDENT_REGISTRATION_MESSAGE}
    assert sent == []
    with reset_session_factory() as db:
        users = db.scalars(select(User).where(User.email == "resident@example.com")).all()
        assert len(users) == 1
        assert users[0].display_name == "Casey Resident"


def test_invalid_recovery_input_is_rejected(reset_client: TestClient) -> None:
    invalid_email = reset_client.post(
        "/api/v1/auth/forgot-password",
        json={"email": "not-an-email"},
    )
    weak_password = reset_client.post(
        "/api/v1/auth/reset-password",
        json={
            "token": "not-a-valid-token",
            "password": "weak-password-only",
            "confirm_password": "weak-password-only",
        },
    )
    mismatched_passwords = reset_client.post(
        "/api/v1/auth/reset-password",
        json={
            "token": "not-a-valid-token",
            "password": "Strong-password-123!",
            "confirm_password": "Other-password-123!",
        },
    )

    assert invalid_email.status_code == 422
    assert weak_password.status_code == 422
    assert mismatched_passwords.status_code == 422


def test_password_reset_is_generic_hashed_single_use_and_revokes_sessions(
    reset_client: TestClient,
    reset_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sent: list[tuple[str, str]] = []
    monkeypatch.setattr(auth, "_email_delivery_available", lambda: True)
    monkeypatch.setattr(auth, "_send_password_reset_email", lambda email, token: sent.append((email, token)))

    unknown = reset_client.post(
        "/api/v1/auth/forgot-password",
        json={"email": "unknown@example.com"},
    )
    known = reset_client.post(
        "/api/v1/auth/forgot-password",
        json={"email": "resident@example.com"},
    )

    assert unknown.status_code == known.status_code == 202
    assert unknown.json() == known.json() == {"message": auth.PASSWORD_RESET_MESSAGE}
    assert len(sent) == 1
    with reset_session_factory() as db:
        user = db.scalar(select(User).where(User.email == "resident@example.com"))
        assert user is not None
        token_row = db.scalar(
            select(PasswordResetToken).where(PasswordResetToken.user_id == user.id)
        )
        assert token_row is not None
        assert token_row.token_hash == hash_session_token(sent[0][1])
        assert token_row.token_hash != sent[0][1]

    login = reset_client.post(
        "/api/v1/auth/login",
        json={"email": "resident@example.com", "password": "Resident-password-123!"},
    )
    assert login.status_code == 200
    with reset_session_factory() as db:
        user = db.scalar(select(User).where(User.email == "resident@example.com"))
        assert user is not None
        assert db.scalar(select(AuthSession).where(AuthSession.user_id == user.id)) is not None

    reset = reset_client.post(
        "/api/v1/auth/reset-password",
        json={
            "token": sent[0][1],
            "password": "New-Resident-password-456!",
            "confirm_password": "New-Resident-password-456!",
        },
    )

    assert reset.status_code == 200
    assert reset.json()["message"] == "Password updated. Sign in with your new password."
    with reset_session_factory() as db:
        user = db.scalar(select(User).where(User.email == "resident@example.com"))
        assert user is not None
        assert verify_password("New-Resident-password-456!", user.password_hash)
        assert db.scalar(select(AuthSession).where(AuthSession.user_id == user.id)) is None
        assert db.scalar(
            select(AuditLog).where(
                AuditLog.actor_user_id == user.id,
                AuditLog.action == "password_reset",
            )
        ) is not None

    reused = reset_client.post(
        "/api/v1/auth/reset-password",
        json={
            "token": sent[0][1],
            "password": "Another-Resident-password-789!",
            "confirm_password": "Another-Resident-password-789!",
        },
    )
    old_password = reset_client.post(
        "/api/v1/auth/login",
        json={"email": "resident@example.com", "password": "Resident-password-123!"},
    )
    new_password = reset_client.post(
        "/api/v1/auth/login",
        json={"email": "resident@example.com", "password": "New-Resident-password-456!"},
    )
    assert reused.status_code == 400
    assert old_password.status_code == 401
    assert new_password.status_code == 200


def test_password_reset_rejects_expired_and_invalid_tokens(
    reset_client: TestClient,
    reset_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sent: list[str] = []
    monkeypatch.setattr(auth, "_email_delivery_available", lambda: True)
    monkeypatch.setattr(auth, "_send_password_reset_email", lambda _email, token: sent.append(token))
    response = reset_client.post(
        "/api/v1/auth/forgot-password",
        json={"email": "resident@example.com"},
    )
    assert response.status_code == 202

    with reset_session_factory() as db:
        token_row = db.scalar(select(PasswordResetToken))
        assert token_row is not None
        token_row.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        db.commit()

    expired = reset_client.post(
        "/api/v1/auth/reset-password",
        json={
            "token": sent[0],
            "password": "New-Resident-password-456!",
            "confirm_password": "New-Resident-password-456!",
        },
    )
    invalid = reset_client.post(
        "/api/v1/auth/reset-password",
        json={
            "token": "not-a-valid-token",
            "password": "New-Resident-password-456!",
            "confirm_password": "New-Resident-password-456!",
        },
    )
    assert expired.status_code == invalid.status_code == 400
    assert expired.json()["detail"] == invalid.json()["detail"]


def test_password_reset_smtp_failure_keeps_generic_response_and_revokes_token(
    reset_client: TestClient,
    reset_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(auth, "_email_delivery_available", lambda: True)

    def fail_delivery(_email: str, _token: str) -> None:
        raise HTTPException(status_code=503, detail="SMTP is unavailable")

    monkeypatch.setattr(auth, "_send_password_reset_email", fail_delivery)
    response = reset_client.post(
        "/api/v1/auth/forgot-password",
        json={"email": "resident@example.com"},
    )

    assert response.status_code == 202
    assert response.json() == {"message": auth.PASSWORD_RESET_MESSAGE}
    with reset_session_factory() as db:
        token_row = db.scalar(select(PasswordResetToken))
        assert token_row is not None
        assert token_row.used_at is not None


def test_password_reset_rate_limits_are_persisted_and_generic(
    reset_client: TestClient,
    reset_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sent: list[str] = []
    availability_checks: list[bool] = []

    def delivery_is_configured() -> bool:
        availability_checks.append(True)
        return True

    monkeypatch.setattr(auth, "_email_delivery_available", delivery_is_configured)
    monkeypatch.setattr(auth, "_send_password_reset_email", lambda email, _token: sent.append(email))

    responses = [
        reset_client.post(
            "/api/v1/auth/forgot-password",
            json={"email": f"user-{index}@example.com"},
        )
        for index in range(auth.PASSWORD_RESET_IP_LIMIT + 1)
    ]

    assert all(response.status_code == 202 for response in responses)
    assert all(response.json() == {"message": auth.PASSWORD_RESET_MESSAGE} for response in responses)
    assert sent == []
    assert len(availability_checks) == auth.PASSWORD_RESET_IP_LIMIT
    with reset_session_factory() as db:
        assert len(db.scalars(select(PasswordResetRateLimit)).all()) == 2 * len(responses)
