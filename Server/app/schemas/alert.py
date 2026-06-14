from __future__ import annotations

from pydantic import BaseModel, Field


class AlertRuleCreate(BaseModel):
    scope: str = Field(default="symbol", description="symbol | watchlist | nifty50")
    symbol: str | None = None
    condition: str = Field(..., description="price_above | price_below | pct_up | pct_down")
    threshold: float
    note: str | None = None


class AlertRuleOut(BaseModel):
    id: str
    scope: str
    symbol: str | None = None
    condition: str
    threshold: float
    note: str | None = None
    status: str
    triggered_symbol: str | None = None
    triggered_price: float | None = None
    last_triggered_at: str | None = None
    created_at: str | None = None


class AlertRuleListResponse(BaseModel):
    items: list[AlertRuleOut]


class AlertStatusUpdate(BaseModel):
    status: str
