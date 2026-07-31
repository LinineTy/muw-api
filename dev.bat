@echo off
REM One-click dev start: kill any leftover server on port 3000, then start fresh.
REM Prevents stale processes from locking the port / database after repeated runs.
setlocal
echo Killing existing server on port 3000 (if any)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1
echo Starting api dev server on http://localhost:3000 ...
go run main.go
endlocal
