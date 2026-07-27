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


def _http_get(url: str, timeout: float = 15.0, retries: int = 2) -> tuple[str, int]:
    """GET raw text with timeout + retry. Honours HTTP(S)_PROXY via trust_env."""
    last: Exception | None = None
    headers = {
        "User-Agent": _UA,
        "Accept": "application/json,text/javascript,text/plain,*/*",
        "Referer": "https://www.navasan.net/",
    }
    # Generous timeouts — IR edges + mtproxier are often slow under parallel load.
    to = httpx.Timeout(timeout, connect=10.0)
    for attempt in range(retries + 1):
        started = time.time()
        try:
            with httpx.Client(timeout=to, trust_env=True, headers=headers) as client:
                r = client.get(url)
            r.raise_for_status()
            return r.text, int((time.time() - started) * 1000)
        except Exception as e:  # noqa: BLE001
            last = e
            if attempt < retries:
                time.sleep(0.4 * (attempt + 1))
    assert last is not None
    raise last


def fetch_json(url: str, timeout: float = 15.0, retries: int = 2) -> tuple[Any, int]:
    """GET JSON with timeout + retry. Honours HTTP(S)_PROXY via trust_env."""
    text, ms = _http_get(url, timeout=timeout, retries=retries)
    try:
        return __import__("json").loads(text), ms
    except Exception:
        # Some edges return JS wrappers; callers that need raw text use fetch_text.
        raise ValueError(f"non-json response ({len(text)} bytes)") from None


def fetch_text(url: str, timeout: float = 15.0, retries: int = 2) -> tuple[str, int]:
    return _http_get(url, timeout=timeout, retries=retries)


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


def map_abantether_ticker(j: dict) -> dict | None:
    """Abantether OTC ticker → USDTIRT buy/sell Toman.

    Shape: { data: { markets: { USDTIRT: { symbol, buy_price, sell_price, ... } } } }
    """
    data = j.get("data") if isinstance(j, dict) else None
    markets = (data or {}).get("markets") if isinstance(data, dict) else None
    if not isinstance(markets, dict):
        markets = j.get("markets") if isinstance(j, dict) else None
    if not isinstance(markets, dict):
        return None
    cur = markets.get("USDTIRT") or markets.get("USDT")
    if not isinstance(cur, dict):
        # fallback: any key that is exactly USDT*IRT
        for k, v in markets.items():
            if str(k).upper() in ("USDTIRT", "USDTTMN", "USDT_IRT") and isinstance(v, dict):
                cur = v
                break
    if not isinstance(cur, dict):
        return None
    buy = _num(cur.get("buy_price") or cur.get("buy") or cur.get("price"))
    sell = _num(cur.get("sell_price") or cur.get("sell") or cur.get("price"))
    return _pair_toman(buy, sell)


def map_gold_api(j: dict) -> float | None:
    return _num(j.get("price"))


def map_goldprice_org(j: dict) -> float | None:
    """Legacy goldprice.org shape (often 403 / rate-limited)."""
    items = j.get("items") or []
    return _num(items[0].get("xauPrice")) if items else None


def map_currency_api_xau(j: dict) -> float | None:
    """fawazahmed0 currency-api: { xau: { usd: <USD per troy oz> } }."""
    xau = j.get("xau") if isinstance(j, dict) else None
    if isinstance(xau, dict):
        return _num(xau.get("usd"))
    return None


def parse_navasan_initrates(text: str) -> dict:
    """Parse www.navasan.net/initrates.php JS payload → rates dict.

    Shape: ``var lastrates = {"usd_sell":{"value":"190,200",...}, ...};``
    """
    import json as _json

    m = re.search(r"var\s+lastrates\s*=\s*(\{)", text)
    if not m:
        # bare JSON object
        t = text.strip()
        if t.startswith("{"):
            return _json.loads(t)
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
        raise ValueError("navasan initrates: unclosed lastrates object")
    return _json.loads(text[start:end])


