import logging
import secrets
import smtplib
import ssl
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage
from urllib.parse import quote, urlsplit

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from app.database import get_db
from app.dependencies import CurrentUser, DatabaseSession, require_roles, require_trusted_origin
from app.models import (
    AuditLog,
    AuthSession,
    EmailVerification,
    PasswordResetRateLimit,
    PasswordResetToken,
    User,
    UserRole,
)
from app.schemas import (
    ForgotPasswordRequest,
    LoginRequest,
    ResidentRegistrationRequest,
    ResetPasswordRequest,
    UserCreateRequest,
    UserListRead,
    UserRead,
    UserUpdateRequest,
)
from app.security import DUMMY_PASSWORD_HASH, create_session_token, hash_password, hash_session_token, verify_password
from app.settings import settings


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["authentication"])
admin_only = require_roles(UserRole.ADMIN)
RESIDENT_REGISTRATION_MESSAGE = (
    "If the address can be registered, a verification email will be sent."
)
PASSWORD_RESET_MESSAGE = (
    "If an eligible account exists, password reset instructions will be sent "
    "when email delivery is available."
)
PASSWORD_RESET_WINDOW = timedelta(hours=1)
PASSWORD_RESET_IP_LIMIT = 5
PASSWORD_RESET_EMAIL_LIMIT = 3


def _email_delivery_available() -> bool:
    credentials_are_complete = bool(settings.smtp_username) == bool(settings.smtp_password)
    transport_is_secure = settings.smtp_use_ssl or settings.smtp_use_starttls
    app_url = urlsplit(settings.public_app_url)
    safe_app_url = bool(app_url.hostname) and app_url.username is None and app_url.password is None and (
        app_url.scheme == "https"
        or (
            settings.app_env.lower() in {"development", "test"}
            and
            app_url.scheme == "http"
            and app_url.hostname in {"localhost", "127.0.0.1"}
        )
    ) and not app_url.query and not app_url.fragment
    return bool(
        settings.smtp_host
        and settings.smtp_from_email
        and safe_app_url
        and credentials_are_complete
        and transport_is_secure
    )


def _send_verification_email(email: str, token: str) -> None:
    verification_url = (
        f"{settings.public_app_url.rstrip('/')}/verify-email?token={quote(token, safe='')}"
    )
    message = EmailMessage()
    message["Subject"] = "Verify your CityLens resident account"
    message["From"] = settings.smtp_from_email
    message["To"] = email
    message.set_content(
        "Use this link to verify your CityLens resident account. "
        f"The link expires in {settings.email_verification_ttl_hours} hours.\n\n"
        f"{verification_url}\n"
    )
    try:
        if settings.smtp_use_ssl:
            with smtplib.SMTP_SSL(
                settings.smtp_host,
                settings.smtp_port,
                context=ssl.create_default_context(),
                timeout=15,
            ) as server:
                if settings.smtp_username and settings.smtp_password:
                    server.login(settings.smtp_username, settings.smtp_password)
                server.send_message(message)
        else:
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as server:
                server.starttls(context=ssl.create_default_context())
                if settings.smtp_username and settings.smtp_password:
                    server.login(settings.smtp_username, settings.smtp_password)
                server.send_message(message)
    except (OSError, smtplib.SMTPException) as error:
        logger.error("Resident verification email delivery failed (%s).", type(error).__name__)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Verification email could not be sent. Try again later.",
        ) from error


