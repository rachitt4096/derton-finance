from __future__ import annotations

from pydantic import BaseModel, Field, EmailStr


class AdminCreateUserRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=32)
    password: str = Field(..., min_length=8, max_length=128)
    role: str = Field(..., pattern="^(admin|analyst)$")
    display_name: str | None = Field(None, max_length=80)


class AdminUpdateUserRequest(BaseModel):
    email: EmailStr | None = None
    role: str | None = Field(None, pattern="^(admin|analyst)$")
    display_name: str | None = None
    is_active: bool | None = None


class AdminResetPasswordRequest(BaseModel):
    password: str = Field(..., min_length=8, max_length=128)


class AdminOverview(BaseModel):
    users: dict
    sessions: dict
    instruments: dict
    watchlists: dict
    market_history: dict
    broker: dict | None = None
    market_retention_days: int | None = None


class AdminUserRow(BaseModel):
    id: str
    email: str
    username: str
    display_name: str | None = None
    role: str
    is_active: bool
    created_at: str
    updated_at: str
    active_session_count: int = 0
    last_session_at: str | None = None


class AdminUsersResponse(BaseModel):
    items: list[AdminUserRow]
