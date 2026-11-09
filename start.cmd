@echo off
REM ---------------------------------------------------------------------------
REM Launch Multi-Claude from source.
REM
REM Builds the renderer, then starts Electron detached so closing this window
REM does not kill the app. Double-click it, or pin it to the taskbar.
REM
REM If you would rather have it in the Start Menu, run: npm run dist
REM and install dist\Multi-Claude Setup <version>.exe
REM ---------------------------------------------------------------------------

cd /d "%~dp0"

if not exist "node_modules\electron\dist\electron.exe" (
  echo Dependencies are missing. Running npm install...
  call npm install
  if errorlevel 1 (
    echo.
    echo npm install failed. Fix the error above and try again.
    pause
    exit /b 1
  )
)

echo Building the renderer...
call npx vite build
if errorlevel 1 (
  echo.
  echo The renderer build failed. Nothing was launched.
  pause
  exit /b 1
)

echo Starting Multi-Claude...
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
exit /b 0
