from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.schemas.portfolio import (
    TransactionCreateRequest,
    TransactionUpdateRequest,
    IdResponse,
)
import app.main as _main
from app.services.portfolio_service import PortfolioService

router = APIRouter(prefix="/api/portfolio", tags=["portfolio"])


@router.get("/summary")
async def portfolio_summary(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    prices = _main.market_runtime.get_latest_prices() if _main.market_runtime else {}
    service = PortfolioService(db)
    return await service.get_summary(current_user["id"], prices)


@router.get("/holdings")
async def portfolio_holdings(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    prices = _main.market_runtime.get_latest_prices() if _main.market_runtime else {}
    service = PortfolioService(db)
    items = await service.get_holdings(current_user["id"], prices)
    return {"items": items}


@router.get("/transactions")
async def list_transactions(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    service = PortfolioService(db)
    items = await service.list_transactions(current_user["id"])
    return {"items": items}


@router.post("/transactions", response_model=IdResponse, status_code=201)
async def create_transaction(
    body: TransactionCreateRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    service = PortfolioService(db)
    tid = await service.create_transaction(current_user["id"], {
        "symbol": body.symbol.upper(),
        "side": body.side,
        "quantity": body.quantity,
        "price": body.price,
        "traded_at": body.traded_at,
    })
    return IdResponse(id=tid)


@router.put("/transactions/{transaction_id}")
async def update_transaction(
    transaction_id: str,
    body: TransactionUpdateRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    service = PortfolioService(db)
    await service.update_transaction(current_user["id"], transaction_id, {
        "quantity": body.quantity,
        "price": body.price,
        "traded_at": body.traded_at,
    })
    return {"ok": True}


@router.delete("/transactions/{transaction_id}")
async def delete_transaction(
    transaction_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    service = PortfolioService(db)
    await service.delete_transaction(current_user["id"], transaction_id)
    return {"ok": True}
