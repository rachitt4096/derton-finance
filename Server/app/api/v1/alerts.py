from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.schemas.alert import (
    AlertRuleCreate,
    AlertRuleListResponse,
    AlertRuleOut,
    AlertStatusUpdate,
)
from app.services.alert_rule_service import AlertRuleService

router = APIRouter(prefix="/api/alerts", tags=["alerts"])


def _out(rule: dict) -> AlertRuleOut:
    return AlertRuleOut(
        id=rule["id"],
        scope=rule["scope"],
        symbol=rule["symbol"],
        condition=rule["condition"],
        threshold=rule["threshold"],
        note=rule["note"],
        status=rule["status"],
        triggered_symbol=rule["triggered_symbol"],
        triggered_price=rule["triggered_price"],
        last_triggered_at=rule["last_triggered_at"],
        created_at=rule["created_at"],
    )


@router.get("", response_model=AlertRuleListResponse)
async def list_alerts(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    service = AlertRuleService(db)
    rules = await service.list_rules(current_user["id"])
    return AlertRuleListResponse(items=[_out(r) for r in rules])


@router.post("", response_model=AlertRuleOut)
async def create_alert(
    body: AlertRuleCreate,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    service = AlertRuleService(db)
    try:
        rule = await service.create_rule(
            current_user["id"],
            scope=body.scope,
            condition=body.condition,
            threshold=body.threshold,
            symbol=body.symbol,
            note=body.note,
        )
        return _out(rule)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.patch("/{rule_id}", response_model=AlertRuleOut)
async def update_alert_status(
    rule_id: str,
    body: AlertStatusUpdate,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    service = AlertRuleService(db)
    try:
        ok = await service.set_status(current_user["id"], rule_id, body.status)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if not ok:
        raise HTTPException(status_code=404, detail="Alert not found")
    rules = await service.list_rules(current_user["id"])
    match = next((r for r in rules if r["id"] == rule_id), None)
    return _out(match)


@router.delete("/{rule_id}")
async def delete_alert(
    rule_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    service = AlertRuleService(db)
    ok = await service.delete_rule(current_user["id"], rule_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Alert not found")
    return {"ok": True}