def _send_password_reset_email(email: str, token: str) -> None:
    reset_url = f"{settings.public_app_url.rstrip('/')}/reset-password?token={quote(token, safe='')}"
    message = EmailMessage()
    message["Subject"] = "Reset your CityLens password"
    message["From"] = settings.smtp_from_email
    message["To"] = email
    message.set_content(
        "Use this link to reset your CityLens password. "
        f"The link expires in {settings.password_reset_ttl_minutes} minutes "
        "and can only be used once.\n\n"
        f"{reset_url}\n"
    )
    try:
        if settings.smtp_use_ssl:
            with smtplib.SMTP_SSL(
                settings.smtp_host,
                settings.smtp_port,
                context=ssl.create_default_context(),
                timeout=15,
            ) as server:
                if settings.smtp_username and settings.smtp_password:
                    server.login(settings.smtp_username, settings.smtp_password)
                server.send_message(message)
        else:
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as server:
                server.starttls(context=ssl.create_default_context())
                if settings.smtp_username and settings.smtp_password:
                    server.login(settings.smtp_username, settings.smtp_password)
                server.send_message(message)
    except (OSError, smtplib.SMTPException) as error:
        logger.error("Password reset email delivery failed (%s).", type(error).__name__)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Password reset email could not be sent.",
        ) from error


@router.post(
    "/register",
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(require_trusted_origin)],
)
def register_resident(payload: ResidentRegistrationRequest, db: DatabaseSession) -> dict[str, str]:
    if not _email_delivery_available():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Resident registration is temporarily unavailable because email delivery is not configured.",
        )

    user = db.scalar(select(User).where(User.email == payload.email))
    if user is not None and (user.email_verified or user.is_active or user.role != UserRole.RESIDENT):
        return {"message": RESIDENT_REGISTRATION_MESSAGE}

    now = datetime.now(UTC)
    verification = db.scalar(
        select(EmailVerification).where(EmailVerification.user_id == user.id)
    ) if user is not None else None
    if verification is not None:
        created_at = verification.created_at
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=UTC)
        if created_at > now - timedelta(seconds=60):
            return {"message": RESIDENT_REGISTRATION_MESSAGE}

    if user is None:
        user = User(
            email=payload.email,
            display_name=payload.display_name,
            password_hash=hash_password(payload.password),
            role=UserRole.RESIDENT,
            is_active=False,
            email_verified=False,
        )
        db.add(user)
        try:
            db.flush()
        except IntegrityError:
            db.rollback()
            return {"message": RESIDENT_REGISTRATION_MESSAGE}

    raw_token = secrets.token_urlsafe(32)
    token_hash = hash_session_token(raw_token)
    if verification is None:
        verification = EmailVerification(
            user_id=user.id,
            token_hash=token_hash,
            expires_at=now + timedelta(hours=settings.email_verification_ttl_hours),
        )
        db.add(verification)
    else:
        verification.token_hash = token_hash
        verification.expires_at = now + timedelta(hours=settings.email_verification_ttl_hours)
        verification.created_at = now

    try:
        db.commit()
    except SQLAlchemyError as error:
        db.rollback()
        logger.error("Resident registration could not be saved (%s).", type(error).__name__)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Resident registration could not be saved. Try again later.",
        ) from error

    try:
        _send_verification_email(payload.email, raw_token)
    except HTTPException:
        verification.created_at = now - timedelta(seconds=61)
        try:
            db.commit()
        except SQLAlchemyError as error:
            db.rollback()
            logger.error("Resident verification retry state could not be saved (%s).", type(error).__name__)
        raise
    return {"message": RESIDENT_REGISTRATION_MESSAGE}


@router.post(
    "/verify-email",
    dependencies=[Depends(require_trusted_origin)],
)
def verify_resident_email(token: str, db: DatabaseSession) -> dict[str, str]:
    if not token or len(token) > 256:
        raise HTTPException(status_code=400, detail="Verification link is invalid or expired.")
    verification = db.scalar(
        select(EmailVerification).where(
            EmailVerification.token_hash == hash_session_token(token)
        )
    )
    if verification is None:
        raise HTTPException(status_code=400, detail="Verification link is invalid or expired.")
    expires_at = verification.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    user = db.get(User, verification.user_id)
    if (
        user is None
        or user.role != UserRole.RESIDENT
        or user.email_verified
        or expires_at <= datetime.now(UTC)
    ):
        db.delete(verification)
        db.commit()
        raise HTTPException(status_code=400, detail="Verification link is invalid or expired.")

    user.email_verified = True
    user.is_active = True
    db.delete(verification)
    db.add(AuditLog(actor_user_id=user.id, action="verified_email", entity_type="user", entity_id=user.id))
    db.commit()
    return {"message": "Email verified. You can now sign in."}


