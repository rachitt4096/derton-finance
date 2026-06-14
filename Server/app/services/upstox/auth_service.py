from __future__ import annotations

import json
from datetime import datetime, timezone

import httpx

from app.config import settings
from app.services.upstox.credential_store import BrokerCredentialStore


class UpstoxAuthService:
    def __init__(self, credential_store: BrokerCredentialStore) -> None:
        self.credential_store = credential_store

    def is_configured(self) -> bool:
        return bool(
            settings.UPSTOX_API_KEY.strip()
            and settings.UPSTOX_API_SECRET.strip()
            and settings.UPSTOX_REDIRECT_URI.strip()
        )

    def get_authorization_url(self, state: str | None = None) -> str:
        if not self.is_configured():
            raise ValueError("Upstox OAuth is not configured.")
        url = f"{settings.UPSTOX_AUTH_URL}?client_id={settings.UPSTOX_API_KEY.strip()}&redirect_uri={settings.UPSTOX_REDIRECT_URI.strip()}"
        if state:
            url += f"&state={state}"
        return url

    async def exchange_code(self, code: str) -> dict:
        if not self.is_configured():
            raise ValueError("Upstox OAuth is not configured.")

        async with httpx.AsyncClient(timeout=15) as client:
            payload = {
                "code": code,
                "client_id": settings.UPSTOX_API_KEY.strip(),
                "client_secret": settings.UPSTOX_API_SECRET.strip(),
                "redirect_uri": settings.UPSTOX_REDIRECT_URI.strip(),
                "grant_type": "authorization_code",
            }
            response = await client.post(
                settings.UPSTOX_TOKEN_URL,
                data=payload,
                headers={"accept": "application/json"},
            )
            raw = response.json() if response.text else {}
            if not response.is_success:
                first_error = (
                    raw.get("errors", [{}])[0].get("message")
                    if isinstance(raw.get("errors"), list)
                    else None
                )
                raise ValueError(first_error or f"Upstox token exchange failed with HTTP {response.status_code}")

            access_token = (raw.get("access_token") or "").strip()
            if not access_token:
                raise ValueError("Upstox token exchange did not return an access token.")

            expires_at = self._compute_default_expiry()
            await self.credential_store.set(
                "upstox",
                access_token,
                expires_at,
                {
                    "email": raw.get("email"),
                    "user_id": raw.get("user_id"),
                    "user_name": raw.get("user_name"),
                    "issued_at": datetime.now(timezone.utc).isoformat(),
                },
            )

            return {
                "access_token": access_token,
                "expires_at": expires_at.isoformat(),
            }

    async def disconnect(self) -> None:
        await self.credential_store.clear("upstox")

    def _compute_default_expiry(self) -> datetime:
        from datetime import timedelta
        return datetime.now(timezone.utc) + timedelta(days=1)
