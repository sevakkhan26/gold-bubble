"""FastAPI app: /api/* + SPA frontend with path-based routes."""
from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import select

from . import config, trade, wallet
from .db import (
    PricePoint,
    SessionLocal,
    TradeConnector,
    TradeOrder,
    WalletConnection,
    init_db,
)
from .refresher import refresher
from .version import APP_VERSION, public_version

PUBLIC_DIR = Path(__file__).resolve().parent.parent / "public"
INDEX_HTML = PUBLIC_DIR / "index.html"

# Client-side menu routes (must match public/index.html PAGE_ROUTES)
SPA_ROUTES = {
    "",
    "market",
    "wallet",
    "bubbles",
    "formulas",
    "alerts",
    "b24dom",
    "b24for",
    "b18dom",
    "b18for",
    "baed",
    "busd",
    "settings",
    "sources",
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    try:
        refresher.refresh_once()
    except Exception as e:  # noqa: BLE001
        print(f"[startup] initial refresh failed (will keep polling): {e}")
    refresher.start()
    yield
    refresher.stop()


app = FastAPI(
    title="Gold Market Live",
    version=APP_VERSION,
    lifespan=lifespan,
)


def _has_pair(o):
    return bool(o) and (o.get("buy") is not None or o.get("sell") is not None)


def _is_empty(m):
    if not m:
        return True
    mk = m.get("market", {})
    return not (
        _has_pair(mk.get("usd"))
        or _has_pair(mk.get("aed"))
        or _has_pair(mk.get("gold18PerKg"))
        or _has_pair(mk.get("shemsh24PerKg"))
        or m.get("ounceUsd") is not None
        or _has_pair(m.get("usdtByExchange", {}).get("nobitex"))
        or _has_pair(m.get("usdtByExchange", {}).get("wallex"))
        or any(v is not None for v in (m.get("foreignGold") or {}).values())
    )


@app.get("/api/health")
def health():
    _, updated = refresher.snapshot()
    return {
        "ok": True,
        **public_version(),
        "refreshSec": config.REFRESH_SEC,
        "navasanKey": "set" if config.NAVASAN_API_KEY else "missing",
        "brsApiKey": "set" if config.BRSAPI_KEY else "missing",
        "overrides": list(config.OVERRIDES),
        "lastRefreshAt": updated,
        "proxy": bool(config.HTTP_PROXY or config.HTTPS_PROXY),
    }


@app.get("/api/version")
def version():
    return public_version()


@app.get("/api/debug")
def debug():
    model, updated = refresher.snapshot()
    return {
        "lastRefreshAt": updated,
        "report": refresher.last_report,
        "cached": model,
        **public_version(),
    }


@app.get("/api/prices")
def prices():
    model, updated = refresher.snapshot()
    if _is_empty(model):
        return JSONResponse(
            status_code=503,
            content={
                "error": "no_data",
                "message": "All live sources unavailable and no cached price yet.",
                "report": refresher.last_report,
                **public_version(),
            },
        )
    age_ms = int((time.time() - updated) * 1000) if updated else None
    stale = age_ms is not None and age_ms > config.REFRESH_SEC * 2000
    return {**model, "stale": stale, "ageMs": age_ms, **public_version()}


@app.get("/api/history")
def history(
    asset: str = Query(..., description="usd/usdt/aed/gold18/gold24/ounce/paxgold/tethergold"),
    exchange: str | None = Query(None, description="navasan/nobitex/wallex/... (optional)"),
    limit: int = Query(200, ge=1, le=5000),
):
    """Time series for one asset (optionally one exchange), newest first."""
    with SessionLocal() as s:
        stmt = select(PricePoint).where(PricePoint.asset == asset)
        if exchange:
            stmt = stmt.where(PricePoint.exchange == exchange)
        stmt = stmt.order_by(PricePoint.ts.desc()).limit(limit)
        rows = s.execute(stmt).scalars().all()
    return {
        "asset": asset,
        "exchange": exchange,
        "count": len(rows),
        "points": [
            {
                "ts": r.ts.isoformat(),
                "source": r.source,
                "exchange": r.exchange,
                "buy": r.buy,
                "sell": r.sell,
                "value": r.value,
                "estimated": r.estimated,
            }
            for r in rows
        ],
    }


# ---------------------------------------------------------------- wallet API


class ConnectionIn(BaseModel):
    label: str = Field(min_length=1, max_length=60)
    asset: str
    url: str
    jsonPath: str = ""
    method: str = "GET"
    headers: dict[str, str] | None = None
    body: str | None = None
    multiplier: float = 1.0
    enabled: bool = True
    exchange: str | None = None


class ConnectionPatch(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=60)
    asset: str | None = None
    url: str | None = None
    jsonPath: str | None = None
    method: str | None = None
    headers: dict[str, str] | None = None
    body: str | None = None
    multiplier: float | None = None
    enabled: bool | None = None
    exchange: str | None = None


def _check_asset(asset: str) -> str:
    if asset not in wallet.ALLOWED_ASSETS:
        raise HTTPException(
            status_code=422,
            detail=f"asset must be one of: {', '.join(sorted(wallet.ALLOWED_ASSETS))}",
        )
    return asset


def _check_url(url: str) -> str:
    try:
        return wallet.validate_url(url)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e


def _check_method(method: str) -> str:
    m = (method or "GET").upper()
    if m not in {"GET", "POST"}:
        raise HTTPException(status_code=422, detail="method must be GET or POST")
    return m


def _get_conn(s, conn_id: int) -> WalletConnection:
    conn = s.get(WalletConnection, conn_id)
    if conn is None:
        raise HTTPException(status_code=404, detail="connection not found")
    return conn


@app.get("/api/wallet/connections")
def list_connections():
    """Configured exchange endpoints. Header values are masked."""
    with SessionLocal() as s:
        rows = s.execute(
            select(WalletConnection).order_by(WalletConnection.id)
        ).scalars().all()
        return {
            "assets": sorted(wallet.ALLOWED_ASSETS),
            "connections": [wallet.public_connection(c) for c in rows],
        }


@app.post("/api/wallet/connections", status_code=201)
def create_connection(payload: ConnectionIn):
    conn = WalletConnection(
        label=payload.label.strip(),
        asset=_check_asset(payload.asset),
        url=_check_url(payload.url),
        json_path=payload.jsonPath or "",
        method=_check_method(payload.method),
        headers_json=wallet.merge_headers(None, payload.headers),
        body=payload.body,
        multiplier=payload.multiplier if payload.multiplier is not None else 1.0,
        enabled=payload.enabled,
        exchange=payload.exchange or None,
    )
    with SessionLocal() as s:
        s.add(conn)
        s.commit()
        return wallet.public_connection(conn)


@app.patch("/api/wallet/connections/{conn_id}")
def update_connection(conn_id: int, payload: ConnectionPatch):
    with SessionLocal() as s:
        conn = _get_conn(s, conn_id)
        if payload.label is not None:
            conn.label = payload.label.strip()
        if payload.asset is not None:
            conn.asset = _check_asset(payload.asset)
        if payload.url is not None:
            conn.url = _check_url(payload.url)
        if payload.jsonPath is not None:
            conn.json_path = payload.jsonPath
        if payload.method is not None:
            conn.method = _check_method(payload.method)
        if payload.headers is not None:
            conn.headers_json = wallet.merge_headers(conn.headers_json, payload.headers)
        if payload.body is not None:
            conn.body = payload.body
        if payload.multiplier is not None:
            conn.multiplier = payload.multiplier
        if payload.enabled is not None:
            conn.enabled = payload.enabled
        if payload.exchange is not None:
            conn.exchange = payload.exchange or None
        s.commit()
        return wallet.public_connection(conn)


@app.delete("/api/wallet/connections/{conn_id}")
def delete_connection(conn_id: int):
    with SessionLocal() as s:
        conn = _get_conn(s, conn_id)
        s.delete(conn)
        s.commit()
    return {"ok": True, "id": conn_id}


@app.post("/api/wallet/connections/{conn_id}/test")
def test_connection(conn_id: int):
    """Call one endpoint right now and report what came back."""
    with SessionLocal() as s:
        conn = _get_conn(s, conn_id)
        result = wallet.fetch_balance(conn)
        wallet.record_result(conn, result)
        s.commit()
        return {**result, "connection": wallet.public_connection(conn)}


@app.get("/api/wallet/balances")
def wallet_balances():
    """Live balances per wallet row, summed over every enabled connection."""
    with SessionLocal() as s:
        rows = s.execute(
            select(WalletConnection).where(WalletConnection.enabled.is_(True))
        ).scalars().all()
        if not rows:
            return {
                "balances": {},
                "byExchange": {},
                "connections": [],
                "fetchedAt": time.time(),
            }

        with ThreadPoolExecutor(max_workers=min(6, len(rows))) as pool:
            results = list(pool.map(wallet.fetch_balance, rows))

        balances: dict[str, float] = {}
        by_exchange: dict[str, dict[str, float]] = {}
        out = []
        for conn, result in zip(rows, results):
            wallet.record_result(conn, result)
            if result["ok"] and result["value"] is not None:
                balances[conn.asset] = balances.get(conn.asset, 0.0) + result["value"]
                if conn.exchange:
                    per_ex = by_exchange.setdefault(conn.exchange, {})
                    per_ex[conn.asset] = per_ex.get(conn.asset, 0.0) + result["value"]
            out.append(
                {
                    "id": conn.id,
                    "label": conn.label,
                    "asset": conn.asset,
                    "exchange": conn.exchange,
                    "ok": result["ok"],
                    "value": result["value"],
                    "ms": result["ms"],
                    "error": result["error"],
                }
            )
        s.commit()
    return {
        "balances": balances,
        "byExchange": by_exchange,
        "connections": out,
        "fetchedAt": time.time(),
    }


# ----------------------------------------------------------------- trade API


class ConnectorIn(BaseModel):
    label: str = Field(min_length=1, max_length=60)
    exchange: str = Field(min_length=1, max_length=30)
    asset: str
    url: str
    method: str = "POST"
    headers: dict[str, str] | None = None
    bodyTemplate: str = ""
    buyValue: str = "buy"
    sellValue: str = "sell"
    enabled: bool = True
    dryRun: bool = True


class ConnectorPatch(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=60)
    exchange: str | None = None
    asset: str | None = None
    url: str | None = None
    method: str | None = None
    headers: dict[str, str] | None = None
    bodyTemplate: str | None = None
    buyValue: str | None = None
    sellValue: str | None = None
    enabled: bool | None = None
    dryRun: bool | None = None


class OrderIn(BaseModel):
    connectorId: int
    side: str
    qty: float
    price: float | None = None
    confirm: bool = False


def _check_trade_method(method: str) -> str:
    m = (method or "POST").upper()
    if m not in {"GET", "POST", "PUT", "DELETE"}:
        raise HTTPException(status_code=422, detail="method must be GET, POST, PUT or DELETE")
    return m


def _get_connector(s, conn_id: int) -> TradeConnector:
    conn = s.get(TradeConnector, conn_id)
    if conn is None:
        raise HTTPException(status_code=404, detail="connector not found")
    return conn


@app.get("/api/trade/connectors")
def list_connectors():
    with SessionLocal() as s:
        rows = s.execute(select(TradeConnector).order_by(TradeConnector.id)).scalars().all()
        return {"connectors": [trade.public_connector(c) for c in rows]}


@app.post("/api/trade/connectors", status_code=201)
def create_connector(payload: ConnectorIn):
    conn = TradeConnector(
        label=payload.label.strip(),
        exchange=payload.exchange.strip(),
        asset=_check_asset(payload.asset),
        url=_check_url(payload.url),
        method=_check_trade_method(payload.method),
        headers_json=wallet.merge_headers(None, payload.headers),
        body_template=payload.bodyTemplate or "",
        buy_value=payload.buyValue or "buy",
        sell_value=payload.sellValue or "sell",
        enabled=payload.enabled,
        dry_run=payload.dryRun,
    )
    with SessionLocal() as s:
        s.add(conn)
        s.commit()
        return trade.public_connector(conn)


@app.patch("/api/trade/connectors/{conn_id}")
def update_connector(conn_id: int, payload: ConnectorPatch):
    with SessionLocal() as s:
        conn = _get_connector(s, conn_id)
        if payload.label is not None:
            conn.label = payload.label.strip()
        if payload.exchange is not None:
            conn.exchange = payload.exchange.strip()
        if payload.asset is not None:
            conn.asset = _check_asset(payload.asset)
        if payload.url is not None:
            conn.url = _check_url(payload.url)
        if payload.method is not None:
            conn.method = _check_trade_method(payload.method)
        if payload.headers is not None:
            conn.headers_json = wallet.merge_headers(conn.headers_json, payload.headers)
        if payload.bodyTemplate is not None:
            conn.body_template = payload.bodyTemplate
        if payload.buyValue is not None:
            conn.buy_value = payload.buyValue
        if payload.sellValue is not None:
            conn.sell_value = payload.sellValue
        if payload.enabled is not None:
            conn.enabled = payload.enabled
        if payload.dryRun is not None:
            conn.dry_run = payload.dryRun
        s.commit()
        return trade.public_connector(conn)


@app.delete("/api/trade/connectors/{conn_id}")
def delete_connector(conn_id: int):
    with SessionLocal() as s:
        conn = _get_connector(s, conn_id)
        s.delete(conn)
        s.commit()
    return {"ok": True, "id": conn_id}


@app.post("/api/trade/preview")
def preview_order(payload: OrderIn):
    """Render the exact request an order would send — nothing is transmitted."""
    with SessionLocal() as s:
        conn = _get_connector(s, payload.connectorId)
        try:
            req = trade.build_request(
                conn, side=payload.side, qty=payload.qty, price=payload.price
            )
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e)) from e
        return {"dryRun": bool(conn.dry_run), "request": req}


