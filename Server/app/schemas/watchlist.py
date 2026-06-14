from __future__ import annotations

from pydantic import BaseModel, Field


class WatchlistUpdateRequest(BaseModel):
    symbols: list[str] = Field(..., max_length=100)


class WatchlistResponse(BaseModel):
    name: str
    symbols: list[str]
