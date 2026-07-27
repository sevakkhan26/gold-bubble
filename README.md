# Gold Market Live (Python + PostgreSQL)

**Version:** `1.1.2` (semver in `app/version.py` + Docker `APP_VERSION` / `APP_GIT_SHA`)

Full backend rewrite in **Python (FastAPI)** with **price history** for every asset/field stored in **PostgreSQL** (or SQLite for local dev).

**Frontend (production):** full original dashboard in `public/index.html` (all pages + settings content) served by FastAPI, wired to live `GET /api/prices`.

**Frontend (WIP):** `frontend/` holds an experimental Vite + shadcn/ui rewrite — **not** used in production until every page/settings section is ported without content loss.

## Deploy / CI-CD (same pattern as Iran Market Terminal & OTC)

| Path | What happens |
|------|----------------|
| **GitHub Actions CI** | `.github/workflows/ci.yml` — `pytest` on every push/PR to `main` |
| **GitHub Actions CD note** | `.github/workflows/cd-server-poller.yml` — documents that LAN poller deploys |
| **LAN auto-deploy** | `auto-deploy-poller` polls GitHub every ~30s; on new `main` SHA runs `deploy.sh gold-bubble` |
| **Manual webhook** | `POST http://<server>:9000/hooks/update-gold-bubble?token=...` |

Server layout (expected):

```text
/home/server/docker-projects/gold-bubble/   # this repo clone
```

Project-local `docker-compose.yml` (app + Postgres) is used because of the `.standalone-deploy` marker.

## What it does

- Live gold, FX, and USDT board for Iranian and international sources
- Per-exchange attribution (each venue box only shows its own data)
- Background refresh every `REFRESH_SEC` seconds
- Full time-series history in table `price_points`
- Static RTL dashboard (React via CDN) at `/`

## Sources

| Source | Assets | API key |
|--------|--------|---------|
| **Nobitex** | USDT/IRT order book | No |
| **Wallex** | USDT/TMN order book | No |
| **gold-api.com** → **goldprice.org** | XAU ounce (USD) | No |
| **CoinGecko** | PAXG / XAUT (USD) | No |
| **Navasan** | Free-market USD, AED, gold 18k/24k, ounce (Toman) | **Required** for domestic prices |
| **BrsApi** | Domestic fallback | Optional (only if no Navasan key) |

Without a Navasan/BrsApi key, domestic USD/AED/gold may fall back to **estimated** values (USDT mid as USD proxy; melt estimate for gold from ounce × dollar).

## Run with Docker (Postgres included — recommended)

```bash
# Navasan key for free-market USD/AED/domestic gold:
export NAVASAN_API_KEY=your_key   # PowerShell: $env:NAVASAN_API_KEY="your_key"
docker compose up --build
# Open: http://localhost:8787
```

This starts Postgres (`postgres:16`) and the app. On startup the app creates tables and writes a history row for each price every `REFRESH_SEC` seconds.

## Local run without Docker (SQLite)

```bash
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env               # set NAVASAN_API_KEY; DATABASE_URL defaults to SQLite
uvicorn app.main:app --host 127.0.0.1 --port 8787
# Open: http://127.0.0.1:8787
```

For local Postgres, set in `.env`:

```env
DATABASE_URL=postgresql+psycopg2://user:pass@localhost:5432/goldmarket
```

## API

| Path | Description |
|------|-------------|
| `GET /api/prices` | Latest price model (per-exchange, with `stale`, `ageMs`, `version`) |
| `GET /api/health` | Health + version + API-key status + URL overrides + last refresh time |
| `GET /api/version` | `{ version, gitSha, buildTime }` |
| `GET /api/debug` | Last refresh report per source (`source` / `ok` / `ms` / `error`) |
| `GET /api/history?asset=usdt&exchange=nobitex&limit=200` | Time series for one price |

**`asset` values:** `usd`, `usdt`, `aed`, `gold18`, `gold24`, `ounce`, `paxgold`, `tethergold`  
**`exchange` (optional):** `navasan`, `nobitex`, `wallex`, …

## Database & history

Table `price_points` — one row = one price at one moment:

`id`, `ts`, `source`, `exchange`, `asset`, `buy`, `sell`, `value`, `estimated`

On each refresh, every available field (USDT per exchange, Navasan USD/AED/gold, ounce, PAXG/XAUT) is inserted, so full history builds over time.

## Tests

```bash
pip install -r requirements.txt
python -m pytest -q
# Covers mappers, build_model, history storage, and HTTP endpoints (SQLite)
```

## Environment variables

| Variable | Default | Notes |
|----------|---------|--------|
| `DATABASE_URL` | `sqlite:///./data.db` | Use Postgres URL in production / Docker |
| `NAVASAN_API_KEY` | _(empty)_ | Required for live domestic USD/AED/gold |
| `BRSAPI_KEY` | _(empty)_ | Optional domestic fallback |
| `PORT` | `8787` | HTTP port |
| `REFRESH_SEC` | `60` | Minimum 15 |
| `HTTP_TIMEOUT` | `8` | Provider request timeout (seconds) |
| `APP_VERSION` | `1.0.0` | Semver exposed in API + UI |
| `HTTP_PROXY` / `HTTPS_PROXY` / `OUTBOUND_HTTPS_PROXY` | _(empty)_ | Outbound proxy for providers |
| `NO_PROXY` | `db,localhost,127.0.0.1` | Skip proxy for Postgres |

Optional base-URL overrides (proxy / mirror / self-test):  
`NOBITEX_URL`, `WALLEX_URL`, `GOLDAPI_URL`, `GOLDPRICEORG_URL`, `COINGECKO_URL`, `NAVASAN_URL`, `BRSAPI_URL`

See `.env.example` for a ready template. **Never commit `.env`.**

## Project layout

```
app/                 # FastAPI backend
frontend/            # Vite + React + shadcn/ui (source)
public/              # Built frontend (npm run build → copy dist here)
tests/
docker-compose.yml
Dockerfile
```

### Frontend dev

```bash
# terminal 1 — API
source .venv/bin/activate && uvicorn app.main:app --port 8787
# terminal 2 — UI (proxies /api → :8787)
cd frontend && npm install && npm run dev
```

### Frontend production build

```bash
cd frontend && npm ci && npm run build
rm -rf ../public && mkdir ../public && cp -R dist/* ../public/
```

## License / notes

Internal desk tool. Navasan key: [navasan.tech](https://navasan.tech/) (bot: `@navasan_contact_bot`).
