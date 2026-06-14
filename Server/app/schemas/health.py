from __future__ import annotations

from pydantic import BaseModel


class HealthResponse(BaseModel):
    ok: bool
    db: str
    db_error: str | None = None
    clickhouse: str = "unknown"
    minio: str = "unknown"
    redis: str = "unknown"
    broker: dict | None = None
    timestamp: str
