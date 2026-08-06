@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title Gold Market Live - عيب يابي

echo ============================================
echo   Gold Market Live - عيب يابي
echo ============================================
echo اگر سايت بالا نمي آيد، اين فايل را اجرا کنيد
echo و از نتيجه اسکرين‌شات بگيريد.
echo.

echo [1] پايتون:
where python >nul 2>nul
if not errorlevel 1 (
    python --version
) else (
    echo     python در PATH نيست!
)
if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" (
    echo     پايتون نصب شده روي سيستم:
    "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" --version
) else (
    echo     پايتون در مسير معمول نصب نيست (شايد نصب نشده)
)
echo.

echo [2] محيط مجازي:
if exist .venv (
    echo     .venv موجود است
) else (
    echo     .venv وجود ندارد - start.bat اولين بار آن را مي سازد
)
echo.

echo [3] پورت 8787:
where python >nul 2>nul
if not errorlevel 1 (
    python -c "import socket,sys;sys.exit(0 if socket.socket().connect_ex(('127.0.0.1',8787))==0 else 1)" >nul 2>nul
    if not errorlevel 1 (
        echo     پورت 8787 اشغال است! (برنامه ي ديگري روي آن است)
    ) else (
        echo     پورت 8787 آزاد است
    )
) else (
    echo     (بررسي نشد - پايتون نيست)
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
echo از اين پنجره اسکرين‌شات بگيريد و براي پشتيبان بفرستيد.
pause
