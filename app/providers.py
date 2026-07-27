"""Price providers — keyless-first, Iran-reachable. Python port of the Node version.

Pure mappers (map_*) are separated from I/O so they can be unit-tested without a
network. build_model() never raises: failed sources are omitted and the caller
merges with the last known good value.
"""
from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any

import httpx

GRAMS_PER_KG = 1000
TROY = 31.1035
PURITY_18 = 0.75


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def fetch_json(url: str, timeout: float = 8.0, retries: int = 1) -> tuple[Any, int]:
    """GET JSON with timeout + retry. Returns (json, elapsed_ms)."""
    last = None
    for attempt in range(retries + 1):
        started = time.time()
        try:
            r = httpx.get(url, timeout=timeout, headers={
                "User-Agent": "TraderBot/GoldMarketLive-1.0",
                "Accept": "application/json",
            })
            r.raise_for_status()
            return r.json(), int((time.time() - started) * 1000)
        except Exception as e:  # noqa: BLE001
            last = e
            if attempt < retries:
                time.sleep(0.3 * (attempt + 1))
    raise last  # type: ignore[misc]


# ---------- pure mappers ----------
def _num(x: Any) -> float | None:
    try:
        if isinstance(x, (list, tuple)):
            x = x[0]
        elif isinstance(x, dict) and "price" in x:
            x = x["price"]
        v = float(x)
        return v if v > 0 else None
    except (TypeError, ValueError, IndexError):
        return None


def map_nobitex_depth(j: dict) -> dict | None:
    """Nobitex /v2/depth/USDTIRT -> best bid (buy) / best ask (sell), Rial /10 = Toman."""
    bids = [v for v in (_num(x) for x in (j.get("bids") or [])) if v]
    asks = [v for v in (_num(x) for x in (j.get("asks") or [])) if v]
    last = _num(j.get("lastTradePrice"))
    best_bid = max(bids) if bids else None
    best_ask = min(asks) if asks else None
    if best_bid is None and best_ask is None and last is None:
        return None
    to_t = lambda v: round(v / 10) if v else None  # noqa: E731
    buy, sell, last_t = to_t(best_bid), to_t(best_ask), to_t(last)
    latest = last_t if last_t is not None else (round((buy + sell) / 2) if buy and sell else (buy or sell))
    return {"buy": buy if buy is not None else latest, "sell": sell if sell is not None else latest, "latest": latest}


def map_wallex_depth(j: dict) -> dict | None:
    """Wallex /v1/depth?symbol=USDTTMN -> best bid (buy) / best ask (sell), Toman."""
    res = j.get("result") or {}
    bids = [v for v in (_num(x) for x in (res.get("bid") or [])) if v]
    asks = [v for v in (_num(x) for x in (res.get("ask") or [])) if v]
    best_bid = max(bids) if bids else None
    best_ask = min(asks) if asks else None
    if best_bid is None and best_ask is None:
        return None
    mid = round((best_bid + best_ask) / 2) if best_bid and best_ask else (best_bid or best_ask)
    return {"buy": round(best_bid) if best_bid else None, "sell": round(best_ask) if best_ask else None, "latest": mid}


def map_gold_api(j: dict) -> float | None:
    return _num(j.get("price"))


def map_goldprice_org(j: dict) -> float | None:
    items = j.get("items") or []
    return _num(items[0].get("xauPrice")) if items else None


def map_navasan(j: dict) -> dict:
    """Navasan /latest/ -> free-market USD (harat_naghdi), AED, gold 18k, ounce (Toman)."""
    def v(keys):
        for k in keys:
            o = j.get(k)
            if isinstance(o, dict) and o.get("value") is not None:
                n = _num(o["value"])
                if n:
                    return n
        return None

    usd_buy = v(["harat_naghdi_buy"])
    usd_sell = v(["harat_naghdi_sell", "harat_naghdi", "usd_sell", "usd"])
    aed = v(["aed", "derham_dubai", "aed_sell"])
    g18 = v(["18ayar", "gold_18", "tala_18ayar"])
    g24 = v(["24ayar", "gold_24", "abshodeh"])
    ounce = v(["ons", "ounce", "gold_ons"])
    if g24 is None and g18 is not None:
        g24 = g18 / 0.75
    usd = {"buy": round(usd_buy or usd_sell), "sell": round(usd_sell or usd_buy)} if (usd_buy or usd_sell) else None
    return {
        "ounceUsd": ounce,
        "usd": usd,
        "aed": {"buy": round(aed), "sell": round(aed)} if aed else None,
        "gold18PerKg": {"buy": round(g18 * GRAMS_PER_KG), "sell": round(g18 * GRAMS_PER_KG)} if g18 else None,
        "shemsh24PerKg": {"buy": round(g24 * GRAMS_PER_KG), "sell": round(g24 * GRAMS_PER_KG)} if g24 else None,
    }


