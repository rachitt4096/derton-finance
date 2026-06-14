from __future__ import annotations

from fastapi import Cookie, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.services.auth_service import AuthService
from app.core.exceptions import UnauthorizedError, ForbiddenError


async def get_auth_service(db: AsyncSession = Depends(get_db)) -> AuthService:
    return AuthService(db)


async def get_current_user(
    request: Request,
    auth_service: AuthService = Depends(get_auth_service),
) -> dict:
    from app.config import settings
    token = request.cookies.get(settings.COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=401, detail="Unauthorized")
    user = await auth_service.get_session_user(token)
    if not user:
        raise HTTPException(status_code=401, detail="Session expired")
    return user


async def get_current_admin(
    current_user: dict = Depends(get_current_user),
) -> dict:
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Forbidden")
    return current_user
