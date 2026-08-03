"""Background refresher: fetches on an interval, stores full history, keeps the
latest merged model in memory for /api/prices, with a last-valid-value fallback."""
from __future__ import annotations

import threading
import time
from datetime import datetime, timezone

from . import config
from .db import PricePoint, SessionLocal
from .providers import build_model


def _pick(a, b):
    return a if b is None else b


def _pair(a, b):
    return b if (b and (b.get("buy") is not None or b.get("sell") is not None)) else a


def merge_model(prev: dict | None, nxt: dict) -> dict:
    """Keep last valid value for any field missing in the new fetch."""
    if not prev:
        return nxt
    market = {}
    pm, nm = prev.get("market", {}), nxt.get("market", {})
    for k in ("usd", "aed", "gold18PerKg", "shemsh24PerKg"):
        market[k] = _pair(pm.get(k), nm.get(k))
    exchanges = {}
    ids = set(prev.get("exchanges", {})) | set(nxt.get("exchanges", {}))
    for i in ids:
        pe, ne = prev.get("exchanges", {}).get(i, {}), nxt.get("exchanges", {}).get(i, {})
        own_p, own_n = pe.get("own") or {}, ne.get("own") or {}
        exchanges[i] = {
            "usdt": _pair(pe.get("usdt"), ne.get("usdt")),
            "usd": _pair(pe.get("usd"), ne.get("usd")),
            "aed": _pair(pe.get("aed"), ne.get("aed")),
            "gold18PerKg": _pair(pe.get("gold18PerKg"), ne.get("gold18PerKg")),
            "shemsh24PerKg": _pair(pe.get("shemsh24PerKg"), ne.get("shemsh24PerKg")),
            "own": {**own_p, **own_n} if (own_p or own_n) else ne.get("own") or pe.get("own"),
        }
    fg_p, fg_n = prev.get("foreignGold") or {}, nxt.get("foreignGold") or {}
    usdt_ids = (
        "nobitex",
        "wallex",
        "bitpin",
        "tabdeal",
        "exir",
        "ramzinex",
        "tetherland",
        "abantether",
    )
    prev_u, nxt_u = prev.get("usdtByExchange") or {}, nxt.get("usdtByExchange") or {}
    usdt_by = {k: _pair(prev_u.get(k), nxt_u.get(k)) for k in usdt_ids}
    # keep any extra keys from either side
    for k in set(prev_u) | set(nxt_u):
        if k not in usdt_by:
            usdt_by[k] = _pair(prev_u.get(k), nxt_u.get(k))
    return {
        "updatedAt": nxt["updatedAt"],
        "ounceUsd": _pick(prev.get("ounceUsd"), nxt.get("ounceUsd")),
        "exchanges": exchanges,
        "market": market,
        "usdtByExchange": usdt_by,
        "foreignGold": {
            "pax-gold": _pick(fg_p.get("pax-gold"), fg_n.get("pax-gold")),
            "tether-gold": _pick(fg_p.get("tether-gold"), fg_n.get("tether-gold")),
        },
        "sources": {**prev.get("sources", {}), **nxt.get("sources", {})},
        "estimated": nxt.get("estimated") or prev.get("estimated") or {"usd": False, "gold": False},
        "anyLive": nxt.get("anyLive") or prev.get("anyLive", False),
    }


ASSET_KEYS = {"usdt": "usdt", "usd": "usd", "aed": "aed", "gold18PerKg": "gold18", "shemsh24PerKg": "gold24"}


def store_history(model: dict) -> int:
    """Insert one row per available price/field into price_points. Returns rows written."""
    prov = model.get("sources", {})
    rows: list[PricePoint] = []

    def src_for(asset_key: str, exchange: str | None) -> tuple[str, bool]:
        if exchange in ("nobitex", "wallex") and asset_key == "usdt":
            return (exchange.capitalize(), False)
        key = {"usd": "usd", "aed": "aed", "gold18": "gold18", "gold24": "gold24"}.get(asset_key, asset_key)
        p = prov.get(key, {})
        return (p.get("source", "?"), bool(p.get("estimated")))

    for ex, fields in (model.get("exchanges") or {}).items():
        for fkey, pair in fields.items():
            asset = ASSET_KEYS.get(fkey)
            if not asset or not pair:
                continue
            source, est = src_for(asset, ex)
            rows.append(PricePoint(source=source, exchange=ex, asset=asset,
                                   buy=pair.get("buy"), sell=pair.get("sell"), estimated=est))
    # global single-value assets
    if model.get("ounceUsd") is not None:
        rows.append(PricePoint(source=prov.get("ounce", {}).get("source", "?"), exchange=None, asset="ounce", value=model["ounceUsd"]))
    for tok in ("pax-gold", "tether-gold"):
        v = (model.get("foreignGold") or {}).get(tok)
        if v is not None:
            rows.append(PricePoint(source="CoinGecko", exchange=None, asset=tok.replace("-", ""), value=v))

    if not rows:
        return 0
    with SessionLocal() as s:
        s.add_all(rows)
        s.commit()
    return len(rows)


class Refresher:
    def __init__(self) -> None:
        self.latest: dict | None = None
        self.updated_at: float = 0.0
        self.last_report: list | None = None
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def refresh_once(self) -> dict:
        # A safety net for a hung provider, not the pacing mechanism — _loop keeps
        # the cadence. Sized to REFRESH_SEC it starved a slow proxied egress of the
        # 20-40s its providers actually need, and the board came up with no data.
        out = build_model(
            config.NAVASAN_API_KEY,
            config.BRSAPI_KEY,
            config.OVERRIDES,
            config.HTTP_TIMEOUT,
            budget_sec=max(45.0, config.REFRESH_SEC * 3.0),
        )
        fresh, report = out["model"], out["report"]
        with self._lock:
            self.latest = merge_model(self.latest, fresh)
            self.updated_at = time.time()
            self.last_report = report
        try:
            n = store_history(fresh)
        except Exception as e:  # noqa: BLE001
            n = -1
            print(f"[history] write failed: {e}")
        ok = sum(1 for r in report if r["ok"])
        for r in report:
            flag = "OK " if r["ok"] else "ERR"
            print(f"[refresh] {flag} {str(r['ms'] or '-'):>5}ms  {r['label']}" + (f"  -> {r['error']}" if r.get("error") else ""))
        print(f"[refresh] {ok}/{len(report)} live | history rows={n} | ounce={fresh['ounceUsd']} estimated={fresh['estimated']}")
        return self.latest  # type: ignore[return-value]

    def _loop(self) -> None:
        # Fixed cadence: schedule from when a cycle *started*, so a slow fetch
        # shortens the following wait instead of adding to it. Waiting after the
        # fetch made the real interval REFRESH_SEC + fetch time — minutes, once
        # providers began timing out, which read as a frozen board.
        # lifespan already ran refresh_once(); wait first to avoid double-hit on start.
        next_at = time.time() + config.REFRESH_SEC
        while not self._stop.is_set():
            if self._stop.wait(max(0.0, next_at - time.time())):
                break
            started = time.time()
            try:
                self.refresh_once()
            except Exception as e:  # noqa: BLE001
                print(f"[refresh] unexpected: {e}")
            next_at = max(started + config.REFRESH_SEC, time.time() + 1.0)

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def snapshot(self) -> tuple[dict | None, float]:
        with self._lock:
            return self.latest, self.updated_at


refresher = Refresher()
