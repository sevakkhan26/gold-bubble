@echo off
REM ════════════════════════════════════════════════════════════
REM  بروزرسانی سایت gold-bubble — ویندوز
REM  استفاده:  update.bat "پیام کامیت (اختیاری)"
REM  برای دیپلوی فوری، قبل از اجرا:
REM     set LAN_WEBHOOK=http://192.168.50.128:9000/hooks/update-gold-bubble?token=توکن
REM ════════════════════════════════════════════════════════════
chcp 65001 >nul
cd /d "%~dp0"
where git >nul 2>nul || (echo git نصب نیست: https://git-scm.com & pause & exit /b 1)

set MSG=%~1
if "%MSG%"=="" set MSG=بروزرسانی %date%

echo [1/3] ثبت تغییرات ...
git add -A
git diff --cached --quiet
if %errorlevel%==0 (
  echo   (تغییری برای commit وجود ندارد)
) else (
  git commit -q -m "%MSG%"
  echo   commit شد
)

echo [2/3] پوش به گیت‌هاب ...
git remote get-url origin >nul 2>nul
if %errorlevel%==0 (
  git push origin main
) else (
  set /p USER=GitHub username [sevakkhan26]: 
  if "%USER%"=="" set USER=sevakkhan26
  set /p TOKEN=Personal Access Token: 
  git remote add origin https://github.com/sevakkhan26/gold-bubble.git
  git push https://%USER%:%TOKEN%@github.com/sevakkhan26/gold-bubble.git HEAD:main
)
if errorlevel 1 (
  echo.
  echo خطا در push! توکن یا دسترسی را بررسی کنید.
  pause
  exit /b 1
)
echo پوش انجام شد

if defined LAN_WEBHOOK (
  echo [3/3] دیپلوی فوری روی سرور LAN ...
  curl -s -m 15 -X POST "%LAN_WEBHOOK%"
) else (
  echo [3/3] پولر سرور تا حدود 30 ثانیه خودش دیپلوی می‌کند.
)
pause
