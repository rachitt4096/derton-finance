from __future__ import annotations

from pydantic import BaseModel, Field


class InstrumentRecord(BaseModel):
    symbol: str
    company_name: str
    exchange: str
    instrument_key: str


class InstrumentSearchResponse(BaseModel):
    items: list[InstrumentRecord]
