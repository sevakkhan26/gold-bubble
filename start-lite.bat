@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title Gold Market Lite - راه انداز سريع

echo ============================================
echo   Gold Market Lite - راه انداز سريع سايت
echo   (فقط با پايتون؛ هيچ کتابخانه اي نصب نمي شود)
echo ============================================
echo.

if not exist "%~dp0lite\server.py" (
    echo [خطا] فايل سرور پيدا نشد!
    echo لطفا اول کليک راست روي فايل زيپ  -  Extract All
    echo و بعد از داخل پوشه ي بازشده، دوباره اين فايل را اجرا کنيد.
    echo.
    pause
    exit /b 1
)

REM ---------- پيدا کردن پايتون ----------
set "PY="
if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" set "PY="%LOCALAPPDATA%\Programs\Python\Python312\python.exe""
if not defined PY (
    for /d %%D in ("%LOCALAPPDATA%\Programs\Python\Python3*") do if exist "%%D\python.exe" set "PY="%%D\python.exe""
)
if not defined PY where python >nul 2>nul && set "PY=python"
if not defined PY where py >nul 2>nul && set "PY=py -3"
if not defined PY (
    echo [خطا] پايتون پيدا نشد!
    echo اگر پايتون نداريد: روي  portable-start.bat  کليک کنيد
    echo (آن نسخه پايتون را همراه خود دارد، بدون نصب).
    echo اگر پايتون نصب کرده ايد اما ديده نمي شود:
    echo ويندوز را يک بار ري استارت کنيد، بعد دوباره اين فايل.
    echo.
    pause
    exit /b 1
)
echo پايتون: %PY%
%PY% --version
echo.

REM ---------- پورت ----------
%PY% -c "import socket,sys;sys.exit(0 if socket.socket().connect_ex(('127.0.0.1',8787))==0 else 1)" >nul 2>nul
if not errorlevel 1 (
    echo [خطا] پورت 8787 اشغال است!
    echo شايد نسخه ي قبلي سايت هنوز باز است (پنجره ي
    echo «Gold Market Live Server» يا «Gold Market Lite Server»
    echo را ببنديد) يا برنامه ي ديگري اين پورت را گرفته.
    echo.
    pause
    exit /b 1
)

REM ---------- اجرا ----------
echo [1/2] اجراي سرور سبک ...
start "Gold Market Lite Server" /min cmd /c "cd /d "%~dp0" && %PY% lite\server.py > lite.log 2>&1"

echo [2/2] منتظر بالا آمدن سايت ...
set /a tries=0
:waitloop
set /a tries+=1
%PY% -c "import urllib.request,sys;sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8787/api/health',timeout=1).status==200 else 1)" >nul 2>nul
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
    echo [هشدار] سايت پاسخ نداد. لطفا:
    echo   1) فايل lite.log را در همين پوشه باز کنيد
    echo   2) يا روي portable-diagnose.bat کليک کنيد
    echo   3) و اسکرين شات را براي پشتيبان بفرستيد
)
echo   باز کردن مرورگر ...
start "" http://localhost:8787
echo.
echo سايت در پنجره ي جداگانه در حال اجراست.
echo براي خاموش کردن، پنجره ي «Gold Market Lite Server» را ببنديد.
echo.
pause
