"""Wallet balance connectors.

Each WalletConnection points at one exchange endpoint and extracts a single
number (the user's balance for one wallet row) out of the JSON response.
Pure helpers (parse_path / extract_path / to_number) are unit-testable without
network; fetch_balance() is the only part that talks to the outside world.
"""
from __future__ import annotations

import json
import re
import time
from datetime import datetime, timezone
from typing import Any

import httpx

from . import config

# Shown to the browser instead of a stored secret; sending it back means "keep".
SECRET_MASK = "••••••"

ALLOWED_ASSETS = {
    "gold18dom",
    "gold18for",
    "gold24dom",
    "gold24for",
    "usd",
    "aed",
    "usdt",
    "toman",
}

_TOKEN_RE = re.compile(r"[^.\[\]]+|\[\d+\]")


def parse_path(path: str) -> list[str | int]:
    """`data.wallets[0].balance` → ['data', 'wallets', 0, 'balance'].

    Empty path means "the response itself is the number".
    """
    out: list[str | int] = []
    for tok in _TOKEN_RE.findall(path or ""):
        tok = tok.strip()
        if not tok:
            continue
        if tok.startswith("[") and tok.endswith("]"):
            out.append(int(tok[1:-1]))
        else:
            out.append(tok)
    return out


def extract_path(data: Any, path: str) -> Any:
    """Walk a dotted/indexed path through parsed JSON. Raises KeyError if missing."""
    cur = data
    for step in parse_path(path):
        if isinstance(step, int):
            if not isinstance(cur, (list, tuple)) or step >= len(cur):
                raise KeyError(f"index [{step}] not found in {type(cur).__name__}")
            cur = cur[step]
        else:
            if isinstance(cur, dict):
                if step not in cur:
                    raise KeyError(f"key '{step}' not found")
                cur = cur[step]
            elif isinstance(cur, (list, tuple)):
                # Common shape: [{"currency": "usdt", "balance": "12"}] — match by value.
                hit = next(
                    (
                        it
                        for it in cur
                        if isinstance(it, dict)
                        and any(str(v).lower() == step.lower() for v in it.values())
                    ),
                    None,
                )
                if hit is None:
                    raise KeyError(f"no list item matching '{step}'")
                cur = hit
            else:
                raise KeyError(f"cannot read '{step}' from {type(cur).__name__}")
    return cur


def to_number(x: Any) -> float | None:
    """Numbers arrive as int, float, or string ('1,234.5' / '۱۲۳' / '12 USDT')."""
    if isinstance(x, bool) or x is None:
        return None
    if isinstance(x, (int, float)):
        return float(x)
    if isinstance(x, str):
        s = x.strip().translate(str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789"))
        s = s.replace(",", "").replace("٬", "")
        m = re.search(r"-?\d+(?:\.\d+)?", s)
        if m:
            try:
                return float(m.group(0))
            except ValueError:
                return None
    return None


def parse_headers(raw: str | None) -> dict[str, str]:
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        return {}
    if not isinstance(data, dict):
        return {}
    return {str(k): str(v) for k, v in data.items()}


def mask_headers(raw: str | None) -> dict[str, str]:
    """Header map for the browser — every value replaced by the mask."""
    return {k: SECRET_MASK for k in parse_headers(raw)}


def merge_headers(stored: str | None, incoming: dict[str, str] | None) -> str:
    """Apply an edit: masked values keep whatever is already stored."""
    if incoming is None:
        return stored or "{}"
    old = parse_headers(stored)
    merged = {
        k: (old.get(k, "") if v == SECRET_MASK else str(v))
        for k, v in incoming.items()
    }
    return json.dumps(merged, ensure_ascii=False)


def validate_url(url: str) -> str:
    u = (url or "").strip()
    if not u.lower().startswith(("http://", "https://")):
        raise ValueError("url must start with http:// or https://")
    return u


def fetch_balance(conn) -> dict:
    """Call one connection's endpoint and pull the balance out of the response.

    Never raises — returns {"ok", "value", "ms", "error"} so one broken exchange
    cannot take down /api/wallet/balances.
    """
    started = time.time()
    try:
        url = validate_url(conn.url)
        headers = {"Accept": "application/json", **parse_headers(conn.headers_json)}
        body = (conn.body or "").strip()
        timeout = httpx.Timeout(config.HTTP_TIMEOUT, connect=10.0)
        with httpx.Client(timeout=timeout, trust_env=True, headers=headers) as client:
            if (conn.method or "GET").upper() == "POST":
                if body:
                    headers.setdefault("Content-Type", "application/json")
                    r = client.post(url, content=body.encode("utf-8"))
                else:
                    r = client.post(url)
            else:
                r = client.get(url)
        r.raise_for_status()
        payload = r.json()
        raw = extract_path(payload, conn.json_path)
        value = to_number(raw)
        ms = int((time.time() - started) * 1000)
        if value is None:
            return {"ok": False, "value": None, "ms": ms, "error": f"not a number: {raw!r}"}
        return {
            "ok": True,
            "value": value * (conn.multiplier if conn.multiplier is not None else 1.0),
            "ms": ms,
            "error": None,
        }
    except Exception as e:  # noqa: BLE001
        return {
            "ok": False,
            "value": None,
            "ms": int((time.time() - started) * 1000),
            "error": f"{type(e).__name__}: {e}"[:300],
        }


def record_result(conn, result: dict) -> None:
    """Store the outcome of a fetch on the connection row (caller commits)."""
    conn.last_ok = bool(result.get("ok"))
    conn.last_value = result.get("value")
    conn.last_error = result.get("error")
    conn.last_checked_at = datetime.now(timezone.utc)


def public_connection(conn) -> dict:
    return {
        "id": conn.id,
        "label": conn.label,
        "asset": conn.asset,
        "exchange": conn.exchange,
        "enabled": bool(conn.enabled),
        "method": conn.method,
        "url": conn.url,
        "headers": mask_headers(conn.headers_json),
        "body": conn.body,
        "jsonPath": conn.json_path,
        "multiplier": conn.multiplier,
        "lastValue": conn.last_value,
        "lastOk": conn.last_ok,
        "lastError": conn.last_error,
        "lastCheckedAt": conn.last_checked_at.isoformat() if conn.last_checked_at else None,
    }
