from __future__ import annotations

import secrets
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


class PortfolioService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def list_transactions(self, user_id: str) -> list[dict]:
        result = await self.db.execute(
            text(
                """
                SELECT id, symbol, side, quantity::text, price::text, traded_at::text, metadata
                FROM portfolio_transactions
                WHERE user_id = :user_id
                ORDER BY traded_at DESC, created_at DESC
                """
            ),
            {"user_id": user_id},
        )
        return [
            {
                "id": r[0],
                "symbol": r[1],
                "side": r[2],
                "quantity": float(r[3]),
                "price": float(r[4]),
                "traded_at": r[5],
                "metadata": r[6] if r[6] else {},
            }
            for r in result.all()
        ]

    async def create_transaction(
        self, user_id: str, input_data: dict
    ) -> str:
        tid = secrets.token_hex(16)
        traded_at = input_data.get("traded_at") or datetime.now(timezone.utc).isoformat()
        await self.db.execute(
            text(
                """
                INSERT INTO portfolio_transactions (id, user_id, symbol, side, quantity, price, traded_at)
                VALUES (:id, :uid, :symbol, :side, :qty, :price, :traded_at)
                """
            ),
            {
                "id": tid,
                "uid": user_id,
                "symbol": input_data["symbol"],
                "side": input_data["side"],
                "qty": input_data["quantity"],
                "price": input_data["price"],
                "traded_at": traded_at,
            },
        )
        return tid

    async def update_transaction(self, user_id: str, txn_id: str, input_data: dict) -> None:
        await self.db.execute(
            text(
                """
                UPDATE portfolio_transactions
                SET quantity = :qty, price = :price, traded_at = :traded_at
                WHERE id = :id AND user_id = :uid
                """
            ),
            {
                "qty": input_data["quantity"],
                "price": input_data["price"],
                "traded_at": input_data["traded_at"],
                "id": txn_id,
                "uid": user_id,
            },
        )

    async def delete_transaction(self, user_id: str, txn_id: str) -> None:
        await self.db.execute(
            text(
                "DELETE FROM portfolio_transactions WHERE id = :id AND user_id = :uid"
            ),
            {"id": txn_id, "uid": user_id},
        )

    async def get_summary(self, user_id: str, latest_prices: dict[str, float]) -> dict:
        transactions = await self.list_transactions(user_id)
        holdings_map = self._build_holdings_map(transactions, latest_prices)
        holdings = [h for h in holdings_map.values() if h["quantity"] > 0]

        invested = sum(h["avg_price"] * h["quantity"] for h in holdings)
        current = sum(h["current_value"] for h in holdings)
        realized = sum(h["realized_pnl"] for h in holdings_map.values())
        unrealized = sum(h["unrealized_pnl"] for h in holdings)

        return {
            "cards": [
                {"id": "invested", "label": "Total Invested", "value": invested, "change": None},
                {
                    "id": "current",
                    "label": "Current Value",
                    "value": current,
                    "change": (current / invested - 1) * 100 if invested else 0,
                },
                {
                    "id": "total_pl",
                    "label": "Total P&L",
                    "value": realized + unrealized,
                    "change": ((realized + unrealized) / invested) * 100 if invested else 0,
                },
                {
                    "id": "unrealized",
                    "label": "Unrealized",
                    "value": unrealized,
                    "change": (unrealized / invested) * 100 if invested else 0,
                },
                {"id": "realized", "label": "Realized", "value": realized, "change": None},
            ],
            "totals": {
                "invested": invested,
                "current": current,
                "realized": realized,
                "unrealized": unrealized,
                "total_pnl": realized + unrealized,
            },
        }

    async def get_holdings(self, user_id: str, latest_prices: dict[str, float]) -> list[dict]:
        transactions = await self.list_transactions(user_id)
        holdings_map = self._build_holdings_map(transactions, latest_prices)
        rows = [h for h in holdings_map.values() if h["quantity"] > 0]

        result = []
        for h in rows:
            result.append({
                "symbol": h["symbol"],
                "quantity": h["quantity"],
                "avg_price": h["avg_price"],
                "current_price": h["current_price"],
                "current_value": h["current_value"],
                "pnl": h["unrealized_pnl"],
                "pnl_pct": (h["current_price"] - h["avg_price"]) / h["avg_price"] * 100 if h["avg_price"] else 0,
                "realized_pnl": h["realized_pnl"],
                "allocation_pct": 0,
            })

        total_current = sum(r["current_value"] for r in result)
        for r in result:
            r["allocation_pct"] = (r["current_value"] / total_current * 100) if total_current else 0

        return result

    def _build_holdings_map(
        self, transactions: list[dict], latest_prices: dict[str, float]
    ) -> dict[str, dict]:
        sorted_txns = sorted(transactions, key=lambda t: t["traded_at"])
        holdings: dict[str, dict] = {}

        for txn in sorted_txns:
            sym = txn["symbol"]
            h = holdings.get(sym, {
                "symbol": sym,
                "quantity": 0.0,
                "avg_price": 0.0,
                "current_price": latest_prices.get(sym, txn["price"]),
                "current_value": 0.0,
                "realized_pnl": 0.0,
                "unrealized_pnl": 0.0,
                "total_cost": 0.0,
            })

            if txn["side"] == "BUY":
                h["quantity"] += txn["quantity"]
                h["total_cost"] += txn["quantity"] * txn["price"]
            else:
                avg_cost = h["total_cost"] / h["quantity"] if h["quantity"] > 0 else 0
                h["realized_pnl"] += txn["quantity"] * (txn["price"] - avg_cost)
                h["quantity"] = max(0, h["quantity"] - txn["quantity"])
                h["total_cost"] = max(0, h["total_cost"] - avg_cost * txn["quantity"])

            h["avg_price"] = h["total_cost"] / h["quantity"] if h["quantity"] > 0 else 0
            h["current_price"] = latest_prices.get(sym, h["current_price"])
            h["current_value"] = h["quantity"] * h["current_price"]
            h["unrealized_pnl"] = h["quantity"] * (h["current_price"] - h["avg_price"])
            holdings[sym] = h

        return holdings
