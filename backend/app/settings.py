from pathlib import Path
from urllib.parse import urlsplit

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


PROJECT_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=PROJECT_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    postgres_db: str = "citylens"
    postgres_user: str | None = None
    postgres_password: str | None = None
    postgres_host: str = "localhost"
    postgres_port: int = 5432
    database_url: str | None = None
    frontend_origin: str = "http://localhost:5173"
    frontend_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    app_env: str = "production"
    evidence_storage_path: Path = PROJECT_ROOT / "var" / "evidence"
    evidence_max_upload_bytes: int = 25 * 1024 * 1024
    road_video_storage_path: Path = PROJECT_ROOT / "var" / "road-videos"
    road_video_max_upload_bytes: int = 500 * 1024 * 1024
    road_video_max_duration_seconds: int = 3600
    road_damage_model_path: Path | None = None
    road_damage_sample_interval_seconds: float = 1.0
    auth_session_ttl_minutes: int = 480
    auth_cookie_name: str = "citylens_session"
    public_app_url: str = "http://localhost:5173"
    password_reset_ttl_minutes: int = Field(default=15, ge=1, le=60)
    database_pool_size: int = Field(default=3, ge=1, le=20)
    database_max_overflow: int = Field(default=2, ge=0, le=20)
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_from_email: str | None = None
    smtp_use_starttls: bool = True
    smtp_use_ssl: bool = False
    email_verification_ttl_hours: int = 24
    admin_bootstrap_email: str | None = None
    admin_bootstrap_password: str | None = None
    admin_bootstrap_name: str = "CityLens Administrator"

    @property
    def trusted_frontend_origins(self) -> list[str]:
        return [origin.strip() for origin in self.frontend_origins.split(",") if origin.strip()]

    def validate_frontend_origins(self) -> None:
        origins = self.trusted_frontend_origins
        if "*" in origins:
            raise ValueError("FRONTEND_ORIGINS must list exact origins; wildcard origins are not allowed.")
        if self.app_env.lower() == "production" and not origins:
            raise ValueError("Production requires at least one exact HTTPS origin in FRONTEND_ORIGINS.")
        for origin in origins:
            parsed = urlsplit(origin)
            if (
                not parsed.scheme
                or not parsed.netloc
                or parsed.path
                or parsed.query
                or parsed.fragment
                or parsed.username
                or parsed.password
            ):
                raise ValueError("Each FRONTEND_ORIGINS entry must be an exact scheme and host origin.")
            if self.app_env.lower() == "production" and parsed.scheme != "https":
                raise ValueError("Production FRONTEND_ORIGINS entries must use HTTPS.")

    @property
    def secure_auth_cookie(self) -> bool:
        return self.app_env.lower() not in {"development", "test"}


settings = Settings()