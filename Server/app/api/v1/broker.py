from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_admin, get_db
from app.config import settings
from app.schemas.broker import BrokerConnectUrlResponse, BrokerOkResponse, BrokerStatusResponse
from app.services.auth_service import AuthService
from app.services.upstox.auth_service import UpstoxAuthService
from app.services.upstox.auto_auth import UpstoxAutoAuth
from app.services.upstox.credential_store import BrokerCredentialStore

router = APIRouter(prefix="/api/broker", tags=["broker"])


@router.get("/status", response_model=BrokerStatusResponse)
async def broker_status(db: AsyncSession = Depends(get_db)):
    store = BrokerCredentialStore(db)
    stored = await store.get("upstox")
    has_env_token = bool(settings.UPSTOX_ACCESS_TOKEN.strip())
    has_stored_token = bool(stored and stored.get("access_token"))

    return BrokerStatusResponse(
        mode=settings.BROKER_MODE,
        provider="upstox",
        configured=bool(settings.UPSTOX_API_KEY.strip()),
        authorization_required=not has_env_token and not has_stored_token,
        token_expires_at=stored.get("expires_at") if stored else None,
        using_stored_token=has_stored_token,
        using_env_token=has_env_token and not has_stored_token,
        instruments_url=settings.UPSTOX_INSTRUMENTS_URL,
    )


@router.get("/upstox/connect-url", response_model=BrokerConnectUrlResponse)
async def upstox_connect_url(
    current_user: dict = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    store = BrokerCredentialStore(db)
    auth_service = UpstoxAuthService(store)
    if not auth_service.is_configured():
        raise HTTPException(status_code=400, detail="Upstox OAuth is not configured")
    state = f"{current_user['id']}:{datetime.now(timezone.utc).timestamp()}"
    url = auth_service.get_authorization_url(state)
    return BrokerConnectUrlResponse(authorizationUrl=url)


@router.get("/upstox/callback")
async def upstox_callback(
    code: str | None = Query(None),
    error: str | None = Query(None),
    error_description: str | None = Query(None),
):
    """
    Upstox redirects here after user authorises. No session cookie is
    available at this point (SameSite=Lax blocks cookies on cross-domain
    redirects from Upstox back to the API).

    Strategy: forward the code to the frontend via query params.
    The frontend then calls POST /api/broker/upstox/exchange (same-origin,
    cookie present) to do the actual token exchange.
    """
    base_url = settings.APP_ORIGINS[0]

    if error:
        msg = (error_description or error)[:200]
        return RedirectResponse(url=f"{base_url}?broker=error&brokerMessage={msg}")

    if not code:
        return RedirectResponse(
            url=f"{base_url}?broker=error&brokerMessage=No+authorization+code"
        )

    # Pass the code to the frontend — it will complete the exchange
    return RedirectResponse(url=f"{base_url}?broker=pending&brokerCode={code.strip()}")


@router.post("/upstox/exchange")
async def upstox_exchange(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Frontend posts the code here (same-origin, so the session cookie IS
    present). Validates admin role, then exchanges code for access token.
    """
    body = await request.json()
    code = (body.get("code") or "").strip()
    if not code:
        raise HTTPException(status_code=400, detail="Missing authorization code")

    token = request.cookies.get(settings.COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    auth_svc = AuthService(db)
    user = await auth_svc.get_session_user(token)
    if not user or user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    store = BrokerCredentialStore(db)
    upstox_auth = UpstoxAuthService(store)
    try:
        result = await upstox_auth.exchange_code(code)
        return {"ok": True, "expires_at": result.get("expires_at")}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/upstox/auto-auth", response_model=BrokerOkResponse)
async def upstox_auto_auth(
    current_user: dict = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Trigger automated token refresh using stored credentials (no browser needed)."""
    store = BrokerCredentialStore(db)
    auto_auth = UpstoxAutoAuth(store)
    if not auto_auth.is_configured():
        raise HTTPException(
            status_code=400,
            detail="Auto-auth not configured — set UPSTOX_USER_ID, UPSTOX_PIN, UPSTOX_TOTP_SECRET in .env",
        )
    try:
        await auto_auth.run()
        return BrokerOkResponse()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/upstox/disconnect", response_model=BrokerOkResponse)
async def upstox_disconnect(
    current_user: dict = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    store = BrokerCredentialStore(db)
    auth_service = UpstoxAuthService(store)
    await auth_service.disconnect()
    return BrokerOkResponse()
