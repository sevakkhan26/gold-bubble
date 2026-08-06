#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════
#  Gold Market Live — راه‌اندازی یک‌کلیکی (مک / لینوکس)
#  اجرا:  bash start.sh
#  سایت روی http://localhost:8787 باز می‌شود.
#  (Ctrl+C برای خاموشی)
# ════════════════════════════════════════════════════════════
set -e
cd "$(dirname "$0")"

echo "============================================"
echo "  Gold Market Live — راه‌اندازی"
echo "============================================"

command -v python3 >/dev/null 2>&1 || {
  echo "[خطا] Python نصب نیست!"
  echo "نصب از:  https://www.python.org/downloads/"
  exit 1
}

if [ ! -d .venv ]; then
  echo "[1/3] ساخت محیط مجازی ..."
  python3 -m venv .venv
fi
# shellcheck disable=SC1091
. .venv/bin/activate

echo "[2/3] بررسی و نصب وابستگی‌ها ..."
pip show fastapi >/dev/null 2>&1 || pip install -r requirements.txt

echo "[3/3] اجرای سایت روی http://localhost:8787"
echo "      (Ctrl+C برای خاموشی)"
( sleep 2 && python3 -m webbrowser "http://localhost:8787" >/dev/null 2>&1 || true ) &
python -m uvicorn app.main:app --host 0.0.0.0 --port 8787
