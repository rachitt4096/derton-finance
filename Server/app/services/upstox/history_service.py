from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from app.config import settings
from app.services.upstox.credential_store import BrokerCredentialStore


class UpstoxHistoryService:
    # Shared across instances/requests so the 365-day fetch isn't repeated per call.
    _daily_stats_cache: dict[str, Any] = {}

    def __init__(self, credential_store: BrokerCredentialStore) -> None:
        self.credential_store = credential_store
        self._year_range_cache: dict[str, Any] = {}
        self._minute_close_cache: dict[str, Any] = {}

    async def get_daily_stats(self, symbol: str) -> dict:
        """52-week high/low + daily & annualised volatility from one cached
        365-day daily-candle fetch (cached 6h, shared across requests)."""
        import math
        import statistics

        sym = symbol.strip().upper()
        now_ms = datetime.now(timezone.utc).timestamp() * 1000
        cached = UpstoxHistoryService._daily_stats_cache.get(sym)
        if cached and cached["expires_at"] > now_ms:
            return cached["value"]

        candles = await self.get_candles_by_symbol(sym, 365, "1d")
        if not candles:
            value = {
                "year_high": None, "year_low": None, "year_high_date": None,
                "year_low_date": None, "daily_volatility": None, "annualised_volatility": None,
            }
        else:
            ordered = sorted(candles, key=lambda c: c["time"])
            high_c = max(ordered, key=lambda c: c["high"])
            low_c = min(ordered, key=lambda c: c["low"])
            closes = [c["close"] for c in ordered if c.get("close")]
            returns = [
                (closes[i] - closes[i - 1]) / closes[i - 1]
                for i in range(1, len(closes))
                if closes[i - 1]
            ]
            daily_vol = round(statistics.pstdev(returns) * 100, 2) if len(returns) > 1 else None
            annual_vol = round(daily_vol * math.sqrt(252), 2) if daily_vol is not None else None
            value = {
                "year_high": high_c["high"],
                "year_low": low_c["low"],
                "year_high_date": high_c["time"],
                "year_low_date": low_c["time"],
                "daily_volatility": daily_vol,
                "annualised_volatility": annual_vol,
            }

        UpstoxHistoryService._daily_stats_cache[sym] = {
            "expires_at": now_ms + 6 * 3600 * 1000,
            "value": value,
        }
        return value

    async def get_candles_by_symbol(
        self,
        symbol: str,
        days: int,
        interval: str,
        date: str | None = None,
    ) -> list[dict]:
        token = await self.credential_store.resolve_access_token(
            "upstox", settings.UPSTOX_ACCESS_TOKEN
        )
        if not token:
            raise ValueError("Upstox access token is not configured")

        from app.services.instrument_service import InstrumentService
        from app.database import async_session_factory

        async with async_session_factory() as db:
            inst_service = InstrumentService(db)
            instruments = await inst_service.get_by_symbols([symbol.strip().upper()])

        if not instruments:
            return []

        return await self.get_candles_by_instrument_key(
            instruments[0]["instrument_key"], days, interval, date, token=token
        )

    async def get_candles_by_instrument_key(
        self,
        inst_key: str,
        days: int,
        interval: str,
        date: str | None = None,
        token: str | None = None,
    ) -> list[dict]:
        if token is None:
            token = await self.credential_store.resolve_access_token(
                "upstox", settings.UPSTOX_ACCESS_TOKEN
            )
        if not token:
            raise ValueError("Upstox access token is not configured")

        unit, value = self._map_interval(interval)
        to_date = date or (datetime.now(timezone.utc)).strftime("%Y-%m-%d")
        from_date = date or (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")

        # Upstox's intraday endpoint only ever returns the *current* trading day
        # and ignores the requested date. Use it only for the live session (no
        # date, or date == today in IST); for any past date use the historical
        # date-range endpoint, which supports intraday intervals too.
        today_ist = (datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)).strftime("%Y-%m-%d")
        is_intraday = interval != "1d" and (not date or date == today_ist)
        intraday_endpoint = f"https://api.upstox.com/v3/historical-candle/intraday/{inst_key}/{unit}/{value}"
        range_endpoint = (
            f"https://api.upstox.com/v3/historical-candle/{inst_key}/{unit}/{value}/{to_date}/{from_date}"
        )

        async with httpx.AsyncClient(timeout=15) as client:
            candles = await self._fetch_candles(
                client, intraday_endpoint if is_intraday else range_endpoint, token
            )
            # Live intraday returns nothing on non-trading days / pre-market. Fall
            # back to the recent historical range so charts still show last session.
            if not candles and is_intraday:
                fallback_from = (datetime.now(timezone.utc) - timedelta(days=max(days, 7))).strftime("%Y-%m-%d")
                fallback_endpoint = (
                    f"https://api.upstox.com/v3/historical-candle/{inst_key}/{unit}/{value}/{today_ist}/{fallback_from}"
                )
                candles = await self._fetch_candles(client, fallback_endpoint, token)

        return candles

    async def _fetch_candles(self, client: httpx.AsyncClient, endpoint: str, token: str) -> list[dict]:
        response = await client.get(
            endpoint,
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
        )
        if response.status_code == 401:
            raise ValueError("Upstox token expired")
        response.raise_for_status()
        raw_candles = response.json().get("data", {}).get("candles", [])
        return [
            {
                "time": c[0],
                "open": float(c[1]),
                "high": float(c[2]),
                "low": float(c[3]),
                "close": float(c[4]),
                "volume": float(c[5]) if len(c) > 5 else 0,
            }
            for c in raw_candles
            if c and all(isinstance(v, (int, float)) for v in c[1:5])
        ]

    async def get_52_week_range(self, symbol: str) -> dict:
        sym = symbol.strip().upper()
        if sym in self._year_range_cache:
            entry = self._year_range_cache[sym]
            if entry["expires_at"] > datetime.now(timezone.utc).timestamp() * 1000:
                return entry["value"]

        candles = await self.get_candles_by_symbol(sym, 365, "1d")
        if not candles:
            result = {"year_high": None, "year_low": None, "year_high_date": None, "year_low_date": None}
        else:
            high_c = max(candles, key=lambda c: c["high"])
            low_c = min(candles, key=lambda c: c["low"])
            result = {
                "year_high": high_c["high"],
                "year_low": low_c["low"],
                "year_high_date": high_c["time"],
                "year_low_date": low_c["time"],
            }

        self._year_range_cache[sym] = {
            "expires_at": (datetime.now(timezone.utc).timestamp() * 1000) + 6 * 3600 * 1000,
            "value": result,
        }
        return result

    def _map_interval(self, interval: str) -> tuple[str, str]:
        mapping = {
            "1m": ("minutes", "1"),
            "5m": ("minutes", "5"),
            "15m": ("minutes", "15"),
            "1h": ("hours", "1"),
            "1d": ("days", "1"),
        }
        return mapping.get(interval, ("days", "1"))
