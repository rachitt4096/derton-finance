from __future__ import annotations

import json

import httpx

from app.config import settings
from app.database import async_session_factory
from app.services.upstox.credential_store import BrokerCredentialStore
from app.services.upstox.history_service import UpstoxHistoryService
from app.services.upstox.quote_service import UpstoxQuoteService

# Tool schemas in the Bedrock Converse `toolConfig` format.
TOOL_SPECS = [
    {
        "toolSpec": {
            "name": "get_market_candles",
            "description": (
                "Fetch OHLCV candles for an NSE symbol. Use for any question about a "
                "stock's price action, a specific date's session, intraday movement, "
                "highs/lows, volume or VWAP. Returns a session summary plus a "
                "downsampled series."
            ),
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "symbol": {"type": "string", "description": "NSE trading symbol, e.g. RELIANCE"},
                        "date": {
                            "type": "string",
                            "description": "Session date YYYY-MM-DD. Omit for the latest/live session.",
                        },
                        "interval": {
                            "type": "string",
                            "enum": ["1m", "5m", "15m", "1d"],
                            "description": "Candle interval. Use 1m for minute-by-minute.",
                        },
                        "days": {
                            "type": "integer",
                            "description": "Trailing window in days when no date is given (default 1).",
                        },
                    },
                    "required": ["symbol"],
                }
            },
        }
    },
    {
        "toolSpec": {
            "name": "get_quotes",
            "description": "Get the latest/last-close quote (price, change, volume, OHLC) for one or more NSE symbols.",
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "symbols": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "List of NSE symbols, e.g. ['RELIANCE','TCS']",
                        }
                    },
                    "required": ["symbols"],
                }
            },
        }
    },
    {
        "toolSpec": {
            "name": "web_search",
            "description": "Search the web for recent news, events or context. Use for news, sentiment, why a stock moved, macro events.",
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Search query"},
                    },
                    "required": ["query"],
                }
            },
        }
    },
    {
        "toolSpec": {
            "name": "find_notable_moves",
            "description": (
                "Scan a symbol's daily history over a period and return the standout "
                "sessions — biggest up/down days, gap-ups/downs, and volume spikes — each "
                "with its date. Use this to find WHAT moved and WHEN, then correlate those "
                "dates with news (web_search) to reason about causes and recurring patterns."
            ),
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "symbol": {"type": "string", "description": "NSE symbol, e.g. RELIANCE"},
                        "days": {"type": "integer", "description": "Lookback window in days (default 30)"},
                    },
                    "required": ["symbol"],
                }
            },
        }
    },
    {
        "toolSpec": {
            "name": "get_company_fundamentals",
            "description": (
                "Get a company's fundamentals — sector, industry, market cap, P/E, latest "
                "revenue & profit, and multi-year financials. Use for 'study this company', "
                "valuation, or any question about the business rather than just price."
            ),
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "symbol": {"type": "string", "description": "NSE trading symbol, e.g. RELIANCE"},
                    },
                    "required": ["symbol"],
                }
            },
        }
    },
    {
        "toolSpec": {
            "name": "create_alert",
            "description": (
                "Create a price alert for the user. Use when they ask to be alerted/notified "
                "when a stock hits a price or moves a percentage. Scope can target one company, "
                "their whole watchlist, or all NIFTY 50 stocks."
            ),
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "scope": {
                            "type": "string",
                            "enum": ["symbol", "watchlist", "nifty50"],
                            "description": "symbol = one company; watchlist = the user's watchlist; nifty50 = all NIFTY 50 stocks",
                        },
                        "symbol": {"type": "string", "description": "NSE symbol when scope is 'symbol'"},
                        "condition": {
                            "type": "string",
                            "enum": ["price_above", "price_below", "pct_up", "pct_down"],
                            "description": "price_above/below = absolute price; pct_up/pct_down = % move from previous close",
                        },
                        "threshold": {"type": "number", "description": "Price level, or percentage for pct_up/pct_down"},
                        "note": {"type": "string", "description": "Optional label for the alert"},
                    },
                    "required": ["scope", "condition", "threshold"],
                }
            },
        }
    },
    {
        "toolSpec": {
            "name": "list_alerts",
            "description": "List the user's current price alerts and their status.",
            "inputSchema": {"json": {"type": "object", "properties": {}}},
        }
    },
]


