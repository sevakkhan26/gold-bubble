"""Database layer (SQLAlchemy). Postgres in prod via DATABASE_URL; SQLite for dev."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (
    Boolean, DateTime, Float, Integer, String, Text, create_engine, Index, inspect, text,
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
    exchange: Mapped[str | None] = mapped_column(String(30), nullable=True)  # nobitex/wallex/…
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

class TradeConnector(Base):
    """An exchange order endpoint. Placeholders in url/body are filled per order.

    `dry_run` starts True so a freshly added connector cannot fire a real order
    before the user has looked at the rendered request.
    """
    __tablename__ = "trade_connectors"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    label: Mapped[str] = mapped_column(String(60))
    exchange: Mapped[str] = mapped_column(String(30), index=True)   # nobitex/wallex/…
    asset: Mapped[str] = mapped_column(String(20), index=True)      # wallet row id
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    dry_run: Mapped[bool] = mapped_column(Boolean, default=True)

    method: Mapped[str] = mapped_column(String(6), default="POST")
    url: Mapped[str] = mapped_column(Text)
    headers_json: Mapped[str] = mapped_column(Text, default="{}")
    body_template: Mapped[str] = mapped_column(Text, default="")    # {{side}} {{qty}} {{price}}
    buy_value: Mapped[str] = mapped_column(String(20), default="buy")
    sell_value: Mapped[str] = mapped_column(String(20), default="sell")

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class TradeOrder(Base):
    """One attempt to place an order — kept whether it succeeded, failed, or was a dry run."""
    __tablename__ = "trade_orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True
    )
    connector_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    exchange: Mapped[str] = mapped_column(String(30), index=True)
    asset: Mapped[str] = mapped_column(String(20), index=True)
    side: Mapped[str] = mapped_column(String(4))                    # buy / sell
    qty: Mapped[float] = mapped_column(Float)
    price: Mapped[float | None] = mapped_column(Float, nullable=True)
    total: Mapped[float | None] = mapped_column(Float, nullable=True)

    status: Mapped[str] = mapped_column(String(10), index=True)     # dry / sent / failed
    http_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    request_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    request_body: Mapped[str | None] = mapped_column(Text, nullable=True)
    response_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)


_connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, pool_pre_ping=True, connect_args=_connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

# Columns added after a table shipped — create_all() only creates missing tables.
_ADDED_COLUMNS = [("wallet_connections", "exchange", "VARCHAR(30)")]


def _add_missing_columns() -> None:
    insp = inspect(engine)
    for table, column, ddl_type in _ADDED_COLUMNS:
        if not insp.has_table(table):
            continue
        if column in {c["name"] for c in insp.get_columns(table)}:
            continue
        with engine.begin() as conn:
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl_type}"))


def init_db() -> None:
    Base.metadata.create_all(engine)
    _add_missing_columns()