@router.post(
    "/forgot-password",
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(require_trusted_origin)],
)
def request_password_reset(
    payload: ForgotPasswordRequest,
    request: Request,
    db: DatabaseSession,
) -> dict[str, str]:
    now = datetime.now(UTC)
    cutoff = now - PASSWORD_RESET_WINDOW
    client_host = request.client.host if request.client else "unknown"
    ip_hash = hash_session_token(f"password-reset-ip:{client_host}")
    email_hash = hash_session_token(f"password-reset-email:{payload.email}")
    try:
        db.execute(
            delete(PasswordResetRateLimit).where(
                PasswordResetRateLimit.created_at < cutoff
            )
        )
        ip_requests = db.scalar(
            select(func.count()).select_from(PasswordResetRateLimit).where(
                PasswordResetRateLimit.request_hash == ip_hash,
                PasswordResetRateLimit.created_at >= cutoff,
            )
        ) or 0
        email_requests = db.scalar(
            select(func.count()).select_from(PasswordResetRateLimit).where(
                PasswordResetRateLimit.request_hash == email_hash,
                PasswordResetRateLimit.created_at >= cutoff,
            )
        ) or 0
        db.add_all([
            PasswordResetRateLimit(request_hash=ip_hash, created_at=now),
            PasswordResetRateLimit(request_hash=email_hash, created_at=now),
        ])
        db.commit()
    except SQLAlchemyError as error:
        db.rollback()
        logger.error("Password reset request could not be recorded (%s).", type(error).__name__)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Password reset is temporarily unavailable.",
        ) from error

    if (
        ip_requests >= PASSWORD_RESET_IP_LIMIT
        or email_requests >= PASSWORD_RESET_EMAIL_LIMIT
        or not _email_delivery_available()
    ):
        return {"message": PASSWORD_RESET_MESSAGE}

    user = db.scalar(
        select(User).where(
            User.email == payload.email,
            User.is_active.is_(True),
            User.email_verified.is_(True),
            User.deleted_at.is_(None),
        )
    )
    if user is None:
        return {"message": PASSWORD_RESET_MESSAGE}

    raw_token = secrets.token_urlsafe(32)
    token_row = PasswordResetToken(
        user_id=user.id,
        token_hash=hash_session_token(raw_token),
        expires_at=now + timedelta(minutes=settings.password_reset_ttl_minutes),
    )
    try:
        db.execute(
            update(PasswordResetToken)
            .where(
                PasswordResetToken.user_id == user.id,
                PasswordResetToken.used_at.is_(None),
            )
            .values(used_at=now)
        )
        db.add(token_row)
        db.commit()
    except SQLAlchemyError as error:
        db.rollback()
        logger.error("Password reset token could not be saved (%s).", type(error).__name__)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Password reset is temporarily unavailable.",
        ) from error

    try:
        _send_password_reset_email(user.email, raw_token)
    except HTTPException:
        try:
            token_row.used_at = datetime.now(UTC)
            db.commit()
        except SQLAlchemyError as error:
            db.rollback()
            logger.error("Undelivered password reset token could not be revoked (%s).", type(error).__name__)
    return {"message": PASSWORD_RESET_MESSAGE}


