import os
import tempfile
from datetime import datetime, timedelta, timezone

# Throwaway SQLite DB BEFORE importing app modules (config reads env at import).
_DBFILE = os.path.join(tempfile.gettempdir(), "gm_maint_test.db")
if os.path.exists(_DBFILE):
    os.remove(_DBFILE)
os.environ["DATABASE_URL"] = f"sqlite:///{_DBFILE}"
# Same fixture env as test_providers — modules are imported alphabetically and
# whichever file imports app.config first wins, so keep every file's env equal.
os.environ["NAVASAN_API_KEY"] = "TESTKEY"

import pytest  # noqa: E402
from sqlalchemy import select  # noqa: E402

from app import wallet  # noqa: E402
from app.db import PricePoint, SessionLocal, cleanup_history, init_db  # noqa: E402
from app.refresher import next_wait  # noqa: E402


# ---------------------------------------------------------------- refresher


def test_next_wait_keeps_cadence_and_breathes_after_overrun():
    # Normal cycle: the remaining slot is the wait.
    assert next_wait(5.0, 15.0) == 10.0
    assert next_wait(15.0, 15.0) == 0.0
    # Overrun: breather equal to the overrun, capped at one interval, so a 90s
    # cycle under a 15s interval waits 15s instead of starting back-to-back.
    assert next_wait(90.0, 15.0) == 15.0
    assert next_wait(22.0, 15.0) == 15.0
    assert next_wait(16.0, 15.0) == 15.0


# ---------------------------------------------------------------- retention


def test_cleanup_history_removes_only_old_rows():
    init_db()
    now = datetime.now(timezone.utc)
    with SessionLocal() as s:
        s.add_all(
            [
                PricePoint(
                    source="t", exchange=None, asset="usd",
                    buy=1.0, sell=1.0, ts=now - timedelta(days=30),
                ),
                PricePoint(
                    source="t", exchange=None, asset="usd",
                    buy=2.0, sell=2.0, ts=now - timedelta(days=2),
                ),
            ]
        )
        s.commit()

    removed = cleanup_history(days=14)
    assert removed == 1

    with SessionLocal() as s:
        rows = s.execute(select(PricePoint)).scalars().all()
        assert len(rows) == 1
        assert rows[0].buy == 2.0


# ------------------------------------------------- wallet proxy fallback


class _FakeResp:
    def __init__(self, status=200, payload=None):
        self.status_code = status
        self.text = ""
        self._payload = payload or {}

    def json(self):
        return self._payload


class _FakeConn:
    """Stand-in for a WalletConnection row."""

    def __init__(self, **kw):
        self.method = kw.get("method", "GET")
        self.url = kw.get("url", "https://example.test/balances")
        self.headers_json = kw.get("headers_json", "{}")
        self.body = kw.get("body")
        self.json_path = kw.get("json_path", "balance")
        self.multiplier = kw.get("multiplier", 1.0)


class _ProxyDeadClient:
    """A configured-but-dead outbound proxy: proxied attempts raise, direct succeed."""

    def __init__(self, timeout=None, trust_env=True, headers=None):
        self.trust_env = trust_env

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def get(self, url):
        if self.trust_env:
            import httpx

            raise httpx.ConnectError("proxy dead", request=None)
        return _FakeResp(200, {"balance": "12.5"})

    def post(self, url, **kw):
        import httpx

        raise httpx.ConnectError("proxy dead", request=None)


def test_fetch_balance_falls_back_to_direct_when_proxy_dead(monkeypatch):
    monkeypatch.setenv("HTTPS_PROXY", "http://dead.proxy:1")
    calls = []

    class _Counting(_ProxyDeadClient):
        def __init__(self, *a, **k):
            super().__init__(*a, **k)
            calls.append(self.trust_env)

    monkeypatch.setattr(wallet.httpx, "Client", _Counting)
    out = wallet.fetch_balance(_FakeConn())
    assert out["ok"] is True
    assert out["value"] == 12.5
    # One proxied attempt, then one direct.
    assert calls == [True, False]


def test_fetch_balance_single_attempt_without_proxy(monkeypatch):
    monkeypatch.delenv("HTTPS_PROXY", raising=False)
    monkeypatch.delenv("HTTP_PROXY", raising=False)
    monkeypatch.delenv("OUTBOUND_HTTPS_PROXY", raising=False)
    calls = []

    class _AlwaysOKClient:
        """No proxy configured → one attempt that simply succeeds."""

        def __init__(self, timeout=None, trust_env=True, headers=None):
            calls.append(trust_env)

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def get(self, url):
            return _FakeResp(200, {"balance": "12.5"})

    monkeypatch.setattr(wallet.httpx, "Client", _AlwaysOKClient)
    out = wallet.fetch_balance(_FakeConn())
    assert out["ok"] is True
    assert out["value"] == 12.5
    # Exactly one attempt, via env (proxy or not) — no fallback loop.
    assert calls == [True]


def test_fetch_balance_never_retries_post(monkeypatch):
    monkeypatch.setenv("HTTPS_PROXY", "http://dead.proxy:1")
    calls = []

    class _Counting(_ProxyDeadClient):
        def __init__(self, *a, **k):
            super().__init__(*a, **k)
            calls.append(self.trust_env)

    monkeypatch.setattr(wallet.httpx, "Client", _Counting)
    out = wallet.fetch_balance(_FakeConn(method="POST"))
    # A POST that failed on the proxy is NOT retried direct (it may have landed).
    assert out["ok"] is False
    assert calls == [True]
