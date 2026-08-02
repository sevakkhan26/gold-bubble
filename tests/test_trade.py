import os
import tempfile

# Throwaway SQLite DB BEFORE importing app modules (config reads env at import).
_DBFILE = os.path.join(tempfile.gettempdir(), "gm_trade_test.db")
if os.path.exists(_DBFILE):
    os.remove(_DBFILE)
os.environ["DATABASE_URL"] = f"sqlite:///{_DBFILE}"

import pytest  # noqa: E402

from app import trade, wallet  # noqa: E402


class FakeConnector:
    def __init__(self, **kw):
        self.id = kw.get("id", 1)
        self.label = kw.get("label", "test")
        self.exchange = kw.get("exchange", "nobitex")
        self.asset = kw.get("asset", "gold18dom")
        self.enabled = kw.get("enabled", True)
        self.dry_run = kw.get("dry_run", True)
        self.method = kw.get("method", "POST")
        self.url = kw.get("url", "https://api.test/orders")
        self.headers_json = kw.get("headers_json", "{}")
        self.body_template = kw.get("body_template", "")
        self.buy_value = kw.get("buy_value", "buy")
        self.sell_value = kw.get("sell_value", "sell")


# ------------------------------------------------------------------ templates


def test_format_number_drops_trailing_zero():
    assert trade.format_number(10.0) == "10"
    assert trade.format_number(2.5) == "2.5"


def test_render_template_fills_placeholders():
    out = trade.render_template(
        '{"side":"{{side}}","amount":{{qty}},"price":{{ price }}}',
        {"side": "buy", "qty": 2.5, "price": 18000000},
    )
    assert out == '{"side":"buy","amount":2.5,"price":18000000}'


def test_render_template_missing_value_raises():
    with pytest.raises(ValueError) as e:
        trade.render_template("price={{price}}", {"price": None})
    assert "price" in str(e.value)


def test_side_value_uses_connector_mapping():
    conn = FakeConnector(buy_value="BUY", sell_value="SELL")
    assert trade.side_value(conn, "buy") == "BUY"
    assert trade.side_value(conn, "sell") == "SELL"
    with pytest.raises(ValueError):
        trade.side_value(conn, "hold")


def test_build_request_renders_url_and_body():
    conn = FakeConnector(
        url="https://api.test/{{exchange}}/order",
        body_template='{"symbol":"GOLD18","side":"{{side}}","qty":{{qty}},"total":{{total}}}',
    )
    req = trade.build_request(conn, side="sell", qty=3, price=1000)
    assert req["url"] == "https://api.test/nobitex/order"
    assert req["body"] == '{"symbol":"GOLD18","side":"sell","qty":3,"total":3000}'
    assert req["method"] == "POST"


def test_build_request_matches_wallex_order_body():
    """POST https://api.wallex.ir/v1/account/orders — the shape the preset sends."""
    conn = FakeConnector(
        exchange="wallex",
        asset="usdt",
        url="https://api.wallex.ir/v1/account/orders",
        body_template=(
            '{"symbol":"USDTTMN","type":"LIMIT","side":"{{side}}",'
            '"price":"{{price}}","quantity":"{{qty}}"}'
        ),
        buy_value="BUY",
        sell_value="SELL",
    )
    req = trade.build_request(conn, side="sell", qty=12.5, price=121000)
    assert req["url"] == "https://api.wallex.ir/v1/account/orders"
    assert req["body"] == (
        '{"symbol":"USDTTMN","type":"LIMIT","side":"SELL","price":"121000","quantity":"12.5"}'
    )
    # Wallex wants price/quantity as JSON strings — the template quotes them.
    import json

    parsed = json.loads(req["body"])
    assert parsed["side"] == "SELL" and parsed["quantity"] == "12.5"


def test_build_request_rejects_non_positive_qty():
    with pytest.raises(ValueError):
        trade.build_request(FakeConnector(), side="buy", qty=0, price=1)


# ------------------------------------------------------------------ sending


def test_send_order_dry_run_does_not_transmit(monkeypatch):
    def explode(*a, **kw):
        raise AssertionError("dry run must not open a connection")

    monkeypatch.setattr(trade.httpx, "Client", explode)
    out = trade.send_order(FakeConnector(dry_run=True), side="buy", qty=1, price=5)
    assert out["status"] == "dry" and out["request"]["url"] == "https://api.test/orders"


def test_send_order_posts_when_armed(monkeypatch):
    seen = {}

    class FakeResp:
        status_code = 201
        text = '{"orderId": 77}'

    class FakeClient:
        def __init__(self, *a, **kw):
            seen["headers"] = kw.get("headers")

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def request(self, method, url, content=None):
            seen["method"], seen["url"], seen["content"] = method, url, content
            return FakeResp()

    monkeypatch.setattr(trade.httpx, "Client", FakeClient)
    conn = FakeConnector(
        dry_run=False,
        headers_json='{"Authorization": "Token abc"}',
        body_template='{"side":"{{side}}","qty":{{qty}}}',
    )
    out = trade.send_order(conn, side="buy", qty=2, price=None)
    assert out["status"] == "sent" and out["httpStatus"] == 201
    assert seen["method"] == "POST"
    assert seen["content"] == b'{"side":"buy","qty":2}'
    assert seen["headers"]["Authorization"] == "Token abc"


