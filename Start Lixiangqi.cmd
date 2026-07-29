@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\Start-Lixiangqi.ps1"
if errorlevel 1 (
  echo.
  echo Lixiangqi could not start. The error above and files in logs\ explain why.
  pause
)
