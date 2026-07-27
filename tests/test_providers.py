import os
import tempfile

# Use a throwaway SQLite DB BEFORE importing app modules (config reads env at import).
_DBFILE = os.path.join(tempfile.gettempdir(), "gm_test.db")
if os.path.exists(_DBFILE):
    os.remove(_DBFILE)
os.environ["DATABASE_URL"] = f"sqlite:///{_DBFILE}"
os.environ["NAVASAN_API_KEY"] = "TESTKEY"

from app import providers  # noqa: E402
from app.providers import (  # noqa: E402
    GRAMS_PER_KG,
    build_model,
    map_abantether_ticker,
    map_bitpin_book,
    map_gold_api,
    map_goldprice_org,
    map_navasan,
    map_nobitex_depth,
    map_ramzinex_book,
    map_tabdeal_depth,
    map_tetherland,
    map_tgju_table,
    map_wallex_depth,
    parse_navasan_initrates,
)


def test_map_nobitex_depth():
    r = map_nobitex_depth(
        {
            "bids": [["1583000", 2], ["1582000", 1]],
            "asks": [["1585000", 1], ["1586000", 3]],
            "lastTradePrice": "1584000",
        }
    )
    assert r["buy"] == 158300 and r["sell"] == 158500 and r["latest"] == 158400


def test_map_wallex_depth():
    r = map_wallex_depth({"result": {"bid": [{"price": "157900"}], "ask": [{"price": "158100"}]}})
    assert r["buy"] == 157900 and r["sell"] == 158100


def test_map_bitpin_tabdeal_toman():
    b = map_bitpin_book({"bids": [["190100", "1"]], "asks": [["190200", "2"]]})
    assert b["buy"] == 190100 and b["sell"] == 190200
    t = map_tabdeal_depth({"bids": [["189900", "1"]], "asks": [["190000", "1"]]})
    assert t["buy"] == 189900 and t["sell"] == 190000


def test_map_ramzinex_rial():
    r = map_ramzinex_book({"data": {"buys": [[1901000, 1]], "sells": [[1902000, 1]]}})
    assert r["buy"] == 190100 and r["sell"] == 190200


def test_map_tetherland():
    r = map_tetherland(
        {"status": 200, "data": {"currencies": {"USDT": {"buy_price": 190000, "sell_price": 190100}}}}
    )
    assert r["buy"] == 190000 and r["sell"] == 190100


def test_map_abantether_ticker():
    r = map_abantether_ticker(
        {
            "data": {
                "markets": {
                    "BTCIRT": {"symbol": "BTC", "buy_price": "1", "sell_price": "1"},
                    "USDTIRT": {
                        "symbol": "USDT",
                        "buy_price": "190877",
                        "sell_price": "189444",
                    },
                }
            }
        }
    )
    assert r["buy"] == 190877 and r["sell"] == 189444


def test_map_tgju_table():
    assert map_tgju_table({"data": [["1,900,000", "x"]]}, rial=True) == 190000


def test_map_navasan():
    m = map_navasan(
        {
            "harat_naghdi_buy": {"value": "92000"},
            "harat_naghdi_sell": {"value": "92300"},
            "aed": {"value": "25100"},
            "18ayar": {"value": "6250000"},
            "ons": {"value": "4072"},
        }
    )
    assert m["usd"]["buy"] == 92000 and m["usd"]["sell"] == 92300
    assert m["aed"]["sell"] == 25100
    assert m["gold18PerKg"]["sell"] == 6250000 * GRAMS_PER_KG
    assert m["ounceUsd"] == 4072
    assert m["shemsh24PerKg"]["sell"] == round((6250000 / 0.75) * GRAMS_PER_KG)


def test_parse_navasan_initrates():
    text = (
        'var lastrates = {"harat_naghdi_buy":{"value":"187,900","date":1},'
        '"harat_naghdi_sell":{"value":"188,300","date":1},'
        '"18ayar":{"value":"18,414,980","date":1},'
        '"aed_sell":{"value":"52,200","date":1},'
        '"usd_usdt":{"value":"190,500","date":1}};'
        'var yesterday = {"usd":{"value":1}};'
    )
    rates = parse_navasan_initrates(text)
    m = map_navasan(rates)
    assert m["usd"]["buy"] == 187900 and m["usd"]["sell"] == 188300
    assert m["aed"]["sell"] == 52200
    assert m["gold18PerKg"]["sell"] == 18414980 * GRAMS_PER_KG
    assert m["usdt"]["sell"] == 190500


def test_map_gold_api_and_goldprice():
    assert map_gold_api({"price": 4072.5}) == 4072.5
    assert map_goldprice_org({"items": [{"curr": "USD", "xauPrice": 4070.2}]}) == 4070.2


def _fake_text(url, timeout=8.0, retries=1):
    u = str(url)
    if "navasan.net" in u or "initrates" in u:
        return (
            'var lastrates = {"harat_naghdi_buy":{"value":"187900"},'
            '"harat_naghdi_sell":{"value":"188300"},'
            '"aed_sell":{"value":"52200"},'
            '"18ayar":{"value":"18414980"},'
            '"usd_usdt":{"value":"190500"}};'
            "var yesterday = {};",
            5,
        )
    return ("{}", 5)


