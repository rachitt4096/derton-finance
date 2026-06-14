from __future__ import annotations

import csv
import io
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING, AsyncGenerator

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import logger

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import async_sessionmaker

_UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0 Safari/537.36"
)
_BHAV_URL = "https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_{ddmmyyyy}.csv"


def _ist_today() -> datetime:
    return datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)


class NseEodService:
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
            raise RuntimeError("NseEodService requires a db session or session_factory")

    async def get(self, symbol: str) -> dict | None:
        async with self._session() as db:
            result = await db.execute(
                text("SELECT symbol, trade_date, deliv_per, deliv_qty, ttl_qty, close FROM nse_eod WHERE symbol = :s"),
                {"s": symbol.strip().upper()},
            )
            row = result.one_or_none()
        if not row:
            return None
        return {
            "symbol": row[0], "trade_date": row[1], "deliv_per": row[2],
            "deliv_qty": row[3], "ttl_qty": row[4], "close": row[5],
        }

    async def _download_latest(self) -> tuple[str, str] | None:
        """Walk back from today to find the most recent available bhavcopy."""
        headers = {
            "User-Agent": _UA,
            "Accept": "*/*",
            "Referer": "https://www.nseindia.com/",
        }
        async with httpx.AsyncClient(timeout=30, headers=headers, follow_redirects=True) as client:
            try:
                await client.get("https://www.nseindia.com/")  # best-effort cookie prime
            except Exception:  # noqa: BLE001
                pass
            for back in range(0, 7):
                day = _ist_today() - timedelta(days=back)
                if day.weekday() >= 5:  # skip Sat/Sun
                    continue
                url = _BHAV_URL.format(ddmmyyyy=day.strftime("%d%m%Y"))
                try:
                    resp = await client.get(url)
                    if resp.status_code == 200 and resp.text.startswith("SYMBOL"):
                        return day.strftime("%Y-%m-%d"), resp.text
                except Exception:  # noqa: BLE001
                    continue
        return None

    async def fetch_and_store(self) -> int:
        downloaded = await self._download_latest()
        if not downloaded:
            logger.warning("NSE bhavcopy not available for recent dates")
            return 0
        trade_date, body = downloaded

        rows = []
        reader = csv.reader(io.StringIO(body))
        header = next(reader, None)  # noqa: F841
        for cols in reader:
            if len(cols) < 15:
                continue
            series = cols[1].strip()
            if series != "EQ":  # only cash-segment equity
                continue
            symbol = cols[0].strip().upper()

            def _num(v: str) -> float | None:
                v = v.strip()
                try:
                    return float(v)
                except ValueError:
                    return None

            rows.append({
                "symbol": symbol,
                "trade_date": trade_date,
                "deliv_per": _num(cols[14]),
                "deliv_qty": _num(cols[13]),
                "ttl_qty": _num(cols[10]),
                "close": _num(cols[8]),
            })

        if not rows:
            return 0

        async with self._session() as db:
            await db.execute(
                text(
                    """
                    INSERT INTO nse_eod (symbol, trade_date, deliv_per, deliv_qty, ttl_qty, close, updated_at)
                    VALUES (:symbol, :trade_date, :deliv_per, :deliv_qty, :ttl_qty, :close, now())
                    ON CONFLICT (symbol) DO UPDATE SET
                        trade_date = EXCLUDED.trade_date,
                        deliv_per = EXCLUDED.deliv_per,
                        deliv_qty = EXCLUDED.deliv_qty,
                        ttl_qty = EXCLUDED.ttl_qty,
                        close = EXCLUDED.close,
                        updated_at = now()
                    """
                ),
                rows,
            )
            await db.commit()
        logger.info("NSE EOD delivery data stored", count=len(rows), date=trade_date)
        return len(rows)
