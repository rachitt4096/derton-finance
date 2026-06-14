from __future__ import annotations

from pydantic import BaseModel, Field


class FlagCreateRequest(BaseModel):
    symbol: str = Field(..., min_length=1)
    company: str = Field(..., min_length=1)
    type: str = Field(..., min_length=1)
    detail: str = Field(..., min_length=1)
    since: str = Field(..., min_length=1)
    severity: str = Field(..., min_length=1)
    status: str = Field(..., min_length=1)


class FlagUpdateRequest(BaseModel):
    detail: str = Field(..., min_length=1)
    severity: str = Field(..., min_length=1)
    status: str = Field(..., min_length=1)


class FlagResponse(BaseModel):
    id: str
    symbol: str
    company: str
    type: str
    detail: str
    since: str
    severity: str
    status: str


class FlagsListResponse(BaseModel):
    items: list[FlagResponse]
