#!/usr/bin/env python3
"""
backfill_breeze.py — ICICI Breeze → ClickHouse historical backfill.

Breeze is the only free source with 1-SECOND historical bars + historical OI.
Use it to complement the Upstox backfill (which has no 1-sec, no historical OI).

Daily session token required (Breeze tokens expire each day):
  1. python backfill_breeze.py --login-url        # prints the login URL
  2. Log in (ICICI id + password + OTP), copy ?apisession=XXXX from the redirect
  3. python backfill_breeze.py --session XXXX --interval 1minute
     (the token is saved to .env so later runs that day don't need --session)

Usage:
  python backfill_breeze.py --session XXXX                       # watchlist, 1minute + 1day
  python backfill_breeze.py --interval 1second --symbols RELIANCE
  python backfill_breeze.py --interval 1minute 1day --years 5
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
import time
import urllib.parse
from datetime import date, datetime, timedelta

import asyncpg
from clickhouse_driver import Client as CHClient


# ── Config ────────────────────────────────────────────────────────────────────

def _load_env(path: str) -> dict[str, str]:
    env: dict[str, str] = {}
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                env[k.strip()] = v.strip()
                os.environ.setdefault(k.strip(), v.strip())
    except FileNotFoundError:
        pass
    return env


ENV_PATH = os.path.join(os.path.dirname(__file__), ".env")
_ENV = _load_env(ENV_PATH)

BREEZE_KEY    = _ENV.get("BREEZE_API_KEY", "")
BREEZE_SECRET = _ENV.get("BREEZE_API_SECRET", "")
BREEZE_TOKEN  = _ENV.get("BREEZE_SESSION_TOKEN", "")

CH_HOST = _ENV.get("CLICKHOUSE_HOST", "localhost")
CH_PORT = int(_ENV.get("CLICKHOUSE_PORT", "9000"))
CH_USER = _ENV.get("CLICKHOUSE_USER", "default")
CH_PASS = _ENV.get("CLICKHOUSE_PASSWORD", "")
CH_DB   = _ENV.get("CLICKHOUSE_DATABASE", "derton_finance")
PG_DSN  = _ENV.get("POSTGRES_URL", "").replace("postgresql+asyncpg://", "postgresql://")

# Breeze 1-second history starts ~2022; daily/minute goes back further.
INTRADAY_START = date(2022, 1, 1)

# Per-call window caps (Breeze limits how much one request can span).
# 1second is tight — pull one trading day at a time.
CHUNK_DAYS = {
    "1second":  1,
    "1minute":  30,
    "5minute":  90,
    "30minute": 180,
    "1day":     365,
}

# Map our interval names → ClickHouse interval label (matches Upstox backfill).
CH_INTERVAL = {
    "1second":  "1s",
    "1minute":  "1m",
    "5minute":  "5m",
    "30minute": "30m",
    "1day":     "1d",
}

_REQUEST_GAP = 0.4  # seconds between Breeze calls (rate-limit safety)


# ── Session token persistence ───────────────────────────────────────────────

def _save_token(token: str) -> None:
    lines = []
    found = False
    with open(ENV_PATH) as f:
        for line in f:
            if line.startswith("BREEZE_SESSION_TOKEN="):
                lines.append(f"BREEZE_SESSION_TOKEN={token}\n")
                found = True
            else:
                lines.append(line)
    if not found:
        lines.append(f"BREEZE_SESSION_TOKEN={token}\n")
    with open(ENV_PATH, "w") as f:
        f.writelines(lines)


# ── ClickHouse ────────────────────────────────────────────────────────────────

def _ch() -> CHClient:
    return CHClient(host=CH_HOST, port=CH_PORT, user=CH_USER,
                    password=CH_PASS, database=CH_DB,
                    settings={"max_execution_time": 60})


def _fix_ttl(ch: CHClient) -> None:
    """market_candles ships with a 365-day TTL — extend it so multi-year
    history isn't auto-deleted on the next merge."""
    try:
        ch.execute(
            "ALTER TABLE market_candles MODIFY TTL "
            "toDateTime(bucket_start) + INTERVAL 6 YEAR"
        )
        print("✓ market_candles TTL extended to 6 years")
    except Exception as e:
        print(f"  TTL alter note: {e}")


def _ensure_oi_column(ch: CHClient) -> None:
    cols = {r[0] for r in ch.execute(
        "SELECT name FROM system.columns "
        "WHERE table='market_candles' AND database=currentDatabase()"
    )}
    if "oi" not in cols:
        ch.execute("ALTER TABLE market_candles ADD COLUMN IF NOT EXISTS oi Float64 DEFAULT 0")
        print("✓ added oi column to market_candles")


def _loaded_days(ch: CHClient, symbol: str, interval: str) -> set[str]:
    rows = ch.execute(
        "SELECT DISTINCT toDate(bucket_start) FROM market_candles "
        "WHERE symbol=%(s)s AND interval=%(i)s",
        {"s": symbol, "i": interval},
    )
    return {r[0].isoformat() for r in rows}


def _insert(ch: CHClient, symbol: str, interval: str, candles: list[dict]) -> int:
    rows = []
    for c in candles:
        try:
            ts = datetime.fromisoformat(c["datetime"].replace("Z", "")).replace(tzinfo=None)
            rows.append({
                "symbol": symbol, "interval": interval,
                "bucket_start": ts, "first_trade_at": ts, "last_trade_at": ts,
                "open": float(c["open"]), "high": float(c["high"]),
                "low": float(c["low"]), "close": float(c["close"]),
                "volume": float(c.get("volume") or 0),
                "oi": float(c.get("open_interest") or 0),
                "source": "breeze_backfill",
            })
        except Exception:
            continue
    if not rows:
        return 0
    ch.execute(
        "INSERT INTO market_candles "
        "(symbol, interval, bucket_start, first_trade_at, last_trade_at, "
        " open, high, low, close, volume, oi, source) VALUES",
        rows,
    )
    return len(rows)


