from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

import httpx

from app.config import settings


class AlertService:
    def __init__(self) -> None:
        self._last_sent: dict[str, float] = {}

    async def notify(self, event: dict) -> None:
        if not settings.ALERTS_ENABLED_RESOLVED:
            return

        now = datetime.now(timezone.utc).timestamp() * 1000
        key = event.get("key", "unknown")
        last = self._last_sent.get(key, 0)
        if now - last < settings.ALERT_COOLDOWN_MS:
            return

        self._last_sent[key] = now
        payload = self._build_payload(event)

        tasks = []
        if settings.ALERT_SLACK_WEBHOOK_URL:
            tasks.append(self._send_slack(payload))
        if self._has_twilio():
            tasks.append(self._send_whatsapp(payload))
        if settings.ALERT_EMAIL_WEBHOOK_URL:
            tasks.append(self._send_email(payload))

        if not tasks:
            return

        import asyncio
        results = await asyncio.gather(*tasks, return_exceptions=True)
        failures = [r for r in results if isinstance(r, Exception)]
        if len(failures) == len(results):
            self._last_sent.pop(key, None)

    def _build_payload(self, event: dict) -> dict:
        return {
            "key": event.get("key"),
            "severity": event.get("severity", "info"),
            "title": (event.get("title") or "").strip(),
            "message": (event.get("message") or "").strip(),
            "metadata": event.get("metadata", {}),
            "occurred_at": datetime.now(timezone.utc).isoformat(),
            "source": "derton-finance-server",
        }

    def _has_twilio(self) -> bool:
        return bool(
            settings.ALERT_WHATSAPP_TWILIO_ACCOUNT_SID.strip()
            and settings.ALERT_WHATSAPP_TWILIO_AUTH_TOKEN.strip()
            and settings.ALERT_WHATSAPP_TWILIO_FROM.strip()
            and settings.ALERT_WHATSAPP_TWILIO_TO.strip()
        )

    async def _send_slack(self, payload: dict) -> None:
        text = f"[{payload['severity'].upper()}] {payload['title']}\n{payload['message']}"
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(
                settings.ALERT_SLACK_WEBHOOK_URL,
                json={"text": text},
            )

    async def _send_whatsapp(self, payload: dict) -> None:
        sid = settings.ALERT_WHATSAPP_TWILIO_ACCOUNT_SID.strip()
        token = settings.ALERT_WHATSAPP_TWILIO_AUTH_TOKEN.strip()
        body = f"[{payload['severity'].upper()}] {payload['title']}\n{payload['message']}"
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(
                f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json",
                data={
                    "From": f"whatsapp:{settings.ALERT_WHATSAPP_TWILIO_FROM.strip()}",
                    "To": f"whatsapp:{settings.ALERT_WHATSAPP_TWILIO_TO.strip()}",
                    "Body": body,
                },
                auth=(sid, token),
            )

    async def _send_email(self, payload: dict) -> None:
        headers = {}
        token = settings.ALERT_EMAIL_WEBHOOK_TOKEN.strip()
        if token:
            headers["Authorization"] = f"Bearer {token}"

        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(
                settings.ALERT_EMAIL_WEBHOOK_URL,
                json={
                    "subject": f"[{payload['severity'].upper()}] {payload['title']}",
                    "text": f"{payload['title']}\n{payload['message']}",
                    "event": payload,
                },
                headers=headers,
            )
