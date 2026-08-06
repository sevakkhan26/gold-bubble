#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Gold Market Lite — نسخه‌ی سبک، فقط با کتابخانه‌ی استاندارد پایتون.

یک سرور تک‌فایلی که همان تابلو‌ی قیمت زنده‌ی برنامه‌ی کامل را اجرا می‌کند
بدون هیچ وابستگی خارجی (بدون pip install، بدون venv):

    python lite/server.py

سپس:  http://localhost:8787

A single-file, standard-library-only server that runs the same live price
board as the full FastAPI app. No third-party packages needed at all.
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
INDEX = PUBLIC / "index.html"
DB_PATH = ROOT / "lite.db"

PORT = int(os.environ.get("PORT", "8787"))
REFRESH_SEC = max(15, int(os.environ.get("REFRESH_SEC", "15")))
HTTP_TIMEOUT = float(os.environ.get("HTTP_TIMEOUT", "15"))
NAVASAN_KEY = os.environ.get("NAVASAN_API_KEY", "")
HISTORY_DAYS = int(os.environ.get("PRICE_HISTORY_DAYS", "14"))

VERSION = "2.2.0-lite"
GIT_SHA = os.environ.get("APP_GIT_SHA", "lite")
BUILD_TIME = "portable"

GRAMS_PER_KG = 1000
TROY = 31.1035
PURITY_18 = 0.75

UA = (
    "Mozilla/5.0 (compatible; GoldBubble-Lite/" + VERSION
    + "; +https://github.com/sevakkhan26/gold-bubble)"
)

USDT_IDS = ("nobitex", "wallex", "bitpin", "tabdeal", "exir",
            "ramzinex", "tetherland", "abantether")


# ─────────────────────────── helpers ───────────────────────────

def _num(x):
    try:
        if isinstance(x, (list, tuple)):
            x = x[0]
        elif isinstance(x, dict):
            for k in ("price", "p", "value", "last"):
                if k in x:
                    x = x[k]
                    break
        if isinstance(x, str):
            x = x.replace(",", "").replace(" ", "").strip()
        v = float(x)
        return v if v > 0 else None
    except (TypeError, ValueError, IndexError):
        return None


def _pair(buy, sell, last=None):
    if buy is None and sell is None and last is None:
        return None
    b = round(buy) if buy is not None else None
    s = round(sell) if sell is not None else None
    latest = round(last) if last is not None else None
    if latest is None and b is not None and s is not None:
        latest = round((b + s) / 2)
    if latest is None:
        latest = b if b is not None else s
    return {"buy": b if b is not None else latest,
            "sell": s if s is not None else latest,
            "latest": latest}


def _book(bids, asks, rial=False):
    bv = [v for v in (_num(x) for x in (bids or [])) if v]
    av = [v for v in (_num(x) for x in (asks or [])) if v]
    best_bid = max(bv) if bv else None
    best_ask = min(av) if av else None
    if rial:
        best_bid = best_bid / 10 if best_bid else None
        best_ask = best_ask / 10 if best_ask else None
    return _pair(best_bid, best_ask)


def _proxy_on():
    return bool(os.environ.get("OUTBOUND_HTTPS_PROXY", "").strip()
                or os.environ.get("HTTPS_PROXY", "").strip()
                or os.environ.get("HTTP_PROXY", "").strip())