def test_send_order_marks_http_error_as_failed(monkeypatch):
    class FakeResp:
        status_code = 403
        text = "forbidden"

    class FakeClient:
        def __init__(self, *a, **kw):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def request(self, *a, **kw):
            return FakeResp()

    monkeypatch.setattr(trade.httpx, "Client", FakeClient)
    out = trade.send_order(FakeConnector(dry_run=False), side="sell", qty=1, price=None)
    assert out["status"] == "failed" and out["httpStatus"] == 403


def test_send_order_survives_network_error(monkeypatch):
    class Boom:
        def __init__(self, *a, **kw):
            raise RuntimeError("no route to host")

    monkeypatch.setattr(trade.httpx, "Client", Boom)
    out = trade.send_order(FakeConnector(dry_run=False), side="buy", qty=1, price=None)
    assert out["status"] == "failed" and "no route to host" in out["error"]


# ------------------------------------------------------------------ HTTP API


def _client():
    from fastapi.testclient import TestClient

    from app.main import app

    return TestClient(app)


def _make_connector(client, **overrides):
    payload = {
        "label": "نوبیتکس — طلای ۱۸",
        "exchange": "nobitex",
        "asset": "gold18dom",
        "url": "https://api.test/orders",
        "method": "POST",
        "headers": {"Authorization": "Token trade-secret"},
        "bodyTemplate": '{"side":"{{side}}","qty":{{qty}},"price":{{price}}}',
        **overrides,
    }
    r = client.post("/api/trade/connectors", json=payload)
    assert r.status_code == 201, r.text
    return r.json()


def test_connector_defaults_to_dry_run_and_masks_secret():
    with _client() as client:
        conn = _make_connector(client)
        assert conn["dryRun"] is True
        assert conn["headers"] == {"Authorization": wallet.SECRET_MASK}
        assert "trade-secret" not in client.get("/api/trade/connectors").text
        client.delete(f"/api/trade/connectors/{conn['id']}")


def test_preview_renders_without_sending(monkeypatch):
    with _client() as client:
        conn = _make_connector(client)
        monkeypatch.setattr(
            "app.main.trade.send_order",
            lambda *a, **kw: pytest.fail("preview must not send"),
        )
        out = client.post(
            "/api/trade/preview",
            json={"connectorId": conn["id"], "side": "buy", "qty": 2, "price": 100},
        ).json()
        assert out["dryRun"] is True
        assert out["request"]["body"] == '{"side":"buy","qty":2,"price":100}'
        client.delete(f"/api/trade/connectors/{conn['id']}")


def test_order_requires_confirm():
    with _client() as client:
        conn = _make_connector(client)
        r = client.post(
            "/api/trade/orders",
            json={"connectorId": conn["id"], "side": "buy", "qty": 1, "price": 10},
        )
        assert r.status_code == 422 and "confirm" in r.text
        client.delete(f"/api/trade/connectors/{conn['id']}")


def test_order_rejects_bad_side_and_qty():
    with _client() as client:
        conn = _make_connector(client)
        bad_side = client.post(
            "/api/trade/orders",
            json={"connectorId": conn["id"], "side": "hold", "qty": 1, "confirm": True},
        )
        assert bad_side.status_code == 422
        bad_qty = client.post(
            "/api/trade/orders",
            json={"connectorId": conn["id"], "side": "buy", "qty": 0, "confirm": True},
        )
        assert bad_qty.status_code == 422
        client.delete(f"/api/trade/connectors/{conn['id']}")


def test_dry_run_order_is_recorded_but_not_sent(monkeypatch):
    with _client() as client:
        conn = _make_connector(client)

        def explode(*a, **kw):
            raise AssertionError("dry run must not open a connection")

        monkeypatch.setattr(trade.httpx, "Client", explode)
        out = client.post(
            "/api/trade/orders",
            json={
                "connectorId": conn["id"],
                "side": "sell",
                "qty": 2.5,
                "price": 18_000_000,
                "confirm": True,
            },
        ).json()
        assert out["status"] == "dry"
        assert out["order"]["total"] == 45_000_000
        assert out["order"]["side"] == "sell"

        history = client.get("/api/trade/orders?asset=gold18dom").json()
        assert history["count"] == 1 and history["orders"][0]["status"] == "dry"
        client.delete(f"/api/trade/connectors/{conn['id']}")


def test_disabled_connector_cannot_trade():
    with _client() as client:
        conn = _make_connector(client)
        client.patch(f"/api/trade/connectors/{conn['id']}", json={"enabled": False})
        r = client.post(
            "/api/trade/orders",
            json={"connectorId": conn["id"], "side": "buy", "qty": 1, "confirm": True},
        )
        assert r.status_code == 422 and "disabled" in r.text
        client.delete(f"/api/trade/connectors/{conn['id']}")