# ── Symbol → ICICI code resolution ────────────────────────────────────────────

def _resolve_icici_code(breeze, nse_symbol: str) -> str | None:
    """Breeze uses ICICI's own short codes (RELIANCE→RELIND). Resolve via API."""
    try:
        info = breeze.get_names(exchange_code="NSE", stock_code=nse_symbol)
        if isinstance(info, dict):
            code = info.get("isec_stock_code") or info.get("stock_code")
            if code:
                return code
    except Exception:
        pass
    # Many symbols work as-is; fall back to the NSE symbol.
    return nse_symbol


# ── Postgres symbol lists ──────────────────────────────────────────────────────

async def _watchlist(pg) -> list[str]:
    rows = await pg.fetch(
        "SELECT DISTINCT wi.symbol FROM watchlist_items wi "
        "JOIN instruments i ON i.symbol = wi.symbol "
        "WHERE i.exchange='NSE' ORDER BY wi.symbol"
    )
    return [r["symbol"] for r in rows]


# ── Core ──────────────────────────────────────────────────────────────────────

def _date_chunks(start: date, end: date, step: int) -> list[tuple[date, date]]:
    out, cur = [], start
    while cur <= end:
        nxt = min(cur + timedelta(days=step - 1), end)
        out.append((cur, nxt))
        cur = nxt + timedelta(days=1)
    return out


def _backfill(breeze, ch, symbol: str, intervals: list[str], years: int) -> None:
    icici = _resolve_icici_code(breeze, symbol)
    today = date.today()

    for interval in intervals:
        ch_label = CH_INTERVAL[interval]
        is_intraday = interval != "1day"
        start = INTRADAY_START if is_intraday else today.replace(year=today.year - years)
        chunks = _date_chunks(start, today, CHUNK_DAYS[interval])

        done = _loaded_days(ch, symbol, ch_label)
        total = 0
        for i, (f, t) in enumerate(chunks, 1):
            # Skip fully-loaded chunks (resume-safe).
            if all((f + timedelta(days=d)).isoformat() in done
                   for d in range((t - f).days + 1)):
                continue
            try:
                time.sleep(_REQUEST_GAP)
                resp = breeze.get_historical_data_v2(
                    interval=interval,
                    from_date=f.strftime("%Y-%m-%dT00:00:00.000Z"),
                    to_date=t.strftime("%Y-%m-%dT23:59:59.000Z"),
                    stock_code=icici,
                    exchange_code="NSE",
                    product_type="cash",
                )
                candles = resp.get("Success") or []
                total += _insert(ch, symbol, ch_label, candles)
                print(f"  {interval} [{i}/{len(chunks)}] {f}→{t}: {total:,} total", end="\r")
            except Exception as exc:
                print(f"\n  {interval} {f}→{t} error: {exc}")
        print(f"  {interval}: {total:,} candles ({icici})              ")


# ── Entry ───────────────────────────────────────────────────────────────────────

async def main() -> None:
    p = argparse.ArgumentParser(description="ICICI Breeze → ClickHouse backfill")
    p.add_argument("--login-url", action="store_true", help="Print the daily login URL and exit")
    p.add_argument("--session", help="apisession token from the login redirect")
    p.add_argument("--symbols", nargs="+", help="NSE symbols (default: watchlist)")
    p.add_argument("--symbols-file", help="File with one NSE symbol per line")
    p.add_argument("--interval", nargs="+", dest="intervals",
                   choices=list(CHUNK_DAYS), default=["1minute", "1day"])
    p.add_argument("--years", type=int, default=5, help="Daily history window (default 5)")
    args = p.parse_args()

    if args.login_url:
        print("https://api.icicidirect.com/apiuser/login?api_key="
              + urllib.parse.quote_plus(BREEZE_KEY))
        return

    if not BREEZE_KEY or not BREEZE_SECRET:
        print("✗ BREEZE_API_KEY / BREEZE_API_SECRET missing in .env")
        sys.exit(1)

    token = args.session or BREEZE_TOKEN
    if not token:
        print("✗ No session token. Run with --login-url, log in, then pass --session XXXX")
        sys.exit(1)

    from breeze_connect import BreezeConnect
    breeze = BreezeConnect(api_key=BREEZE_KEY)
    try:
        breeze.generate_session(api_secret=BREEZE_SECRET, session_token=token)
    except Exception as exc:
        print(f"✗ Session failed (token likely expired — re-login): {exc}")
        sys.exit(1)
    if args.session:
        _save_token(args.session)
        print("✓ session token saved to .env (valid until end of day)\n")

    if args.symbols_file:
        with open(args.symbols_file) as f:
            symbols = [ln.strip() for ln in f if ln.strip() and not ln.startswith("#")]
    elif args.symbols:
        symbols = args.symbols
    else:
        pg = await asyncpg.connect(PG_DSN)
        try:
            symbols = await _watchlist(pg)
        finally:
            await pg.close()

    if not symbols:
        print("✗ No symbols")
        sys.exit(1)

    ch = _ch()
    _fix_ttl(ch)
    _ensure_oi_column(ch)
    print(f"Symbols  : {len(symbols)} — {', '.join(symbols)}")
    print(f"Intervals: {', '.join(args.intervals)}\n")

    t0 = time.time()
    for idx, sym in enumerate(symbols, 1):
        print(f"[{idx}/{len(symbols)}] {sym}")
        _backfill(breeze, ch, sym, args.intervals, args.years)
    print(f"\n✓ Done in {(time.time()-t0)/60:.1f} min")


if __name__ == "__main__":
    asyncio.run(main())
