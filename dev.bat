@echo off
REM One-click dev start: kill any leftover server on port 3000, rebuild the
REM web frontend so go:embed picks up the latest UI, then start fresh.
REM Prevents stale processes from locking the port/database and stale web/dist
REM builds from being embedded after repeated runs.
setlocal
cd /d "%~dp0"

echo Killing existing server on port 3000 (if any)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1

echo Rebuilding web frontend (web/dist)...
cd /d "%~dp0web"
REM `call` is required: npm-installed `bun` is a cmd shim whose trailing
REM goto kills the rest of this batch file when run without it.
call bun run build
if errorlevel 1 (
  echo Frontend build failed, aborting.
  exit /b 1
)
cd /d "%~dp0"

echo Starting api dev server on http://localhost:3000 ...
call go run main.go
endlocal
