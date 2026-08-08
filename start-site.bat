@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title Gold Market Site - Launcher

echo ============================================
echo   Gold Market Site - Launcher
echo ============================================

where python >nul 2>nul
if not errorlevel 1 (
    python "%~dp0launcher.py"
    goto :done
)
where py >nul 2>nul
if not errorlevel 1 (
    py -3 "%~dp0launcher.py"
    goto :done
)
if exist "%~dp0portable\python\python.exe" (
    "%~dp0portable\python\python.exe" "%~dp0launcher.py"
    goto :done
)
echo.
echo [ERROR] Python not found.
echo   - Extract the full zip (portable python is inside)
echo   - or install Python: https://www.python.org/downloads/
pause
:done
pause
