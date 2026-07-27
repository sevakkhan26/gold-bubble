# بازار طلا و ارز — نسخه‌ی Python + PostgreSQL

بک‌اند کامل به **پایتون (FastAPI)** بازنویسی شده و **تاریخچه‌ی همه‌ی قیمت‌ها/فیلدها**
در **PostgreSQL** ذخیره می‌شود. فرانت‌اند (`public/index.html`) بدون تغییر، همان
`/api/prices` را می‌خواند.

## اجرا با Docker (پستگرس خودکار — پیشنهادی)
```bash
# کلید نوسان را در محیط بگذار (برای دلار/درهم/طلای داخلی):
export NAVASAN_API_KEY=کلیدت      # ویندوز PowerShell: $env:NAVASAN_API_KEY="کلیدت"
docker compose up --build
# باز کن: http://localhost:8787
```
این دستور پستگرس (`postgres:16`) و اپ را بالا می‌آورد؛ اپ خودش جدول‌ها را می‌سازد و
هر `REFRESH_SEC` ثانیه قیمت‌ها را می‌گیرد و یک ردیف تاریخچه برای هر قیمت می‌نویسد.

## اجرای محلی بدون Docker (SQLite برای توسعه)
```bash
python -m venv .venv && source .venv/bin/activate   # ویندوز: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env            # NAVASAN_API_KEY را بگذار؛ DATABASE_URL پیش‌فرض SQLite است
uvicorn app.main:app --port 8787
# باز کن: http://localhost:8787
```
برای پستگرسِ محلی، در `.env`:
`DATABASE_URL=postgresql+psycopg2://user:pass@localhost:5432/goldmarket`

## API
| مسیر | کار |
|---|---|
| `GET /api/prices` | آخرین مدل قیمت (per-exchange، با `stale` و `ageMs`) |
| `GET /api/health` | سلامت + وضعیت کلید + منابع override |
| `GET /api/debug` | گزارش آخرین بروزرسانی هر منبع (source/ok/ms/error) |
| `GET /api/history?asset=usdt&exchange=nobitex&limit=200` | **تاریخچه‌ی زمانی** یک قیمت |

`asset` می‌تواند باشد: `usd`, `usdt`, `aed`, `gold18`, `gold24`, `ounce`, `paxgold`, `tethergold`.
`exchange` اختیاری است (`navasan`/`nobitex`/`wallex`/…).

## دیتابیس و تاریخچه
جدول `price_points`: هر ردیف = یک قیمت در یک لحظه:
`id, ts, source, exchange, asset, buy, sell, value, estimated`.
در هر بروزرسانی، برای هر فیلدِ موجود (تتر هر صرافی، دلار/درهم/طلای نوسان، انس، PAXG/XAUT)
یک ردیف درج می‌شود؛ پس تاریخچه‌ی کاملِ همه‌ی قیمت‌ها ساخته می‌شود.

## منابع (مثل نسخه‌ی قبل)
Nobitex/Wallex (تتر، بدون کلید)، gold-api.com→goldprice.org (انس، بدون کلید)،
CoinGecko (PAXG/XAUT، بدون کلید)، Navasan (دلار/درهم/طلای داخلی، **کلید لازم**).
انتساب per-exchange: داده‌ی هر منبع فقط زیر کادر خودش می‌رود؛ چیزی «تخمینی» به‌جای
«واقعی» نشان داده نمی‌شود (فیلد `estimated`).

## تست
```bash
pip install -r requirements.txt
python -m pytest -q     # mapperها، build_model، ذخیره‌ی تاریخچه و endpointها (روی SQLite)
```

## محیط
`DATABASE_URL`, `NAVASAN_API_KEY`, `BRSAPI_KEY` (اختیاری), `PORT` (پیش‌فرض 8787),
`REFRESH_SEC` (حداقل ۱۵), `HTTP_TIMEOUT`.
