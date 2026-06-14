from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class CandlePoint(BaseModel):
    time: str
    open: float
    high: float
    low: float
    close: float
    volume: float


class MarketHistoryResponse(BaseModel):
    symbol: str
    interval: str
    days: int
    date: str | None = None
    candles: list[CandlePoint]


class LiveMarketQuote(BaseModel):
    symbol: str
    company_name: str | None = None
    exchange: str | None = None
    instrument_key: str | None = None
    last_price: float | None = None
    session_close: float | None = None
    open: float | None = None
    high: float | None = None
    low: float | None = None
    close: float | None = None
    volume: float | None = None
    average_price: float | None = None
    net_change: float | None = None
    percent_change: float | None = None
    lower_circuit_limit: float | None = None
    upper_circuit_limit: float | None = None
    total_buy_quantity: float | None = None
    total_sell_quantity: float | None = None
    last_trade_time: str | None = None
    timestamp: str | None = None
    year_high: float | None = None
    year_low: float | None = None
    year_high_date: str | None = None
    year_low_date: str | None = None
    daily_volatility: float | None = None
    annualised_volatility: float | None = None
    depth: dict | None = None


class MarketQuotesResponse(BaseModel):
    items: list[LiveMarketQuote]


# These two are consumed by the frontend in camelCase. Accept either casing on
# input (populate_by_name) and serialize as camelCase (FastAPI uses by_alias).
_camel = ConfigDict(populate_by_name=True, alias_generator=to_camel)


class CompanyFinancialYear(BaseModel):
    model_config = _camel
    label: str
    revenue_cr: float
    profit_cr: float
    eps: float
    operating_margin_pct: float


class CompanyInsight(BaseModel):
    model_config = _camel
    symbol: str
    company_name: str
    exchange: str
    instrument_key: str
    sector: str | None = None
    industry: str | None = None
    description: str | None = None
    market_cap_cr: float | None = None
    pe_ratio: float | None = None
    dividend_yield: float | None = None
    face_value: float | None = None
    book_value: float | None = None
    revenue_cr: float | None = None
    profit_cr: float | None = None
    free_float_market_cap_cr: float | None = None
    deliverable_pct: float | None = None
    financials: list[CompanyFinancialYear] = []
    traded_value_history: list[dict] = []


class CompanyInsightsResponse(BaseModel):
    items: list[CompanyInsight]


class OpeningRow(BaseModel):
    symbol: str
    company: str
    pre_open: float | None = None
    prev_close: float | None = None
    gap: float | None = None
    gap_pct: float | None = None
    open_volume: str = "0"
    current_price: float | None = None
    sector: str = ""


class OpeningWindowResponse(BaseModel):
    items: list[OpeningRow]


class OptionExpiriesResponse(BaseModel):
    underlying: str
    instrument_key: str
    expiries: list[str]


class OptionLeg(BaseModel):
    instrument_key: str | None = None
    ltp: float | None = None
    close_price: float | None = None
    volume: float | None = None
    oi: float | None = None
    prev_oi: float | None = None
    oi_change: float | None = None
    bid_price: float | None = None
    ask_price: float | None = None
    iv: float | None = None
    delta: float | None = None
    gamma: float | None = None
    theta: float | None = None
    vega: float | None = None


class OptionStrike(BaseModel):
    strike_price: float | None = None
    pcr: float | None = None
    call: OptionLeg
    put: OptionLeg


class OptionChainResponse(BaseModel):
    underlying: str
    instrument_key: str
    expiry: str
    spot_price: float | None = None
    pcr: float | None = None
    total_call_oi: float | None = None
    total_put_oi: float | None = None
    strikes: list[OptionStrike]
