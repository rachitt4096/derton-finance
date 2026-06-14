from __future__ import annotations

import httpx

from app.config import settings
from app.services.upstox.credential_store import BrokerCredentialStore

# Common index underlyings exposed as quick-select options on the frontend.
INDEX_UNDERLYINGS: dict[str, str] = {
    "NIFTY": "NSE_INDEX|Nifty 50",
    "BANKNIFTY": "NSE_INDEX|Nifty Bank",
    "FINNIFTY": "NSE_INDEX|Nifty Fin Service",
    "MIDCPNIFTY": "NSE_INDEX|NIFTY MID SELECT",
    "SENSEX": "BSE_INDEX|SENSEX",
}

CONTRACT_URL = "https://api.upstox.com/v2/option/contract"
CHAIN_URL = "https://api.upstox.com/v2/option/chain"


class UpstoxOptionService:
    def __init__(self, credential_store: BrokerCredentialStore) -> None:
        self.credential_store = credential_store

    async def _token(self) -> str:
        token = await self.credential_store.resolve_access_token(
            "upstox", settings.UPSTOX_ACCESS_TOKEN
        )
        if not token:
            raise ValueError("Upstox access token is not configured")
        return token

    async def _resolve_underlying_key(self, underlying: str) -> str | None:
        """Map a user-facing underlying (index alias or equity symbol) to an instrument_key."""
        key = underlying.strip()
        if key.upper() in INDEX_UNDERLYINGS:
            return INDEX_UNDERLYINGS[key.upper()]
        if "|" in key:
            return key  # already an instrument_key

        from app.database import async_session_factory
        from app.services.instrument_service import InstrumentService

        async with async_session_factory() as db:
            instruments = await InstrumentService(db).get_by_symbols([key.upper()])
        if instruments:
            return instruments[0]["instrument_key"]
        return None

    async def get_expiries(self, underlying: str) -> dict:
        token = await self._token()
        inst_key = await self._resolve_underlying_key(underlying)
        if not inst_key:
            raise ValueError(f"Unknown underlying: {underlying}")

        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(
                CONTRACT_URL,
                params={"instrument_key": inst_key},
                headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
            )
            if response.status_code == 401:
                raise ValueError("Upstox token expired")
            response.raise_for_status()
            contracts = response.json().get("data", []) or []

        expiries = sorted({c.get("expiry") for c in contracts if c.get("expiry")})
        return {"underlying": underlying.upper(), "instrument_key": inst_key, "expiries": expiries}

    async def get_chain(self, underlying: str, expiry: str) -> dict:
        token = await self._token()
        inst_key = await self._resolve_underlying_key(underlying)
        if not inst_key:
            raise ValueError(f"Unknown underlying: {underlying}")

        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(
                CHAIN_URL,
                params={"instrument_key": inst_key, "expiry_date": expiry},
                headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
            )
            if response.status_code == 401:
                raise ValueError("Upstox token expired")
            response.raise_for_status()
            rows = response.json().get("data", []) or []

        spot = rows[0].get("underlying_spot_price") if rows else None
        strikes = [self._map_row(r) for r in rows]

        # Aggregate totals for a quick sentiment read.
        total_call_oi = sum((s["call"]["oi"] or 0) for s in strikes)
        total_put_oi = sum((s["put"]["oi"] or 0) for s in strikes)
        pcr = round(total_put_oi / total_call_oi, 4) if total_call_oi else None

        return {
            "underlying": underlying.upper(),
            "instrument_key": inst_key,
            "expiry": expiry,
            "spot_price": spot,
            "pcr": pcr,
            "total_call_oi": total_call_oi,
            "total_put_oi": total_put_oi,
            "strikes": strikes,
        }

    @staticmethod
    def _map_leg(leg: dict | None) -> dict:
        leg = leg or {}
        md = leg.get("market_data") or {}
        gk = leg.get("option_greeks") or {}
        return {
            "instrument_key": leg.get("instrument_key"),
            "ltp": md.get("ltp"),
            "close_price": md.get("close_price"),
            "volume": md.get("volume"),
            "oi": md.get("oi"),
            "prev_oi": md.get("prev_oi"),
            "oi_change": (md.get("oi") - md.get("prev_oi"))
            if (md.get("oi") is not None and md.get("prev_oi") is not None)
            else None,
            "bid_price": md.get("bid_price"),
            "ask_price": md.get("ask_price"),
            "iv": gk.get("iv"),
            "delta": gk.get("delta"),
            "gamma": gk.get("gamma"),
            "theta": gk.get("theta"),
            "vega": gk.get("vega"),
        }

    def _map_row(self, row: dict) -> dict:
        return {
            "strike_price": row.get("strike_price"),
            "pcr": row.get("pcr"),
            "call": self._map_leg(row.get("call_options")),
            "put": self._map_leg(row.get("put_options")),
        }
