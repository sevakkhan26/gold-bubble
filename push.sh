#!/usr/bin/env bash
# پوش امن به گیت‌هاب — مک/لینوکس:  bash push.sh
set -e
cd "$(dirname "$0")"
REPO_HOST="github.com/sevakkhan26/gold-bubble.git"
command -v git >/dev/null 2>&1 || { echo ">> git نصب نیست: https://git-scm.com"; exit 1; }
read -p "GitHub username [sevakkhan26]: " USER
USER="${USER:-sevakkhan26}"
read -s -p "Personal Access Token (paste, then Enter): " TOKEN
echo
[ -d .git ] || git init
git add -A
git commit -m "Python (FastAPI) backend + PostgreSQL price history" || echo ">> چیزی برای commit نبود"
git branch -M main
git remote remove origin 2>/dev/null || true
git remote add origin "https://${REPO_HOST}"
echo ">> در حال push ..."
git push "https://${USER}:${TOKEN}@${REPO_HOST}" HEAD:main
echo ">> انجام شد ✅ (توکن ذخیره نشد)"
