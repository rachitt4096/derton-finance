from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.schemas.watchlist import WatchlistUpdateRequest, WatchlistResponse
from app.services.watchlist_service import WatchlistService

router = APIRouter(prefix="/api/watchlists", tags=["watchlists"])


@router.get("/default", response_model=WatchlistResponse)
async def get_watchlist(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    service = WatchlistService(db)
    symbols = await service.get_default_watchlist(current_user["id"])
    return WatchlistResponse(name="Default", symbols=symbols)


@router.put("/default", response_model=WatchlistResponse)
async def update_watchlist(
    body: WatchlistUpdateRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    service = WatchlistService(db)
    symbols = await service.set_default_watchlist(current_user["id"], body.symbols)
    return WatchlistResponse(name="Default", symbols=symbols)
