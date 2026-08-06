#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
#  دیپلوی دستی روی سرور LAN — این اسکریپت را روی خود سرور اجرا کنید
#  (همان کاری که auto-deploy-poller بعد از هر پوش به‌صورت خودکار می‌کند)
#
#  روی سرور:
#     bash deploy-server.sh
# ═══════════════════════════════════════════════════════════════════════
set -e
cd "$(dirname "$0")"

echo ">> ۱) دریافت آخرین تغییرات از گیت‌هاب ..."
git fetch origin main
git pull --ff-only origin main

echo ">> ۲) ساخت مجدد تصویر داکر ..."
docker compose build

echo ">> ۳) راه‌اندازی مجدد سرویس‌ها ..."
docker compose up -d

echo ">> ✅ دیپلوی انجام شد — وضعیت:"
docker compose ps
