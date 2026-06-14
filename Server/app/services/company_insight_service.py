from __future__ import annotations

import json
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


class CompanyInsightService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get_company_insights(
        self,
        symbols: list[str],
        include_history: bool = False,
        history_days: int = 30,
    ) -> list[dict]:
        normalized = list(dict.fromkeys(s.strip().upper() for s in symbols if s.strip()))
        if not normalized:
            return []

        result = await self.db.execute(
            text(
                """
                SELECT symbol, company_name, exchange, instrument_key, metadata
                FROM instruments
                WHERE symbol = ANY(:symbols)
                """
            ),
            {"symbols": normalized},
        )
        rows = result.all()
        by_symbol = {r[0]: r for r in rows}

        # Latest NSE EOD delivery % per symbol (from the daily bhavcopy).
        deliv_result = await self.db.execute(
            text("SELECT symbol, deliv_per FROM nse_eod WHERE symbol = ANY(:symbols)"),
            {"symbols": normalized},
        )
        deliv_by_symbol = {r[0]: r[1] for r in deliv_result.all()}

        # Company master (shares outstanding + sector + snapshot mkt cap) for the
        # whole >=10,000cr universe, sourced from NSE's daily mcap file.
        master_result = await self.db.execute(
            text(
                "SELECT symbol, shares_outstanding, market_cap_cr, sector "
                "FROM company_master WHERE symbol = ANY(:symbols)"
            ),
            {"symbols": normalized},
        )
        master_by_symbol = {r[0]: {"shares": r[1], "mcap": r[2], "sector": r[3]} for r in master_result.all()}

        # Live last prices to compute market cap / free float / P/E from shares.
        prices: dict[str, float] = {}
        try:
            from app.services.upstox.credential_store import BrokerCredentialStore
            from app.services.upstox.quote_service import UpstoxQuoteService

            prices = await UpstoxQuoteService(BrokerCredentialStore(self.db)).get_last_prices(normalized)
        except Exception:  # noqa: BLE001 — prices are best-effort
            prices = {}

        items = []
        for sym in normalized:
            row = by_symbol.get(sym)
            if not row:
                continue

            metadata_raw = row[4] or "{}"
            try:
                metadata = json.loads(metadata_raw) if isinstance(metadata_raw, str) else metadata_raw
            except (json.JSONDecodeError, TypeError):
                metadata = {}

            overview = metadata.get("companyOverview") or metadata
            financials = overview.get("financials", []) or []
            latest = financials[0] if financials else {}

            price = prices.get(sym)
            master = master_by_symbol.get(sym, {})
            ff = overview.get("ff", overview.get("freeFloatFactor"))
            eps = overview.get("eps")

            # Live market cap: prefer NSE shares-outstanding x live price (whole
            # universe), then the curated shares_cr, then snapshot fallbacks.
            shares_abs = master.get("shares")           # absolute share count (NSE mcap file)
            shares_cr = overview.get("shares_cr")        # crore shares (curated NIFTY 50)
            if shares_abs and price:
                market_cap = round(shares_abs * price / 1e7)
            elif shares_cr and price:
                market_cap = round(shares_cr * price)
            else:
                market_cap = master.get("mcap") or overview.get("marketCapCr")

            free_float_mcap = round(market_cap * ff) if (market_cap and ff is not None) else None
            pe_ratio = round(price / eps, 2) if (price and eps) else overview.get("peRatio")
            sector = overview.get("sector") or master.get("sector")

            items.append({
                "symbol": row[0],
                "company_name": row[1],
                "exchange": row[2],
                "instrument_key": row[3],
                "sector": sector,
                "industry": overview.get("industry"),
                "description": overview.get("description"),
                "market_cap_cr": market_cap,
                "pe_ratio": pe_ratio,
                "dividend_yield": overview.get("dividendYield"),
                "face_value": overview.get("faceValue"),
                "book_value": overview.get("bookValue"),
                "revenue_cr": latest.get("revenueCr"),
                "profit_cr": latest.get("profitCr"),
                "free_float_market_cap_cr": free_float_mcap,
                "deliverable_pct": deliv_by_symbol.get(sym),
                "financials": financials,
                "traded_value_history": [],
            })

        return items
