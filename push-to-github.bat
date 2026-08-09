@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title Push to GitHub - Gold Bubble

echo ============================================
echo   Push to GitHub - Gold Bubble
echo   (کاميت و ارسال همه ي تغييرات به گيت هاب)
echo ============================================
echo.

if not exist "%~dp0app\main.py" (
    echo [خطا] فولدر پروژه ي gold-bubble نيست!
    echo اين فايل را از داخل پوشه ي gold-bubble اجرا کنيد.
    pause
    exit /b 1
)

set /p USERNAME=GitHub username [sevakkhan26]: 
if "%USERNAME%"=="" set USERNAME=sevakkhan26
set /p TOKEN=Personal Access Token (paste): 

echo.
echo [1/4] بررسي گيت ...
if not exist .git (
    echo     ريپو ي جديد ساخته مي شود ...
    git init -q
    git branch -M main
)

echo [2/4] ثبت تغييرات ...
git add -A
git diff --cached --quiet
if %errorlevel%==0 (
    echo     (تغييري براي commit نيست - همه چيز قبلا ثبت شده)
) else (
    git commit -q -m "update: latest changes (v2.2.7 - percent spread UI, Persian source status, Lite server)"
    echo     commit شد
)

echo [3/4] تنظيم remote ...
git remote remove origin >nul 2>nul
git remote add origin https://github.com/%USERNAME%/gold-bubble.git

echo [4/4] ارسال به گيت هاب ...
git push https://%USERNAME%:%TOKEN%@github.com/%USERNAME%/gold-bubble.git HEAD:main
if errorlevel 1 (
    echo.
    echo [خطا] push ناموفق بود!
    echo   - توکن را بررسي کنيد (دسترسي repo داشته باشد)
    echo   - نام کاربری درست باشد
    echo   - اتصال اينترنت برقرار باشد
    pause
    exit /b 1
)

echo.
echo ============================================
echo   ✅ Push انجام شد!
echo   پولر سرور LAN تا ~30 ثانيه ديگر خودش
echo   نسخه ي جديد را ديپلوي مي کند.
echo ============================================
echo.
echo (توکن ذخيره نشد - فقط همين اجرا)
pause
