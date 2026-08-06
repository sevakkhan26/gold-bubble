@echo off
REM اجراي سرور - توسط start.bat صدا زده مي شود (پنجره ي جداگانه)
chcp 65001 >nul
cd /d "%~dp0"
title Gold Market Live Server
call .venv\Scripts\activate.bat
python -m uvicorn app.main:app --host 0.0.0.0 --port 8787 > server.log 2>&1
echo.
echo سرور متوقف شد. اين پنجره را ببنديد.
pause