@router.post(
    "/reset-password",
    dependencies=[Depends(require_trusted_origin)],
)
def reset_password(payload: ResetPasswordRequest, db: DatabaseSession) -> dict[str, str]:
    token_row = db.scalar(
        select(PasswordResetToken)
        .where(PasswordResetToken.token_hash == hash_session_token(payload.token))
        .with_for_update()
    )
    now = datetime.now(UTC)
    if token_row is None or token_row.used_at is not None:
        raise HTTPException(status_code=400, detail="Password reset link is invalid or expired.")

    expires_at = token_row.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    user = db.get(User, token_row.user_id)
    if (
        expires_at <= now
        or user is None
        or not user.is_active
        or not user.email_verified
        or user.deleted_at is not None
    ):
        raise HTTPException(status_code=400, detail="Password reset link is invalid or expired.")

    user.password_hash = hash_password(payload.password)
    db.execute(
        update(PasswordResetToken)
        .where(
            PasswordResetToken.user_id == user.id,
            PasswordResetToken.used_at.is_(None),
        )
        .values(used_at=now)
    )
    db.execute(delete(AuthSession).where(AuthSession.user_id == user.id))
    db.add(AuditLog(actor_user_id=user.id, action="password_reset", entity_type="user", entity_id=user.id))
    try:
        db.commit()
    except SQLAlchemyError as error:
        db.rollback()
        logger.error("Password reset could not be saved (%s).", type(error).__name__)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Password reset could not be saved. Try again later.",
        ) from error
    return {"message": "Password updated. Sign in with your new password."}


def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=settings.auth_cookie_name,
        value=token,
        max_age=settings.auth_session_ttl_minutes * 60,
        httponly=True,
        secure=settings.secure_auth_cookie,
        samesite="none" if settings.secure_auth_cookie else "lax",
        path="/api",
    )


def _clear_session_cookie(response: Response) -> None:
    response.delete_cookie(
        key=settings.auth_cookie_name,
        httponly=True,
        secure=settings.secure_auth_cookie,
        samesite="none" if settings.secure_auth_cookie else "lax",
        path="/api",
    )


@router.post("/login", response_model=UserRead, dependencies=[Depends(require_trusted_origin)])
def login(payload: LoginRequest, response: Response, db: DatabaseSession) -> User:
    user = db.scalar(select(User).where(User.email == payload.email))
    stored_hash = user.password_hash if user is not None else DUMMY_PASSWORD_HASH
    password_matches = verify_password(payload.password, stored_hash)
    if user is None or not password_matches:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    if not user.is_active or (user.role == UserRole.RESIDENT and not user.email_verified):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

    raw_token = create_session_token()
    now = datetime.now(UTC)
    db.add(
        AuthSession(
            user_id=user.id,
            token_hash=hash_session_token(raw_token),
            expires_at=now + timedelta(minutes=settings.auth_session_ttl_minutes),
        )
    )
    user.last_login_at = now
    db.add(AuditLog(actor_user_id=user.id, action="login", entity_type="user", entity_id=user.id))
    db.commit()
    db.refresh(user)
    _set_session_cookie(response, raw_token)
    return user


@router.get("/me", response_model=UserRead)
def current_user(user: CurrentUser) -> User:
    return user


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_trusted_origin)])
def logout(
    request: Request,
    response: Response,
    db: DatabaseSession,
) -> Response:
    raw_token = request.cookies.get(settings.auth_cookie_name)
    if raw_token:
        session = db.scalar(
            select(AuthSession).where(AuthSession.token_hash == hash_session_token(raw_token))
        )
        if session is not None:
            db.add(
                AuditLog(
                    actor_user_id=session.user_id,
                    action="logout",
                    entity_type="user",
                    entity_id=session.user_id,
                )
            )
            db.delete(session)
            db.commit()
    _clear_session_cookie(response)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.get("/users", response_model=UserListRead)
