@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title Gold Market Live - عيب يابي نسخه همراه

echo ============================================
echo   Gold Market Live - عيب يابي (نسخه همراه)
echo ============================================
echo اگر سايت بالا نمي آيد، اين فايل را اجرا کنيد
echo و از نتيجه اسکرين شات بگيريد.
echo.

set "PY=%~dp0portable\python\python.exe"

echo [1] پايتون همراه:
if exist "%PY%" (
    "%PY%" --version
) else (
    echo     پيدا نشد! (پوشه ي portable را کامل Extract کرده باشيد)
)
echo.

echo [2] بسته هاي اصلي:
"%PY%" -c "import fastapi, uvicorn, sqlalchemy, httpx; print('    fastapi/uvicorn/sqlalchemy/httpx OK')" >nul 2>nul
if errorlevel 1 (
    echo     برخي بسته ها نصب نيستند (آماده سازي اوليه کامل نشده)
) else (
    echo     همه ي بسته ها نصب است
)
echo.

echo [3] پورت 8787:
"%PY%" -c "import socket,sys;sys.exit(0 if socket.socket().connect_ex(('127.0.0.1',8787))==0 else 1)" >nul 2>nul
if not errorlevel 1 (
    echo     پورت اشغال است! (برنامه ي ديگري روي آن است)
) else (
    echo     پورت آزاد است
)
echo.

echo [4] لاگ سرور (server.log):
if exist server.log (
    type server.log
) else (
    echo     هنوز لاگي ساخته نشده است
)
echo.

echo [5] فولدر فعلي:
cd
echo.
echo از اين پنجره اسکرين شات بگيريد و براي پشتيبان بفرستيد.
pause
