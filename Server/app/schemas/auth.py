from __future__ import annotations

from datetime import datetime
from pydantic import BaseModel, EmailStr, Field


class LoginRequest(BaseModel):
    identifier: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)


class SessionUser(BaseModel):
    id: str
    email: str
    username: str
    role: str


class LoginResponse(BaseModel):
    user: SessionUser
    expires_at: datetime


class SessionResponse(BaseModel):
    user: SessionUser


class LogoutResponse(BaseModel):
    ok: bool = True


class ErrorResponse(BaseModel):
    error: str
