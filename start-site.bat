@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title Gold Market Site - راه انداز سايت

echo ============================================
echo   Gold Market Site - راه اندازي سايت
echo   (پايتون همراه برنامه است؛ نيازي به نصب نيست)
echo ============================================
echo.

REM ---------- 0) فايل ها کامل اکسترکت شده؟ ----------
if not exist "%~dp0lite\server.py" (
    echo [خطا] فايل هاي سايت پيدا نشد!
    echo.
    echo اول کليک راست روي فايل زيپ  -  Extract All
    echo و بعد از داخل پوشه ي بازشده، اين فايل را اجرا کنيد.
    echo.
    pause
    exit /b 1
)

REM ---------- 1) انتخاب پايتون ----------
set "PY="
REM اول: پايتون همراه (داخل پوشه ي portable) - بدون نياز به نصب
if exist "%~dp0portable\python\python.exe" set "PY=%~dp0portable\python\python.exe"
REM دوم: پايتون نصب شده روي سيستم (مسير معمول نصب کاربر)
if not defined PY if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" set "PY=%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
if not defined PY (
    for /d %%D in ("%LOCALAPPDATA%\Programs\Python\Python3*") do if exist "%%D\python.exe" set "PY=%%D\python.exe"
)
if not defined PY where python >nul 2>nul && set "PY=python"
if not defined PY (
    for /f "delims=" %%P in ('where py 2^>nul') do if not defined PY set "PY=%%P"
)
if not defined PY (
    echo [خطا] هيچ پايتوني پيدا نشد!
    echo   - اگر پوشه کامل Extract شده باشد، پايتون همراه داخل آن است.
    echo   - يا پايتون را از اين آدرس نصب کنيد:
    echo     https://www.python.org/downloads/
    echo     (هنگام نصب تيک Add python.exe to PATH را بزنيد)
    echo   - بعد از نصب، ويندوز را يک بار ري استارت کنيد.
    echo.
    pause
    exit /b 1
)
echo پايتون: %PY%
"%PY%" --version
echo.

REM ---------- 2) اگر سايت از قبل بالا است ----------
"%PY%" -c "import urllib.request,sys;sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8787/api/health',timeout=2).status==200 else 1)" >nul 2>nul
if not errorlevel 1 (
    echo سايت از قبل در حال اجراست. باز کردن مرورگر ...
    start "" http://localhost:8787
    pause
    exit /b 0
)

REM ---------- 3) پورت آزاد است؟ ----------
"%PY%" -c "import socket,sys;sys.exit(0 if socket.socket().connect_ex(('127.0.0.1',8787))==0 else 1)" >nul 2>nul
if not errorlevel 1 (
    echo [خطا] پورت 8787 اشغال است!
    echo برنامه ي ديگري روي اين پورت است؛ آن را ببنديد و دوباره اجرا کنيد.
    pause
    exit /b 1
)

REM ---------- 4) اجراي سرور (پنجره ي جداگانه) ----------
echo [1/2] اجراي سرور ...
del "%~dp0lite.log" >nul 2>nul
set "GB_PY=%PY%"
start "Gold Market Site Server" /min "%~dp0run-lite.bat"

REM ---------- 5) صبر تا بالا آمدن ----------
echo [2/2] منتظر بالا آمدن سايت ...
set /a tries=0
:waitloop
set /a tries+=1
"%PY%" -c "import urllib.request,sys;sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8787/api/health',timeout=1).status==200 else 1)" >nul 2>nul
if errorlevel 1 (
    if %tries% lss 60 (
        timeout /t 1 /nobreak >nul
        goto waitloop
    )
)

if %tries% lss 60 (
    echo   سايت آماده است!
) else (
    echo.
    echo [خطا] سايت بالا نيامد. باز کردن لاگ خطا ...
    if exist "%~dp0lite.log" (
        start notepad "%~dp0lite.log"
        echo   فايل lite.log در Notepad باز شد.
    ) else (
        echo   فايل lite.log هنوز ساخته نشده است.
    )
    echo   از پنجره ي «Gold Market Site Server» هم اسکرين شات بگيريد.
    echo.
)
echo   باز کردن مرورگر ...
start "" http://localhost:8787
echo.
echo سايت در پنجره ي جداگانه اجرا مي شود.
echo براي خاموش کردن: پنجره ي «Gold Market Site Server» را ببنديد.
echo.
pause
