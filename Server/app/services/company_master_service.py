from __future__ import annotations

import csv
import io
import zipfile
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
_PR_ZIP = "https://nsearchives.nseindia.com/archives/equities/bhavcopy/pr/PR{ddmmyy}.zip"
_NIFTY500 = "https://nsearchives.nseindia.com/content/indices/ind_nifty500list.csv"

# Only store companies at/above this market cap (₹ crore), per requirement.
MIN_MARKET_CAP_CR = 10_000.0


def _ist_today() -> datetime:
    return datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)


class CompanyMasterService:
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
            raise RuntimeError("CompanyMasterService requires a db session or session_factory")

    async def get(self, symbol: str) -> dict | None:
        async with self._session() as db:
            result = await db.execute(
                text(
                    "SELECT symbol, security_name, shares_outstanding, market_cap_cr, face_value, sector "
                    "FROM company_master WHERE symbol = :s"
                ),
                {"s": symbol.strip().upper()},
            )
            row = result.one_or_none()
        if not row:
            return None
        return {
            "symbol": row[0], "security_name": row[1], "shares_outstanding": row[2],
            "market_cap_cr": row[3], "face_value": row[4], "sector": row[5],
        }

    async def get_all_symbols(self, limit: int | None = None) -> list[str]:
        """All companies in the master universe (market cap >= MIN_MARKET_CAP_CR),
        ordered by market cap descending so the largest names win if a cap applies."""
        query = (
            "SELECT symbol FROM company_master "
            "WHERE market_cap_cr >= :min_cap ORDER BY market_cap_cr DESC"
        )
        params: dict[str, object] = {"min_cap": MIN_MARKET_CAP_CR}
        if limit is not None:
            query += " LIMIT :limit"
            params["limit"] = limit
        async with self._session() as db:
            result = await db.execute(text(query), params)
            return [row[0] for row in result.all()]

    async def _fetch_sectors(self, client: httpx.AsyncClient) -> dict[str, str]:
        try:
            resp = await client.get(_NIFTY500)
            resp.raise_for_status()
            reader = csv.DictReader(io.StringIO(resp.text))
            return {
                (r.get("Symbol") or "").strip().upper(): (r.get("Industry") or "").strip()
                for r in reader
                if r.get("Symbol")
            }
        except Exception:  # noqa: BLE001
            return {}

    async def _download_mcap(self, client: httpx.AsyncClient) -> tuple[str, str] | None:
        for back in range(0, 7):
            day = _ist_today() - timedelta(days=back)
            if day.weekday() >= 5:
                continue
            url = _PR_ZIP.format(ddmmyy=day.strftime("%d%m%y"))
            try:
                resp = await client.get(url)
                if resp.status_code != 200 or len(resp.content) < 1000:
                    continue
                zf = zipfile.ZipFile(io.BytesIO(resp.content))
                mcap_name = next((n for n in zf.namelist() if n.lower().startswith("mcap")), None)
                if not mcap_name:
                    continue
                return day.strftime("%Y-%m-%d"), zf.read(mcap_name).decode("utf-8", "ignore")
            except Exception:  # noqa: BLE001
                continue
        return None

    async def fetch_and_store(self) -> int:
        headers = {"User-Agent": _UA, "Accept": "*/*", "Referer": "https://www.nseindia.com/"}
        async with httpx.AsyncClient(timeout=45, headers=headers, follow_redirects=True) as client:
            try:
                await client.get("https://www.nseindia.com/")
            except Exception:  # noqa: BLE001
                pass
            sectors = await self._fetch_sectors(client)
            downloaded = await self._download_mcap(client)

        if not downloaded:
            logger.warning("NSE mcap file not available for recent dates")
            return 0
        trade_date, body = downloaded

        rows = []
        reader = csv.reader(io.StringIO(body))
        next(reader, None)  # header
        for cols in reader:
            if len(cols) < 10:
                continue
            series = cols[2].strip()
            if series != "EQ":
                continue

            def _num(v: str) -> float | None:
                try:
                    return float(v.strip())
                except (ValueError, AttributeError):
                    return None

            market_cap = _num(cols[9])
            if market_cap is None:
                continue
            market_cap_cr = market_cap / 1e7
            if market_cap_cr < MIN_MARKET_CAP_CR:
                continue

            symbol = cols[1].strip().upper()
            rows.append({
                "symbol": symbol,
                "security_name": cols[3].strip(),
                "shares_outstanding": _num(cols[7]),
                "market_cap_cr": round(market_cap_cr, 2),
                "face_value": _num(cols[6]),
                "sector": sectors.get(symbol),
                "trade_date": trade_date,
            })

        if not rows:
            return 0

        async with self._session() as db:
            await db.execute(
                text(
                    """
                    INSERT INTO company_master
                        (symbol, security_name, shares_outstanding, market_cap_cr, face_value, sector, trade_date, updated_at)
                    VALUES (:symbol, :security_name, :shares_outstanding, :market_cap_cr, :face_value, :sector, :trade_date, now())
                    ON CONFLICT (symbol) DO UPDATE SET
                        security_name = EXCLUDED.security_name,
                        shares_outstanding = EXCLUDED.shares_outstanding,
                        market_cap_cr = EXCLUDED.market_cap_cr,
                        face_value = EXCLUDED.face_value,
                        sector = COALESCE(EXCLUDED.sector, company_master.sector),
                        trade_date = EXCLUDED.trade_date,
                        updated_at = now()
                    """
                ),
                rows,
            )
            await db.commit()
        logger.info("Company master stored", count=len(rows), date=trade_date, min_cap_cr=MIN_MARKET_CAP_CR)
        return len(rows)
