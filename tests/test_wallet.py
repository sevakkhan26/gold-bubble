import os
import tempfile

# Throwaway SQLite DB BEFORE importing app modules (config reads env at import).
_DBFILE = os.path.join(tempfile.gettempdir(), "gm_wallet_test.db")
if os.path.exists(_DBFILE):
    os.remove(_DBFILE)
os.environ["DATABASE_URL"] = f"sqlite:///{_DBFILE}"

import pytest  # noqa: E402

from app import wallet  # noqa: E402


class FakeConn:
    """Stand-in for a WalletConnection row (fetch_balance only reads attributes)."""

    def __init__(self, **kw):
        self.method = kw.get("method", "GET")
        self.url = kw.get("url", "https://example.test/balances")
        self.headers_json = kw.get("headers_json", "{}")
        self.body = kw.get("body")
        self.json_path = kw.get("json_path", "")
        self.multiplier = kw.get("multiplier", 1.0)


# ------------------------------------------------------------------ path parsing


def test_parse_path_dots_and_indexes():
    assert wallet.parse_path("data.wallets[0].balance") == ["data", "wallets", 0, "balance"]
    assert wallet.parse_path("") == []
    assert wallet.parse_path("balance") == ["balance"]


def test_extract_path_nested_dict_and_list():
    payload = {"data": {"wallets": [{"balance": "12.5"}, {"balance": "1"}]}}
    assert wallet.extract_path(payload, "data.wallets[0].balance") == "12.5"
    assert wallet.extract_path(payload, "data.wallets[1].balance") == "1"


def test_extract_path_matches_list_item_by_value():
    """[{'currency': 'usdt', 'value': 30}] — 'usdt' selects the row."""
    payload = {"balances": [{"currency": "btc", "value": 1}, {"currency": "usdt", "value": 30}]}
    assert wallet.extract_path(payload, "balances.usdt.value") == 30


def test_extract_path_wallex_balances_shape():
    """GET https://api.wallex.ir/v1/account/balances — the shape the preset targets."""
    payload = {
        "success": True,
        "message": "عملیات با موفقیت انجام شد",
        "result": {
            "balances": {
                "TMN": {"asset": "TMN", "faName": "تومان", "fiat": True,
                        "value": "10000000", "locked": "0"},
                "USDT": {"asset": "USDT", "faName": "تتر", "fiat": False,
                         "value": "10.00000000", "locked": "0.00000000"},
            }
        },
    }
    assert wallet.to_number(wallet.extract_path(payload, "result.balances.USDT.value")) == 10.0
    assert (
        wallet.to_number(wallet.extract_path(payload, "result.balances.TMN.value")) == 10_000_000
    )


def test_extract_path_empty_returns_whole_payload():
    assert wallet.extract_path(42, "") == 42


def test_extract_path_missing_key_raises():
    with pytest.raises(KeyError):
        wallet.extract_path({"a": 1}, "b")
    with pytest.raises(KeyError):
        wallet.extract_path({"a": [1]}, "a[5]")


# ------------------------------------------------------------------ numbers


@pytest.mark.parametrize(
    "raw,expected",
    [
        (12, 12.0),
        (12.5, 12.5),
        ("1,234.5", 1234.5),
        ("۱۲۳", 123.0),
        ("30 USDT", 30.0),
        ("", None),
        (None, None),
        (True, None),
        ({"a": 1}, None),
    ],
)
def test_to_number(raw, expected):
    assert wallet.to_number(raw) == expected


# ------------------------------------------------------------------ secrets


def test_mask_headers_hides_values():
    masked = wallet.mask_headers('{"Authorization": "Token secret-abc"}')
    assert masked == {"Authorization": wallet.SECRET_MASK}


def test_merge_headers_keeps_stored_value_when_masked():
    stored = '{"Authorization": "Token secret-abc"}'
    merged = wallet.merge_headers(stored, {"Authorization": wallet.SECRET_MASK})
    assert wallet.parse_headers(merged)["Authorization"] == "Token secret-abc"


def test_merge_headers_accepts_new_value():
    stored = '{"Authorization": "Token old"}'
    merged = wallet.merge_headers(stored, {"Authorization": "Token new"})
    assert wallet.parse_headers(merged)["Authorization"] == "Token new"


def test_merge_headers_drops_removed_keys():
    stored = '{"Authorization": "x", "X-Extra": "y"}'
    merged = wallet.merge_headers(stored, {"Authorization": wallet.SECRET_MASK})
    assert wallet.parse_headers(merged) == {"Authorization": "x"}


def test_validate_url_rejects_non_http():
    with pytest.raises(ValueError):
        wallet.validate_url("file:///etc/passwd")
    assert wallet.validate_url(" https://api.test/x ") == "https://api.test/x"


# ------------------------------------------------------------------ fetching


def test_fetch_balance_applies_multiplier(monkeypatch):
    class FakeResp:
        def raise_for_status(self):
            return None

        def json(self):
            return {"result": {"balances": [{"asset": "USDT", "free": "1500000"}]}}

    class FakeClient:
        def __init__(self, *a, **kw):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def get(self, url):
            return FakeResp()

    monkeypatch.setattr(wallet.httpx, "Client", FakeClient)
    conn = FakeConn(json_path="result.balances[0].free", multiplier=0.1)  # rial → toman
    out = wallet.fetch_balance(conn)
    assert out["ok"] is True and out["value"] == 150000.0


