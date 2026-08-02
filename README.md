# Gold Market Live (Python + PostgreSQL)

**Version:** semver lives in `app/version.py` (`_CODE_VERSION`) and is what
`/api/version` reports; `APP_GIT_SHA` identifies the deployed commit.

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
| `GET/POST /api/wallet/connections` | List / create wallet balance connectors |
| `PATCH/DELETE /api/wallet/connections/{id}` | Edit / remove one connector |
| `POST /api/wallet/connections/{id}/test` | Call one connector now and report the result |
| `GET /api/wallet/balances` | Live balance per wallet row, summed over enabled connectors |
| `GET/POST /api/trade/connectors` | List / create exchange order endpoints |
| `PATCH/DELETE /api/trade/connectors/{id}` | Edit / remove one order endpoint |
| `POST /api/trade/preview` | Render the request an order would send (nothing transmitted) |
| `POST /api/trade/orders` | Place one order (`confirm: true` required) |
| `GET /api/trade/orders?asset=gold18dom&limit=20` | Order history |

**`asset` values:** `usd`, `usdt`, `aed`, `gold18`, `gold24`, `ounce`, `paxgold`, `tethergold`  
**`exchange` (optional):** `navasan`, `nobitex`, `wallex`, …

## Database & history

Table `price_points` — one row = one price at one moment:

`id`, `ts`, `source`, `exchange`, `asset`, `buy`, `sell`, `value`, `estimated`

On each refresh, every available field (USDT per exchange, Navasan USD/AED/gold, ounce, PAXG/XAUT) is inserted, so full history builds over time.

## Wallet (کیف پول)

The wallet page values your holdings — 18k/24k gold (domestic and foreign) plus
USD, AED, USDT and cash — at live market rates.

Quantities can be filled automatically from your own exchange accounts. Each
**connection** (added in the *منابع API* page) is one endpoint:

| Field | Example |
|-------|---------|
| Wallet row | `usdt` |
| Method / URL | `GET https://api.exchange.tld/account/balances` |
| Auth header | `Authorization: Token …` |
| JSON path | `wallets[0].balance` · `result.balances.usdt.free` |
| Multiplier | `0.1` (rial → toman), `0.001` (mg → gram), `1` |

The path walks dotted keys and `[index]`; a bare name against a list matches the
item whose value equals it (`balances.usdt.free` on `[{"currency":"usdt",…}]`).

**Wallex preset.** The forms have one-click presets for Wallex, so only the API
key has to be typed (base `https://api.wallex.ir`, header `x-api-key`):

| | Balance | Order |
|---|---|---|
| Endpoint | `GET /v1/account/balances` | `POST /v1/account/orders` |
| Path / body | `result.balances.USDT.value` (or `TMN`) | `{"symbol":"USDTTMN","type":"LIMIT","side":"{{side}}","price":"{{price}}","quantity":"{{qty}}"}` |
| Sides | — | `BUY` / `SELL` |

Credentials are stored in `wallet_connections` on the **server** and are never
returned to the browser — the API replies with `••••••` and sending that mask back
keeps the stored value. Several connections can feed one wallet row (they are
summed), and anything you type in the wallet overrides the automatic number.
Use read-only API keys.

Table `wallet_connections`: `id`, `label`, `asset`, `exchange`, `enabled`,
`method`, `url`, `headers_json`, `body`, `json_path`, `multiplier`, plus the last
result (`last_value`, `last_ok`, `last_error`, `last_checked_at`). Tagging a
connection with an `exchange` is what makes per-venue holdings show up in the
trade panel.

## Trading (معامله)

The *آربیتراژ طلای ۱۸ داخلی* page carries a buy/sell ticket: pick the venue, see
what you hold there and the live per-gram bid/ask, enter a quantity, and place
the order. Orders go out through **trade connectors** (added in *منابع API*):

| Field | Example |
|-------|---------|
| Exchange / wallet row | `nobitex` / `gold18dom` |
| Method / URL | `POST https://api.exchange.tld/market/orders/add` |
| Auth header | `Authorization: Token …` (needs trade permission) |
| Body template | `{"side":"{{side}}","amount":{{qty}},"price":{{price}}}` |
| Buy / sell values | `buy` / `sell`, or `BUY` / `SELL` |

Placeholders `{{side}}`, `{{qty}}`, `{{price}}`, `{{total}}`, `{{asset}}` and
`{{exchange}}` are substituted in both URL and body; a placeholder with no value
(e.g. `{{price}}` on a market order) is a hard error rather than a blank.

**Safety.** A new connector is created in **dry-run**: the request is rendered and
shown but never transmitted, until you press *فعال‌سازی ارسال*. `POST
/api/trade/orders` also refuses anything without `confirm: true`, a valid side,
and a positive quantity. Every attempt — dry, sent, or failed — is written to
`trade_orders` with the exact request and the exchange's response.

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
| `APP_VERSION` | _(ignored)_ | Kept for compatibility — `app/version.py` wins so a stale `.env` cannot mask a fresh deploy |
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
