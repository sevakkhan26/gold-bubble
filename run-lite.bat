@echo off
REM اجراي سرور Lite - توسط start-site.bat صدا زده مي شود (پنجره ي جداگانه)
chcp 65001 >nul
cd /d "%~dp0"
title Gold Market Site Server
if not defined GB_PY (
    if exist "%~dp0portable\python\python.exe" (
        set "GB_PY=%~dp0portable\python\python.exe"
    ) else (
        set "GB_PY=python"
    )
)
"%GB_PY%" "%~dp0lite\server.py" > "%~dp0lite.log" 2>&1
echo.
echo سرور متوقف شد. اين پنجره را ببنديد.
pause
