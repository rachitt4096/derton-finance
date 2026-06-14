from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.schemas.health import HealthResponse
from app.clickhouse import get_ch_client
from app.config import settings
from app.core.cache import get_redis
from app.minio_client import get_minio_client

router = APIRouter(tags=["health"])


@router.get("/api/health", response_model=HealthResponse)
async def health(db: AsyncSession = Depends(get_db)):
    db_status = "down"
    db_error = None
    try:
        result = await db.execute(text("SELECT 1 AS ok"))
        db_status = "up" if result.scalar() == 1 else "down"
    except Exception as e:
        db_status = "down"
        db_error = str(e)

    ch_status = "unknown"
    try:
        ch = get_ch_client()
        ch.execute("SELECT 1")
        ch_status = "up"
    except Exception:
        ch_status = "down"

    redis_status = "down"
    try:
        await get_redis().ping()
        redis_status = "up"
    except Exception:
        redis_status = "down"

    if not settings.MINIO_ENABLED:
        minio_status = "disabled"
    else:
        minio_status = "down"
        try:
            get_minio_client().list_buckets()
            minio_status = "up"
        except Exception:
            minio_status = "down"

    # Core dependencies that must be healthy for the API to serve data.
    ok = db_status == "up" and ch_status == "up" and redis_status == "up"

    return HealthResponse(
        ok=ok,
        db=db_status,
        db_error=db_error,
        clickhouse=ch_status,
        minio=minio_status,
        redis=redis_status,
        timestamp=datetime.now(timezone.utc).isoformat(),
    )
