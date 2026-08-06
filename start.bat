@echo off
REM ════════════════════════════════════════════════════════════
REM  Gold Market Live — راه‌اندازی یک‌کلیکی (ویندوز)
REM  فقط دوبار کلیک کنید. سایت روی http://localhost:8787 باز می‌شود.
REM  (این پنجره را نبندید — با بستنش سایت خاموش می‌شود)
REM ════════════════════════════════════════════════════════════
chcp 65001 >nul
cd /d "%~dp0"
title Gold Market Live — در حال راه‌اندازی...

echo ============================================
echo   Gold Market Live — راه‌اندازی
echo ============================================

where python >nul 2>nul
if %errorlevel%==0 (
  set PY=python
) else (
  where py >nul 2>nul
  if %errorlevel%==0 (
    set PY=py -3
  ) else (
    echo.
    echo [خطا] Python روي اين سيستم نصب نيست!
    echo از اين آدرس نصب کنيد:  https://www.python.org/downloads/
    echo هنگام نصب، گزينه «Add python.exe to PATH» را تيک بزنيد.
    pause
    exit /b 1
  )
)

if not exist .venv (
  echo [1/3] ساخت محيط مجازي ...
  %PY% -m venv .venv
)
call .venv\Scripts\activate.bat

echo [2/3] بررسي و نصب وابستگي‌ها ...
pip show fastapi >nul 2>nul
if %errorlevel%==0 (
  echo       وابستگي‌ها نصب است.
) else (
  pip install -r requirements.txt
)

echo [3/3] اجراي سايت روي http://localhost:8787
echo       (اين پنجره را باز نگه داريد)
start "" http://localhost:8787
python -m uvicorn app.main:app --host 0.0.0.0 --port 8787
pause
