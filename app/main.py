"""FastAPI app: /api/prices, /api/health, /api/debug, /api/history + static frontend."""
from __future__ import annotations

import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Query
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select

from . import config
from .db import PricePoint, SessionLocal, init_db
from .refresher import refresher
from .version import APP_VERSION, public_version

PUBLIC_DIR = Path(__file__).resolve().parent.parent / "public"


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    try:
        refresher.refresh_once()  # warm cache + first history rows
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


# Serve the frontend (same origin -> /api works, no CORS needed).
# Registered last so /api/* always wins.
if PUBLIC_DIR.exists():
    app.mount("/", StaticFiles(directory=str(PUBLIC_DIR), html=True), name="static")
