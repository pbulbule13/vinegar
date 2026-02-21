@echo off
title Vinegar Home Assistant
echo ============================================
echo   Vinegar Home Assistant - Server Launcher
echo ============================================
echo.

:: Use port 3001 to avoid conflicts with other services (React, Express, etc. commonly use 3000)
set PORT=3001

:: Check and kill any process already using our port
echo [1/4] Checking for port conflicts...
set FOUND_CONFLICT=0
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%PORT%" ^| findstr "LISTENING"') do (
    echo   Port %PORT% in use by PID: %%a - stopping it...
    taskkill /F /PID %%a >nul 2>&1
    set FOUND_CONFLICT=1
)
if %FOUND_CONFLICT%==0 (
    echo   Port %PORT% is free.
)

:: Also kill any stale Next.js dev server processes
echo [2/4] Cleaning up stale processes...
for /f "tokens=2 delims=," %%a in ('tasklist /FO CSV ^| findstr /I "node.exe"') do (
    wmic process where "ProcessId=%%~a" get CommandLine 2>nul | findstr /I "next dev" >nul 2>&1 && (
        echo   Killing stale Next.js process PID: %%~a
        taskkill /F /PID %%~a >nul 2>&1
    )
)
timeout /t 1 /nobreak >nul

:: Navigate to project directory
echo [3/4] Starting Vinegar server...
cd /d "%~dp0"

:: Display access info
echo [4/4] Server starting on port %PORT%
echo.
echo   Access from this PC:   http://localhost:%PORT%
echo   Access from devices:   http://192.168.1.15:%PORT%
echo   APK connects to:       http://192.168.1.15:%PORT%
echo   Documentation:         http://192.168.1.15:%PORT%/docs.html
echo.
echo   Press Ctrl+C to stop the server.
echo ============================================
echo.

npx next dev -H 0.0.0.0 -p %PORT%