@app.post("/api/trade/orders", status_code=201)
def place_order(payload: OrderIn):
    """Place one order. Requires confirm=true; dry-run connectors never transmit."""
    if not payload.confirm:
        raise HTTPException(status_code=422, detail="confirm must be true to place an order")
    if payload.side not in trade.SIDES:
        raise HTTPException(status_code=422, detail="side must be buy or sell")
    if payload.qty is None or payload.qty <= 0:
        raise HTTPException(status_code=422, detail="qty must be greater than zero")

    with SessionLocal() as s:
        conn = _get_connector(s, payload.connectorId)
        if not conn.enabled:
            raise HTTPException(status_code=422, detail="connector is disabled")

        result = trade.send_order(conn, side=payload.side, qty=payload.qty, price=payload.price)
        req = result.get("request") or {}
        order = TradeOrder(
            connector_id=conn.id,
            exchange=conn.exchange,
            asset=conn.asset,
            side=payload.side,
            qty=payload.qty,
            price=payload.price,
            total=(payload.qty * payload.price) if payload.price is not None else None,
            status=result["status"],
            http_status=result.get("httpStatus"),
            request_url=req.get("url"),
            request_body=req.get("body"),
            response_text=result.get("response"),
            error=result.get("error"),
        )
        s.add(order)
        s.commit()
        return {**result, "order": trade.public_order(order)}


