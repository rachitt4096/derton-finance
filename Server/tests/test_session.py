from __future__ import annotations

from datetime import datetime, timezone

from app.services.session_service import (
    is_nse_market_data_window_open,
    is_nse_trading_session_open,
    normalize_broker_status_for_session,
)


def test_market_data_window_opens_during_pre_open():
    pre_open = datetime(2026, 4, 23, 3, 35, 0, tzinfo=timezone.utc)
    assert is_nse_market_data_window_open(pre_open) is True
    assert is_nse_trading_session_open(pre_open) is False


def test_market_data_and_trading_closed_after_hours():
    after_close = datetime(2026, 4, 23, 10, 5, 0, tzinfo=timezone.utc)
    assert is_nse_market_data_window_open(after_close) is False
    assert is_nse_trading_session_open(after_close) is False


def test_normalize_broker_status_downgrades_connecting_after_close():
    after_close = datetime(2026, 4, 23, 10, 5, 0, tzinfo=timezone.utc)
    result = normalize_broker_status_for_session(
        {
            "source": "upstox",
            "status": "connecting",
            "last_tick_at": None,
            "retry_in_ms": 5000,
            "error": None,
        },
        after_close,
    )
    assert result["status"] == "idle"
    assert result["retry_in_ms"] is None


def test_normalize_broker_status_keeps_live_during_market():
    market_open = datetime(2026, 4, 23, 4, 30, 0, tzinfo=timezone.utc)
    result = normalize_broker_status_for_session(
        {
            "source": "upstox",
            "status": "live",
            "last_tick_at": 1000,
            "retry_in_ms": None,
            "error": None,
        },
        market_open,
    )
    assert result["status"] == "live"
