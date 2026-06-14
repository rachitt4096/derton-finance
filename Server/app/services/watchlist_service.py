from __future__ import annotations

import secrets

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


class WatchlistService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get_all_default_watchlist_symbols(self) -> list[str]:
        result = await self.db.execute(
            text(
                """
                SELECT DISTINCT watchlist_items.symbol
                FROM watchlists
                JOIN watchlist_items ON watchlist_items.watchlist_id = watchlists.id
                WHERE watchlists.is_default = true
                ORDER BY watchlist_items.symbol ASC
                """
            )
        )
        return [r[0] for r in result.all()]

    async def get_default_watchlist(self, user_id: str) -> list[str]:
        result = await self.db.execute(
            text(
                """
                SELECT watchlist_items.symbol
                FROM watchlists
                JOIN watchlist_items ON watchlist_items.watchlist_id = watchlists.id
                WHERE watchlists.user_id = :user_id
                  AND watchlists.is_default = true
                ORDER BY watchlist_items.sort_order ASC
                """
            ),
            {"user_id": user_id},
        )
        return [r[0] for r in result.all()]

    async def set_default_watchlist(self, user_id: str, symbols: list[str]) -> list[str]:
        normalized = list(
            dict.fromkeys(
                s.strip().upper()
                for s in symbols
                if s.strip()
            )
        )

        if normalized:
            result = await self.db.execute(
                text("SELECT symbol FROM instruments WHERE symbol = ANY(:symbols)"),
                {"symbols": normalized},
            )
            valid = {r[0] for r in result.all()}
            filtered = [s for s in normalized if s in valid]
        else:
            filtered = []

        result = await self.db.execute(
            text(
                """
                SELECT id FROM watchlists
                WHERE user_id = :user_id AND is_default = true
                LIMIT 1
                """
            ),
            {"user_id": user_id},
        )
        row = result.one_or_none()
        watchlist_id = row[0] if row else secrets.token_hex(16)

        await self.db.execute(
            text(
                """
                INSERT INTO watchlists (id, user_id, name, is_default)
                VALUES (:id, :user_id, 'Default', true)
                ON CONFLICT (user_id, name) DO UPDATE SET is_default = true
                """
            ),
            {"id": watchlist_id, "user_id": user_id},
        )

        await self.db.execute(
            text("DELETE FROM watchlist_items WHERE watchlist_id = :wid"),
            {"wid": watchlist_id},
        )

        for idx, symbol in enumerate(filtered):
            await self.db.execute(
                text(
                    """
                    INSERT INTO watchlist_items (id, watchlist_id, symbol, sort_order)
                    VALUES (:id, :wid, :symbol, :order)
                    """
                ),
                {
                    "id": secrets.token_hex(16),
                    "wid": watchlist_id,
                    "symbol": symbol,
                    "order": idx,
                },
            )

        return filtered
