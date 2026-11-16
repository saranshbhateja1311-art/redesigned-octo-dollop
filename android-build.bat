@echo off
setlocal EnableExtensions
cd /d "%~dp0"
where node >nul 2>nul || (echo Install Node.js 22+ first.& pause& exit /b 1)
if not exist node_modules (call npm install || (echo npm install failed.& pause& exit /b 1))
call node prepare-web.js || (echo Could not prepare web assets.& pause& exit /b 1)
if not exist android\gradlew.bat (
  call npx cap add android || (echo Could not create Android project.& pause& exit /b 1)
)
call npx cap sync android || (echo Capacitor sync failed.& pause& exit /b 1)
cd android
call gradlew.bat assembleDebug
if errorlevel 1 (echo Android build failed.& pause& exit /b 1)
echo APK: android\app\build\outputs\apk\debug\app-debug.apk
pause
