@echo off
REM پوش امن به گيت‌هاب — ويندوز: در PowerShell بزن  .\push.bat
cd /d "%~dp0"
where git >nul 2>nul || (echo git نصب نيست: https://git-scm.com & pause & exit /b 1)
set /p USER=GitHub username [sevakkhan26]: 
if "%USER%"=="" set USER=sevakkhan26
set /p TOKEN=Personal Access Token (paste, then Enter): 
if not exist .git ( git init )
git add -A
git commit -m "Python (FastAPI) backend + PostgreSQL price history"
git branch -M main
git remote remove origin 2>nul
git remote add origin https://github.com/sevakkhan26/gold-bubble.git
git push https://%USER%:%TOKEN%@github.com/sevakkhan26/gold-bubble.git HEAD:main
echo Done.
pause