def test_fetch_balance_reports_error_without_raising(monkeypatch):
    class Boom:
        def __init__(self, *a, **kw):
            raise RuntimeError("connect failed")

    monkeypatch.setattr(wallet.httpx, "Client", Boom)
    out = wallet.fetch_balance(FakeConn())
    assert out["ok"] is False and out["value"] is None and "connect failed" in out["error"]


def test_fetch_balance_flags_non_numeric(monkeypatch):
    class FakeResp:
        def raise_for_status(self):
            return None

        def json(self):
            return {"balance": {"nested": "thing"}}

    class FakeClient:
        def __init__(self, *a, **kw):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def get(self, url):
            return FakeResp()

    monkeypatch.setattr(wallet.httpx, "Client", FakeClient)
    out = wallet.fetch_balance(FakeConn(json_path="balance"))
    assert out["ok"] is False and "not a number" in out["error"]


# ------------------------------------------------------------------ HTTP API


def _client():
    from fastapi.testclient import TestClient

    from app.main import app

    return TestClient(app)


def test_connection_crud_and_secret_masking():
    with _client() as client:
        created = client.post(
            "/api/wallet/connections",
            json={
                "label": "نوبیتکس — تتر",
                "asset": "usdt",
                "url": "https://api.nobitex.ir/users/wallets/list",
                "jsonPath": "wallets[0].balance",
                "method": "POST",
                "headers": {"Authorization": "Token super-secret"},
                "multiplier": 1,
            },
        )
        assert created.status_code == 201, created.text
        conn = created.json()
        assert conn["headers"] == {"Authorization": wallet.SECRET_MASK}
        assert "super-secret" not in created.text

        listed = client.get("/api/wallet/connections").json()
        assert any(c["id"] == conn["id"] for c in listed["connections"])
        assert "usdt" in listed["assets"]
        assert "super-secret" not in client.get("/api/wallet/connections").text

        # Editing another field must not wipe the stored token.
        patched = client.patch(
            f"/api/wallet/connections/{conn['id']}",
            json={"label": "نوبیتکس", "headers": {"Authorization": wallet.SECRET_MASK}},
        )
        assert patched.status_code == 200
        assert patched.json()["label"] == "نوبیتکس"

        from app.db import SessionLocal, WalletConnection

        with SessionLocal() as s:
            row = s.get(WalletConnection, conn["id"])
            assert wallet.parse_headers(row.headers_json)["Authorization"] == "Token super-secret"

        assert client.delete(f"/api/wallet/connections/{conn['id']}").json()["ok"] is True
        assert client.get("/api/wallet/connections").json()["connections"] == []


def test_connection_rejects_bad_asset_and_url():
    with _client() as client:
        bad_asset = client.post(
            "/api/wallet/connections",
            json={"label": "x", "asset": "bitcoin", "url": "https://a.test", "jsonPath": "b"},
        )
        assert bad_asset.status_code == 422

        bad_url = client.post(
            "/api/wallet/connections",
            json={"label": "x", "asset": "usdt", "url": "ftp://a.test", "jsonPath": "b"},
        )
        assert bad_url.status_code == 422


def test_balances_sums_per_asset_and_reports_failures(monkeypatch):
    with _client() as client:
        for label in ("nobitex", "wallex"):
            r = client.post(
                "/api/wallet/connections",
                json={
                    "label": label,
                    "asset": "usdt",
                    "url": f"https://{label}.test/balance",
                    "jsonPath": "balance",
                },
            )
            assert r.status_code == 201
        broken = client.post(
            "/api/wallet/connections",
            json={
                "label": "broken",
                "asset": "gold18dom",
                "url": "https://broken.test/balance",
                "jsonPath": "balance",
            },
        ).json()

        def fake_fetch(conn):
            if conn.label == "broken":
                return {"ok": False, "value": None, "ms": 1, "error": "boom"}
            return {"ok": True, "value": 100.0, "ms": 1, "error": None}

        monkeypatch.setattr("app.main.wallet.fetch_balance", fake_fetch)

        data = client.get("/api/wallet/balances").json()
        assert data["balances"] == {"usdt": 200.0}       # two connections summed
        assert "gold18dom" not in data["balances"]        # failure contributes nothing
        assert len(data["connections"]) == 3
        failed = next(c for c in data["connections"] if c["id"] == broken["id"])
        assert failed["ok"] is False and failed["error"] == "boom"

        # Last result is persisted for the sources page.
        stored = client.get("/api/wallet/connections").json()["connections"]
        assert next(c for c in stored if c["id"] == broken["id"])["lastOk"] is False

        for c in stored:
            client.delete(f"/api/wallet/connections/{c['id']}")


def test_test_endpoint_returns_result(monkeypatch):
    with _client() as client:
        conn = client.post(
            "/api/wallet/connections",
            json={
                "label": "probe",
                "asset": "toman",
                "url": "https://probe.test/b",
                "jsonPath": "balance",
            },
        ).json()

        monkeypatch.setattr(
            "app.main.wallet.fetch_balance",
            lambda c: {"ok": True, "value": 5.0, "ms": 3, "error": None},
        )
        out = client.post(f"/api/wallet/connections/{conn['id']}/test").json()
        assert out["ok"] is True and out["value"] == 5.0
        assert out["connection"]["lastValue"] == 5.0

        client.delete(f"/api/wallet/connections/{conn['id']}")


def test_missing_connection_is_404():
    with _client() as client:
        assert client.patch("/api/wallet/connections/999999", json={"label": "x"}).status_code == 404
        assert client.delete("/api/wallet/connections/999999").status_code == 404
        assert client.post("/api/wallet/connections/999999/test").status_code == 404
