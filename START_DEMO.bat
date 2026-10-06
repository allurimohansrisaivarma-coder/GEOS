@echo off
rem Starts the GEOS dashboard locally (no internet needed) and opens it in your default browser.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Get it from https://nodejs.org & pause & exit /b 1)
echo Starting GEOS at http://localhost:5173  (close this window to stop)
start "" /min cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:5173/"
node scripts\serve.mjs
