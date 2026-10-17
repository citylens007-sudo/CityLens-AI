import re
from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models import (
    AlertStatus,
    DefectStatus,
    EvidenceType,
    IncidentReviewStatus,
    RepairStatus,
    UserRole,
)


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=1, max_length=128)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", normalized):
            raise ValueError("Enter a valid email address")
        return normalized


def validate_strong_password(value: str) -> str:
    if (
        len(value) < 12
        or not re.search(r"[a-z]", value)
        or not re.search(r"[A-Z]", value)
        or not re.search(r"\d", value)
        or not re.search(r"[^A-Za-z0-9]", value)
    ):
        raise ValueError(
            "Password must be at least 12 characters and include uppercase, "
            "lowercase, numeric, and special characters."
        )
    return value


class UserCreateRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    display_name: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=12, max_length=128)
    role: UserRole

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", normalized):
            raise ValueError("Enter a valid email address")
        return normalized

    @field_validator("display_name")
    @classmethod
    def normalize_display_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Display name cannot be empty")
        return normalized


class ResidentRegistrationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str = Field(min_length=3, max_length=320)
    display_name: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=12, max_length=128)
    confirm_password: str = Field(min_length=12, max_length=128)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", normalized):
            raise ValueError("Enter a valid email address")
        return normalized

    @field_validator("display_name")
    @classmethod
    def normalize_display_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Display name cannot be empty")
        return normalized

    @field_validator("password")
    @classmethod
    def validate_password_strength(cls, value: str) -> str:
        return validate_strong_password(value)

    @model_validator(mode="after")
    def passwords_must_match(self) -> "ResidentRegistrationRequest":
        if self.password != self.confirm_password:
            raise ValueError("Passwords do not match")
        return self


class ForgotPasswordRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str = Field(min_length=3, max_length=320)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", normalized):
            raise ValueError("Enter a valid email address")
        return normalized


class ResetPasswordRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: str = Field(min_length=1, max_length=256)
    password: str = Field(min_length=12, max_length=128)
    confirm_password: str = Field(min_length=12, max_length=128)

    @field_validator("password")
    @classmethod
    def validate_password_strength(cls, value: str) -> str:
        return validate_strong_password(value)

    @model_validator(mode="after")
    def passwords_must_match(self) -> "ResetPasswordRequest":
        if self.password != self.confirm_password:
            raise ValueError("Passwords do not match")
        return self


class UserUpdateRequest(BaseModel):
    email: str | None = Field(default=None, min_length=3, max_length=320)
    display_name: str | None = Field(default=None, min_length=1, max_length=120)
    role: UserRole | None = None
    is_active: bool | None = None

    @field_validator("email")
    @classmethod
    def normalize_update_email(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip().lower()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", normalized):
            raise ValueError("Enter a valid email address")
        return normalized

    @field_validator("display_name")
    @classmethod
    def normalize_update_display_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("Display name cannot be empty")
        return normalized

    @model_validator(mode="after")
    def require_update(self) -> "UserUpdateRequest":
        if not any(value is not None for value in (
            self.email,
            self.display_name,
            self.role,
            self.is_active,
        )):
            raise ValueError("Provide at least one account field to update")
        return self


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: str
    display_name: str
    role: UserRole
    is_active: bool
    deleted_at: datetime | None
    created_at: datetime
    updated_at: datetime
    last_login_at: datetime | None


class UserListRead(BaseModel):
    items: list[UserRead]
    total: int
    limit: int
    offset: int


class PublicDefectRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    defect_type: str
    severity: str
    latitude: float | None
    longitude: float | None
    detected_at: datetime
    status: DefectStatus
    created_at: datetime


class PublicReportCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    defect_type: str = Field(min_length=1, max_length=120)
    description: str = Field(min_length=1, max_length=4000)
    severity: Literal["High", "Medium", "Low"]
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)

    @field_validator("defect_type", "description")
    @classmethod
    def normalize_report_text(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("This field cannot be empty")
        return normalized

    @model_validator(mode="after")
    def validate_coordinates(self) -> "PublicReportCreateRequest":
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("Latitude and longitude must be provided together")
        return self


class PublicReportUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    description: str | None = Field(default=None, min_length=1, max_length=4000)
    severity: Literal["High", "Medium", "Low"] | None = None
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)

    @model_validator(mode="after")
    def validate_report_update(self) -> "PublicReportUpdateRequest":
        if not self.model_fields_set:
            raise ValueError("Provide at least one field to update")
        coordinate_fields = {"latitude", "longitude"} & self.model_fields_set
        if coordinate_fields and not {"latitude", "longitude"} <= self.model_fields_set:
            raise ValueError("Latitude and longitude must be updated together")
        if self.description is not None and not self.description.strip():
            raise ValueError("Description cannot be empty")
        return self


