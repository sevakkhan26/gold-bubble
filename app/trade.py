"""Order placement against user-configured exchange endpoints.

The app never invents an order: the caller must pass an explicit side, quantity
and confirm flag, and a connector only leaves dry-run mode when the user turns it
off. render_template()/build_request() are pure and unit-tested; send_order() is
the only function that reaches an exchange.
"""
from __future__ import annotations

import re
import time
from typing import Any

import httpx

from . import config
from .wallet import ALLOWED_ASSETS, parse_headers, validate_url  # noqa: F401  (re-exported)

SIDES = ("buy", "sell")

# {{qty}} / {{ price }} — whitespace tolerated.
_PLACEHOLDER_RE = re.compile(r"\{\{\s*(\w+)\s*\}\}")


def format_number(x: float) -> str:
    """Exchange payloads want '2.5' and '10', not '2.5' and '10.0'."""
    if x == int(x):
        return str(int(x))
    return repr(round(float(x), 10))


def render_template(template: str, values: dict[str, Any]) -> str:
    """Replace {{name}} with values[name]. Unknown or None placeholders raise."""
    missing: list[str] = []

    def sub(m: re.Match[str]) -> str:
        key = m.group(1)
        val = values.get(key)
        if val is None:
            missing.append(key)
            return ""
        return format_number(val) if isinstance(val, (int, float)) else str(val)

    out = _PLACEHOLDER_RE.sub(sub, template or "")
    if missing:
        raise ValueError(f"missing value for: {', '.join(sorted(set(missing)))}")
    return out


def side_value(conn, side: str) -> str:
    if side not in SIDES:
        raise ValueError("side must be buy or sell")
    return (conn.buy_value if side == "buy" else conn.sell_value) or side


def build_request(conn, *, side: str, qty: float, price: float | None) -> dict:
    """Render the outgoing request without sending it (also used by the preview)."""
    if qty is None or qty <= 0:
        raise ValueError("qty must be greater than zero")
    values = {
        "side": side_value(conn, side),
        "qty": qty,
        "price": price,
        "total": (qty * price) if price is not None else None,
        "asset": conn.asset,
        "exchange": conn.exchange,
    }
    return {
        "method": (conn.method or "POST").upper(),
        "url": validate_url(render_template(conn.url, values)),
        "body": render_template(conn.body_template or "", values),
    }


def send_order(conn, *, side: str, qty: float, price: float | None) -> dict:
    """Place one order. Returns the outcome; never raises."""
    try:
        req = build_request(conn, side=side, qty=qty, price=price)
    except ValueError as e:
        return {
            "status": "failed",
            "error": str(e),
            "httpStatus": None,
            "request": None,
            "response": None,
        }

    if conn.dry_run:
        return {
            "status": "dry",
            "error": None,
            "httpStatus": None,
            "request": req,
            "response": "dry-run — درخواست ساخته شد ولی ارسال نشد",
        }

    started = time.time()
    try:
        headers = {"Accept": "application/json", **parse_headers(conn.headers_json)}
        body = req["body"].strip()
        if body:
            headers.setdefault("Content-Type", "application/json")
        timeout = httpx.Timeout(config.HTTP_TIMEOUT, connect=10.0)
        with httpx.Client(timeout=timeout, trust_env=True, headers=headers) as client:
            if req["method"] == "GET":
                r = client.get(req["url"])
            else:
                r = client.request(req["method"], req["url"], content=body.encode("utf-8"))
        text = r.text[:2000]
        ok = 200 <= r.status_code < 300
        detail = " ".join((r.text or "").split())[:200]
        return {
            "status": "sent" if ok else "failed",
            "error": None if ok else f"HTTP {r.status_code} — {detail or 'بدون پاسخ'}",
            "httpStatus": r.status_code,
            "request": req,
            "response": text,
            "ms": int((time.time() - started) * 1000),
        }
    except Exception as e:  # noqa: BLE001
        return {
            "status": "failed",
            "error": f"{type(e).__name__}: {e}"[:300],
            "httpStatus": None,
            "request": req,
            "response": None,
            "ms": int((time.time() - started) * 1000),
        }


def public_connector(conn) -> dict:
    from .wallet import mask_headers

    return {
        "id": conn.id,
        "label": conn.label,
        "exchange": conn.exchange,
        "asset": conn.asset,
        "enabled": bool(conn.enabled),
        "dryRun": bool(conn.dry_run),
        "method": conn.method,
        "url": conn.url,
        "headers": mask_headers(conn.headers_json),
        "bodyTemplate": conn.body_template,
        "buyValue": conn.buy_value,
        "sellValue": conn.sell_value,
    }


def public_order(order) -> dict:
    return {
        "id": order.id,
        "ts": order.ts.isoformat() if order.ts else None,
        "connectorId": order.connector_id,
        "exchange": order.exchange,
        "asset": order.asset,
        "side": order.side,
        "qty": order.qty,
        "price": order.price,
        "total": order.total,
        "status": order.status,
        "httpStatus": order.http_status,
        "requestUrl": order.request_url,
        "requestBody": order.request_body,
        "response": order.response_text,
        "error": order.error,
    }
