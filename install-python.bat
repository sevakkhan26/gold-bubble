@echo off
setlocal
chcp 65001 >nul
title نصب خودکار پایتون - Gold Market Live

echo ============================================
echo   نصب خودکار پایتون (Python 3.12)
echo ============================================
echo.
echo   فقط دوبار کليک کنيد؛ بقيه کارها خودکار است:
echo   دانلود (~30 مگابايت) + نصب بدون نياز به کليک.
echo   چند دقيقه طول مي کشد. صبر کنيد و پنجره را نبنديد.
echo.

REM ---------- معماري سيستم ----------
set "ARCH=amd64"
if /i "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "ARCH=arm64"
if /i "%PROCESSOR_ARCHITEW6432%"=="AMD64" set "ARCH=amd64"

set "URL=https://www.python.org/ftp/python/3.12.10/python-3.12.10-%ARCH%.exe"
set "INSTALLER=%TEMP%\python-3.12.10-%ARCH%.exe"

echo [1/3] دانلود پایتون ...
where curl >nul 2>nul
if errorlevel 1 (
    powershell -Command "Invoke-WebRequest -Uri '%URL%' -OutFile '%INSTALLER%'" >nul 2>nul
) else (
    curl -L -o "%INSTALLER%" "%URL%" >nul 2>nul
)
if not exist "%INSTALLER%" (
    echo.
    echo [خطا] دانلود ناموفق بود.
    echo اتصال اينترنت را بررسي کنيد و دوباره اجرا کنيد.
    pause
    exit /b 1
)
echo       دانلود انجام شد. (%ARCH%)

echo [2/3] نصب پایتون (بي صدا، بدون نياز به تائيد) ...
"%INSTALLER%" /quiet InstallAllUsers=0 PrependPath=1 Include_launcher=1 Include_test=0 Include_doc=0 Include_tcltk=0
echo       نصب انجام شد.

echo [3/3] بررسي نصب ...
set "LOCAL_PY=%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
if exist "%LOCAL_PY%" (
    "%LOCAL_PY%" --version
    echo.
    echo ============================================
    echo   ✅ پايتون نصب شد!
    echo.
    echo   حالا تمام پنجره ها را ببنديد، دوباره
    echo   وارد پوشه ي gold-bubble شويد و start.bat
    echo   را اجرا کنيد.
    echo ============================================
) else (
    echo.
    echo [هشدار] پايتون در مسير معمول پيدا نشد.
    echo اگر پنجره ي نصب خطايي نشان نداد، cmd جديد باز کنيد
    echo و اين را بزنيد:   python --version
    echo اگر نسخه ي 3.12 نشان داد، start.bat را اجرا کنيد.
)
pause
