from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class AlertRule(Base):
    __tablename__ = "alert_rules"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    # scope: 'symbol' (one stock), 'watchlist' (all of the user's watchlist), 'nifty50'
    scope: Mapped[str] = mapped_column(String, nullable=False, default="symbol")
    symbol: Mapped[str | None] = mapped_column(String, nullable=True)
    # condition: 'price_above' | 'price_below' | 'pct_up' | 'pct_down'
    condition: Mapped[str] = mapped_column(String, nullable=False)
    threshold: Mapped[float] = mapped_column(Float, nullable=False)
    note: Mapped[str | None] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(String, nullable=False, default="active")
    triggered_symbol: Mapped[str | None] = mapped_column(String, nullable=True)
    triggered_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    last_triggered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
