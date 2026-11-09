@echo off
:: Opens a second Claude Desktop using your saved profile in %USERPROFILE%\Claude_Work
:: (login is kept there permanently - do not delete that folder)
setlocal EnableDelayedExpansion
set "PROFILE=%USERPROFILE%\Claude_Work"
set "EXE="

:: Normal installer: pick the newest app-* folder
for /f "delims=" %%D in ('dir /b /ad /o-n "%LOCALAPPDATA%\AnthropicClaude\app-*" 2^>nul') do (
  if not defined EXE if exist "%LOCALAPPDATA%\AnthropicClaude\%%D\claude.exe" set "EXE=%LOCALAPPDATA%\AnthropicClaude\%%D\claude.exe"
)
if not defined EXE if exist "%LOCALAPPDATA%\AnthropicClaude\claude.exe" set "EXE=%LOCALAPPDATA%\AnthropicClaude\claude.exe"

:: Microsoft Store / MSIX install
if not defined EXE (
  for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "(Get-AppxPackage *Claude*).InstallLocation"`) do (
    if exist "%%P\app\claude.exe" set "EXE=%%P\app\claude.exe"
  )
)

if not defined EXE (
  echo Could not find claude.exe. Edit this file and set EXE to its full path.
  pause & exit /b 1
)

start "" "!EXE!" --user-data-dir="%PROFILE%"
