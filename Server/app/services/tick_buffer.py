from __future__ import annotations

from datetime import UTC, datetime
from typing import Any


class TickBuffer:
    def __init__(self) -> None:
        self._latest: dict[str, dict[str, Any]] = {}
        self._pending: list[dict[str, Any]] = []

    def ingest(self, tick: dict[str, Any]) -> None:
        self._latest[tick["symbol"]] = tick
        self._pending.append(tick)

    def get_latest_price_map(self, symbols: list[str] | None = None) -> dict[str, float]:
        allowed = set(symbols) if symbols else None
        return {
            sym: tick["price"]
            for sym, tick in self._latest.items()
            if allowed is None or sym in allowed
        }

    def get_latest_tick_at(self, symbols: list[str] | None = None) -> float | None:
        allowed = set(symbols) if symbols else None
        timestamps = [
            tick["recorded_at"]
            for sym, tick in self._latest.items()
            if allowed is None or sym in allowed
        ]
        return max(timestamps) if timestamps else None

    def drain_pending(self) -> list[dict[str, Any]]:
        snapshot = list(self._pending)
        self._pending.clear()
        return snapshot

    def restore_pending(self, ticks: list[dict[str, Any]]) -> None:
        if ticks:
            self._pending[:0] = ticks

    def seed(self, symbol: str, price: float) -> None:
        self._latest[symbol] = {
            "symbol": symbol,
            "price": price,
            "recorded_at": datetime.now(UTC).timestamp() * 1000,
            "volume": None,
            "payload": {"source": "seed"},
        }

    def delete_symbol(self, symbol: str) -> None:
        self._latest.pop(symbol, None)
