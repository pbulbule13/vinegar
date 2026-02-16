@echo off
title Vinegar Home Assistant
echo ============================================
echo   Vinegar Home Assistant - Server Launcher
echo ============================================
echo.

:: Kill any existing Node/Next.js processes on port 3000
echo [1/3] Stopping existing servers...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
    echo   Killing process PID: %%a
    taskkill /F /PID %%a >nul 2>&1
)
timeout /t 2 /nobreak >nul

:: Navigate to project directory
echo [2/3] Starting Vinegar server...
cd /d "%~dp0"

:: Start the dev server on all interfaces (accessible from LAN devices)
echo [3/3] Server starting on http://192.168.1.15:3000
echo.
echo   Access from this PC:   http://localhost:3000
echo   Access from devices:   http://192.168.1.15:3000
echo   APK connects to:       http://192.168.1.15:3000
echo.
echo   Press Ctrl+C to stop the server.
echo ============================================
echo.

npx next dev -H 0.0.0.0 -p 3000
