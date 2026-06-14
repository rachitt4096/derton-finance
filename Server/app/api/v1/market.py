from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.schemas.market import (
    CandlePoint,
    CompanyInsightsResponse,
    MarketHistoryResponse,
    MarketQuotesResponse,
    OpeningWindowResponse,
    OptionChainResponse,
    OptionExpiriesResponse,
)
from app.services.commodities_service import CommoditiesService
from app.services.company_insight_service import CompanyInsightService
from app.services.instrument_service import InstrumentService
from app.services.opening_service import OpeningService
from app.services.upstox.credential_store import BrokerCredentialStore
from app.services.upstox.history_service import UpstoxHistoryService
from app.services.upstox.option_service import UpstoxOptionService
from app.services.upstox.quote_service import UpstoxQuoteService

router = APIRouter(prefix="/api/market", tags=["market"])


@router.get("/quotes", response_model=MarketQuotesResponse)
async def get_quotes(
    symbols: str = Query(default=""),
    db: AsyncSession = Depends(get_db),
):
    symbol_list = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    if not symbol_list:
        return MarketQuotesResponse(items=[])

    credential_store = BrokerCredentialStore(db)
    quote_service = UpstoxQuoteService(credential_store)
    try:
        items = await quote_service.get_quotes(symbol_list)
        return MarketQuotesResponse(items=items)
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc))


@router.get("/history", response_model=MarketHistoryResponse)
async def get_history(
    symbol: str = Query(..., min_length=1),
    days: int = Query(default=30, ge=1, le=3650),
    interval: str = Query(default="1m", pattern="^(1m|5m|15m|1h|1d)$"),
    date: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    db: AsyncSession = Depends(get_db),
):
    sym = symbol.upper()

    # Primary source: locally recorded tick-by-tick data in ClickHouse (fast, no
    # broker round-trip). Fall back to Upstox for symbols/periods we haven't recorded
    # yet (e.g. un-watched names or deep history not yet accumulated).
    candles: list[dict] = []
    import app.main as app_main

    if app_main.market_runtime is not None:
        try:
            candles = await app_main.market_runtime.get_candles(
                sym, days, interval, date=date
            )
        except Exception:  # noqa: BLE001 — never let a CH hiccup break the chart
            candles = []

    if not candles:
        credential_store = BrokerCredentialStore(db)
        history_service = UpstoxHistoryService(credential_store)
        candles = await history_service.get_candles_by_symbol(sym, days, interval, date)

    return MarketHistoryResponse(
        symbol=sym,
        interval=interval,
        days=days,
        date=date,
        candles=[CandlePoint(**c) for c in candles],
    )


@router.get("/company-insights", response_model=CompanyInsightsResponse)
async def company_insights(
    symbols: str = Query(...),
    include_history: str = Query(default="0", pattern="^(0|1|false|true)$"),
    history_days: int = Query(default=30, ge=1, le=3650),
    db: AsyncSession = Depends(get_db),
):
    symbol_list = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    service = CompanyInsightService(db)
    items = await service.get_company_insights(
        symbol_list,
        include_history=include_history in ("1", "true"),
        history_days=history_days,
    )
    return CompanyInsightsResponse(items=items)


@router.get("/option-expiries", response_model=OptionExpiriesResponse)
async def option_expiries(
    underlying: str = Query(..., min_length=1),
    db: AsyncSession = Depends(get_db),
):
    service = UpstoxOptionService(BrokerCredentialStore(db))
    try:
        data = await service.get_expiries(underlying)
        return OptionExpiriesResponse(**data)
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc))


@router.get("/option-chain", response_model=OptionChainResponse)
async def option_chain(
    underlying: str = Query(..., min_length=1),
    expiry: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$"),
    db: AsyncSession = Depends(get_db),
):
    service = UpstoxOptionService(BrokerCredentialStore(db))
    try:
        data = await service.get_chain(underlying, expiry)
        return OptionChainResponse(**data)
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc))


@router.get("/commodities")
async def commodities(db: AsyncSession = Depends(get_db)):
    service = CommoditiesService(BrokerCredentialStore(db))
    try:
        return {"items": await service.list_with_quotes()}
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc))


@router.get("/commodities/{name}/history")
async def commodities_history(
    name: str,
    days: int = Query(default=30, ge=1, le=3650),
    interval: str = Query(default="1d", pattern="^(1m|5m|15m|1h|1d)$"),
    date: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    db: AsyncSession = Depends(get_db),
):
    service = CommoditiesService(BrokerCredentialStore(db))
    try:
        return await service.get_history(name, days, interval, date)
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc))


@router.get("/opening-window", response_model=OpeningWindowResponse)
async def opening_window():
    import app.main as _main

    runtime = _main.market_runtime
    quotes: dict = {}
    prices: dict = {}

    if runtime:
        quotes = runtime.get_latest_quotes()
        prices = runtime.get_latest_prices()

    service = OpeningService()
    items = await service.get_opening_rows(quotes, prices)
    return OpeningWindowResponse(items=items)


compat_router = APIRouter(tags=["market"])


@compat_router.get("/api/opening-window", response_model=OpeningWindowResponse)
async def opening_window_compat():
    return await opening_window()