def _fetch(url, timeout, use_env):
    """GET raw text. `use_env` = honour HTTP(S)_PROXY, else direct."""
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept": "application/json,text/javascript,text/plain,*/*",
        "Referer": "https://www.navasan.net/",
    })
    if use_env:
        opener = urllib.request.build_opener()
    else:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def _get_json(url, timeout=HTTP_TIMEOUT, retries=1):
    """JSON GET with retry; one proxy attempt, then direct attempts."""
    routes = ([True] + [False] * retries) if _proxy_on() else ([True] * (retries + 1))
    last = None
    for i, use_env in enumerate(routes):
        try:
            text = _fetch(url, timeout, use_env)
            return json.loads(text), i + 1
        except Exception as e:  # noqa: BLE001
            last = e
    raise last if last else RuntimeError("fetch failed")


def _get_text(url, timeout=HTTP_TIMEOUT, retries=1):
    routes = ([True] + [False] * retries) if _proxy_on() else ([True] * (retries + 1))
    last = None
    for i, use_env in enumerate(routes):
        try:
            return _fetch(url, timeout, use_env), i + 1
        except Exception as e:  # noqa: BLE001
            last = e
    raise last if last else RuntimeError("fetch failed")


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


# ─────────────────────────── mappers ───────────────────────────

def map_nobitex(j):
    last = _num(j.get("lastTradePrice"))
    pair = _book(j.get("bids"), j.get("asks"), rial=True)
    if pair is None and last is not None:
        return _pair(last / 10, last / 10, last / 10)
    if pair and last is not None:
        pair["latest"] = round(last / 10)
    return pair


def map_wallex(j):
    res = j.get("result") or {}
    return _book(res.get("bid") or res.get("bids"),
                 res.get("ask") or res.get("asks"))


def map_bitpin(j):
    return _book(j.get("bids"), j.get("asks"))


def map_tabdeal(j):
    return _book(j.get("bids"), j.get("asks"))


def map_exir(j):
    book = j.get("usdt-irt") if isinstance(j, dict) else None
    if isinstance(book, dict) and (book.get("bids") or book.get("asks")):
        return _book(book.get("bids"), book.get("asks"))
    last = _num(j.get("last") or j.get("close"))
    return _pair(last, last, last) if last else None


def map_ramzinex(j):
    data = j.get("data") if isinstance(j, dict) else j
    if not isinstance(data, dict):
        return None
    return _book(data.get("buys") or data.get("bids"),
                 data.get("sells") or data.get("asks"), rial=True)


def map_tetherland(j):
    data = j.get("data") if isinstance(j, dict) else None
    cur = None
    if isinstance(data, dict):
        cur = (data.get("currencies") or {}).get("USDT") or data.get("USDT")
    if not isinstance(cur, dict):
        return None
    buy = _num(cur.get("buy_price") or cur.get("price"))
    sell = _num(cur.get("sell_price") or cur.get("price"))
    return _pair(buy, sell)


def map_abantether(j):
    """Dealer quote: their buy_price is what the customer pays (our sell)."""
    data = j.get("data") if isinstance(j, dict) else None
    markets = (data or {}).get("markets") if isinstance(data, dict) else None
    if not isinstance(markets, dict):
        markets = j.get("markets") if isinstance(j, dict) else None
    cur = None
    if isinstance(markets, dict):
        cur = markets.get("USDTIRT") or markets.get("USDT")
        if not isinstance(cur, dict):
            for k, v in markets.items():
                if str(k).upper() in ("USDTIRT", "USDTTMN", "USDT_IRT") and isinstance(v, dict):
                    cur = v
                    break
    if not isinstance(cur, dict):
        return None
    pays = _num(cur.get("buy_price") or cur.get("buy") or cur.get("price"))
    gets = _num(cur.get("sell_price") or cur.get("sell") or cur.get("price"))
    return _pair(buy=gets, sell=pays)


def map_gold_api(j):
    return _num(j.get("price"))


def map_currency_xau(j):
    xau = j.get("xau") if isinstance(j, dict) else None
    return _num(xau.get("usd")) if isinstance(xau, dict) else None


def parse_navasan_initrates(text):
    m = re.search(r"var\s+lastrates\s*=\s*(\{)", text)
    if not m:
        t = text.strip()
        if t.startswith("{"):
            return json.loads(t)
        raise ValueError("navasan initrates: lastrates not found")
    start = m.start(1)
    depth = 0
    end = None
    for i, ch in enumerate(text[start:], start):
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    if end is None:
        raise ValueError("navasan initrates: unclosed object")
    return json.loads(text[start:end])


def map_navasan(j):
    def v(keys):
        for k in keys:
            o = j.get(k)
            if isinstance(o, dict) and o.get("value") is not None:
                n = _num(o["value"])
                if n:
                    return n
            elif o is not None and not isinstance(o, dict):
                n = _num(o)
                if n:
                    return n
        return None

    usd_buy = v(["harat_naghdi_buy", "usd_buy"])
    usd_sell = v(["harat_naghdi_sell", "harat_naghdi", "usd_sell", "usd"])
    aed = v(["aed_sell", "aed", "dirham_dubai", "derham_dubai"])
    g18 = v(["18ayar", "gold_18", "tala_18ayar"])
    g24 = v(["24ayar", "gold_24"])
    ounce = v(["ons", "ounce", "gold_ons", "usd_xau"])
    usdt = v(["usd_usdt", "usdt"])
    if g24 is None and g18 is not None:
        g24 = g18 / PURITY_18
    out = {
        "ounceUsd": ounce,
        "usd": _pair(usd_buy, usd_sell) if (usd_buy or usd_sell) else None,
        "aed": _pair(aed, aed) if aed else None,
        "gold18PerKg": _pair(g18 * GRAMS_PER_KG, g18 * GRAMS_PER_KG) if g18 else None,
        "shemsh24PerKg": _pair(g24 * GRAMS_PER_KG, g24 * GRAMS_PER_KG) if g24 else None,
    }
    if usdt:
        out["usdt"] = _pair(usdt, usdt)
    return out


def map_tgju_table(j):
    rows = j.get("data") if isinstance(j, dict) else None
    if not rows:
        return None
    raw = rows[0][0] if isinstance(rows[0], (list, tuple)) else rows[0]
    n = _num(raw)
    return n / 10 if n is not None else None


# ──────────────────────── source registry ────────────────────────

def _sources():
    nav_url = f"https://api.navasan.tech/latest/?api_key={NAVASAN_KEY}" if NAVASAN_KEY else None
    src = [
        ("navasan_web", "Navasan (web)", "https://www.navasan.net/initrates.php", "text"),
        ("tgju_usd", "TGJU dollar", "https://api.tgju.org/v1/market/indicator/summary-table-data/price_dollar_rl", "json"),
        ("tgju_aed", "TGJU AED", "https://api.tgju.org/v1/market/indicator/summary-table-data/price_aed", "json"),
        ("tgju_g18", "TGJU gold 18k", "https://api.tgju.org/v1/market/indicator/summary-table-data/geram18", "json"),
        ("nobitex", "Nobitex USDT", "https://apiv2.nobitex.ir/v2/depth/USDTIRT", "json"),
        ("wallex", "Wallex USDT", "https://api.wallex.ir/v1/depth?symbol=USDTTMN", "json"),
        ("bitpin", "Bitpin USDT", "https://api.bitpin.ir/api/v1/mth/orderbook/USDT_IRT/", "json"),
        ("tabdeal", "Tabdeal USDT", "https://api1.tabdeal.org/r/api/v1/depth?symbol=USDTIRT&limit=20", "json"),
        ("exir", "Exir USDT", "https://api.exir.io/v2/ticker?symbol=usdt-irt", "json"),
        ("ramzinex", "Ramzinex USDT", "https://publicapi.ramzinex.com/exchange/api/v1.0/exchange/orderbooks/11/buys_sells", "json"),
        ("tetherland", "Tetherland USDT", "https://api.tetherland.com/currencies", "json"),
        ("abantether", "Abantether USDT", "https://api.abantether.com/api/v1/manager/otc/ticker", "json"),
        ("gold_api", "gold-api.com XAU", "https://api.gold-api.com/price/XAU", "json"),
        ("currency_xau", "Currency-API XAU", "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/xau.json", "json"),
        ("coingecko", "CoinGecko PAXG/XAUT", "https://api.coingecko.com/api/v3/simple/price?ids=pax-gold,tether-gold&vs_currencies=usd", "json"),
    ]
    if nav_url:
        src.append(("navasan", "Navasan API", nav_url, "json"))
    return src


def _run_source(name, label, url, kind, timeout):
    try:
        if kind == "text":
            text, ms = _get_text(url, timeout)
            value = map_navasan(parse_navasan_initrates(text))
        else:
            j, ms = _get_json(url, timeout)
            value = {
                "navasan": map_navasan,
                "tgju_usd": lambda x: map_tgju_table(x),
                "tgju_aed": lambda x: map_tgju_table(x),
                "tgju_g18": lambda x: map_tgju_table(x),
                "nobitex": map_nobitex,
                "wallex": map_wallex,
                "bitpin": map_bitpin,
                "tabdeal": map_tabdeal,
                "exir": map_exir,
                "ramzinex": map_ramzinex,
                "tetherland": map_tetherland,
                "abantether": map_abantether,
                "gold_api": map_gold_api,
                "currency_xau": map_currency_xau,
                "coingecko": lambda j: {
                    "pax-gold": (j.get("pax-gold") or {}).get("usd"),
                    "tether-gold": (j.get("tether-gold") or {}).get("usd"),
                },
            }[name](j)
        return {"source": name, "label": label, "ok": True, "ms": ms, "value": value}
    except Exception as e:  # noqa: BLE001
        return {"source": name, "label": label, "ok": False, "ms": None,
                "value": None, "error": str(e)[:160]}


# ──────────────────────── model building ────────────────────────

def build_model(timeout=HTTP_TIMEOUT):
    """Fetch everything in parallel, assemble the board model. Never raises."""
    sources = _sources()
    deadline = time.time() + max(90.0, REFRESH_SEC * 3.0)
    results = []
    with ThreadPoolExecutor(max_workers=min(6, len(sources))) as pool:
        futs = {pool.submit(_run_source, n, l, u, k, timeout): n for n, l, u, k in sources}
        pending = set(futs)
        try:
            for fut in as_completed(futs, timeout=max(0.1, deadline - time.time())):
                pending.discard(fut)
                results.append(fut.result())
        except Exception:  # noqa: BLE001  (budget exhausted)
            for fut in pending:
                fut.cancel()
                r = {"source": futs[fut], "label": futs[fut], "ok": False,
                     "ms": None, "value": None, "error": "skipped — budget spent"}
                results.append(r)

    by = {r["source"]: r for r in results}
    ts = _now_iso()

    # USDT per exchange
    usdt_ex = {}
    for ex in USDT_IDS:
        v = by.get(ex, {}).get("value")
        if v:
            usdt_ex[ex] = v

    # ounce (global)
    ounce = None
    if by.get("gold_api", {}).get("value") is not None:
        ounce = by["gold_api"]["value"]
    elif by.get("currency_xau", {}).get("value") is not None:
        ounce = by["currency_xau"]["value"]
    foreign = by.get("coingecko", {}).get("value")
    if ounce is None and foreign and foreign.get("pax-gold"):
        ounce = foreign["pax-gold"]

    # domestic market: Navasan > TGJU
    nav = by.get("navasan", {}).get("value") or by.get("navasan_web", {}).get("value")
    tgju_usd = by.get("tgju_usd", {}).get("value")
    tgju_aed = by.get("tgju_aed", {}).get("value")
    tgju_g18 = by.get("tgju_g18", {}).get("value")
    tgju_dom = None
    if tgju_usd or tgju_aed or tgju_g18:
        g18p = _pair(tgju_g18 * GRAMS_PER_KG, tgju_g18 * GRAMS_PER_KG) if tgju_g18 else None
        g24p = None
        if tgju_g18:
            g24 = tgju_g18 / PURITY_18
            g24p = _pair(g24 * GRAMS_PER_KG, g24 * GRAMS_PER_KG)
        tgju_dom = {
            "usd": _pair(tgju_usd, tgju_usd) if tgju_usd else None,
            "aed": _pair(tgju_aed, tgju_aed) if tgju_aed else None,
            "gold18PerKg": g18p,
            "shemsh24PerKg": g24p,
            "ounceUsd": None,
        }

    dom = nav or tgju_dom
    usd = dom.get("usd") if dom else None
    aed = dom.get("aed") if dom else None
    gold18 = dom.get("gold18PerKg") if dom else None
    gold24 = dom.get("shemsh24PerKg") if dom else None

    est_usd = est_gold = False
    usd_source = "Navasan" if nav else ("TGJU" if tgju_dom else None)
    if usd is None:
        mids = [x["latest"] for x in usdt_ex.values() if x and x.get("latest")]
        if mids:
            mid = round(sum(mids) / len(mids))
            usd = _pair(mid, mid)
            usd_source = "USDT-proxy"
            est_usd = True

    # melt fallback for gold
    if (not gold18 or not gold24) and ounce and usd:
        melt24 = (ounce * usd["sell"]) / TROY * GRAMS_PER_KG
        if not gold18:
            gold18 = _pair(melt24 * PURITY_18, melt24 * PURITY_18)
            est_gold = True
        if not gold24:
            gold24 = _pair(melt24, melt24)
            est_gold = True

    # exchanges board
    exchanges = {}
    for ex, usdt in usdt_ex.items():
        exchanges[ex] = {
            "usdt": usdt,
            "usd": usdt,
            "aed": aed,
            "gold18PerKg": gold18,
            "shemsh24PerKg": gold24,
            "own": {"usdt": True, "usd": False, "aed": False, "gold": False},
        }
    if nav:
        exchanges["navasan"] = {
            "usd": nav.get("usd"),
            "aed": nav.get("aed"),
            "gold18PerKg": nav.get("gold18PerKg"),
            "shemsh24PerKg": nav.get("shemsh24PerKg"),
            "own": {"usdt": bool(nav.get("usdt")), "usd": bool(nav.get("usd")),
                    "aed": bool(nav.get("aed")),
                    "gold": bool(nav.get("gold18PerKg") or nav.get("shemsh24PerKg"))},
        }
        if nav.get("usdt"):
            exchanges["navasan"]["usdt"] = nav["usdt"]
    if tgju_dom:
        exchanges["bonbast"] = {
            "usd": tgju_dom.get("usd"),
            "aed": tgju_dom.get("aed"),
            "gold18PerKg": tgju_dom.get("gold18PerKg"),
            "shemsh24PerKg": tgju_dom.get("shemsh24PerKg"),
            "own": {"usdt": False, "usd": bool(tgju_dom.get("usd")),
                    "aed": bool(tgju_dom.get("aed")),
                    "gold": bool(tgju_dom.get("gold18PerKg") or tgju_dom.get("shemsh24PerKg"))},
        }

    prov = {}
    if usd:
        prov["usd"] = {"source": usd_source, "ts": ts, "live": True, "estimated": est_usd}
    if aed:
        prov["aed"] = {"source": "Navasan" if nav else "TGJU", "ts": ts, "live": True, "estimated": False}
    if gold18:
        prov["gold18"] = {"source": "Navasan" if nav else ("TGJU" if tgju_dom else "melt-estimate"),
                          "ts": ts, "live": True, "estimated": est_gold}
    if gold24:
        prov["gold24"] = {"source": "Navasan" if nav else ("TGJU" if tgju_dom else "melt-estimate"),
                          "ts": ts, "live": True, "estimated": est_gold}
    if ounce:
        prov["ounce"] = {"source": "gold-api.com", "ts": ts, "live": True}
    if nav:
        prov["navasan"] = {"source": "Navasan", "ts": ts, "live": True, "estimated": False}
    if foreign and foreign.get("pax-gold") is not None:
        prov["paxg"] = {"source": "CoinGecko", "ts": ts, "live": True}

    model = {
        "updatedAt": ts,
        "ounceUsd": ounce,
        "exchanges": exchanges,
        "market": {"usd": usd, "aed": aed, "gold18PerKg": gold18, "shemsh24PerKg": gold24},
        "usdtByExchange": {k: usdt_ex.get(k) for k in USDT_IDS},
        "foreignGold": foreign,
        "sources": prov,
        "estimated": {"usd": est_usd, "gold": est_gold},
        "anyLive": any(r["ok"] and r["value"] for r in results),
    }
    report = [
        {"source": r["source"], "label": r["label"], "ok": r["ok"], "ms": r["ms"],
         "error": r.get("error")}
        for r in sorted(results, key=lambda x: x["source"])
    ]
    return model, report


def merge_model(prev, nxt):
    """Keep last valid value for fields missing in the new fetch."""
    if not prev:
        return nxt

    def pick(a, b):
        return a if b is None else b

    def pair(a, b):
        return b if (b and (b.get("buy") is not None or b.get("sell") is not None)) else a

    market = {k: pair((prev.get("market") or {}).get(k), (nxt.get("market") or {}).get(k))
              for k in ("usd", "aed", "gold18PerKg", "shemsh24PerKg")}
    exchanges = {}
    for i in set(prev.get("exchanges", {})) | set(nxt.get("exchanges", {})):
        pe = (prev.get("exchanges") or {}).get(i, {})
        ne = (nxt.get("exchanges") or {}).get(i, {})
        exchanges[i] = {
            "usdt": pair(pe.get("usdt"), ne.get("usdt")),
            "usd": pair(pe.get("usd"), ne.get("usd")),
            "aed": pair(pe.get("aed"), ne.get("aed")),
            "gold18PerKg": pair(pe.get("gold18PerKg"), ne.get("gold18PerKg")),
            "shemsh24PerKg": pair(pe.get("shemsh24PerKg"), ne.get("shemsh24PerKg")),
            "own": ne.get("own") or pe.get("own") or {},
        }
    usdt_by = {}
    for k in set(prev.get("usdtByExchange", {})) | set(nxt.get("usdtByExchange", {})):
        usdt_by[k] = pair(prev.get("usdtByExchange", {}).get(k),
                          nxt.get("usdtByExchange", {}).get(k))
    fg_p = prev.get("foreignGold") or {}
    fg_n = nxt.get("foreignGold") or {}
    return {
        "updatedAt": nxt.get("updatedAt", prev.get("updatedAt")),
        "ounceUsd": pick(prev.get("ounceUsd"), nxt.get("ounceUsd")),
        "exchanges": exchanges,
        "market": market,
        "usdtByExchange": usdt_by,
        "foreignGold": {"pax-gold": pick(fg_p.get("pax-gold"), fg_n.get("pax-gold")),
                        "tether-gold": pick(fg_p.get("tether-gold"), fg_n.get("tether-gold"))},
        "sources": {**prev.get("sources", {}), **nxt.get("sources", {})},
        "estimated": {"usd": nxt.get("estimated", {}).get("usd", prev.get("estimated", {}).get("usd", False)),
                      "gold": nxt.get("estimated", {}).get("gold", prev.get("estimated", {}).get("gold", False))},
        "anyLive": nxt.get("anyLive") or prev.get("anyLive", False),
    }


# ──────────────────────── history (sqlite) ────────────────────────

def _db():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS price_points ("
        " id INTEGER PRIMARY KEY AUTOINCREMENT,"
        " ts TEXT, source TEXT, exchange TEXT, asset TEXT,"
        " buy REAL, sell REAL, value REAL, estimated INTEGER)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS ix_asset_ex_ts"
        " ON price_points (asset, exchange, ts)"
    )
    return conn


def store_history(model):
    rows = []
    for ex, fields in (model.get("exchanges") or {}).items():
        for fkey, pair in fields.items():
            asset = {"usdt": "usdt", "usd": "usd", "aed": "aed",
                     "gold18PerKg": "gold18", "shemsh24PerKg": "gold24"}.get(fkey)
            if not asset or not pair:
                continue
            rows.append((datetime.now(timezone.utc).isoformat(), "lite", ex, asset,
                         pair.get("buy"), pair.get("sell"), None, 0))
    if model.get("ounceUsd") is not None:
        rows.append((datetime.now(timezone.utc).isoformat(), "lite", None, "ounce",
                     None, None, model["ounceUsd"], 0))
    if not rows:
        return 0
    with _db() as conn:
        conn.executemany(
            "INSERT INTO price_points (ts, source, exchange, asset, buy, sell, value, estimated)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?)", rows)
    return len(rows)


def prune_history(days=HISTORY_DAYS):
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    with _db() as conn:
        conn.execute("DELETE FROM price_points WHERE ts < ?", (cutoff,))


# ──────────────────────── refresher ────────────────────────

class Refresher:
    def __init__(self):
        self.latest = None
        self.updated_at = 0.0
        self.report = None
        self._lock = threading.Lock()
        self._busy = threading.Lock()
        self._stop = threading.Event()
        self._thread = None

    def refresh_once(self):
        if not self._busy.acquire(blocking=False):
            return self.latest
        try:
            model, report = build_model()
            with self._lock:
                self.latest = merge_model(self.latest, model)
                self.updated_at = time.time()
                self.report = report
            try:
                store_history(model)
            except Exception as e:  # noqa: BLE001
                print(f"[lite] history: {e}")
            ok = sum(1 for r in report if r["ok"])
            print(f"[lite] refresh: {ok}/{len(report)} live | "
                  f"ounce={model.get('ounceUsd')} est={model.get('estimated')}")
            return self.latest
        finally:
            self._busy.release()

    def _loop(self):
        next_at = time.time() + REFRESH_SEC
        cycles = 0
        while not self._stop.is_set():
            if self._stop.wait(max(0.0, next_at - time.time())):
                break
            started = time.time()
            try:
                self.refresh_once()
            except Exception as e:  # noqa: BLE001
                print(f"[lite] refresh error: {e}")
            dur = time.time() - started
            wait = (REFRESH_SEC - dur) if dur <= REFRESH_SEC else min(dur, REFRESH_SEC)
            next_at = time.time() + max(0.0, wait)
            cycles += 1
            if cycles % 100 == 0:
                try:
                    prune_history()
                except Exception:  # noqa: BLE001
                    pass

    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()

    def snapshot(self):
        with self._lock:
            return self.latest, self.updated_at, self.report


refresher = Refresher()


# ──────────────────────── HTTP server ────────────────────────

CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2",
    ".ico": "image/x-icon",
    ".png": "image/png",
    ".jpg": "image/jpeg",
}

SPA_ROUTES = {
    "", "market", "usdt", "gold18", "gold24", "usd", "aed", "wallet",
    "sources", "settings", "bubbles", "formulas", "alerts",
    "b24dom", "b24for", "b18dom", "b18for", "baed", "busd",
}

EMPTY_WALLET = {"assets": ["gold18dom", "gold18for", "gold24dom", "gold24for",
                           "usd", "aed", "usdt", "toman"], "connections": []}


def _json_bytes(obj, status=200):
    body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    return status, body


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        sys.stderr.write("[lite] %s - %s\n" % (self.address_string(), fmt % args))

    # -- helpers -----------------------------------------------------------
    def _send(self, status, body, ctype="application/json; charset=utf-8"):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_json(self, obj, status=200):
        self._send(status, json.dumps(obj, ensure_ascii=False).encode("utf-8"))

    def _serve_file(self, path: Path):
        try:
            data = path.read_bytes()
        except OSError:
            self._send(404, b"Not Found", "text/plain; charset=utf-8")
            return
        ctype = CONTENT_TYPES.get(path.suffix.lower(), "application/octet-stream")
        self._send(200, data, ctype)

    # -- routing -----------------------------------------------------------
    def do_GET(self):
        path = urlparse(self.path).path
        if path.startswith("/api/"):
            self.api_get(path)
            return
        self.static(path)

    def do_POST(self):
        self._mutating()

    def do_PATCH(self):
        self._mutating()

    def do_DELETE(self):
        self._mutating()

    def _mutating(self):
        path = urlparse(self.path).path
        if path.startswith("/api/"):
            self._send_json(
                {"detail": "این قابلیت در نسخه‌ی سبک (Lite) غیرفعال است — از نسخه‌ی کامل استفاده کنید."},
                status=501,
            )
        else:
            self._send(404, b"Not Found", "text/plain; charset=utf-8")

    # -- static ------------------------------------------------------------
    def static(self, path: str):
        if path == "/" or path == "":
            self._serve_index()
            return
        rel = path.lstrip("/")
        candidate = (PUBLIC / unquote(rel)).resolve()
        try:
            candidate.relative_to(PUBLIC.resolve())
        except ValueError:
            self._send(404, b"Not Found", "text/plain; charset=utf-8")
            return
        if candidate.is_file():
            self._serve_file(candidate)
            return
        self._serve_index()

    def _serve_index(self):
        if INDEX.is_file():
            self._serve_file(INDEX)
        else:
            self._send(404, b"index.html missing", "text/plain; charset=utf-8")

    # -- api ---------------------------------------------------------------
    def api_get(self, path: str):
        try:
            if path == "/api/prices":
                self.api_prices()
            elif path == "/api/health":
                self.api_health()
            elif path == "/api/version":
                self._send_json({"version": VERSION, "gitSha": GIT_SHA, "buildTime": BUILD_TIME})
            elif path == "/api/debug":
                model, updated, report = refresher.snapshot()
                self._send_json({"lastRefreshAt": updated, "report": report or [],
                                 "cached": model, "version": VERSION, "gitSha": GIT_SHA,
                                 "buildTime": BUILD_TIME})
            elif path == "/api/history":
                self.api_history()
            elif path == "/api/wallet/connections":
                self._send_json(EMPTY_WALLET)
            elif path == "/api/wallet/balances":
                self._send_json({"balances": {}, "byExchange": {}, "connections": [],
                                 "fetchedAt": time.time()})
            elif path == "/api/trade/connectors":
                self._send_json({"connectors": []})
            elif path == "/api/trade/orders":
                self._send_json({"count": 0, "orders": []})
            else:
                self._send_json({"detail": "Not Found"}, status=404)
        except Exception as e:  # noqa: BLE001
            self._send_json({"detail": f"{type(e).__name__}: {e}"}, status=500)

    def api_prices(self):
        model, updated, _ = refresher.snapshot()
        if not model or not (model.get("market") or model.get("exchanges")):
            self._send_json({"error": "no_data",
                             "message": "قیمت‌ها هنوز دریافت نشده‌اند — چند ثانیه دیگر دوباره امتحان کنید.",
                             "version": VERSION, "gitSha": GIT_SHA}, status=503)
            return
        age_ms = int((time.time() - updated) * 1000) if updated else None
        stale = age_ms is not None and age_ms > REFRESH_SEC * 2000
        self._send_json({**model, "stale": stale, "ageMs": age_ms,
                         "version": VERSION, "gitSha": GIT_SHA, "buildTime": BUILD_TIME})

    def api_health(self):
        _, updated, _ = refresher.snapshot()
        self._send_json({
            "ok": True, "version": VERSION, "gitSha": GIT_SHA, "buildTime": BUILD_TIME,
            "refreshSec": REFRESH_SEC,
            "navasanKey": "set" if NAVASAN_KEY else "missing",
            "brsApiKey": "missing",
            "overrides": [], "lastRefreshAt": updated,
            "proxy": bool(os.environ.get("HTTPS_PROXY") or os.environ.get("HTTP_PROXY")),
        })

    def api_history(self):
        q = parse_qs(urlparse(self.path).query)
        asset = (q.get("asset") or ["usd"])[0]
        exchange = (q.get("exchange") or [None])[0]
        limit = min(int((q.get("limit") or ["200"])[0]), 5000)
        try:
            conn = _db()
            if exchange:
                rows = conn.execute(
                    "SELECT ts, source, exchange, buy, sell, value, estimated"
                    " FROM price_points WHERE asset=? AND exchange=?"
                    " ORDER BY ts DESC LIMIT ?", (asset, exchange, limit)).fetchall()
            else:
                rows = conn.execute(
                    "SELECT ts, source, exchange, buy, sell, value, estimated"
                    " FROM price_points WHERE asset=?"
                    " ORDER BY ts DESC LIMIT ?", (asset, limit)).fetchall()
            conn.close()
        except Exception:  # noqa: BLE001
            rows = []
        self._send_json({
            "asset": asset, "exchange": exchange, "count": len(rows),
            "points": [
                {"ts": r[0], "source": r[1], "exchange": r[2], "buy": r[3],
                 "sell": r[4], "value": r[5], "estimated": bool(r[6])}
                for r in rows
            ],
        })


# ─────────────────────────────── main ───────────────────────────────

def main():
    print("=" * 50)
    print("  Gold Market Lite " + VERSION)
    print("  بدون نیاز به نصب هیچ کتابخانه‌ای (فقط Python)")
    print("  آدرس: http://localhost:%d" % PORT)
    print("  (برای توقف: Ctrl+C)" if os.name != "nt" else "  (برای توقف پنجره را ببندید)")
    print("=" * 50)

    try:
        prune_history()
    except Exception:  # noqa: BLE001
        pass
    threading.Thread(target=refresher.refresh_once, daemon=True).start()
    refresher.start()

    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
