from functools import lru_cache
from collections.abc import Generator

from fastapi import HTTPException
from sqlalchemy import Engine, URL, create_engine, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from app.settings import settings


@lru_cache
def get_engine() -> Engine:
    if settings.database_url:
        database_url = settings.database_url
        if database_url.startswith("postgres://"):
            database_url = "postgresql+psycopg://" + database_url.removeprefix("postgres://")
        elif database_url.startswith("postgresql://"):
            database_url = "postgresql+psycopg://" + database_url.removeprefix("postgresql://")
        return create_engine(
            database_url,
            pool_pre_ping=True,
            pool_size=settings.database_pool_size,
            max_overflow=settings.database_max_overflow,
            pool_recycle=300,
            connect_args={"connect_timeout": 10},
        )
    if not settings.postgres_user or not settings.postgres_password:
        raise RuntimeError("Set DATABASE_URL or PostgreSQL credentials before connecting")

    database_url = URL.create(
        drivername="postgresql+psycopg",
        username=settings.postgres_user,
        password=settings.postgres_password,
        host=settings.postgres_host,
        port=settings.postgres_port,
        database=settings.postgres_db,
    )
    return create_engine(
        database_url,
        pool_pre_ping=True,
        pool_size=settings.database_pool_size,
        max_overflow=settings.database_max_overflow,
        pool_recycle=300,
        connect_args={"connect_timeout": 10},
    )


@lru_cache
def get_session_factory() -> sessionmaker[Session]:
    return sessionmaker(bind=get_engine(), expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    try:
        session = get_session_factory()()
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail="Database is not configured") from error
    try:
        yield session
    except SQLAlchemyError as error:
        session.rollback()
        raise HTTPException(status_code=503, detail="Database is unavailable") from error
    finally:
        session.close()


def check_database() -> bool:
    try:
        with get_engine().connect() as connection:
            connection.execute(text("SELECT 1"))
        return True
    except (RuntimeError, SQLAlchemyError):
        return False