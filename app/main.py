"""FastAPI app: /api/* + SPA frontend with path-based routes."""
from __future__ import annotations

import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy import select

from . import config
from .db import PricePoint, SessionLocal, init_db
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
