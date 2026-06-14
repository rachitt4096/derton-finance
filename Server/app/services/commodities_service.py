from __future__ import annotations

import gzip
import io
import json
import time
from datetime import datetime, timezone

import httpx

from app.config import settings
from app.services.upstox.credential_store import BrokerCredentialStore
from app.services.upstox.history_service import UpstoxHistoryService

MCX_INSTRUMENTS_URL = "https://assets.upstox.com/market-quote/instruments/exchange/MCX.json.gz"

# Display name -> MCX asset_symbol. These are the headline commodities.
COMMODITIES = {
    "GOLD": "GOLD",
    "SILVER": "SILVER",
    "CRUDEOIL": "CRUDEOIL",
    "NATURALGAS": "NATURALGAS",
    "COPPER": "COPPER",
}

_CONTRACT_TTL_S = 6 * 3600


class CommoditiesService:
    """Resolves headline MCX commodities to their current near-month futures
    contract (auto-handles monthly rollover) and serves quotes + candles."""

    _contracts_cache: dict[str, dict] = {}
    _contracts_fetched_at: float = 0.0

    def __init__(self, credential_store: BrokerCredentialStore) -> None:
        self._store = credential_store

    async def _token(self) -> str:
        token = await self._store.resolve_access_token("upstox", settings.UPSTOX_ACCESS_TOKEN)
        if not token:
            raise ValueError("Upstox access token is not configured")
        return token

    async def _load_contracts(self) -> dict[str, dict]:
        """Return {display_name: {instrument_key, trading_symbol, expiry, lot_size}}
        for the nearest non-expired futures of each commodity. Cached for 6h."""
        now = time.time()
        if CommoditiesService._contracts_cache and now - CommoditiesService._contracts_fetched_at < _CONTRACT_TTL_S:
            return CommoditiesService._contracts_cache

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(MCX_INSTRUMENTS_URL)
            resp.raise_for_status()
            raw = gzip.GzipFile(fileobj=io.BytesIO(resp.content)).read()
            data = json.loads(raw)

        today_ms = datetime.now(timezone.utc).timestamp() * 1000
        resolved: dict[str, dict] = {}
        for name, asset in COMMODITIES.items():
            futs = [
                d for d in data
                if d.get("asset_symbol") == asset
                and d.get("instrument_type") == "FUT"
                and (d.get("expiry") or 0) >= today_ms
            ]
            futs.sort(key=lambda d: d.get("expiry", 0))
            if futs:
                f = futs[0]
                resolved[name] = {
                    "instrument_key": f["instrument_key"],
                    "trading_symbol": f.get("trading_symbol"),
                    "expiry": f.get("expiry"),
                    "lot_size": f.get("lot_size"),
                }

        CommoditiesService._contracts_cache = resolved
        CommoditiesService._contracts_fetched_at = now
        return resolved

    async def list_with_quotes(self) -> list[dict]:
        token = await self._token()
        contracts = await self._load_contracts()
        if not contracts:
            return []

        keys = ",".join(c["instrument_key"] for c in contracts.values())
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"https://api.upstox.com/v2/market-quote/quotes?instrument_key={keys}",
                headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
            )
            resp.raise_for_status()
            raw = resp.json().get("data", {})

        by_token = {v.get("instrument_token"): v for v in raw.values()}
        items = []
        for name, c in contracts.items():
            q = by_token.get(c["instrument_key"], {})
            ltp = q.get("last_price")
            net = q.get("net_change")
            cp = (ltp - net) if (ltp is not None and net is not None) else (q.get("ohlc", {}) or {}).get("close")
            items.append({
                "name": name,
                "trading_symbol": c["trading_symbol"],
                "instrument_key": c["instrument_key"],
                "expiry": c["expiry"],
                "last_price": ltp,
                "prev_close": cp,
                "net_change": net,
                "percent_change": round((net / cp) * 100, 2) if (net is not None and cp) else None,
                "open": (q.get("ohlc", {}) or {}).get("open"),
                "high": (q.get("ohlc", {}) or {}).get("high"),
                "low": (q.get("ohlc", {}) or {}).get("low"),
                "volume": q.get("volume"),
            })
        return items

    async def get_history(self, name: str, days: int, interval: str, date: str | None) -> dict:
        name = name.strip().upper()
        contracts = await self._load_contracts()
        contract = contracts.get(name)
        if not contract:
            raise ValueError(f"Unknown commodity: {name}")
        history = UpstoxHistoryService(self._store)
        candles = await history.get_candles_by_instrument_key(
            contract["instrument_key"], days, interval, date
        )
        return {
            "name": name,
            "trading_symbol": contract["trading_symbol"],
            "interval": interval,
            "date": date,
            "candles": candles,
        }
