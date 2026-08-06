@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title Gold Market Live - اجراي سايت

echo ============================================
echo   Gold Market Live - اجراي سايت
echo   (پايتون همراه برنامه است؛ چيزي نصب نمي شود)
echo ============================================
echo.

REM ---------- بررسي اکسترکت بودن ----------
if not exist "%~dp0app\main.py" (
    echo [خطا] فايل اصلي برنامه پيدا نشد!
    echo لطفا اول کليک راست روي فايل زيپ  -  Extract All
    echo و بعد از داخل پوشه ي بازشده، دوباره اين فايل را اجرا کنيد.
    echo.
    pause
    exit /b 1
)

set "PY=%~dp0portable\python\python.exe"

if not exist "%PY%" (
    echo [خطا] پايتون همراه برنامه پيدا نشد!
    echo مطمئن شويد کل پوشه اکسترکت شده است (پوشه ي portable حذف نشده باشد).
    echo اگر فايل زيپ را دوباره دانلود کرده ايد، دوباره کامل Extract کنيد.
    echo.
    pause
    exit /b 1
)

REM ---------- راه اندازي اول: نصب بسته ها از داخل پوشه (فقط بار اول) ----------
"%PY%" -c "import fastapi, uvicorn, sqlalchemy, httpx" >nul 2>nul
if errorlevel 1 (
    echo [1/3] آماده سازي اوليه ... (فقط بار اول؛ 1-2 دقيقه - صبر کنيد)
    echo       (اينترنت لازم نيست؛ همه چيز داخل پوشه است)
    if not exist "%~dp0portable\python\Lib\site-packages\pip" (
        "%PY%" "%~dp0portable\python\get-pip.py" --no-index --find-links "%~dp0portable\wheels" >nul 2>nul
    )
    "%PY%" -m pip install --no-index --find-links "%~dp0portable\wheels" -r "%~dp0requirements-portable.txt" >nul 2>nul
    "%PY%" -c "import fastapi, uvicorn, sqlalchemy, httpx" >nul 2>nul
    if errorlevel 1 (
        echo.
        echo [خطا] آماده سازي ناموفق بود!
        echo براي عيب يابي روي portable-diagnose.bat کليک کنيد
        echo و اسکرين شات پنجره را براي پشتيبان بفرستيد.
        echo.
        pause
        exit /b 1
    )
    echo       آماده شد.
) else (
    echo [1/3] آماده است.
)

REM ---------- پورت ----------
"%PY%" -c "import socket,sys;sys.exit(0 if socket.socket().connect_ex(('127.0.0.1',8787))==0 else 1)" >nul 2>nul
if not errorlevel 1 (
    echo.
    echo [خطا] پورت 8787 اشغال است! برنامه ي ديگري روي آن است.
    echo برنامه ي ديگر را ببنديد و دوباره اجرا کنيد.
    echo.
    pause
    exit /b 1
)

REM ---------- اجراي سرور ----------
echo [2/3] راه اندازي سايت روي http://localhost:8787
start "Gold Market Live Server" /min cmd /c ""%~dp0portable\python\python.exe" -m uvicorn app.main:app --host 0.0.0.0 --port 8787 > server.log 2>&1"

REM ---------- صبر تا بالا آمدن ----------
echo [3/3] منتظر بالا آمدن سايت ...
set /a tries=0
:waitloop
set /a tries+=1
"%PY%" -c "import urllib.request,sys;sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8787/api/health',timeout=1).status==200 else 1)" >nul 2>nul
if errorlevel 1 (
    if %tries% lss 90 (
        timeout /t 1 /nobreak >nul
        goto waitloop
    )
)

if %tries% lss 90 (
    echo   سايت آماده است.
) else (
    echo.
    echo [هشدار] سايت پاسخ نداد. server.log را ببينيد يا
    echo روي portable-diagnose.bat کليک کنيد و اسکرين شات بگيريد.
)
echo   باز کردن مرورگر ...
start "" http://localhost:8787
echo.
echo سايت در پنجره ي جداگانه در حال اجراست.
echo براي خاموش کردن، پنجره ي «Gold Market Live Server» را ببنديد.
echo.
pause
