@echo off
setlocal EnableExtensions
cd /d "%~dp0"
echo Starting APEX OS...
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or newer is required. Install Node.js and run this again.
  pause
  exit /b 1
)
for /f "tokens=1" %%v in ('node -p "process.versions.node.split('.')[0]"') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 22 (
  echo Node.js 22 or newer is required. Current major version: %NODE_MAJOR%
  pause
  exit /b 1
)
start "APEX OS Server" /min cmd /c "cd /d ""%~dp0"" && node server.js"
set "READY=0"
for /l %%i in (1,1,30) do (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$ok=$false; try {$r=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3012/health' -TimeoutSec 1; if($r.StatusCode -eq 200){$ok=$true}} catch {}; if($ok){exit 0}else{exit 1}"
  if not errorlevel 1 (set "READY=1" & goto ready)
  timeout /t 1 /nobreak >nul
)
if "%READY%"=="0" (
  echo APEX OS did not become ready at http://127.0.0.1:3012
  echo Check the APEX OS Server window for errors.
  pause
  exit /b 1
)
:ready
echo APEX OS is ready. Opening browser...
"%SystemRoot%\explorer.exe" "http://127.0.0.1:3012/"
exit /b 0
