from __future__ import annotations

from datetime import datetime
from pydantic import BaseModel, Field


class TransactionCreateRequest(BaseModel):
    symbol: str = Field(..., min_length=1)
    side: str = Field(..., pattern="^(BUY|SELL)$")
    quantity: float = Field(..., gt=0)
    price: float = Field(..., gt=0)
    traded_at: str | None = None


class TransactionUpdateRequest(BaseModel):
    quantity: float = Field(..., gt=0)
    price: float = Field(..., gt=0)
    traded_at: str = Field(..., min_length=1)


class TransactionResponse(BaseModel):
    id: str
    symbol: str
    side: str
    quantity: float
    price: float
    traded_at: str
    metadata: dict = {}


class HoldingsRow(BaseModel):
    symbol: str
    quantity: float
    avg_price: float
    current_price: float
    current_value: float
    pnl: float
    pnl_pct: float
    realized_pnl: float
    allocation_pct: float = 0


class SummaryCard(BaseModel):
    id: str
    label: str
    value: float
    change: float | None = None


class PortfolioSummary(BaseModel):
    cards: list[SummaryCard]
    totals: dict


class HoldingsResponse(BaseModel):
    items: list[dict]


class TransactionsResponse(BaseModel):
    items: list[dict]


class IdResponse(BaseModel):
    id: str
