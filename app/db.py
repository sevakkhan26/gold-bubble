"""Database layer (SQLAlchemy). Postgres in prod via DATABASE_URL; SQLite for dev."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (
    Boolean, DateTime, Float, Integer, String, Text, create_engine, Index,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

from .config import DATABASE_URL


class Base(DeclarativeBase):
    pass


class PricePoint(Base):
    """One historical data point for a single asset/exchange at a moment in time."""
    __tablename__ = "price_points"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    source: Mapped[str] = mapped_column(String(40))           # e.g. Navasan, Nobitex, gold-api.com, melt-estimate
    exchange: Mapped[str | None] = mapped_column(String(30), nullable=True)  # navasan/nobitex/wallex/... or None (global)
    asset: Mapped[str] = mapped_column(String(20))            # usd/usdt/aed/gold18/gold24/ounce/paxg/xaut
    buy: Mapped[float | None] = mapped_column(Float, nullable=True)
    sell: Mapped[float | None] = mapped_column(Float, nullable=True)
    value: Mapped[float | None] = mapped_column(Float, nullable=True)  # for single-value assets (ounce/paxg)
    estimated: Mapped[bool] = mapped_column(Boolean, default=False)


Index("ix_price_asset_ex_ts", PricePoint.asset, PricePoint.exchange, PricePoint.ts)


class WalletConnection(Base):
    """A user-configured exchange endpoint that reports one wallet balance.

    Credentials live here (server side) and are never returned to the browser in
    clear text — see wallet.mask_headers().
    """
    __tablename__ = "wallet_connections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    label: Mapped[str] = mapped_column(String(60))                 # "نوبیتکس — تتر"
    asset: Mapped[str] = mapped_column(String(20), index=True)     # wallet row id, e.g. usdt
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)

    method: Mapped[str] = mapped_column(String(6), default="GET")  # GET / POST
    url: Mapped[str] = mapped_column(Text)
    headers_json: Mapped[str] = mapped_column(Text, default="{}")  # {"Authorization": "Token x"}
    body: Mapped[str | None] = mapped_column(Text, nullable=True)  # raw JSON body for POST
    json_path: Mapped[str] = mapped_column(Text)                   # wallets[0].balance
    multiplier: Mapped[float] = mapped_column(Float, default=1.0)  # rial→toman = 0.1, …

    last_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    last_ok: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_checked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

_connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, pool_pre_ping=True, connect_args=_connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def init_db() -> None:
    Base.metadata.create_all(engine)
