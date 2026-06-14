from __future__ import annotations

import pytest
from app.services.portfolio_service import PortfolioService


def test_build_holdings_map():
    service = PortfolioService.__new__(PortfolioService)
    transactions = [
        {"symbol": "RELIANCE", "side": "BUY", "quantity": 10, "price": 2500, "traded_at": "2026-01-01T00:00:00Z"},
        {"symbol": "RELIANCE", "side": "BUY", "quantity": 5, "price": 2600, "traded_at": "2026-01-02T00:00:00Z"},
    ]
    latest_prices = {"RELIANCE": 2700.0}
    holdings = service._build_holdings_map(transactions, latest_prices)
    h = holdings["RELIANCE"]
    assert h["quantity"] == 15
    assert h["avg_price"] == pytest.approx(2533.33, 0.01)
    assert h["unrealized_pnl"] == pytest.approx(15 * (2700 - 2533.33), 0.01)


def test_build_holdings_map_with_sell():
    service = PortfolioService.__new__(PortfolioService)
    transactions = [
        {"symbol": "TCS", "side": "BUY", "quantity": 10, "price": 3000, "traded_at": "2026-01-01T00:00:00Z"},
        {"symbol": "TCS", "side": "SELL", "quantity": 4, "price": 3200, "traded_at": "2026-01-02T00:00:00Z"},
    ]
    latest_prices = {"TCS": 3100.0}
    holdings = service._build_holdings_map(transactions, latest_prices)
    h = holdings["TCS"]
    assert h["quantity"] == 6
    assert h["avg_price"] == 3000
    assert h["realized_pnl"] == 4 * (3200 - 3000)
    assert h["unrealized_pnl"] == 6 * (3100 - 3000)
