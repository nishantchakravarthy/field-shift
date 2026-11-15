@echo off
title Field Shift - local server
cd /d "%~dp0web"
set LOG=%~dp0run-log.txt
echo Field Shift launcher > "%LOG%"
where node >nul 2>nul
if errorlevel 1 (
  echo NODE_MISSING >> "%LOG%"
  echo Node.js is not installed. Install Node 20 or newer from https://nodejs.org, then run this again.
  pause
  exit /b 1
)
for /f %%v in ('node -v') do echo NODE %%v >> "%LOG%"
rem Stop a server that is still running from an earlier launch
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3000 " ^| findstr LISTENING') do taskkill /PID %%p /F >nul 2>nul
if not exist node_modules (
  echo Installing packages, this takes a few minutes the first time...
  echo STEP install >> "%LOG%"
  call npm install >> "%LOG%" 2>&1
  if errorlevel 1 ( echo INSTALL_FAILED >> "%LOG%" & echo npm install failed, see run-log.txt & pause & exit /b 1 )
)
echo Building the app...
echo STEP build >> "%LOG%"
call npm run build >> "%LOG%" 2>&1
if errorlevel 1 ( echo BUILD_FAILED >> "%LOG%" & echo Build failed, see run-log.txt & pause & exit /b 1 )
echo STEP start >> "%LOG%"
echo Field Shift is running at http://localhost:3000  (close this window to stop it)
call npx next start -p 3000 >> "%LOG%" 2>&1
