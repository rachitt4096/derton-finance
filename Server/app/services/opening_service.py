from __future__ import annotations


class OpeningService:
    async def get_opening_rows(
        self,
        quotes: dict[str, dict],
        latest_prices: dict[str, float],
    ) -> list[dict]:
        rows = []
        for quote in quotes.values():
            if not quote.get("symbol"):
                continue
            sym = quote["symbol"]
            open_price = quote.get("open")
            prev_close = quote.get("close")
            gap = (open_price - prev_close) if (open_price is not None and prev_close is not None) else None
            gap_pct = (
                ((gap / prev_close) * 100)
                if (gap is not None and prev_close and prev_close != 0)
                else None
            )
            live_price = latest_prices.get(sym, quote.get("last_price"))

            rows.append({
                "symbol": sym,
                "company": quote.get("company_name") or sym,
                "pre_open": open_price,
                "prev_close": prev_close,
                "gap": gap,
                "gap_pct": gap_pct,
                "open_volume": str(quote.get("volume") or "0"),
                "current_price": live_price,
                "sector": "",
            })

        rows.sort(key=lambda r: r["symbol"])
        return rows