def test_armed_connector_sends_and_records(monkeypatch):
    with _client() as client:
        conn = _make_connector(client, label="armed")
        client.patch(f"/api/trade/connectors/{conn['id']}", json={"dryRun": False})

        monkeypatch.setattr(
            "app.main.trade.send_order",
            lambda c, **kw: {
                "status": "sent",
                "error": None,
                "httpStatus": 200,
                "request": {"url": c.url, "body": "{}", "method": "POST"},
                "response": '{"orderId": 5}',
            },
        )
        out = client.post(
            "/api/trade/orders",
            json={
                "connectorId": conn["id"],
                "side": "buy",
                "qty": 1,
                "price": 100,
                "confirm": True,
            },
        ).json()
        assert out["status"] == "sent" and out["order"]["httpStatus"] == 200
        client.delete(f"/api/trade/connectors/{conn['id']}")


def test_patch_keeps_secret_when_mask_sent():
    with _client() as client:
        conn = _make_connector(client)
        client.patch(
            f"/api/trade/connectors/{conn['id']}",
            json={"label": "renamed", "headers": {"Authorization": wallet.SECRET_MASK}},
        )
        from app.db import SessionLocal, TradeConnector

        with SessionLocal() as s:
            row = s.get(TradeConnector, conn["id"])
            assert wallet.parse_headers(row.headers_json)["Authorization"] == "Token trade-secret"
        client.delete(f"/api/trade/connectors/{conn['id']}")


def test_copy_key_from_wallet_connection():
    """A working balance key can be reused for orders without retyping it."""
    with _client() as client:
        conn = _make_connector(client, headers={"x-api-key": "stale-token"})
        source = client.post(
            "/api/wallet/connections",
            json={
                "label": "والکس — تتر",
                "asset": "usdt",
                "exchange": "wallex",
                "url": "https://api.wallex.ir/v1/account/balances",
                "jsonPath": "result.balances.USDT.value",
                "headers": {"x-api-key": "the-working-key"},
            },
        ).json()

        out = client.post(
            f"/api/trade/connectors/{conn['id']}/copy-key",
            json={"walletConnectionId": source["id"]},
        )
        assert out.status_code == 200
        assert "the-working-key" not in out.text  # still masked on the way out

        from app.db import SessionLocal, TradeConnector

        with SessionLocal() as s:
            row = s.get(TradeConnector, conn["id"])
            assert wallet.parse_headers(row.headers_json)["x-api-key"] == "the-working-key"

        client.delete(f"/api/wallet/connections/{source['id']}")
        client.delete(f"/api/trade/connectors/{conn['id']}")


def test_copy_key_rejects_unknown_or_keyless_source():
    with _client() as client:
        conn = _make_connector(client)
        missing = client.post(
            f"/api/trade/connectors/{conn['id']}/copy-key", json={"walletConnectionId": 999999}
        )
        assert missing.status_code == 404

        keyless = client.post(
            "/api/wallet/connections",
            json={
                "label": "no auth",
                "asset": "usdt",
                "url": "https://open.test/b",
                "jsonPath": "v",
            },
        ).json()
        r = client.post(
            f"/api/trade/connectors/{conn['id']}/copy-key",
            json={"walletConnectionId": keyless["id"]},
        )
        assert r.status_code == 422

        client.delete(f"/api/wallet/connections/{keyless['id']}")
        client.delete(f"/api/trade/connectors/{conn['id']}")


def test_missing_connector_is_404():
    with _client() as client:
        assert client.patch("/api/trade/connectors/999999", json={"label": "x"}).status_code == 404
        assert client.delete("/api/trade/connectors/999999").status_code == 404
        assert (
            client.post(
                "/api/trade/orders",
                json={"connectorId": 999999, "side": "buy", "qty": 1, "confirm": True},
            ).status_code
            == 404
        )


def test_wallet_balances_group_by_exchange(monkeypatch):
    with _client() as client:
        made = []
        for label, ex in (("nobitex 18k", "nobitex"), ("wallex 18k", "wallex")):
            made.append(
                client.post(
                    "/api/wallet/connections",
                    json={
                        "label": label,
                        "asset": "gold18dom",
                        "exchange": ex,
                        "url": f"https://{ex}.test/b",
                        "jsonPath": "balance",
                    },
                ).json()
            )

        monkeypatch.setattr(
            "app.main.wallet.fetch_balance",
            lambda c: {"ok": True, "value": 10.0 if c.exchange == "nobitex" else 4.0,
                       "ms": 1, "error": None},
        )
        data = client.get("/api/wallet/balances").json()
        assert data["balances"]["gold18dom"] == 14.0
        assert data["byExchange"]["nobitex"]["gold18dom"] == 10.0
        assert data["byExchange"]["wallex"]["gold18dom"] == 4.0

        for c in made:
            client.delete(f"/api/wallet/connections/{c['id']}")
