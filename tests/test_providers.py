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
    map_nobitex_depth, map_wallex_depth, map_navasan, map_gold_api, map_goldprice_org, build_model, GRAMS_PER_KG,
)


# ---------- pure mappers ----------
def test_map_nobitex_depth():
    r = map_nobitex_depth({"bids": [["1583000", 2], ["1582000", 1]], "asks": [["1585000", 1], ["1586000", 3]], "lastTradePrice": "1584000"})
    assert r["buy"] == 158300 and r["sell"] == 158500 and r["latest"] == 158400


def test_map_wallex_depth():
    r = map_wallex_depth({"result": {"bid": [{"price": "157900"}], "ask": [{"price": "158100"}]}})
    assert r["buy"] == 157900 and r["sell"] == 158100


def test_map_navasan():
    m = map_navasan({"harat_naghdi_buy": {"value": "92000"}, "harat_naghdi_sell": {"value": "92300"},
                     "aed": {"value": "25100"}, "18ayar": {"value": "6250000"}, "ons": {"value": "4072"}})
    assert m["usd"]["buy"] == 92000 and m["usd"]["sell"] == 92300
    assert m["aed"]["sell"] == 25100
    assert m["gold18PerKg"]["sell"] == 6250000 * GRAMS_PER_KG
    assert m["ounceUsd"] == 4072
    assert m["shemsh24PerKg"]["sell"] == round((6250000 / 0.75) * GRAMS_PER_KG)


def test_map_gold_api_and_goldprice():
    assert map_gold_api({"price": 4072.5}) == 4072.5
    assert map_goldprice_org({"items": [{"curr": "USD", "xauPrice": 4070.2}]}) == 4070.2


# ---------- build_model with mocked HTTP ----------
def _fake_fetch(url, timeout=8.0, retries=1):
    u = str(url)
    if "navasan" in u:
        return ({"harat_naghdi_buy": {"value": "92000"}, "harat_naghdi_sell": {"value": "92300"},
                 "aed": {"value": "25100"}, "18ayar": {"value": "6250000"}, "ons": {"value": "4072"}}, 5)
    if "nobitex" in u:
        return ({"bids": [["920000", 1]], "asks": [["923000", 1]], "lastTradePrice": "921500"}, 5)
    if "wallex" in u:
        return ({"result": {"bid": [{"price": "92100"}], "ask": [{"price": "92300"}]}}, 5)
    if "gold-api.com" in u:
        return ({"price": 4072}, 5)
    if "goldprice.org" in u:
        return ({"items": [{"xauPrice": 4070}]}, 5)
    if "coingecko" in u:
        return ({"pax-gold": {"usd": 4071}, "tether-gold": {"usd": 4069}}, 5)
    return ({}, 5)


def test_build_model_per_exchange_attribution(monkeypatch):
    monkeypatch.setattr(providers, "fetch_json", _fake_fetch)
    out = build_model(navasan_key="TESTKEY")
    m = out["model"]
    # Navasan -> navasan box only (real, not estimated)
    assert m["exchanges"]["navasan"]["usd"]["sell"] == 92300
    assert m["exchanges"]["navasan"]["gold18PerKg"]["sell"] == 6250000 * GRAMS_PER_KG
    assert m["estimated"]["usd"] is False and m["estimated"]["gold"] is False
    # USDT per exchange only
    assert m["exchanges"]["nobitex"]["usdt"]["sell"] == 92300  # 923000 / 10
    assert m["exchanges"]["wallex"]["usdt"]["sell"] == 92300
    assert "usd" not in m["exchanges"]["nobitex"]  # nobitex has no dollar
    # ounce + foreign gold
    assert m["ounceUsd"] == 4072
    assert m["foreignGold"]["pax-gold"] == 4071


def test_build_model_keyless_gold_fallback(monkeypatch):
    def fake(url, timeout=8.0, retries=1):
        if "gold-api.com" in str(url):
            raise RuntimeError("down")
        return _fake_fetch(url, timeout, retries)
    monkeypatch.setattr(providers, "fetch_json", fake)
    out = build_model(navasan_key="")  # no domestic key -> dollar estimated
    m = out["model"]
    assert m["ounceUsd"] == 4070  # fell back to goldprice.org
    assert m["estimated"]["usd"] is True  # USDT proxy


# ---------- history DB + API endpoints ----------
def test_history_store_and_api(monkeypatch):
    monkeypatch.setattr(providers, "fetch_json", _fake_fetch)
    from fastapi.testclient import TestClient
    from app.main import app  # imports db (sqlite) + refresher

    with TestClient(app) as client:  # lifespan runs: init_db + first refresh (writes history)
        r = client.get("/api/prices")
        assert r.status_code == 200
        body = r.json()
        assert body["exchanges"]["navasan"]["usd"]["sell"] == 92300
        assert "ageMs" in body

        # history for USDT on nobitex
        h = client.get("/api/history", params={"asset": "usdt", "exchange": "nobitex", "limit": 10})
        assert h.status_code == 200
        hist = h.json()
        assert hist["count"] >= 1
        assert hist["points"][0]["sell"] == 92300

        # history for the international ounce (single value)
        ho = client.get("/api/history", params={"asset": "ounce", "limit": 10})
        assert ho.json()["points"][0]["value"] == 4072