def list_users(
    db: DatabaseSession,
    _: User = Depends(admin_only),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    search: str | None = Query(default=None, max_length=160),
    role: UserRole | None = None,
    account_status: str = Query(default="all", pattern="^(all|active|inactive|deleted)$"),
) -> UserListRead:
    statement = select(User)
    count_statement = select(func.count()).select_from(User)
    if account_status == "deleted":
        statement = statement.where(User.deleted_at.is_not(None))
        count_statement = count_statement.where(User.deleted_at.is_not(None))
    elif account_status == "active":
        statement = statement.where(User.deleted_at.is_(None), User.is_active.is_(True))
        count_statement = count_statement.where(User.deleted_at.is_(None), User.is_active.is_(True))
    elif account_status == "inactive":
        statement = statement.where(User.deleted_at.is_(None), User.is_active.is_(False))
        count_statement = count_statement.where(User.deleted_at.is_(None), User.is_active.is_(False))
    else:
        statement = statement.where(User.deleted_at.is_(None))
        count_statement = count_statement.where(User.deleted_at.is_(None))
    if role is not None:
        statement = statement.where(User.role == role)
        count_statement = count_statement.where(User.role == role)
    if search and search.strip():
        term = f"%{search.strip()}%"
        search_filter = or_(User.display_name.ilike(term), User.email.ilike(term))
        statement = statement.where(search_filter)
        count_statement = count_statement.where(search_filter)
    return UserListRead(
        items=list(
            db.scalars(statement.order_by(User.created_at.desc()).limit(limit).offset(offset)).all()
        ),
        total=db.scalar(count_statement) or 0,
        limit=limit,
        offset=offset,
    )


@router.post(
    "/users",
    response_model=UserRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_trusted_origin)],
)
def create_user(
    payload: UserCreateRequest,
    db: DatabaseSession,
    actor: User = Depends(admin_only),
) -> User:
    user = User(
        email=payload.email,
        display_name=payload.display_name,
        password_hash=hash_password(payload.password),
        role=payload.role,
    )
    db.add(user)
    try:
        db.flush()
        db.add(AuditLog(actor_user_id=actor.id, action="created", entity_type="user", entity_id=user.id))
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="An account with that email already exists") from error
    db.refresh(user)
    return user


@router.patch(
    "/users/{user_id}",
    response_model=UserRead,
    dependencies=[Depends(require_trusted_origin)],
)
def update_user(
    user_id: UUID,
    payload: UserUpdateRequest,
    db: DatabaseSession,
    actor: User = Depends(admin_only),
) -> User:
    user = db.get(User, user_id)
    if user is None or user.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.id == actor.id and payload.is_active is False:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot deactivate your own account")
    if user.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Deleted accounts cannot be edited.")

    will_remove_admin = user.role == UserRole.ADMIN and user.is_active and (
        payload.role not in (None, UserRole.ADMIN) or payload.is_active is False
    )
    if will_remove_admin:
        active_admins = db.scalar(
            select(func.count()).select_from(User).where(
                User.role == UserRole.ADMIN,
                User.is_active.is_(True),
            )
        ) or 0
        if active_admins <= 1:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="At least one active administrator is required")

    if payload.role is not None:
        user.role = payload.role
    if payload.is_active is not None:
        user.is_active = payload.is_active
    if payload.email is not None:
        user.email = payload.email
    if payload.display_name is not None:
        user.display_name = payload.display_name
    db.add(AuditLog(actor_user_id=actor.id, action="updated", entity_type="user", entity_id=user.id))
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with that email already exists.",
        ) from error
    db.refresh(user)
    return user


@router.delete(
    "/users/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_trusted_origin)],
)
def delete_user(
    user_id: UUID,
    db: DatabaseSession,
    actor: User = Depends(admin_only),
) -> Response:
    user = db.get(User, user_id)
    if user is None or user.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.id == actor.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot delete your own account.",
        )
    if user.role == UserRole.ADMIN and user.is_active:
        active_admins = db.scalar(
            select(func.count()).select_from(User).where(
                User.role == UserRole.ADMIN,
                User.is_active.is_(True),
                User.deleted_at.is_(None),
            )
        ) or 0
        if active_admins <= 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="The last active administrator cannot be deleted.",
            )

    now = datetime.now(UTC)
    user.deleted_at = now
    user.is_active = False
    for session in db.scalars(select(AuthSession).where(AuthSession.user_id == user.id)).all():
        db.delete(session)
    db.add(
        AuditLog(
            actor_user_id=actor.id,
            action="soft_deleted",
            entity_type="user",
            entity_id=user.id,
        )
    )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)