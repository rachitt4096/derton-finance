from __future__ import annotations

import gzip
import json
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING, Any, AsyncGenerator

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cache import cache_get, cache_set

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import async_sessionmaker


class InstrumentService:
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
            raise RuntimeError("InstrumentService requires a db session or session_factory")

    async def sync_from_upstox(self, instruments_url: str) -> int:
        if not instruments_url:
            return 0

        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.get(instruments_url)
            response.raise_for_status()

            content_type = response.headers.get("content-type", "")
            if instruments_url.endswith(".gz") or "gzip" in content_type:
                payload = json.loads(gzip.decompress(response.content).decode("utf-8"))
            else:
                payload = response.json()

        seen_symbols: set[str] = set()
        seen_keys: set[str] = set()
        count = 0

        async with self._session() as db:
            for item in payload:
                symbol = (item.get("trading_symbol") or item.get("symbol") or "").strip().upper()
                company_name = (item.get("name") or symbol).strip()
                exchange = (item.get("exchange") or "NSE").strip().upper()
                segment = (item.get("segment") or "").strip().upper()
                instrument_type = (item.get("instrument_type") or "").strip().upper()
                instrument_key = (item.get("instrument_key") or item.get("instrumentKey") or "").strip()

                if not symbol or not instrument_key:
                    continue
                if segment and segment != "NSE_EQ":
                    continue
                if instrument_type and instrument_type not in ("EQ", "BE"):
                    continue
                if symbol in seen_symbols or instrument_key in seen_keys:
                    continue

                seen_symbols.add(symbol)
                seen_keys.add(instrument_key)

                from app.services.company_reference import COMPANY_REFERENCE_DATA
                from app.services.nifty50_fundamentals import NIFTY50_FUNDAMENTALS

                fundamentals = NIFTY50_FUNDAMENTALS.get(symbol)
                reference = COMPANY_REFERENCE_DATA.get(symbol)
                overview = None
                if fundamentals or reference:
                    overview = {
                        **(fundamentals or {}),
                        **(reference or {}),  # richer reference seed wins for the 8 detailed stocks
                    }
                metadata = json.dumps({"companyOverview": overview}) if overview else "{}"

                await db.execute(
                    text(
                        """
                        INSERT INTO instruments (symbol, company_name, exchange, instrument_key, metadata, updated_at)
                        VALUES (:symbol, :company_name, :exchange, :instrument_key, :metadata, now())
                        ON CONFLICT (symbol) DO UPDATE SET
                            company_name = EXCLUDED.company_name,
                            exchange = EXCLUDED.exchange,
                            instrument_key = EXCLUDED.instrument_key,
                            metadata = CASE
                                WHEN EXCLUDED.metadata = '{}' THEN instruments.metadata
                                ELSE (COALESCE(instruments.metadata, '{}')::jsonb || EXCLUDED.metadata::jsonb)::text
                            END,
                            updated_at = now()
                        """
                    ),
                    {
                        "symbol": symbol,
                        "company_name": company_name,
                        "exchange": exchange,
                        "instrument_key": instrument_key,
                        "metadata": metadata,
                    },
                )
                count += 1

            await db.commit()

        return count

    async def search(self, query: str, limit: int = 20) -> list[dict]:
        trimmed = query.strip()
        if not trimmed:
            return []

        async with self._session() as db:
            result = await db.execute(
                text(
                    """
                    SELECT symbol, company_name, exchange, instrument_key
                    FROM instruments
                    WHERE symbol ILIKE :pattern OR company_name ILIKE :pattern
                    ORDER BY CASE WHEN symbol ILIKE :exact THEN 0 ELSE 1 END, symbol ASC
                    LIMIT :limit
                    """
                ),
                {"pattern": f"%{trimmed}%", "exact": f"{trimmed}%", "limit": limit},
            )
            rows = result.all()

        return [
            {
                "symbol": r[0],
                "company_name": r[1],
                "exchange": r[2],
                "instrument_key": r[3],
            }
            for r in rows
        ]

    async def list_symbols(self) -> list[str]:
        async with self._session() as db:
            result = await db.execute(text("SELECT symbol FROM instruments ORDER BY symbol ASC"))
            return [r[0] for r in result.all()]

    async def get_by_symbols(self, symbols: list[str]) -> list[dict]:
        if not symbols:
            return []

        async with self._session() as db:
            result = await db.execute(
                text(
                    """
                    SELECT symbol, company_name, exchange, instrument_key
                    FROM instruments
                    WHERE symbol = ANY(:symbols)
                    """
                ),
                {"symbols": symbols},
            )
            return [
                {
                    "symbol": r[0],
                    "company_name": r[1],
                    "exchange": r[2],
                    "instrument_key": r[3],
                }
                for r in result.all()
            ]
