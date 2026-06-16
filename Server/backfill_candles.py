#!/usr/bin/env python3
"""
backfill_candles.py — Upstox → ClickHouse historical candle backfill.

Usage:
  python backfill_candles.py                        # watchlist symbols, 5m + 1d
  python backfill_candles.py --mode nse             # all ~4000 NSE EQ symbols
  python backfill_candles.py --symbols RELIANCE TCS
  python backfill_candles.py --interval 1d          # daily only
  python backfill_candles.py --interval 5m 15m 1d   # multiple intervals
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
import time
from datetime import date, datetime, timedelta

import asyncpg
import httpx
from clickhouse_driver import Client as CHClient


# ── Config ────────────────────────────────────────────────────────────────────

def _load_env(path: str) -> None:
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                os.environ.setdefault(k.strip(), v.strip())
    except FileNotFoundError:
        pass


_load_env(os.path.join(os.path.dirname(__file__), ".env"))

UPSTOX_TOKEN = os.environ.get("UPSTOX_ACCESS_TOKEN", "")
CH_HOST      = os.environ.get("CLICKHOUSE_HOST", "localhost")
CH_PORT      = int(os.environ.get("CLICKHOUSE_PORT", "9000"))
CH_USER      = os.environ.get("CLICKHOUSE_USER", "default")
CH_PASS      = os.environ.get("CLICKHOUSE_PASSWORD", "")
CH_DB        = os.environ.get("CLICKHOUSE_DATABASE", "derton_finance")
PG_DSN       = (
    os.environ.get("POSTGRES_URL", "")
    .replace("postgresql+asyncpg://", "postgresql://")
)

# Upstox intraday history starts Jan 2022; daily goes back much further.
INTRADAY_START = date(2022, 1, 1)
DAILY_YEARS    = 5

# (unit, value) for Upstox V3 historical-candle endpoint
INTERVAL_MAP: dict[str, tuple[str, str]] = {
    "1m":  ("minutes", "1"),
    "5m":  ("minutes", "5"),
    "15m": ("minutes", "15"),
    "1h":  ("hours",   "1"),
    "1d":  ("days",    "1"),
}

# Conservative rate limiting — Upstox doesn't publish exact limits
_SEMAPHORE   = asyncio.Semaphore(4)
_REQUEST_GAP = 0.25   # seconds between requests per worker


# ── Date helpers ──────────────────────────────────────────────────────────────

def _month_chunks(start: date, end: date) -> list[tuple[date, date]]:
    chunks: list[tuple[date, date]] = []
    cur = start.replace(day=1)
    while cur <= end:
        m, y = cur.month, cur.year
        nxt  = date(y + 1, 1, 1) if m == 12 else date(y, m + 1, 1)
        chunks.append((cur, min(nxt - timedelta(days=1), end)))
        cur = nxt
    return chunks


# ── Upstox fetch ──────────────────────────────────────────────────────────────

async def _fetch(
    client: httpx.AsyncClient,
    inst_key: str,
    unit: str,
    value: str,
    from_d: date,
    to_d: date,
    retries: int = 3,
) -> list[list]:
    url = (
        f"https://api.upstox.com/v3/historical-candle"
        f"/{inst_key}/{unit}/{value}"
        f"/{to_d.isoformat()}/{from_d.isoformat()}"
    )
    headers = {
        "Authorization": f"Bearer {UPSTOX_TOKEN}",
        "Accept": "application/json",
    }
    async with _SEMAPHORE:
        for attempt in range(retries):
            try:
                await asyncio.sleep(_REQUEST_GAP)
                r = await client.get(url, headers=headers, timeout=30)
                if r.status_code == 429:
                    wait = 10 * (attempt + 1)
                    print(f"  rate-limited, waiting {wait}s…")
                    await asyncio.sleep(wait)
                    continue
                if r.status_code == 401:
                    print("\n✗ Upstox token expired. Re-authenticate and rerun.")
                    sys.exit(1)
                if r.status_code != 200:
                    return []
                return r.json().get("data", {}).get("candles", [])
            except Exception as exc:
                if attempt == retries - 1:
                    print(f"  fetch error ({from_d}→{to_d}): {exc}")
                await asyncio.sleep(2)
    return []


# ── ClickHouse helpers ────────────────────────────────────────────────────────

def _ch() -> CHClient:
    return CHClient(
        host=CH_HOST, port=CH_PORT,
        user=CH_USER, password=CH_PASS,
        database=CH_DB,
        settings={"max_execution_time": 60},
    )


def _fix_ttl(ch: CHClient) -> None:
    try:
        ch.execute(
            "ALTER TABLE market_candles MODIFY TTL "
            "toDateTime(bucket_start) + INTERVAL 6 YEAR"
        )
        print("✓ market_candles TTL extended to 6 years\n")
    except Exception as e:
        print(f"  TTL alter note: {e}\n")


def _loaded_months(ch: CHClient, symbol: str, interval: str) -> set[str]:
    rows = ch.execute(
        "SELECT DISTINCT formatDateTime(bucket_start, '%Y-%m') "
        "FROM market_candles WHERE symbol = %(s)s AND interval = %(i)s",
        {"s": symbol, "i": interval},
    )
    return {r[0] for r in rows}


def _insert(ch: CHClient, symbol: str, interval: str, raw: list[list]) -> int:
    rows = []
    for c in raw:
        if not c or len(c) < 5:
            continue
        try:
            ts = datetime.fromisoformat(c[0].replace("Z", "+00:00")).replace(tzinfo=None)
            rows.append({
                "symbol":         symbol,
                "interval":       interval,
                "bucket_start":   ts,
                "first_trade_at": ts,
                "last_trade_at":  ts,
                "open":    float(c[1]),
                "high":    float(c[2]),
                "low":     float(c[3]),
                "close":   float(c[4]),
                "volume":  float(c[5]) if len(c) > 5 else 0.0,
                "source":  "upstox_backfill",
            })
        except Exception:
            continue
    if not rows:
        return 0
    ch.execute(
        "INSERT INTO market_candles "
        "(symbol, interval, bucket_start, first_trade_at, last_trade_at, "
        " open, high, low, close, volume, source) VALUES",
        rows,
    )
    return len(rows)


# ── Symbol loading ─────────────────────────────────────────────────────────────

async def _watchlist_instruments(pg: asyncpg.Connection) -> list[dict]:
    rows = await pg.fetch(
        """
        SELECT DISTINCT i.symbol, i.instrument_key
        FROM watchlist_items wi
        JOIN instruments i ON i.symbol = wi.symbol
        WHERE i.exchange = 'NSE'
        ORDER BY i.symbol
        """
    )
    return [dict(r) for r in rows]


async def _nse_instruments(pg: asyncpg.Connection) -> list[dict]:
    rows = await pg.fetch(
        "SELECT symbol, instrument_key FROM instruments "
        "WHERE exchange = 'NSE' ORDER BY symbol"
    )
    return [dict(r) for r in rows]


async def _symbol_instruments(pg: asyncpg.Connection, symbols: list[str]) -> list[dict]:
    rows = await pg.fetch(
        "SELECT symbol, instrument_key FROM instruments "
        "WHERE symbol = ANY($1) AND exchange = 'NSE' ORDER BY symbol",
        symbols,
    )
    return [dict(r) for r in rows]


# ── Core backfill ─────────────────────────────────────────────────────────────

async def _backfill_symbol(
    http: httpx.AsyncClient,
    ch: CHClient,
    symbol: str,
    inst_key: str,
    intervals: list[str],
    today: date,
) -> None:
    for interval in intervals:
        unit, value = INTERVAL_MAP[interval]
        is_intraday = interval != "1d"
        start = INTRADAY_START if is_intraday else today.replace(year=today.year - DAILY_YEARS)
        chunks = _month_chunks(start, today)

        done = _loaded_months(ch, symbol, interval)
        todo = [(f, t) for f, t in chunks if f.strftime("%Y-%m") not in done]

        if not todo:
            print(f"  {interval}: complete ✓")
            continue

        total = 0
        for i, (from_d, to_d) in enumerate(todo, 1):
            raw  = await _fetch(http, inst_key, unit, value, from_d, to_d)
            n    = _insert(ch, symbol, interval, raw)
            total += n
            print(f"  {interval} [{i}/{len(todo)}] {from_d}→{to_d}: {n:,} candles", end="\r")

        print(f"  {interval}: {total:,} candles ({len(todo)} chunks)          ")


async def run(instruments: list[dict], intervals: list[str]) -> None:
    today = date.today()
    ch = _ch()
    _fix_ttl(ch)

    async with httpx.AsyncClient() as http:
        for idx, inst in enumerate(instruments, 1):
            symbol   = inst["symbol"]
            inst_key = inst["instrument_key"]
            print(f"[{idx}/{len(instruments)}] {symbol}")
            await _backfill_symbol(http, ch, symbol, inst_key, intervals, today)


# ── Entry point ───────────────────────────────────────────────────────────────

async def main() -> None:
    parser = argparse.ArgumentParser(description="Upstox → ClickHouse candle backfill")
    parser.add_argument(
        "--mode", choices=["watchlist", "nse"], default="watchlist",
        help="watchlist = your watchlist only; nse = all ~4000 NSE EQ symbols",
    )
    parser.add_argument(
        "--symbols", nargs="+", metavar="SYM",
        help="Specific symbols (overrides --mode)",
    )
    parser.add_argument(
        "--interval", nargs="+", dest="intervals",
        choices=list(INTERVAL_MAP), default=["5m", "1d"],
        metavar="INTERVAL",
        help="Intervals to pull: 1m 5m 15m 1h 1d (default: 5m 1d)",
    )
    args = parser.parse_args()

    if not UPSTOX_TOKEN:
        print("✗ UPSTOX_ACCESS_TOKEN not set in .env")
        sys.exit(1)

    pg = await asyncpg.connect(PG_DSN)
    try:
        if args.symbols:
            instruments = await _symbol_instruments(pg, args.symbols)
        elif args.mode == "nse":
            instruments = await _nse_instruments(pg)
        else:
            instruments = await _watchlist_instruments(pg)
    finally:
        await pg.close()

    if not instruments:
        print("✗ No instruments found — check --symbols or run the app first to seed instruments")
        sys.exit(1)

    print(f"Symbols : {len(instruments)}")
    print(f"Intervals: {', '.join(args.intervals)}")
    if "5m" in args.intervals or any(i in args.intervals for i in ("1m", "15m", "1h")):
        print(f"Intraday : {INTRADAY_START} → today  (Upstox intraday limit)")
    if "1d" in args.intervals:
        print(f"Daily    : {DAILY_YEARS}-year window → today")
    print()

    t0 = time.time()
    await run(instruments, args.intervals)
    mins = (time.time() - t0) / 60
    print(f"\n✓ Done in {mins:.1f} min")


if __name__ == "__main__":
    asyncio.run(main())
