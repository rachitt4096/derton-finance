from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class NseEod(Base):
    """Latest NSE end-of-day delivery figures per symbol (from sec_bhavdata_full)."""

    __tablename__ = "nse_eod"

    symbol: Mapped[str] = mapped_column(String, primary_key=True)
    trade_date: Mapped[str] = mapped_column(String, nullable=False)
    deliv_per: Mapped[float | None] = mapped_column(Float, nullable=True)
    deliv_qty: Mapped[float | None] = mapped_column(Float, nullable=True)
    ttl_qty: Mapped[float | None] = mapped_column(Float, nullable=True)
    close: Mapped[float | None] = mapped_column(Float, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