_BRS_MATCH = {
    "usd": (["USD"], ["dollar", "دلار"]),
    "aed": (["AED"], ["dirham", "درهم", "امارات"]),
    "gold18": (["IR_GOLD_18K"], ["18 عیار", "۱۸ عیار", "طلای 18", "18 carat"]),
    "gold24": (["IR_GOLD_24K"], ["24 عیار", "۲۴ عیار", "طلای 24", "24 carat"]),
    "ounce": (["XAUUSD", "ONS"], ["ounce", "انس", "اونس"]),
}


def _brs_flatten(j: Any) -> list:
    if isinstance(j, list):
        return j
    out = []
    for k in ("gold", "currency", "cryptocurrency", "data"):
        if isinstance(j.get(k), list):
            out += j[k]
    return out


def _brs_pick(items: list, syms: list, names: list) -> float | None:
    for c in syms:
        for x in items:
            if str(x.get("symbol", "")).lower() == c.lower() and x.get("price") is not None:
                return _num(x["price"])
    for c in names:
        cl = c.lower()
        for x in items:
            hay = " ".join(str(x.get(k, "")) for k in ("symbol", "name", "name_en")).lower()
            if cl in hay and x.get("price") is not None:
                return _num(x["price"])
    return None


def map_brsapi(j: dict) -> dict:
    items = _brs_flatten(j)
    def mid(val):
        return {"buy": round(val), "sell": round(val)} if val else None
    g18 = _brs_pick(items, *_BRS_MATCH["gold18"])
    g24 = _brs_pick(items, *_BRS_MATCH["gold24"])
    return {
        "ounceUsd": _brs_pick(items, *_BRS_MATCH["ounce"]),
        "usd": mid(_brs_pick(items, *_BRS_MATCH["usd"])),
        "aed": mid(_brs_pick(items, *_BRS_MATCH["aed"])),
        "gold18PerKg": mid(g18 * GRAMS_PER_KG) if g18 else None,
        "shemsh24PerKg": mid(g24 * GRAMS_PER_KG) if g24 else None,
    }


# ---------- sources ----------
def _sources(keys: dict) -> dict:
    nav_key = keys.get("navasan", "")
    brs_key = keys.get("brsapi", "")
    return {
        "nobitex": ("Nobitex (depth)", "https://apiv2.nobitex.ir/v2/depth/USDTIRT", map_nobitex_depth),
        "wallex": ("Wallex (depth)", "https://api.wallex.ir/v1/depth?symbol=USDTTMN", map_wallex_depth),
        "gold_api": ("gold-api.com", "https://api.gold-api.com/price/XAU", map_gold_api),
        "goldprice_org": ("goldprice.org", "https://data-asg.goldprice.org/dbXRates/USD", map_goldprice_org),
        "coingecko": ("CoinGecko", "https://api.coingecko.com/api/v3/simple/price?ids=pax-gold,tether-gold&vs_currencies=usd",
                      lambda j: {"pax-gold": (j.get("pax-gold") or {}).get("usd"), "tether-gold": (j.get("tether-gold") or {}).get("usd")}),
        "navasan": ("Navasan (key)", f"https://api.navasan.tech/latest/?api_key={nav_key}", map_navasan),
        "brsapi": ("BrsApi (key)", f"https://BrsApi.ir/Api/Market/Gold_Currency.php?key={brs_key}", map_brsapi),
    }


def run_source(name: str, keys: dict, overrides: dict, timeout: float = 8.0) -> dict:
    label, url, mapper = _sources(keys)[name]
    url = overrides.get(name, url)
    import re
    safe = re.sub(r"(api_key|key)=[^&]+", r"\1=***", url)
    try:
        j, ms = fetch_json(url, timeout=timeout)
        return {"source": name, "label": label, "url": safe, "ok": True, "ms": ms, "value": mapper(j)}
    except Exception as e:  # noqa: BLE001
        return {"source": name, "label": label, "url": safe, "ok": False, "ms": None, "value": None, "error": str(e)}


