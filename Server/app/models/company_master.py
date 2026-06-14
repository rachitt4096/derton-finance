from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class CompanyMaster(Base):
    """Per-company master data sourced from NSE's daily market-cap file
    (mcap CSV in the PR zip). Stores shares outstanding so market cap can be
    computed live = shares x current price."""

    __tablename__ = "company_master"

    symbol: Mapped[str] = mapped_column(String, primary_key=True)
    security_name: Mapped[str | None] = mapped_column(String, nullable=True)
    shares_outstanding: Mapped[float | None] = mapped_column(Float, nullable=True)
    market_cap_cr: Mapped[float | None] = mapped_column(Float, nullable=True)  # NSE close-based snapshot
    face_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    sector: Mapped[str | None] = mapped_column(String, nullable=True)
    trade_date: Mapped[str | None] = mapped_column(String, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