@app.get("/api/trade/orders")
def list_orders(
    limit: int = Query(50, ge=1, le=500),
    asset: str | None = Query(None),
    exchange: str | None = Query(None),
):
    with SessionLocal() as s:
        stmt = select(TradeOrder)
        if asset:
            stmt = stmt.where(TradeOrder.asset == asset)
        if exchange:
            stmt = stmt.where(TradeOrder.exchange == exchange)
        rows = s.execute(stmt.order_by(TradeOrder.ts.desc()).limit(limit)).scalars().all()
        return {"count": len(rows), "orders": [trade.public_order(o) for o in rows]}


def _spa_index() -> FileResponse:
    if not INDEX_HTML.is_file():
        raise HTTPException(status_code=404, detail="frontend index.html missing")
    return FileResponse(INDEX_HTML, media_type="text/html; charset=utf-8")


@app.get("/")
def root():
    """Home → SPA (client redirects/normalizes to /market)."""
    return _spa_index()


@app.get("/{full_path:path}")
def spa_or_static(full_path: str, request: Request):
    """Serve static files, or fall back to index.html for SPA menu routes.

    Keeps /api/* exclusive to the API handlers above (they are registered first).
    """
    # Never handle API here (should already be matched, but belt-and-suspenders).
    if full_path == "api" or full_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="Not Found")

    # Safe path resolve under public/
    candidate = (PUBLIC_DIR / full_path).resolve()
    try:
        candidate.relative_to(PUBLIC_DIR.resolve())
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Not Found") from exc

    if candidate.is_file():
        return FileResponse(candidate)

    # SPA route: /market, /settings, ...
    first = full_path.split("/", 1)[0]
    if first in SPA_ROUTES or full_path in SPA_ROUTES:
        return _spa_index()

    # Unknown path → still SPA shell (deep-link friendly) if we have index
    if INDEX_HTML.is_file():
        return _spa_index()
    raise HTTPException(status_code=404, detail="Not Found")
