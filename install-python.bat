@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title Gold Market Live - نصب خودکار

echo ============================================
echo   Gold Market Live - نصب خودکار پايتون
echo ============================================
echo.

REM ---------- 0) اجرا از داخل زيپ؟ ----------
if not exist "%~dp0start.bat" (
    echo [مهم] به نظر مي رسد اين فايل از داخل خود زيپ اجرا شده است!
    echo.
    echo لطفاً اول زيپ را اکسترکت کنيد:
    echo   کليک راست روي فايل زيپ  -  Extract All
    echo و بعد از داخل پوشه ي بازشده، اين فايل را دوباره اجرا کنيد.
    echo.
    pause
    exit /b 1
)

REM ---------- 1) پيدا کردن پايتون ----------
set "PY="
if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" set "PY="%LOCALAPPDATA%\Programs\Python\Python312\python.exe""
if not defined PY (
    for /d %%D in ("%LOCALAPPDATA%\Programs\Python\Python3*") do if exist "%%D\python.exe" set "PY="%%D\python.exe""
)
if not defined PY where python >nul 2>nul && set "PY=python"
if not defined PY where py >nul 2>nul && set "PY=py -3"

if defined PY (
    echo پايتون پيدا شد: %PY%
    %PY% --version
    echo.
    goto :run_site
)

echo پايتون روي سيستم پيدا نشد. دانلود و نصب خودکار شروع مي شود...
echo.

REM ---------- ويندوز 32 بيتي؟ ----------
set "OS64=1"
if /i "%PROCESSOR_ARCHITECTURE%"=="x86" if not defined PROCESSOR_ARCHITEW6432 set "OS64=0"
if "%OS64%"=="0" (
    echo [خطا] ويندوز 32 بيتي تشخيص داده شد.
    echo اين برنامه به ويندوز 64 بيتي نياز دارد.
    pause
    exit /b 1
)

REM ---------- 2) دانلود با نوار پيشرفت + 3 منبع پشتيبان ----------
set "VER=3.12.10"
set "ARCH=amd64"
if /i "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "ARCH=arm64"
set "FNAME=python-%VER%-%ARCH%.exe"
set "INSTALLER=%TEMP%\%FNAME%"

echo [1/3] دانلود پايتون (حدود 30 مگابايت) ...
echo     اگر اينترنت کند باشد چند دقيقه طول مي کشد.
echo     نوار پيشرفت را ببينيد و پنجره را نبنديد.
echo.

where curl >nul 2>nul
if errorlevel 1 goto :dl_ps

echo     منبع 1: python.org
curl -L --connect-timeout 30 --retry 2 --progress-bar -o "%INSTALLER%" "https://www.python.org/ftp/python/%VER%/%FNAME%"
call :chk
if defined GOOD goto :installing

echo     منبع 1 ناموفق بود. منبع 2: npmmirror
curl -L --connect-timeout 30 --progress-bar -o "%INSTALLER%" "https://cdn.npmmirror.com/binaries/python/%VER%/%FNAME%"
call :chk
if defined GOOD goto :installing

echo     منبع 2 ناموفق بود. منبع 3: Huawei Cloud
curl -L --connect-timeout 30 --progress-bar -o "%INSTALLER%" "https://mirrors.huaweicloud.com/python/%VER%/%FNAME%"
call :chk
if defined GOOD goto :installing
goto :dl_fail

:dl_ps
echo     دانلود از طريق PowerShell ...
powershell -Command "$ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://www.python.org/ftp/python/%VER%/%FNAME%' -OutFile '%INSTALLER%'"
call :chk
if defined GOOD goto :installing
goto :dl_fail

:dl_fail
echo.
echo [خطا] دانلود از همه ي منابع ناموفق بود (اتصال اينترنت را بررسي کنيد).
echo.
echo راه حل دستي: با مرورگر خود اين فايل را دانلود کنيد:
echo     https://www.python.org/ftp/python/%VER%/%FNAME%
echo و آن را در همين پوشه (کنار اين فايل) بگذاريد،
echo سپس دوباره اين فايل را اجرا کنيد.
echo.
pause
exit /b 1

:installing
echo.
echo [2/3] نصب پايتون ... (حداکثر 1-2 دقيقه - صبر کنيد)
"%INSTALLER%" /quiet InstallAllUsers=0 PrependPath=1 Include_launcher=1 Include_test=0 Include_doc=0 Include_tcltk=0

REM ---------- 3) بررسي نصب ----------
set "LOCAL_PY=%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
if not exist "%LOCAL_PY%" (
    for /d %%D in ("%LOCALAPPDATA%\Programs\Python\Python3*") do if exist "%%D\python.exe" set "LOCAL_PY=%%D\python.exe"
)
if exist "%LOCAL_PY%" (
    echo.
    echo ✅ پايتون نصب شد:
    "%LOCAL_PY%" --version
    set "PY="%LOCAL_PY%""
) else (
    echo.
    echo [هشدار] پايتون در مسير معمول پيدا نشد!
    echo نصب احتمالاً ناتمام مانده (خطاي ويندوز يا آنتي ويروس).
    echo باز هم ادامه مي دهيم؛ اگر خطا ديديد، diagnose.bat را اجرا کنيد.
    if not defined PY set "PY=python"
)

REM ---------- 4) راه اندازي خودکار سايت ----------
:run_site
echo.
echo [3/3] راه اندازي سايت ...
echo.
set "GB_PY=%PY%"
call start.bat
echo.
echo پايان. اگر سايت بالا نيامد، روي diagnose.bat دوبار کليک کنيد
echo و اسکرين شات پنجره را براي پشتيبان بفرستيد.
pause
exit /b 0

REM ---------- بررسي سالم بودن فايل دانلود (بيشتر از 5 مگابايت) ----------
:chk
set "GOOD="
set "SZ="
for %%A in ("%INSTALLER%") do set "SZ=%%~zA"
if defined SZ if %SZ% GEQ 5000000 set "GOOD=1"
exit /b
