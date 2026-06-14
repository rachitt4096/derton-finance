from __future__ import annotations

from urllib.parse import parse_qs, urlparse

import httpx
import pyotp

from app.config import settings
from app.core.logging import logger
from app.services.upstox.auth_service import UpstoxAuthService
from app.services.upstox.credential_store import BrokerCredentialStore


class UpstoxAutoAuth:
    """Automated daily Upstox token refresh using credentials + TOTP."""

    BASE = "https://api.upstox.com"

    def __init__(self, credential_store: BrokerCredentialStore) -> None:
        self._store = credential_store

    def is_configured(self) -> bool:
        return bool(
            settings.UPSTOX_USER_ID.strip()
            and settings.UPSTOX_PIN.strip()
            and settings.UPSTOX_TOTP_SECRET.strip()
            and settings.UPSTOX_API_KEY.strip()
            and settings.UPSTOX_API_SECRET.strip()
            and settings.UPSTOX_REDIRECT_URI.strip()
        )

    async def run(self) -> str:
        """Full automated auth flow. Returns the new access token."""
        if not self.is_configured():
            raise ValueError("Auto-auth not configured — set UPSTOX_USER_ID, UPSTOX_PIN, UPSTOX_TOTP_SECRET")

        code = await self._get_auth_code()
        auth_svc = UpstoxAuthService(self._store)
        result = await auth_svc.exchange_code(code)
        logger.info("Upstox auto-auth completed", expires_at=result.get("expires_at"))
        return result["access_token"]

    async def _get_auth_code(self) -> str:
        headers = {
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
            "Accept": "application/json, text/plain, */*",
            "Content-Type": "application/x-www-form-urlencoded",
        }

        async with httpx.AsyncClient(
            follow_redirects=False, timeout=30, headers=headers
        ) as client:
            # Step 1: Initiate auth dialog to get session cookies
            await client.get(
                f"{self.BASE}/v2/login/authorization/dialog",
                params={
                    "response_type": "code",
                    "client_id": settings.UPSTOX_API_KEY.strip(),
                    "redirect_uri": settings.UPSTOX_REDIRECT_URI.strip(),
                },
            )

            # Step 2: Submit mobile/user-id + PIN
            r = await client.post(
                f"{self.BASE}/v2/login/authorization",
                data={
                    "mobile_num": settings.UPSTOX_USER_ID.strip(),
                    "mpin": settings.UPSTOX_PIN.strip(),
                    "source": "WEB",
                    "client_id": settings.UPSTOX_API_KEY.strip(),
                    "redirect_uri": settings.UPSTOX_REDIRECT_URI.strip(),
                },
            )
            if not r.is_success and r.status_code not in (301, 302, 303):
                raise ValueError(f"Upstox login step failed: HTTP {r.status_code} — {r.text[:200]}")

            # Step 3: Submit TOTP
            totp = pyotp.TOTP(settings.UPSTOX_TOTP_SECRET.strip()).now()
            r = await client.post(
                f"{self.BASE}/v2/login/authorization/dialog/twofa/totp/verify",
                data={"otp": totp},
            )

            # Extract code from redirect location
            code = self._extract_code(r)
            if code:
                return code

            # Some versions return JSON with the code
            try:
                body = r.json()
                code = body.get("code") or body.get("data", {}).get("code")
                if code:
                    return code
            except Exception:
                pass

            raise ValueError(
                f"Could not extract auth code from Upstox response "
                f"(status={r.status_code}, body={r.text[:300]})"
            )

    @staticmethod
    def _extract_code(response: httpx.Response) -> str | None:
        location = response.headers.get("location", "")
        if location:
            parsed = urlparse(location)
            code = parse_qs(parsed.query).get("code", [None])[0]
            if code:
                return code
        return None