def build_model(navasan_key: str = "", brsapi_key: str = "", overrides: dict | None = None, timeout: float = 8.0) -> dict:
    """Assemble the normalized model + per-source report. Never raises."""
    overrides = overrides or {}
    keys = {"navasan": navasan_key, "brsapi": brsapi_key}
    wanted = ["nobitex", "wallex", "gold_api", "goldprice_org", "coingecko"]
    if navasan_key:
        wanted.append("navasan")
    if brsapi_key:
        wanted.append("brsapi")
    results = [run_source(n, keys, overrides, timeout) for n in wanted]
    by = {r["source"]: r for r in results}
    ts = _now_iso()
    prov: dict = {}

    nobitex = by.get("nobitex", {}).get("value")
    wallex = by.get("wallex", {}).get("value")
    foreign = by.get("coingecko", {}).get("value")
    nav = by.get("navasan", {}).get("value")
    brs = by.get("brsapi", {}).get("value")
    dom = nav or brs
    dom_name = "Navasan" if nav else ("BrsApi" if brs else None)

    if nobitex:
        prov["usdt_nobitex"] = {"source": "Nobitex", "ts": ts, "live": True}
    if wallex:
        prov["usdt_wallex"] = {"source": "Wallex", "ts": ts, "live": True}
    if foreign and foreign.get("pax-gold") is not None:
        prov["paxg"] = {"source": "CoinGecko", "ts": ts, "live": True}

    # ounce chain
    ounce = ounce_src = None
    if by.get("gold_api", {}).get("value") is not None:
        ounce, ounce_src = by["gold_api"]["value"], "gold-api.com"
    elif by.get("goldprice_org", {}).get("value") is not None:
        ounce, ounce_src = by["goldprice_org"]["value"], "goldprice.org"
    elif dom and dom.get("ounceUsd") is not None:
        ounce, ounce_src = dom["ounceUsd"], dom_name
    elif foreign and foreign.get("pax-gold") is not None:
        ounce, ounce_src = foreign["pax-gold"], "CoinGecko(PAXG)"
    if ounce is not None:
        prov["ounce"] = {"source": ounce_src, "ts": ts, "live": True}

    # dollar: domestic real, else blended USDT proxy (estimated)
    mids = [x["latest"] for x in (wallex, nobitex) if x and x.get("latest")]
    usdt_mid = round(sum(mids) / len(mids)) if mids else None
    usd = dom.get("usd") if dom else None
    if usd:
        prov["usd"] = {"source": dom_name, "ts": ts, "live": True, "estimated": False}
    elif usdt_mid:
        usd = {"buy": usdt_mid, "sell": usdt_mid}
        prov["usd"] = {"source": "USDT-proxy", "ts": ts, "live": False, "estimated": True}

    aed = dom.get("aed") if dom else None
    if aed:
        prov["aed"] = {"source": dom_name, "ts": ts, "live": True, "estimated": False}

    gold18 = dom.get("gold18PerKg") if dom else None
    gold24 = dom.get("shemsh24PerKg") if dom else None
    if gold18:
        prov["gold18"] = {"source": dom_name, "ts": ts, "live": True, "estimated": False}
    if gold24:
        prov["gold24"] = {"source": dom_name, "ts": ts, "live": True, "estimated": False}
    dollar_for_melt = usd["sell"] if usd else None
    if (not gold18 or not gold24) and ounce and dollar_for_melt:
        melt24 = (ounce * dollar_for_melt) / TROY * GRAMS_PER_KG
        if not gold18:
            gold18 = {"buy": round(melt24 * PURITY_18), "sell": round(melt24 * PURITY_18)}
            prov["gold18"] = {"source": "melt-estimate", "ts": ts, "live": False, "estimated": True}
        if not gold24:
            gold24 = {"buy": round(melt24), "sell": round(melt24)}
            prov["gold24"] = {"source": "melt-estimate", "ts": ts, "live": False, "estimated": True}

    # per-exchange attribution (each box shows only its own source)
    exchanges: dict = {}
    if nobitex:
        exchanges["nobitex"] = {"usdt": nobitex}
    if wallex:
        exchanges["wallex"] = {"usdt": wallex}
    dom_id = "navasan" if nav else ("bonbast" if brs else None)
    if dom and dom_id:
        exchanges[dom_id] = {
            **exchanges.get(dom_id, {}),
            "usd": dom.get("usd"), "aed": dom.get("aed"),
            "gold18PerKg": dom.get("gold18PerKg"), "shemsh24PerKg": dom.get("shemsh24PerKg"),
        }

    model = {
        "updatedAt": ts,
        "ounceUsd": ounce,
        "exchanges": exchanges,
        "market": {"usd": usd, "aed": aed, "gold18PerKg": gold18, "shemsh24PerKg": gold24},
        "usdtByExchange": {"nobitex": nobitex, "wallex": wallex},
        "foreignGold": foreign,
        "sources": prov,
        "estimated": {"usd": bool(prov.get("usd", {}).get("estimated")), "gold": bool(prov.get("gold18", {}).get("estimated"))},
        "anyLive": any(r["ok"] and r["value"] for r in results),
    }
    report = [{"source": r["source"], "label": r["label"], "ok": r["ok"], "ms": r["ms"], "error": r.get("error")} for r in results]
    return {"model": model, "report": report}
