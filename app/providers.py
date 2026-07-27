"""Price providers — real public APIs for Iranian desks + global refs.

Pure mappers (map_*) are unit-testable without network. build_model() never
raises: failed sources are omitted and last-good values merge upstream.
"""
from __future__ import annotations

import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any, Callable

import httpx

GRAMS_PER_KG = 1000
TROY = 31.1035
PURITY_18 = 0.75

# User-Agent matters for some IR edges (BrsApi / TGJU).
_UA = (
    "Mozilla/5.0 (compatible; GoldBubble/1.2; +https://github.com/sevakkhan26/gold-bubble)"
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def fetch_json(url: str, timeout: float = 15.0, retries: int = 2) -> tuple[Any, int]:
    """GET JSON with timeout + retry. Honours HTTP(S)_PROXY via trust_env."""
    last: Exception | None = None
    headers = {"User-Agent": _UA, "Accept": "application/json,text/plain,*/*"}
    # Generous timeouts — IR edges + mtproxier are often slow under parallel load.
    to = httpx.Timeout(timeout, connect=10.0)
    for attempt in range(retries + 1):
        started = time.time()
        try:
            with httpx.Client(timeout=to, trust_env=True, headers=headers) as client:
                r = client.get(url)
            r.raise_for_status()
            try:
                return r.json(), int((time.time() - started) * 1000)
            except Exception:
                import json as _json

                return _json.loads(r.text), int((time.time() - started) * 1000)
        except Exception as e:  # noqa: BLE001
            last = e
            if attempt < retries:
                time.sleep(0.4 * (attempt + 1))
    assert last is not None
    raise last


# ---------- pure mappers ----------
def _num(x: Any) -> float | None:
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


def _pair_toman(buy: float | None, sell: float | None, last: float | None = None) -> dict | None:
    if buy is None and sell is None and last is None:
        return None
    b = round(buy) if buy is not None else None
    s = round(sell) if sell is not None else None
    latest = round(last) if last is not None else None
    if latest is None and b is not None and s is not None:
        latest = round((b + s) / 2)
    if latest is None:
        latest = b if b is not None else s
    return {
        "buy": b if b is not None else latest,
        "sell": s if s is not None else latest,
        "latest": latest,
    }


def _book_pair(bids: list, asks: list, *, rial: bool = False) -> dict | None:
    """Best bid = buy, best ask = sell. Optionally convert Rial→Toman (/10)."""
    bv = [v for v in (_num(x) for x in bids) if v]
    av = [v for v in (_num(x) for x in asks) if v]
    best_bid = max(bv) if bv else None
    best_ask = min(av) if av else None
    if rial:
        best_bid = best_bid / 10 if best_bid else None
        best_ask = best_ask / 10 if best_ask else None
    return _pair_toman(best_bid, best_ask)


def map_nobitex_depth(j: dict) -> dict | None:
    """Nobitex depth USDTIRT — prices in Rial."""
    last = _num(j.get("lastTradePrice"))
    pair = _book_pair(j.get("bids") or [], j.get("asks") or [], rial=True)
    if pair is None and last is not None:
        return _pair_toman(last / 10, last / 10, last / 10)
    if pair and last is not None:
        pair["latest"] = round(last / 10)
    return pair


def map_wallex_depth(j: dict) -> dict | None:
    res = j.get("result") or {}
    # bid/ask may be list of {price} or [price, amount]
    bids = res.get("bid") or res.get("bids") or []
    asks = res.get("ask") or res.get("asks") or []
    return _book_pair(bids, asks, rial=False)


def map_bitpin_book(j: dict) -> dict | None:
    """Bitpin USDT_IRT orderbook — Toman."""
    return _book_pair(j.get("bids") or [], j.get("asks") or [], rial=False)


def map_tabdeal_depth(j: dict) -> dict | None:
    """Tabdeal USDTIRT depth — Toman."""
    return _book_pair(j.get("bids") or [], j.get("asks") or [], rial=False)


def map_exir_book(j: dict) -> dict | None:
    """Exir orderbook: { 'usdt-irt': { bids:[[p,q],...], asks:... } } or ticker."""
    book = j.get("usdt-irt") if isinstance(j, dict) else None
    if isinstance(book, dict) and (book.get("bids") or book.get("asks")):
        return _book_pair(book.get("bids") or [], book.get("asks") or [], rial=False)
    # ticker shape
    last = _num(j.get("last") or j.get("close"))
    if last is not None:
        return _pair_toman(last, last, last)
    return None


def map_ramzinex_book(j: dict) -> dict | None:
    """Ramzinex buys_sells — prices in Rial (×10)."""
    data = j.get("data") if isinstance(j, dict) else j
    if not isinstance(data, dict):
        return None
    buys = data.get("buys") or data.get("bids") or []
    sells = data.get("sells") or data.get("asks") or []
    return _book_pair(buys, sells, rial=True)


def map_tetherland(j: dict) -> dict | None:
    """Tetherland currencies → USDT buy/sell Toman."""
    data = j.get("data") if isinstance(j, dict) else None
    cur = None
    if isinstance(data, dict):
        cur = (data.get("currencies") or {}).get("USDT") or data.get("USDT")
    if not isinstance(cur, dict):
        return None
    buy = _num(cur.get("buy_price") or cur.get("price"))
    sell = _num(cur.get("sell_price") or cur.get("price"))
    return _pair_toman(buy, sell)


def map_gold_api(j: dict) -> float | None:
    return _num(j.get("price"))


def map_goldprice_org(j: dict) -> float | None:
    items = j.get("items") or []
    return _num(items[0].get("xauPrice")) if items else None


def map_navasan(j: dict) -> dict:
    """Navasan /latest/ → free-market USD/AED/gold (Toman)."""

    def v(keys: list[str]) -> float | None:
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
    usd = _pair_toman(usd_buy, usd_sell) if (usd_buy or usd_sell) else None
    return {
        "ounceUsd": ounce,
        "usd": usd,
        "aed": _pair_toman(aed, aed) if aed else None,
        "gold18PerKg": _pair_toman(g18 * GRAMS_PER_KG, g18 * GRAMS_PER_KG) if g18 else None,
        "shemsh24PerKg": _pair_toman(g24 * GRAMS_PER_KG, g24 * GRAMS_PER_KG) if g24 else None,
    }


def map_tgju_table(j: dict, *, rial: bool = True) -> float | None:
    """TGJU summary-table first row col0 = last price (often Rial with commas)."""
    rows = j.get("data") if isinstance(j, dict) else None
    if not rows:
        return None
    raw = rows[0][0] if isinstance(rows[0], (list, tuple)) else rows[0]
    n = _num(raw)
    if n is None:
        return None
    return n / 10 if rial else n


def map_tgju_fx_bundle(usd_j: dict, aed_j: dict | None = None, g18_j: dict | None = None) -> dict:
    """Build domestic board from TGJU free-market tables (no API key)."""
    usd_t = map_tgju_table(usd_j, rial=True)
    aed_t = map_tgju_table(aed_j, rial=True) if aed_j else None
    g18_t = map_tgju_table(g18_j, rial=True) if g18_j else None  # per gram Toman
    g24_t = (g18_t / PURITY_18) if g18_t else None
    return {
        "usd": _pair_toman(usd_t, usd_t) if usd_t else None,
        "aed": _pair_toman(aed_t, aed_t) if aed_t else None,
        "gold18PerKg": _pair_toman(g18_t * GRAMS_PER_KG, g18_t * GRAMS_PER_KG) if g18_t else None,
        "shemsh24PerKg": _pair_toman(g24_t * GRAMS_PER_KG, g24_t * GRAMS_PER_KG) if g24_t else None,
        "ounceUsd": None,
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

    def mid(val: float | None) -> dict | None:
        return _pair_toman(val, val) if val else None

    g18 = _brs_pick(items, *_BRS_MATCH["gold18"])
    g24 = _brs_pick(items, *_BRS_MATCH["gold24"])
    return {
        "ounceUsd": _brs_pick(items, *_BRS_MATCH["ounce"]),
        "usd": mid(_brs_pick(items, *_BRS_MATCH["usd"])),
        "aed": mid(_brs_pick(items, *_BRS_MATCH["aed"])),
        "gold18PerKg": mid(g18 * GRAMS_PER_KG) if g18 else None,
        "shemsh24PerKg": mid(g24 * GRAMS_PER_KG) if g24 else None,
    }


# ---------- source registry ----------
SourceSpec = tuple[str, str, Callable[[Any], Any]]


def _sources(keys: dict) -> dict[str, SourceSpec]:
    nav_key = keys.get("navasan", "")
    brs_key = keys.get("brsapi", "")
    return {
        # USDT order books / OTC quotes
        "nobitex": (
            "Nobitex USDT",
            "https://apiv2.nobitex.ir/v2/depth/USDTIRT",
            map_nobitex_depth,
        ),
        "wallex": (
            "Wallex USDT",
            "https://api.wallex.ir/v1/depth?symbol=USDTTMN",
            map_wallex_depth,
        ),
        "bitpin": (
            "Bitpin USDT",
            "https://api.bitpin.ir/api/v1/mth/orderbook/USDT_IRT/",
            map_bitpin_book,
        ),
        "tabdeal": (
            "Tabdeal USDT",
            "https://api1.tabdeal.org/r/api/v1/depth?symbol=USDTIRT&limit=20",
            map_tabdeal_depth,
        ),
        "exir": (
            "Exir USDT",
            "https://api.exir.io/v2/ticker?symbol=usdt-irt",
            map_exir_book,
        ),
        "ramzinex": (
            "Ramzinex USDT",
            "https://publicapi.ramzinex.com/exchange/api/v1.0/exchange/orderbooks/11/buys_sells",
            map_ramzinex_book,
        ),
        "tetherland": (
            "Tetherland USDT",
            "https://api.tetherland.com/currencies",
            map_tetherland,
        ),
        # Global gold
        "gold_api": ("gold-api.com XAU", "https://api.gold-api.com/price/XAU", map_gold_api),
        "goldprice_org": (
            "goldprice.org XAU",
            "https://data-asg.goldprice.org/dbXRates/USD",
            map_goldprice_org,
        ),
        "coingecko": (
            "CoinGecko PAXG/XAUT",
            "https://api.coingecko.com/api/v3/simple/price?ids=pax-gold,tether-gold&vs_currencies=usd",
            lambda j: {
                "pax-gold": (j.get("pax-gold") or {}).get("usd"),
                "tether-gold": (j.get("tether-gold") or {}).get("usd"),
            },
        ),
        # Free-market FX/gold (no key) — fills بن‌بست board
        "tgju_usd": (
            "TGJU dollar",
            "https://api.tgju.org/v1/market/indicator/summary-table-data/price_dollar_rl",
            lambda j: map_tgju_table(j, rial=True),
        ),
        "tgju_aed": (
            "TGJU AED",
            "https://api.tgju.org/v1/market/indicator/summary-table-data/price_aed",
            lambda j: map_tgju_table(j, rial=True),
        ),
        "tgju_g18": (
            "TGJU gold 18k",
            "https://api.tgju.org/v1/market/indicator/summary-table-data/geram18",
            lambda j: map_tgju_table(j, rial=True),
        ),
        # Optional keyed domestic
        "navasan": (
            "Navasan",
            f"https://api.navasan.tech/latest/?api_key={nav_key}",
            map_navasan,
        ),
        "brsapi": (
            "BrsApi",
            f"https://BrsApi.ir/Api/Market/Gold_Currency.php?key={brs_key}",
            map_brsapi,
        ),
    }


def run_source(name: str, keys: dict, overrides: dict, timeout: float = 10.0) -> dict:
    label, url, mapper = _sources(keys)[name]
    url = overrides.get(name, url)
    safe = re.sub(r"(api_key|key)=[^&]+", r"\1=***", url)
    try:
        j, ms = fetch_json(url, timeout=timeout)
        return {
            "source": name,
            "label": label,
            "url": safe,
            "ok": True,
            "ms": ms,
            "value": mapper(j),
        }
    except Exception as e:  # noqa: BLE001
        return {
            "source": name,
            "label": label,
            "url": safe,
            "ok": False,
            "ms": None,
            "value": None,
            "error": str(e),
        }


def build_model(
    navasan_key: str = "",
    brsapi_key: str = "",
    overrides: dict | None = None,
    timeout: float = 10.0,
) -> dict:
    """Assemble normalized model + per-source report. Never raises."""
    overrides = overrides or {}
    keys = {"navasan": navasan_key, "brsapi": brsapi_key}

    # Always-on free sources
    wanted = [
        "nobitex",
        "wallex",
        "bitpin",
        "tabdeal",
        "exir",
        "ramzinex",
        "tetherland",
        "gold_api",
        "goldprice_org",
        "coingecko",
        "tgju_usd",
        "tgju_aed",
        "tgju_g18",
    ]
    if navasan_key:
        wanted.append("navasan")
    if brsapi_key:
        wanted.append("brsapi")

    results: list[dict] = []
    # Modest parallelism — too many concurrent TLS handshakes through the
    # outbound proxy causes widespread timeouts on this host.
    workers = min(4, len(wanted))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futs = {
            pool.submit(run_source, n, keys, overrides, timeout): n for n in wanted
        }
        for fut in as_completed(futs):
            results.append(fut.result())

    by = {r["source"]: r for r in results}
    ts = _now_iso()
    prov: dict = {}

    # --- USDT by exchange ---
    usdt_ex: dict[str, dict] = {}
    for ex_id, src_id in [
        ("nobitex", "nobitex"),
        ("wallex", "wallex"),
        ("bitpin", "bitpin"),
        ("tabdeal", "tabdeal"),
        ("exir", "exir"),
        ("ramzinex", "ramzinex"),
        ("tetherland", "tetherland"),
    ]:
        val = by.get(src_id, {}).get("value")
        if val:
            usdt_ex[ex_id] = val
            prov[f"usdt_{ex_id}"] = {
                "source": by[src_id]["label"],
                "ts": ts,
                "live": True,
            }

    foreign = by.get("coingecko", {}).get("value")
    if foreign and foreign.get("pax-gold") is not None:
        prov["paxg"] = {"source": "CoinGecko", "ts": ts, "live": True}

    # --- ounce ---
    ounce = ounce_src = None
    if by.get("gold_api", {}).get("value") is not None:
        ounce, ounce_src = by["gold_api"]["value"], "gold-api.com"
    elif by.get("goldprice_org", {}).get("value") is not None:
        ounce, ounce_src = by["goldprice_org"]["value"], "goldprice.org"
    elif foreign and foreign.get("pax-gold") is not None:
        ounce, ounce_src = foreign["pax-gold"], "CoinGecko(PAXG)"
    if ounce is not None:
        prov["ounce"] = {"source": ounce_src, "ts": ts, "live": True}

    # --- domestic: Navasan (key) > BrsApi (key) > TGJU free board ---
    nav = by.get("navasan", {}).get("value")
    brs = by.get("brsapi", {}).get("value")
    tgju_usd = by.get("tgju_usd", {}).get("value")
    tgju_aed = by.get("tgju_aed", {}).get("value")
    tgju_g18 = by.get("tgju_g18", {}).get("value")
    tgju_dom = None
    if tgju_usd or tgju_aed or tgju_g18:
        g18_pair = (
            _pair_toman(tgju_g18 * GRAMS_PER_KG, tgju_g18 * GRAMS_PER_KG)
            if tgju_g18
            else None
        )
        g24_pair = None
        if tgju_g18:
            g24 = tgju_g18 / PURITY_18
            g24_pair = _pair_toman(g24 * GRAMS_PER_KG, g24 * GRAMS_PER_KG)
        tgju_dom = {
            "usd": _pair_toman(tgju_usd, tgju_usd) if tgju_usd else None,
            "aed": _pair_toman(tgju_aed, tgju_aed) if tgju_aed else None,
            "gold18PerKg": g18_pair,
            "shemsh24PerKg": g24_pair,
            "ounceUsd": None,
        }

    if nav:
        dom, dom_name, dom_id = nav, "Navasan", "navasan"
        est_dom = False
    elif brs:
        dom, dom_name, dom_id = brs, "BrsApi", "bonbast"
        est_dom = False
    elif tgju_dom:
        dom, dom_name, dom_id = tgju_dom, "TGJU", "bonbast"
        est_dom = False
    else:
        dom, dom_name, dom_id = None, None, None
        est_dom = True

    usd = dom.get("usd") if dom else None
    aed = dom.get("aed") if dom else None
    gold18 = dom.get("gold18PerKg") if dom else None
    gold24 = dom.get("shemsh24PerKg") if dom else None

    if usd:
        prov["usd"] = {
            "source": dom_name,
            "ts": ts,
            "live": True,
            "estimated": False,
        }
    else:
        # fallback: median USDT as dollar proxy (still mark estimated)
        mids = [x["latest"] for x in usdt_ex.values() if x and x.get("latest")]
        if mids:
            mid = round(sum(mids) / len(mids))
            usd = _pair_toman(mid, mid)
            prov["usd"] = {
                "source": "USDT-proxy",
                "ts": ts,
                "live": False,
                "estimated": True,
            }

    if aed:
        prov["aed"] = {
            "source": dom_name,
            "ts": ts,
            "live": True,
            "estimated": False,
        }
    if gold18:
        prov["gold18"] = {
            "source": dom_name,
            "ts": ts,
            "live": True,
            "estimated": False,
        }
    if gold24:
        prov["gold24"] = {
            "source": dom_name,
            "ts": ts,
            "live": True,
            "estimated": False,
        }

    # melt fallback only if still missing gold
    dollar_for_melt = usd["sell"] if usd else None
    if (not gold18 or not gold24) and ounce and dollar_for_melt:
        melt24 = (ounce * dollar_for_melt) / TROY * GRAMS_PER_KG
        if not gold18:
            gold18 = _pair_toman(melt24 * PURITY_18, melt24 * PURITY_18)
            prov["gold18"] = {
                "source": "melt-estimate",
                "ts": ts,
                "live": False,
                "estimated": True,
            }
        if not gold24:
            gold24 = _pair_toman(melt24, melt24)
            prov["gold24"] = {
                "source": "melt-estimate",
                "ts": ts,
                "live": False,
                "estimated": True,
            }

    # --- per-exchange board ---
    exchanges: dict = {}
    for ex_id, usdt in usdt_ex.items():
        # USDT mid is the desk's tradeable "dollar proxy" — expose as usd too
        # so bubble/market tables can compute without mock data.
        exchanges[ex_id] = {"usdt": usdt, "usd": usdt}

    if dom and dom_id:
        exchanges[dom_id] = {
            **exchanges.get(dom_id, {}),
            "usd": dom.get("usd"),
            "aed": dom.get("aed"),
            "gold18PerKg": dom.get("gold18PerKg"),
            "shemsh24PerKg": dom.get("shemsh24PerKg"),
        }

    # If TGJU filled bonbast but Navasan key also present, keep both boxes.
    if nav and tgju_dom and "bonbast" not in exchanges:
        exchanges["bonbast"] = {
            "usd": tgju_dom.get("usd"),
            "aed": tgju_dom.get("aed"),
            "gold18PerKg": tgju_dom.get("gold18PerKg"),
            "shemsh24PerKg": tgju_dom.get("shemsh24PerKg"),
        }

    # Only fill empty "navasan" with aggregate when no free-market box exists yet
    # (avoid duplicating TGJU data into both بن‌بست and نوسان).
    if (
        "navasan" not in exchanges
        and "bonbast" not in exchanges
        and (usd or gold18 or gold24 or aed)
    ):
        exchanges["navasan"] = {
            "usd": usd,
            "aed": aed,
            "gold18PerKg": gold18,
            "shemsh24PerKg": gold24,
        }

    model = {
        "updatedAt": ts,
        "ounceUsd": ounce,
        "exchanges": exchanges,
        "market": {
            "usd": usd,
            "aed": aed,
            "gold18PerKg": gold18,
            "shemsh24PerKg": gold24,
        },
        "usdtByExchange": {
            k: usdt_ex.get(k) for k in ("nobitex", "wallex", "bitpin", "tabdeal", "exir", "ramzinex", "tetherland")
        },
        "foreignGold": foreign,
        "sources": prov,
        "estimated": {
            "usd": bool(prov.get("usd", {}).get("estimated")),
            "gold": bool(prov.get("gold18", {}).get("estimated")),
        },
        "anyLive": any(r["ok"] and r["value"] for r in results),
    }
    report = [
        {
            "source": r["source"],
            "label": r["label"],
            "ok": r["ok"],
            "ms": r["ms"],
            "error": r.get("error"),
        }
        for r in sorted(results, key=lambda x: x["source"])
    ]
    return {"model": model, "report": report}