class PublicReportRead(BaseModel):
    id: UUID
    defect_type: str
    description: str | None
    severity: str
    latitude: float | None
    longitude: float | None
    detected_at: datetime
    status: DefectStatus
    created_at: datetime
    evidence_ids: list[UUID] = Field(default_factory=list)


class DefectCreateRequest(BaseModel):
    defect_type: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=4000)
    severity: Literal["High", "Medium", "Low"]
    confidence: float = Field(ge=0, le=100)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    detected_at: datetime | None = None

    @field_validator("defect_type")
    @classmethod
    def normalize_required_text(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("This field cannot be empty")
        return normalized

    @model_validator(mode="after")
    def validate_coordinates(self) -> "DefectCreateRequest":
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("Latitude and longitude must be provided together")
        return self


class DefectUpdateRequest(BaseModel):
    description: str | None = Field(default=None, max_length=4000)
    severity: Literal["High", "Medium", "Low"] | None = None
    confidence: float | None = Field(default=None, ge=0, le=100)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    status: DefectStatus | None = None

    @model_validator(mode="after")
    def validate_update(self) -> "DefectUpdateRequest":
        if not self.model_fields_set:
            raise ValueError("Provide at least one field to update")
        coordinates_changed = {"latitude", "longitude"} & self.model_fields_set
        if coordinates_changed and not {"latitude", "longitude"} <= self.model_fields_set:
            raise ValueError("Latitude and longitude must be updated together")
        return self


class DefectRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    defect_type: str
    description: str | None
    severity: str
    confidence: float
    latitude: float | None
    longitude: float | None
    detected_at: datetime
    status: DefectStatus
    created_by: UUID
    created_at: datetime


class RepairCreateRequest(BaseModel):
    defect_id: UUID
    assigned_team_id: UUID
    notes: str | None = Field(default=None, max_length=4000)


class RepairUpdateRequest(BaseModel):
    status: RepairStatus
    notes: str | None = Field(default=None, max_length=4000)


class RepairRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    defect_id: UUID
    assigned_team_id: UUID
    assigned_by: UUID
    status: RepairStatus
    notes: str | None
    assigned_at: datetime
    completed_at: datetime | None


class IncidentCreateRequest(BaseModel):
    incident_type: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=4000)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    incident_timestamp: datetime

    @field_validator("incident_type")
    @classmethod
    def normalize_incident_type(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Incident type cannot be empty")
        return normalized

    @model_validator(mode="after")
    def validate_coordinates(self) -> "IncidentCreateRequest":
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("Latitude and longitude must be provided together")
        return self


class IncidentUpdateRequest(BaseModel):
    description: str | None = Field(default=None, max_length=4000)
    review_status: IncidentReviewStatus


class IncidentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    incident_type: str
    description: str | None
    latitude: float | None
    longitude: float | None
    incident_timestamp: datetime
    review_status: IncidentReviewStatus
    assigned_controller_id: UUID | None
    created_at: datetime


class AlertCreateRequest(BaseModel):
    incident_id: UUID
    assigned_police_user_id: UUID


class AlertUpdateRequest(BaseModel):
    alert_status: AlertStatus | None = None
    investigation_notes: str | None = Field(default=None, max_length=4000)

    @model_validator(mode="after")
    def require_update(self) -> "AlertUpdateRequest":
        if self.alert_status is None and "investigation_notes" not in self.model_fields_set:
            raise ValueError("Provide a status or investigation note to update")
        return self


class AlertRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    incident_id: UUID
    authorized_by: UUID
    assigned_police_user_id: UUID
    alert_status: AlertStatus
    investigation_notes: str | None
    authorized_at: datetime
    acknowledged_at: datetime | None


class EvidenceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    evidence_type: EvidenceType
    original_filename: str
    content_type: str
    uploaded_by: UUID
    defect_id: UUID | None
    created_at: datetime


class PaginatedResponse[T](BaseModel):
    items: list[T]
    total: int
    limit: int
    offset: int


class DashboardSummary(BaseModel):
    road_defects: int
    high_priority_defects: int
    pending_repairs: int
    open_incidents: int


class ActivityRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    actor_user_id: UUID | None
    action: str
    entity_type: str
    entity_id: UUID | None
    created_at: datetime