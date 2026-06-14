from __future__ import annotations

from datetime import datetime, timezone

_NSE_TRADING_DAYS = frozenset({"Mon", "Tue", "Wed", "Thu", "Fri"})
_PRE_OPEN_START = 9 * 60
_SESSION_OPEN = 9 * 60 + 15
_SESSION_CLOSE = 15 * 60 + 30


def _get_ist_minutes(dt: datetime | None = None) -> tuple[str, int]:
    dt = dt or datetime.now(timezone.utc)
    from zoneinfo import ZoneInfo

    ist = dt.astimezone(ZoneInfo("Asia/Kolkata"))
    weekday = ist.strftime("%a")
    total_minutes = ist.hour * 60 + ist.minute
    return weekday, total_minutes


def is_nse_market_data_window_open(dt: datetime | None = None) -> bool:
    weekday, minutes = _get_ist_minutes(dt)
    if weekday not in _NSE_TRADING_DAYS:
        return False
    return _PRE_OPEN_START <= minutes < _SESSION_CLOSE


def is_nse_trading_session_open(dt: datetime | None = None) -> bool:
    weekday, minutes = _get_ist_minutes(dt)
    if weekday not in _NSE_TRADING_DAYS:
        return False
    return _SESSION_OPEN <= minutes < _SESSION_CLOSE


def normalize_broker_status_for_session(
    status: dict, dt: datetime | None = None
) -> dict:
    if status.get("status") != "connecting" or is_nse_market_data_window_open(dt):
        return status
    return {
        **status,
        "status": "idle",
        "retry_in_ms": None,
    }