def map_navasan(j: dict) -> dict:
    """Navasan rates dict → free-market USD/AED/gold (Toman).

    Accepts both api.navasan.tech/latest and parsed initrates.php lastrates.
    Gold 18ayar is Toman/gram; abshodeh is mithqal (not used as per-gram).
    """

    def v(keys: list[str]) -> float | None:
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

    # Prefer street cash (Harat) then generic usd_* keys from initrates.
    usd_buy = v(["harat_naghdi_buy", "usd_buy"])
    usd_sell = v(["harat_naghdi_sell", "harat_naghdi", "usd_sell", "usd"])
    aed = v(["aed_sell", "aed", "dirham_dubai", "derham_dubai"])
    g18 = v(["18ayar", "gold_18", "tala_18ayar"])
    # Do NOT use abshodeh here — that is مثقال, not Toman/gram.
    g24 = v(["24ayar", "gold_24"])
    ounce = v(["ons", "ounce", "gold_ons", "usd_xau"])
    usdt = v(["usd_usdt", "usdt"])
    if g24 is None and g18 is not None:
        g24 = g18 / PURITY_18
    usd = _pair_toman(usd_buy, usd_sell) if (usd_buy or usd_sell) else None
    out = {
        "ounceUsd": ounce,
        "usd": usd,
        "aed": _pair_toman(aed, aed) if aed else None,
        "gold18PerKg": _pair_toman(g18 * GRAMS_PER_KG, g18 * GRAMS_PER_KG) if g18 else None,
        "shemsh24PerKg": _pair_toman(g24 * GRAMS_PER_KG, g24 * GRAMS_PER_KG) if g24 else None,
    }
    if usdt:
        out["usdt"] = _pair_toman(usdt, usdt)
    return out


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
        "abantether": (
            "Abantether USDT",
            "https://api.abantether.com/api/v1/manager/otc/ticker",
            map_abantether_ticker,
        ),
        # Global gold (primary + free CDN backup; goldprice.org is 403/rate-limited)
        "gold_api": ("gold-api.com XAU", "https://api.gold-api.com/price/XAU", map_gold_api),
        "currency_api_xau": (
            "Currency-API XAU",
            "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/xau.json",
            map_currency_api_xau,
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
        # Free Navasan website (no API key) — same source OTC desk uses
        "navasan_web": (
            "Navasan (web)",
            "https://www.navasan.net/initrates.php",
            map_navasan,  # after parse_navasan_initrates in run_source
        ),
        # Optional keyed domestic API
        "navasan": (
            "Navasan API",
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
        if name == "navasan_web":
            text, ms = fetch_text(url, timeout=timeout)
            # cache-bust sometimes helps behind CDN
            if "lastrates" not in text and "?" not in url:
                text, ms = fetch_text(f"{url}?_={int(time.time())}", timeout=timeout)
            j = parse_navasan_initrates(text)
            value = mapper(j)
        else:
            j, ms = fetch_json(url, timeout=timeout)
            value = mapper(j)
        return {
            "source": name,
            "label": label,
            "url": safe,
            "ok": True,
            "ms": ms,
            "value": value,
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

    # Always-on free sources. Free-market (Navasan web + TGJU) first so board
    # has AED/gold even if later USDT venues time out under a slow outbound proxy.
    wanted = [
        "navasan_web",
        "tgju_usd",
        "tgju_aed",
        "tgju_g18",
        "nobitex",
        "wallex",
        "bitpin",
        "tabdeal",
        "exir",
        "ramzinex",
        "tetherland",
        "abantether",
        "gold_api",
        "currency_api_xau",
        "coingecko",
    ]
    if navasan_key:
        wanted.append("navasan")
    if brsapi_key:
        wanted.append("brsapi")

    results: list[dict] = []
    # Under HTTP(S)_PROXY, parallel TLS handshakes commonly stall. Prefer
    # sequential there; light parallelism only on direct egress.
    import os as _os

    proxy_on = bool(
        _os.environ.get("HTTPS_PROXY")
        or _os.environ.get("HTTP_PROXY")
        or _os.environ.get("OUTBOUND_HTTPS_PROXY")
    )
    workers = 1 if proxy_on else min(4, len(wanted))
    if workers == 1:
        for n in wanted:
            results.append(run_source(n, keys, overrides, timeout))
    else:
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
        ("abantether", "abantether"),
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
    elif by.get("currency_api_xau", {}).get("value") is not None:
        ounce, ounce_src = by["currency_api_xau"]["value"], "Currency-API"
    elif foreign and foreign.get("pax-gold") is not None:
        ounce, ounce_src = foreign["pax-gold"], "CoinGecko(PAXG)"
    if ounce is not None:
        prov["ounce"] = {"source": ounce_src, "ts": ts, "live": True}

    # --- domestic free market ---
    # Navasan API (keyed) > Navasan web (initrates, no key) for the «نوسان» box.
    # TGJU (or BrsApi) independently fills «بن‌بست».
    nav_api = by.get("navasan", {}).get("value")
    nav_web = by.get("navasan_web", {}).get("value")
    nav = nav_api or nav_web
    nav_label = (
        "Navasan API"
        if nav_api
        else ("Navasan (web)" if nav_web else None)
    )
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

    # Market aggregate: prefer Navasan, then BrsApi, then TGJU
    if nav:
        dom, dom_name = nav, nav_label or "Navasan"
        est_dom = False
    elif brs:
        dom, dom_name = brs, "BrsApi"
        est_dom = False
    elif tgju_dom:
        dom, dom_name = tgju_dom, "TGJU"
        est_dom = False
    else:
        dom, dom_name = None, None
        est_dom = True

    usd = dom.get("usd") if dom else None
    aed = dom.get("aed") if dom else None
    gold18 = dom.get("gold18PerKg") if dom else None
    gold24 = dom.get("shemsh24PerKg") if dom else None

    if nav:
        prov["navasan"] = {
            "source": nav_label,
            "ts": ts,
            "live": True,
            "estimated": False,
        }
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
    # Crypto venues only quote USDT. Free-market AED/gold (and cash USD when
    # available) are attached as market references so the full panel is filled
    # — UI marks them as shared free-market, not venue-own quotes.
    exchanges: dict = {}
    for ex_id, usdt in usdt_ex.items():
        exchanges[ex_id] = {
            "usdt": usdt,
            # tradeable dollar proxy for this venue
            "usd": usdt,
            "aed": aed,
            "gold18PerKg": gold18,
            "shemsh24PerKg": gold24,
            "own": {
                "usdt": True,
                "usd": False,  # proxy from USDT
                "aed": False,
                "gold": False,
            },
        }

    # «نوسان» box — Navasan web/API (own quotes)
    if nav:
        nav_entry = {
            "usd": nav.get("usd"),
            "aed": nav.get("aed"),
            "gold18PerKg": nav.get("gold18PerKg"),
            "shemsh24PerKg": nav.get("shemsh24PerKg"),
            "own": {
                "usdt": bool(nav.get("usdt")),
                "usd": bool(nav.get("usd")),
                "aed": bool(nav.get("aed")),
                "gold": bool(nav.get("gold18PerKg") or nav.get("shemsh24PerKg")),
            },
        }
        if nav.get("usdt"):
            nav_entry["usdt"] = nav["usdt"]
        exchanges["navasan"] = nav_entry

    # «بن‌بست» box — TGJU free board (or BrsApi when no TGJU)
    bonbast_src = tgju_dom or (brs if brs and not tgju_dom else None)
    if bonbast_src:
        exchanges["bonbast"] = {
            "usd": bonbast_src.get("usd"),
            "aed": bonbast_src.get("aed"),
            "gold18PerKg": bonbast_src.get("gold18PerKg"),
            "shemsh24PerKg": bonbast_src.get("shemsh24PerKg"),
            "own": {
                "usdt": False,
                "usd": bool(bonbast_src.get("usd")),
                "aed": bool(bonbast_src.get("aed")),
                "gold": bool(
                    bonbast_src.get("gold18PerKg") or bonbast_src.get("shemsh24PerKg")
                ),
            },
        }
    elif brs and "bonbast" not in exchanges:
        exchanges["bonbast"] = {
            "usd": brs.get("usd"),
            "aed": brs.get("aed"),
            "gold18PerKg": brs.get("gold18PerKg"),
            "shemsh24PerKg": brs.get("shemsh24PerKg"),
            "own": {
                "usdt": False,
                "usd": bool(brs.get("usd")),
                "aed": bool(brs.get("aed")),
                "gold": bool(brs.get("gold18PerKg") or brs.get("shemsh24PerKg")),
            },
        }

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
        "usdtByExchange": {k: usdt_ex.get(k) for k in usdt_ids},
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
