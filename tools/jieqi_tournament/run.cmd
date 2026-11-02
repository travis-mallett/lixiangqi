@echo off
setlocal
cd /d "%~dp0\..\.."
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" -X utf8 -m tools.jieqi_tournament.run %*
) else (
  python -X utf8 -m tools.jieqi_tournament.run %*
)
exit /b %errorlevel%
