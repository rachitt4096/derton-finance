from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request, Response, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_auth_service, get_db
from app.config import settings
from app.core.security import rate_limiter
from app.schemas.auth import LoginRequest, LoginResponse, LogoutResponse, SessionResponse
from app.services.auth_service import AuthService

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=LoginResponse)
async def login(
    body: LoginRequest,
    response: Response,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    rate_result = rate_limiter.consume(body.identifier)
    response.headers["X-RateLimit-Limit"] = str(settings.AUTH_RATE_LIMIT_MAX_ATTEMPTS)
    response.headers["X-RateLimit-Remaining"] = str(rate_result[1])

    if not rate_result[0]:
        retry_after = rate_result[2]
        response.headers["Retry-After"] = str(retry_after)
        raise HTTPException(
            status_code=429,
            detail=f"Too many login attempts. Try again in {retry_after} seconds.",
        )

    auth = AuthService(db)
    session = await auth.login(body.identifier, body.password)
    if not session:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    rate_limiter.reset(body.identifier)
    response.set_cookie(
        key=settings.COOKIE_NAME,
        value=session["token"],
        httponly=True,
        samesite=settings.COOKIE_SAME_SITE,
        secure=settings.COOKIE_SECURE_RESOLVED,
        max_age=settings.SESSION_TTL_HOURS * 3600,
        expires=session["expires_at"].strftime("%a, %d %b %Y %H:%M:%S GMT"),
    )
    return LoginResponse(
        user=session["user"],
        expires_at=session["expires_at"],
    )


@router.post("/logout", response_model=LogoutResponse)
async def logout(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    token = request.cookies.get(settings.COOKIE_NAME)
    if token:
        auth = AuthService(db)
        await auth.logout(token)
    response.delete_cookie(settings.COOKIE_NAME)
    return LogoutResponse()


@router.get("/session")
async def session(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    token = request.cookies.get(settings.COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=401, detail="No active session")
    auth = AuthService(db)
    user = await auth.get_session_user(token)
    if not user:
        resp = JSONResponse(status_code=401, content={"error": "Session expired"})
        resp.delete_cookie(settings.COOKIE_NAME)
        return resp
    return {"user": user}