def _summarize_candles(candles: list[dict], max_points: int = 60) -> dict:
    if not candles:
        return {"count": 0, "note": "No candles for the requested symbol/date."}

    opens = candles[0]
    closes = candles[-1]
    high_c = max(candles, key=lambda c: c["high"])
    low_c = min(candles, key=lambda c: c["low"])
    total_vol = sum(c.get("volume", 0) for c in candles)
    pv = sum(((c["high"] + c["low"] + c["close"]) / 3) * c.get("volume", 0) for c in candles)
    vwap = round(pv / total_vol, 2) if total_vol else None
    change = round(closes["close"] - opens["open"], 2)
    pct = round((change / opens["open"]) * 100, 2) if opens["open"] else None

    # Downsample so the model gets shape without huge token cost.
    step = max(1, len(candles) // max_points)
    series = [
        {"t": c["time"], "o": c["open"], "h": c["high"], "l": c["low"], "c": c["close"], "v": c.get("volume", 0)}
        for c in candles[::step]
    ]

    return {
        "count": len(candles),
        "first_time": opens["time"],
        "last_time": closes["time"],
        "open": opens["open"],
        "close": closes["close"],
        "high": high_c["high"],
        "high_time": high_c["time"],
        "low": low_c["low"],
        "low_time": low_c["time"],
        "change": change,
        "percent_change": pct,
        "vwap": vwap,
        "total_volume": total_vol,
        "series": series,
    }


async def run_get_market_candles(args: dict) -> dict:
    symbol = str(args.get("symbol", "")).strip().upper()
    if not symbol:
        return {"error": "symbol is required"}
    interval = args.get("interval") or "1m"
    date = args.get("date") or None
    days = int(args.get("days") or 1)

    store = BrokerCredentialStore(session_factory=async_session_factory)
    service = UpstoxHistoryService(store)
    try:
        candles = await service.get_candles_by_symbol(symbol, days, interval, date)
    except Exception as exc:  # noqa: BLE001
        return {"error": f"history lookup failed: {exc}"}
    return {"symbol": symbol, "interval": interval, "date": date, **_summarize_candles(candles)}


async def run_get_quotes(args: dict) -> dict:
    symbols = [str(s).strip().upper() for s in (args.get("symbols") or []) if str(s).strip()]
    if not symbols:
        return {"error": "symbols is required"}
    store = BrokerCredentialStore(session_factory=async_session_factory)
    service = UpstoxQuoteService(store)
    try:
        quotes = await service.get_quotes(symbols)
    except Exception as exc:  # noqa: BLE001
        return {"error": f"quote lookup failed: {exc}"}
    return {
        "quotes": [
            {
                "symbol": q["symbol"],
                "last_price": q.get("last_price"),
                "close": q.get("close"),
                "open": q.get("open"),
                "high": q.get("high"),
                "low": q.get("low"),
                "net_change": q.get("net_change"),
                "percent_change": q.get("percent_change"),
                "volume": q.get("volume"),
            }
            for q in quotes
        ]
    }


async def run_web_search(args: dict) -> dict:
    query = str(args.get("query", "")).strip()
    if not query:
        return {"error": "query is required"}
    if not settings.TAVILY_API_KEY.strip():
        return {"error": "Web search is not configured (TAVILY_API_KEY missing)."}
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(
                "https://api.tavily.com/search",
                json={
                    "api_key": settings.TAVILY_API_KEY.strip(),
                    "query": query,
                    "search_depth": "basic",
                    "max_results": 5,
                    "include_answer": True,
                },
            )
            response.raise_for_status()
            data = response.json()
    except Exception as exc:  # noqa: BLE001
        return {"error": f"web search failed: {exc}"}
    return {
        "answer": data.get("answer"),
        "results": [
            {"title": r.get("title"), "url": r.get("url"), "content": r.get("content")}
            for r in (data.get("results") or [])
        ],
    }


async def run_create_alert(args: dict, user_id: str | None) -> dict:
    if not user_id:
        return {"error": "no user context for creating alerts"}
    from app.services.alert_rule_service import AlertRuleService

    service = AlertRuleService(session_factory=async_session_factory)
    try:
        rule = await service.create_rule(
            user_id,
            scope=args.get("scope", "symbol"),
            condition=args.get("condition", ""),
            threshold=float(args.get("threshold")),
            symbol=args.get("symbol"),
            note=args.get("note"),
        )
    except (ValueError, TypeError) as exc:
        return {"error": str(exc)}
    return {"created": True, "alert": {k: rule[k] for k in ("id", "scope", "symbol", "condition", "threshold", "status")}}


async def run_list_alerts(args: dict, user_id: str | None) -> dict:
    if not user_id:
        return {"error": "no user context"}
    from app.services.alert_rule_service import AlertRuleService

    service = AlertRuleService(session_factory=async_session_factory)
    rules = await service.list_rules(user_id)
    return {
        "alerts": [
            {k: r[k] for k in ("id", "scope", "symbol", "condition", "threshold", "status", "triggered_symbol")}
            for r in rules
        ]
    }


# Tools that need the authenticated user's id.
_USER_TOOLS = {"create_alert": run_create_alert, "list_alerts": run_list_alerts}

async def run_find_notable_moves(args: dict) -> dict:
    symbol = str(args.get("symbol", "")).strip().upper()
    if not symbol:
        return {"error": "symbol is required"}
    days = int(args.get("days") or 30)

    store = BrokerCredentialStore(session_factory=async_session_factory)
    service = UpstoxHistoryService(store)
    try:
        candles = await service.get_candles_by_symbol(symbol, days, "1d")
    except Exception as exc:  # noqa: BLE001
        return {"error": f"history lookup failed: {exc}"}
    if len(candles) < 2:
        return {"error": "not enough history to analyse"}

    candles = sorted(candles, key=lambda c: c["time"])
    vols = [c.get("volume", 0) for c in candles]
    avg_vol = sum(vols) / len(vols) if vols else 0

    events = []
    for prev, cur in zip(candles, candles[1:]):
        prev_close = prev["close"]
        change_pct = round((cur["close"] - prev_close) / prev_close * 100, 2) if prev_close else None
        gap_pct = round((cur["open"] - prev_close) / prev_close * 100, 2) if prev_close else None
        vol_ratio = round((cur.get("volume", 0) / avg_vol), 2) if avg_vol else None
        tags = []
        if change_pct is not None and abs(change_pct) >= 3:
            tags.append("big_gain" if change_pct > 0 else "big_drop")
        if gap_pct is not None and abs(gap_pct) >= 1.5:
            tags.append("gap_up" if gap_pct > 0 else "gap_down")
        if vol_ratio is not None and vol_ratio >= 2:
            tags.append("volume_spike")
        if tags:
            events.append({
                "date": cur["time"][:10],
                "close": cur["close"],
                "change_pct": change_pct,
                "gap_pct": gap_pct,
                "volume_x_avg": vol_ratio,
                "tags": tags,
            })

    closes = [c["close"] for c in candles]
    period_change = round((closes[-1] - closes[0]) / closes[0] * 100, 2) if closes[0] else None
    return {
        "symbol": symbol,
        "sessions_analysed": len(candles),
        "period_change_pct": period_change,
        "period_high": max(c["high"] for c in candles),
        "period_low": min(c["low"] for c in candles),
        "avg_daily_volume": round(avg_vol),
        "notable_events": events,  # dates the model should investigate with web_search
    }


async def run_get_company_fundamentals(args: dict) -> dict:
    symbol = str(args.get("symbol", "")).strip().upper()
    if not symbol:
        return {"error": "symbol is required"}
    from app.services.company_insight_service import CompanyInsightService

    try:
        async with async_session_factory() as db:
            items = await CompanyInsightService(db).get_company_insights(
                [symbol], include_history=False, history_days=30
            )
    except Exception as exc:  # noqa: BLE001
        return {"error": f"fundamentals lookup failed: {exc}"}
    if not items:
        return {"error": f"no fundamentals on file for {symbol}"}
    it = items[0]
    return {
        "symbol": it.get("symbol"),
        "company": it.get("company_name"),
        "sector": it.get("sector"),
        "industry": it.get("industry"),
        "market_cap_cr": it.get("market_cap_cr"),
        "pe_ratio": it.get("pe_ratio"),
        "revenue_cr": it.get("revenue_cr"),
        "profit_cr": it.get("profit_cr"),
        "financials": (it.get("financials") or [])[:3],
    }


TOOL_RUNNERS = {
    "get_market_candles": run_get_market_candles,
    "get_quotes": run_get_quotes,
    "get_company_fundamentals": run_get_company_fundamentals,
    "find_notable_moves": run_find_notable_moves,
    "web_search": run_web_search,
}


async def run_tool(name: str, args: dict, user_id: str | None = None) -> str:
    if name in _USER_TOOLS:
        result = await _USER_TOOLS[name](args or {}, user_id)
        return json.dumps(result, default=str)
    runner = TOOL_RUNNERS.get(name)
    if not runner:
        return json.dumps({"error": f"unknown tool {name}"})
    result = await runner(args or {})
    return json.dumps(result, default=str)
