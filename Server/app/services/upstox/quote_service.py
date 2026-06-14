from __future__ import annotations

from datetime import datetime, timezone

import httpx

from app.config import settings
from app.services.upstox.credential_store import BrokerCredentialStore
from app.services.instrument_service import InstrumentService
from app.database import async_session_factory


class UpstoxQuoteService:
    def __init__(
        self,
        credential_store: BrokerCredentialStore,
    ) -> None:
        self.credential_store = credential_store

    async def get_last_prices(self, symbols: list[str]) -> dict[str, float]:
        """Lightweight last-price lookup (no 52w/volatility enrichment)."""
        normalized = list(dict.fromkeys(s.strip().upper() for s in symbols if s.strip()))
        if not normalized:
            return {}
        token = await self.credential_store.resolve_access_token("upstox", settings.UPSTOX_ACCESS_TOKEN)
        if not token:
            return {}

        async with async_session_factory() as db:
            instruments = await InstrumentService(db).get_by_symbols(normalized)
        if not instruments:
            return {}
        key_to_symbol = {i["instrument_key"]: i["symbol"] for i in instruments}

        async with httpx.AsyncClient(timeout=15) as client:
            keys = ",".join(key_to_symbol.keys())
            response = await client.get(
                f"https://api.upstox.com/v2/market-quote/quotes?instrument_key={keys}",
                headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
            )
            if not response.is_success:
                return {}
            raw = response.json().get("data", {})

        out: dict[str, float] = {}
        for entry in raw.values():
            tok = entry.get("instrument_token")
            sym = key_to_symbol.get(tok)
            price = entry.get("last_price") or (entry.get("ohlc", {}) or {}).get("close")
            if sym and price:
                out[sym] = price
        return out

    async def get_quotes(self, symbols: list[str]) -> list[dict]:
        normalized = list(dict.fromkeys(s.strip().upper() for s in symbols if s.strip()))
        if not normalized:
            return []

        token = await self.credential_store.resolve_access_token(
            "upstox", settings.UPSTOX_ACCESS_TOKEN
        )
        if not token:
            raise ValueError("Upstox access token is not configured")

        async with async_session_factory() as db:
            instruments = await InstrumentService(db).get_by_symbols(normalized)

        if not instruments:
            return []

        async with httpx.AsyncClient(timeout=15) as client:
            keys = ",".join(i["instrument_key"] for i in instruments)
            response = await client.get(
                f"https://api.upstox.com/v2/market-quote/quotes?instrument_key={keys}",
                headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
            )

            if response.status_code == 401:
                raise ValueError("Upstox token expired")

            response.raise_for_status()
            raw_data = response.json().get("data", {})

        # Upstox keys the response by "SEGMENT:SYMBOL" (e.g. NSE_EQ:RELIANCE), not by
        # the instrument_key we sent. Each entry carries the original key in
        # "instrument_token", so match on that for reliable lookups.
        by_token: dict[str, dict] = {}
        for entry in raw_data.values():
            tok = entry.get("instrument_token")
            if tok:
                by_token[tok] = entry

        results = []
        for inst in instruments:
            raw = by_token.get(inst["instrument_key"], {})
            ltpc = raw.get("ltpc", {})
            ohlc = raw.get("ohlc", {})
            depth = raw.get("depth", {})

            ltp = ltpc.get("ltp") or raw.get("last_price")
            net_change = raw.get("net_change")
            if ltp is not None and net_change is not None:
                # previous close derived from ltp and the broker-provided net change
                cp = ltp - net_change
            else:
                cp = ltpc.get("cp") or ohlc.get("close")
                net_change = (ltp - cp) if (ltp is not None and cp is not None) else None

            results.append({
                "symbol": inst["symbol"],
                "company_name": inst["company_name"],
                "exchange": inst["exchange"],
                "instrument_key": inst["instrument_key"],
                "last_price": ltp,
                "session_close": ohlc.get("close"),
                "open": ohlc.get("open"),
                "high": ohlc.get("high"),
                "low": ohlc.get("low"),
                "close": cp,
                "volume": raw.get("volume"),
                "average_price": raw.get("average_price") or raw.get("avg_price"),
                "net_change": net_change,
                "percent_change": ((net_change / cp) * 100) if (net_change is not None and cp and cp != 0) else None,
                "lower_circuit_limit": raw.get("lower_circuit_limit"),
                "upper_circuit_limit": raw.get("upper_circuit_limit"),
                "total_buy_quantity": raw.get("total_buy_quantity"),
                "total_sell_quantity": raw.get("total_sell_quantity"),
                "last_trade_time": str(ltpc.get("ltt")) if ltpc.get("ltt") is not None else None,
                "timestamp": raw.get("timestamp") or datetime.now(timezone.utc).isoformat(),
                "depth": {
                    "buy": [{"quantity": b.get("quantity"), "price": b.get("price"), "orders": b.get("orders")} for b in (depth.get("buy") or [])],
                    "sell": [{"quantity": s.get("quantity"), "price": s.get("price"), "orders": s.get("orders")} for s in (depth.get("sell") or [])],
                },
            })

        # Enrich with 52-week range + volatility (cached). Capped so a large
        # watchlist doesn't trigger many 365-day fetches on a cold cache.
        if len(results) <= 12:
            from app.services.upstox.history_service import UpstoxHistoryService

            history = UpstoxHistoryService(self.credential_store)
            for r in results:
                try:
                    r.update(await history.get_daily_stats(r["symbol"]))
                except Exception:  # noqa: BLE001 — stats are best-effort
                    pass

        return results
