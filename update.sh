#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
#  بروزرسانی سایت gold-bubble — مک / لینوکس
#  این اسکریپت: ۱) تغییرات را کامیت می‌کند  ۲) به گیت‌هاب پوش می‌دهد
#  ۳) (اختیاری) دیپلوی فوری روی سرور LAN انجام می‌دهد
#
#  استفاده:
#     bash update.sh                              ← پیام خودکار (تاریخ امروز)
#     bash update.sh "اضافه کردن قابلیت جدید"
#
#  دیپلوی فوری (بدون انتظار پولر ۳۰ ثانیه‌ای سرور):
#     LAN_WEBHOOK="http://192.168.50.128:9000/hooks/update-gold-bubble?token=توکن" bash update.sh
# ═══════════════════════════════════════════════════════════════════════
set -e
cd "$(dirname "$0")"

MSG="${1:-بروزرسانی $(date +%F)}"

command -v git >/dev/null 2>&1 || { echo ">> git نصب نیست: https://git-scm.com"; exit 1; }
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo ">> این پوشه یک ریپوی git نیست"; exit 1; }

echo ">> ۱) ثبت تغییرات ..."
git add -A
if git diff --cached --quiet; then
  echo "   (تغییری برای commit وجود ندارد)"
else
  git commit -q -m "$MSG"
  echo "   ✅ commit شد: $(git log -1 --oneline)"
fi

echo ">> ۲) پوش به گیت‌هاب ..."
if git remote get-url origin >/dev/null 2>&1; then
  git push origin main || {
    echo ">> پوش با origin فعلی نشد — توکن را وارد کنید:"
    read -r -p "   GitHub username [sevakkhan26]: " USER; USER="${USER:-sevakkhan26}"
    read -r -s -p "   Personal Access Token: " TOKEN; echo
    git push "https://${USER}:${TOKEN}@github.com/sevakkhan26/gold-bubble.git" HEAD:main
  }
else
  read -r -p "GitHub username [sevakkhan26]: " USER; USER="${USER:-sevakkhan26}"
  read -r -s -p "Personal Access Token: " TOKEN; echo
  git remote add origin "https://github.com/sevakkhan26/gold-bubble.git"
  git push "https://${USER}:${TOKEN}@github.com/sevakkhan26/gold-bubble.git" HEAD:main
fi
echo ">> ✅ پوش انجام شد — نسخه روی گیت‌هاب به‌روز شد"

if [ -n "${LAN_WEBHOOK:-}" ]; then
  echo ">> ۳) دیپلوی فوری روی سرور LAN ..."
  if curl -s -m 15 -X POST "$LAN_WEBHOOK"; then
    echo "   ✅ وب‌هوک زده شد — سایت هم‌اکنون بروزرسانی می‌شود"
  else
    echo "   ⚠️ وب‌هوک ناموفق بود — پولر خودکار سرور تا ~۳۰ ثانیه دیگر دیپلوی می‌کند"
  fi
else
  echo ">> ۳) صبر کنید: پولر خودکار سرور (حدود ۳۰ ثانیه) خودش دیپلوی می‌کند."
  echo "   برای دیپلوی فوری دفعه بعد:"
  echo "   LAN_WEBHOOK='http://192.168.50.128:9000/hooks/update-gold-bubble?token=...' bash update.sh"
fi
