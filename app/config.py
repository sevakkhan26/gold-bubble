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
HTTP_TIMEOUT = _int("HTTP_TIMEOUT", 8)

NAVASAN_API_KEY = os.environ.get("NAVASAN_API_KEY", "")
BRSAPI_KEY = os.environ.get("BRSAPI_KEY", "")

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
        "brsapi": "BRSAPI_URL",
    }.items()
    if os.environ.get(v)
}
