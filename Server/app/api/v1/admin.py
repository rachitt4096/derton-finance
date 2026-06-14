from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_admin, get_db
from app.schemas.admin import (
    AdminCreateUserRequest,
    AdminUpdateUserRequest,
    AdminResetPasswordRequest,
    AdminOverview,
    AdminUsersResponse,
    AdminUserRow,
)
from app.schemas.portfolio import IdResponse
from app.services.admin_service import AdminService

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/overview")
async def admin_overview(
    current_user: dict = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    service = AdminService(db)
    overview = await service.get_overview()
    return {**overview, "market_retention_days": 90}


@router.get("/users", response_model=AdminUsersResponse)
async def admin_list_users(
    current_user: dict = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    service = AdminService(db)
    items = await service.list_users()
    return AdminUsersResponse(items=[AdminUserRow(**i) for i in items])


@router.post("/users", response_model=IdResponse, status_code=201)
async def admin_create_user(
    body: AdminCreateUserRequest,
    current_user: dict = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    service = AdminService(db)
    uid = await service.create_user(current_user["id"], body.model_dump())
    return IdResponse(id=uid)


@router.patch("/users/{user_id}")
async def admin_update_user(
    user_id: str,
    body: AdminUpdateUserRequest,
    current_user: dict = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    service = AdminService(db)
    update_data = {k: v for k, v in body.model_dump().items() if v is not None}
    await service.update_user(current_user["id"], user_id, update_data)
    return {"ok": True}


@router.post("/users/{user_id}/reset-password")
async def admin_reset_password(
    user_id: str,
    body: AdminResetPasswordRequest,
    current_user: dict = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    service = AdminService(db)
    await service.reset_password(current_user["id"], user_id, body.password)
    return {"ok": True}


@router.post("/users/{user_id}/revoke-sessions")
async def admin_revoke_sessions(
    user_id: str,
    current_user: dict = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    service = AdminService(db)
    await service.revoke_sessions(current_user["id"], user_id)
    return {"ok": True}
