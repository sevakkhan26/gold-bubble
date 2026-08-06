@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title Gold Market Live - راه انداز

echo ============================================
echo   Gold Market Live - راه اندازي سايت
echo ============================================

REM ---------- 1) پيدا کردن پايتون ----------
set "PY="
where python >nul 2>nul && set "PY=python"
if not defined PY where py >nul 2>nul && set "PY=py -3"
if not defined PY (
    echo.
    echo [خطا] پايتون روي اين سيستم پيدا نشد!
    echo.
    echo راه حل: روي  install-python.bat  دوبار کليک کنيد
    echo تا پايتون خودکار نصب شود، بعد دوباره start.bat.
    echo (يا از https://www.python.org/downloads/ نصب کنيد
    echo  و هنگام نصب تيک «Add python.exe to PATH» را بزنيد)
    pause
    exit /b 1
)
echo پايتون: %PY%
%PY% --version

REM ---------- 2) محيط مجازي ----------
if not exist .venv (
    echo.
    echo [1/3] ساخت محيط مجازي ...
    %PY% -m venv .venv
    if errorlevel 1 (
        echo [خطا] ساخت محيط مجازي ناموفق بود.
        pause
        exit /b 1
    )
)
call .venv\Scripts\activate.bat

REM ---------- 3) وابستگي ها ----------
echo.
echo [2/3] بررسي و نصب وابستگي ها ...
python -m pip show fastapi >nul 2>nul
if errorlevel 1 (
    echo   در حال نصب ... (ممکن است چند دقيقه طول بکشد - صبر کنيد)
    python -m pip install -r requirements.txt
    if errorlevel 1 (
        echo.
        echo [خطا] نصب وابستگي ها ناموفق بود. اتصال اينترنت را بررسي کنيد.
        pause
        exit /b 1
    )
) else (
    echo   وابستگي ها نصب است.
)

REM ---------- 4) پورت ----------
python -c "import socket,sys;sys.exit(0 if socket.socket().connect_ex(('127.0.0.1',8787))==0 else 1)" >nul 2>nul
if not errorlevel 1 (
    echo.
    echo [خطا] پورت 8787 اشغال است! برنامه يا سايت ديگري آن را گرفته.
    echo يا برنامه ي ديگر را ببنديد، يا در فايل run-server.bat پورت را عوض کنيد.
    pause
    exit /b 1
)

REM ---------- 5) اجراي سرور در پنجره ي جداگانه ----------
echo.
echo [3/3] راه اندازي سايت روي http://localhost:8787
start "Gold Market Live Server" /min run-server.bat

REM ---------- 6) صبر تا بالا آمدن سايت ----------
set /a tries=0
:waitloop
set /a tries+=1
python -c "import urllib.request,sys;sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8787/api/health',timeout=1).status==200 else 1)" >nul 2>nul
if errorlevel 1 (
    if %tries% lss 60 (
        timeout /t 1 /nobreak >nul
        goto waitloop
    )
)

if %tries% lss 60 (
    echo   سايت آماده است.
) else (
    echo   [هشدار] سايت هنوز پاسخ نمي دهد.
    echo   پنجره ي «Gold Market Live Server» را باز کنيد و خطاها را ببينيد.
)
echo   باز کردن مرورگر ...
start "" http://localhost:8787
echo.
echo سايت در پنجره ي جداگانه در حال اجراست.
echo براي خاموش کردن سايت، پنجره ي «Gold Market Live Server» را ببنديد.
echo اين پنجره را هم مي توانيد ببنديد.
pause
