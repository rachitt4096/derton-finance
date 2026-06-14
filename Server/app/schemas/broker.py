from __future__ import annotations

from pydantic import BaseModel


class BrokerStatusResponse(BaseModel):
    source: str = "upstox"
    status: str = "idle"
    last_tick_at: float | None = None
    retry_in_ms: float | None = None
    error: str | None = None
    mode: str | None = None
    provider: str | None = None
    configured: bool = False
    authorization_required: bool = True
    token_expires_at: str | None = None
    using_stored_token: bool = False
    using_env_token: bool = False
    instruments_url: str | None = None


class BrokerConnectUrlResponse(BaseModel):
    authorizationUrl: str


class BrokerOkResponse(BaseModel):
    ok: bool = True