def _fake_fetch(url, timeout=8.0, retries=1):
    u = str(url)
    if "navasan" in u and "navasan.net" not in u:
        return (
            {
                "harat_naghdi_buy": {"value": "92000"},
                "harat_naghdi_sell": {"value": "92300"},
                "aed": {"value": "25100"},
                "18ayar": {"value": "6250000"},
                "ons": {"value": "4072"},
            },
            5,
        )
    if "nobitex" in u:
        return ({"bids": [["920000", 1]], "asks": [["923000", 1]], "lastTradePrice": "921500"}, 5)
    if "wallex" in u:
        return ({"result": {"bid": [{"price": "92100"}], "ask": [{"price": "92300"}]}}, 5)
    if "bitpin" in u:
        return ({"bids": [["92050", "1"]], "asks": [["92150", "1"]]}, 5)
    if "tabdeal" in u:
        return ({"bids": [["91900", "1"]], "asks": [["92000", "1"]]}, 5)
    if "exir" in u:
        return ({"last": 92010, "close": 92010, "symbol": "usdt-irt"}, 5)
    if "ramzinex" in u:
        return ({"data": {"buys": [[920100, 1]], "sells": [[921000, 1]]}}, 5)
    if "tetherland" in u:
        return (
            {"data": {"currencies": {"USDT": {"buy_price": 91950, "sell_price": 92050}}}},
            5,
        )
    if "abantether" in u:
        return (
            {
                "data": {
                    "markets": {
                        "USDTIRT": {
                            "symbol": "USDT",
                            "buy_price": "91980",
                            "sell_price": "92080",
                        }
                    }
                }
            },
            5,
        )
    if "price_dollar_rl" in u:
        return ({"data": [["920,000", "x"]]}, 5)
    if "price_aed" in u:
        return ({"data": [["250,000", "x"]]}, 5)
    if "geram18" in u:
        return ({"data": [["6,250,000", "x"]]}, 5)
    if "gold-api.com" in u:
        return ({"price": 4072}, 5)
    if "goldprice.org" in u:
        return ({"items": [{"xauPrice": 4070}]}, 5)
    if "coingecko" in u:
        return ({"pax-gold": {"usd": 4071}, "tether-gold": {"usd": 4069}}, 5)
    return ({}, 5)


def test_build_model_multi_exchange_usdt(monkeypatch):
    monkeypatch.setattr(providers, "fetch_json", _fake_fetch)
    monkeypatch.setattr(providers, "fetch_text", _fake_text)
    out = build_model(navasan_key="TESTKEY")
    m = out["model"]
    # API key wins over web for نوسان box
    assert m["exchanges"]["navasan"]["usd"]["sell"] == 92300
    assert m["exchanges"]["nobitex"]["usdt"]["sell"] == 92300
    assert m["exchanges"]["wallex"]["usdt"]["sell"] == 92300
    assert m["exchanges"]["bitpin"]["usdt"]["buy"] == 92050
    assert m["exchanges"]["tabdeal"]["usdt"]["buy"] == 91900
    assert m["exchanges"]["exir"]["usdt"]["latest"] == 92010
    assert m["exchanges"]["ramzinex"]["usdt"]["buy"] == 92010
    assert m["exchanges"]["tetherland"]["usdt"]["buy"] == 91950
    assert m["exchanges"]["abantether"]["usdt"]["buy"] == 91980
    # USDT also exposed as usd proxy for bubble math
    assert m["exchanges"]["nobitex"]["usd"]["sell"] == 92300
    # Free-market AED/gold filled onto USDT venues so the board is complete
    assert m["exchanges"]["nobitex"]["aed"]["sell"] == 25100
    assert m["exchanges"]["nobitex"]["gold18PerKg"]["sell"] == 6250000 * GRAMS_PER_KG
    assert m["exchanges"]["nobitex"]["own"]["gold"] is False
    assert m["exchanges"]["nobitex"]["own"]["usdt"] is True
    # TGJU fills بن‌بست alongside Navasan
    assert m["exchanges"]["bonbast"]["usd"]["sell"] == 92000
    assert m["ounceUsd"] == 4072
    assert m["estimated"]["usd"] is False


def test_build_model_navasan_web_without_key(monkeypatch):
    monkeypatch.setattr(providers, "fetch_json", _fake_fetch)
    monkeypatch.setattr(providers, "fetch_text", _fake_text)
    out = build_model(navasan_key="")
    m = out["model"]
    # No API key → free initrates.php still fills نوسان
    assert m["exchanges"]["navasan"]["usd"]["sell"] == 188300
    assert m["exchanges"]["navasan"]["aed"]["sell"] == 52200
    assert m["exchanges"]["navasan"]["usdt"]["sell"] == 190500
    assert m["exchanges"]["bonbast"]["usd"]["sell"] == 92000  # TGJU rial/10
    assert m["exchanges"]["bonbast"]["aed"]["sell"] == 25000
    assert m["estimated"]["usd"] is False
    # USDT venues get free-market AED/gold attached (from Navasan aggregate)
    assert m["exchanges"]["wallex"]["aed"]["sell"] == 52200
    assert m["exchanges"]["wallex"]["own"]["aed"] is False


def test_history_store_and_api(monkeypatch):
    monkeypatch.setattr(providers, "fetch_json", _fake_fetch)
    monkeypatch.setattr(providers, "fetch_text", _fake_text)
    from fastapi.testclient import TestClient
    from app.main import app

    with TestClient(app) as client:
        r = client.get("/api/prices")
        assert r.status_code == 200
        body = r.json()
        assert body["exchanges"]["navasan"]["usd"]["sell"] == 92300
        assert body["exchanges"]["bitpin"]["usdt"]["buy"] == 92050
        assert "ageMs" in body
        assert "version" in body

        h = client.get("/api/history", params={"asset": "usdt", "exchange": "nobitex", "limit": 10})
        assert h.status_code == 200
        assert h.json()["count"] >= 1
