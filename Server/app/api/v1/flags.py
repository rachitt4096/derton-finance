from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.schemas.flag import (
    FlagCreateRequest,
    FlagUpdateRequest,
    FlagResponse,
    FlagsListResponse,
)
from app.schemas.portfolio import IdResponse
from app.services.flag_service import FlagService

router = APIRouter(prefix="/api/flags", tags=["flags"])


@router.get("", response_model=FlagsListResponse)
async def list_flags(
    db: AsyncSession = Depends(get_db),
):
    service = FlagService(db)
    items = await service.list_flags()
    return FlagsListResponse(items=[FlagResponse(**i) for i in items])


@router.post("", response_model=IdResponse, status_code=201)
async def create_flag(
    body: FlagCreateRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Forbidden")
    service = FlagService(db)
    fid = await service.create_flag(body.model_dump())
    return IdResponse(id=fid)


@router.put("/{flag_id}")
async def update_flag(
    flag_id: str,
    body: FlagUpdateRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Forbidden")
    service = FlagService(db)
    await service.update_flag(flag_id, body.model_dump())
    return {"ok": True}


@router.delete("/{flag_id}")
async def delete_flag(
    flag_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Forbidden")
    service = FlagService(db)
    await service.delete_flag(flag_id)
    return {"ok": True}
