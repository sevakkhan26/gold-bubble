"""Configuration, loaded from environment variables (.env supported)."""
import os
from pathlib import Path


def _load_dotenv() -> None:
    p = Path(__file__).resolve().parent.parent / ".env"
    if not p.exists():
        return
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k, v = k.strip(), v.strip().strip('"').strip("'")
        os.environ.setdefault(k, v)


_load_dotenv()


def _int(name: str, default: int, minimum: int | None = None) -> int:
    try:
        val = int(os.environ.get(name, default))
    except (TypeError, ValueError):
        val = default
    if minimum is not None:
        val = max(minimum, val)
    return val


# Database. Defaults to local SQLite for dev; set DATABASE_URL to Postgres in prod:
#   postgresql+psycopg2://user:pass@host:5432/dbname
DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./data.db")

PORT = _int("PORT", 8787)
REFRESH_SEC = _int("REFRESH_SEC", 60, minimum=15)
# IR edges + outbound proxy need headroom; 8s was too tight under mtproxier.
HTTP_TIMEOUT = _int("HTTP_TIMEOUT", 15)

NAVASAN_API_KEY = os.environ.get("NAVASAN_API_KEY", "")
BRSAPI_KEY = os.environ.get("BRSAPI_KEY", "")

# Optional outbound proxy (httpx trust_env). Same idea as OTC / Iran Market Terminal.
# Prefer OUTBOUND_HTTPS_PROXY; fall back to standard HTTPS_PROXY / HTTP_PROXY.
_OUTBOUND = (
    os.environ.get("OUTBOUND_HTTPS_PROXY", "").strip()
    or os.environ.get("HTTPS_PROXY", "").strip()
    or os.environ.get("HTTP_PROXY", "").strip()
)
if _OUTBOUND:
    # Ensure child clients see a consistent pair even if only one var was set.
    os.environ.setdefault("HTTPS_PROXY", _OUTBOUND)
    os.environ.setdefault("HTTP_PROXY", _OUTBOUND)
HTTPS_PROXY = os.environ.get("HTTPS_PROXY", "").strip()
HTTP_PROXY = os.environ.get("HTTP_PROXY", "").strip()

# Optional base-URL overrides (proxy / mirror / self-test).
OVERRIDES = {
    k: os.environ[v]
    for k, v in {
        "nobitex": "NOBITEX_URL",
        "wallex": "WALLEX_URL",
        "gold_api": "GOLDAPI_URL",
        "goldprice_org": "GOLDPRICEORG_URL",
        "coingecko": "COINGECKO_URL",
        "navasan": "NAVASAN_URL",
        "navasan_web": "NAVASAN_WEB_URL",
        "brsapi": "BRSAPI_URL",
    }.items()
    if os.environ.get(v)
}
