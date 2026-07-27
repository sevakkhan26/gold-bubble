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


def test_map_gold_api_and_goldprice():
    assert map_gold_api({"price": 4072.5}) == 4072.5
    assert map_goldprice_org({"items": [{"curr": "USD", "xauPrice": 4070.2}]}) == 4070.2


def _fake_fetch(url, timeout=8.0, retries=1):
    u = str(url)
    if "navasan" in u:
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
    out = build_model(navasan_key="TESTKEY")
    m = out["model"]
    assert m["exchanges"]["navasan"]["usd"]["sell"] == 92300
    assert m["exchanges"]["nobitex"]["usdt"]["sell"] == 92300
    assert m["exchanges"]["wallex"]["usdt"]["sell"] == 92300
    assert m["exchanges"]["bitpin"]["usdt"]["buy"] == 92050
    assert m["exchanges"]["tabdeal"]["usdt"]["buy"] == 91900
    assert m["exchanges"]["exir"]["usdt"]["latest"] == 92010
    assert m["exchanges"]["ramzinex"]["usdt"]["buy"] == 92010
    assert m["exchanges"]["tetherland"]["usdt"]["buy"] == 91950
    # TGJU also available for bonbast when navasan present
    assert m["ounceUsd"] == 4072
    assert m["estimated"]["usd"] is False


def test_build_model_tgju_without_navasan(monkeypatch):
    monkeypatch.setattr(providers, "fetch_json", _fake_fetch)
    out = build_model(navasan_key="")
    m = out["model"]
    assert m["exchanges"]["bonbast"]["usd"]["sell"] == 92000  # TGJU rial/10
    assert m["exchanges"]["bonbast"]["aed"]["sell"] == 25000
    assert m["estimated"]["usd"] is False  # TGJU is live free-market, not USDT proxy


def test_history_store_and_api(monkeypatch):
    monkeypatch.setattr(providers, "fetch_json", _fake_fetch)
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
