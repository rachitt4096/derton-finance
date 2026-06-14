from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import TYPE_CHECKING, AsyncGenerator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import make_id

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import async_sessionmaker

VALID_SCOPES = {"symbol", "watchlist", "nifty50"}
VALID_CONDITIONS = {"price_above", "price_below", "pct_up", "pct_down"}

CONDITION_LABELS = {
    "price_above": "price rises above",
    "price_below": "price falls below",
    "pct_up": "gains at least",
    "pct_down": "drops at least",
}


def condition_met(condition: str, threshold: float, price: float | None, pct: float | None) -> bool:
    if condition == "price_above":
        return price is not None and price > threshold
    if condition == "price_below":
        return price is not None and price < threshold
    if condition == "pct_up":
        return pct is not None and pct >= threshold
    if condition == "pct_down":
        return pct is not None and pct <= -abs(threshold)
    return False


def _row_to_dict(row) -> dict:
    return {
        "id": row[0],
        "user_id": row[1],
        "scope": row[2],
        "symbol": row[3],
        "condition": row[4],
        "threshold": row[5],
        "note": row[6],
        "status": row[7],
        "triggered_symbol": row[8],
        "triggered_price": row[9],
        "last_triggered_at": row[10],
        "created_at": row[11],
    }


_SELECT = (
    "SELECT id, user_id, scope, symbol, condition, threshold, note, status, "
    "triggered_symbol, triggered_price, last_triggered_at::text, created_at::text "
    "FROM alert_rules"
)


class AlertRuleService:
    def __init__(
        self,
        db: AsyncSession | None = None,
        *,
        session_factory: "async_sessionmaker[AsyncSession] | None" = None,
    ) -> None:
        self._db = db
        self._session_factory = session_factory

    @asynccontextmanager
    async def _session(self) -> AsyncGenerator[AsyncSession, None]:
        if self._db is not None:
            yield self._db
        elif self._session_factory is not None:
            async with self._session_factory() as session:
                yield session
        else:
            raise RuntimeError("AlertRuleService requires a db session or session_factory")

    async def list_rules(self, user_id: str) -> list[dict]:
        async with self._session() as db:
            result = await db.execute(
                text(f"{_SELECT} WHERE user_id = :uid ORDER BY created_at DESC"),
                {"uid": user_id},
            )
            return [_row_to_dict(r) for r in result.all()]

    async def create_rule(
        self,
        user_id: str,
        scope: str,
        condition: str,
        threshold: float,
        symbol: str | None = None,
        note: str | None = None,
    ) -> dict:
        scope = scope if scope in VALID_SCOPES else "symbol"
        if condition not in VALID_CONDITIONS:
            raise ValueError(f"Invalid condition. Use one of {sorted(VALID_CONDITIONS)}.")
        if scope == "symbol" and not (symbol and symbol.strip()):
            raise ValueError("A symbol is required for a symbol-scoped alert.")
        sym = symbol.strip().upper() if symbol else None
        rule_id = make_id("alert")
        async with self._session() as db:
            await db.execute(
                text(
                    """
                    INSERT INTO alert_rules
                        (id, user_id, scope, symbol, condition, threshold, note, status, updated_at)
                    VALUES (:id, :uid, :scope, :symbol, :cond, :thr, :note, 'active', now())
                    """
                ),
                {
                    "id": rule_id,
                    "uid": user_id,
                    "scope": scope,
                    "symbol": sym,
                    "cond": condition,
                    "thr": threshold,
                    "note": note,
                },
            )
            await db.commit()
            result = await db.execute(text(f"{_SELECT} WHERE id = :id"), {"id": rule_id})
            return _row_to_dict(result.one())

    async def delete_rule(self, user_id: str, rule_id: str) -> bool:
        async with self._session() as db:
            result = await db.execute(
                text("DELETE FROM alert_rules WHERE id = :id AND user_id = :uid"),
                {"id": rule_id, "uid": user_id},
            )
            await db.commit()
            return result.rowcount > 0

    async def set_status(self, user_id: str, rule_id: str, status: str) -> bool:
        if status not in ("active", "disabled"):
            raise ValueError("status must be 'active' or 'disabled'")
        async with self._session() as db:
            result = await db.execute(
                text(
                    """
                    UPDATE alert_rules SET status = :status, updated_at = now(),
                        triggered_symbol = NULL, triggered_price = NULL
                    WHERE id = :id AND user_id = :uid
                    """
                ),
                {"status": status, "id": rule_id, "uid": user_id},
            )
            await db.commit()
            return result.rowcount > 0

    async def active_rules(self) -> list[dict]:
        async with self._session() as db:
            result = await db.execute(text(f"{_SELECT} WHERE status = 'active'"))
            return [_row_to_dict(r) for r in result.all()]

    async def mark_triggered(self, rule_id: str, symbol: str, price: float) -> None:
        async with self._session() as db:
            await db.execute(
                text(
                    """
                    UPDATE alert_rules
                    SET status = 'triggered', triggered_symbol = :sym, triggered_price = :price,
                        last_triggered_at = :ts, updated_at = now()
                    WHERE id = :id
                    """
                ),
                {"sym": symbol, "price": price, "ts": datetime.now(timezone.utc), "id": rule_id},
            )
            await db.commit()
