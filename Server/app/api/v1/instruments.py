from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.schemas.instrument import InstrumentSearchResponse
from app.services.instrument_service import InstrumentService

router = APIRouter(prefix="/api/instruments", tags=["instruments"])


@router.get("/search", response_model=InstrumentSearchResponse)
async def search_instruments(
    q: str = Query(default="", max_length=100),
    limit: int = Query(default=20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    service = InstrumentService(db)
    items = await service.search(q, limit)
    return InstrumentSearchResponse(items=[{
        "symbol": i["symbol"],
        "company_name": i["company_name"],
        "exchange": i["exchange"],
        "instrument_key": i["instrument_key"],
    } for i in items])
