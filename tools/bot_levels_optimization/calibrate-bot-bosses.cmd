@echo off
setlocal
cd /d "%~dp0..\.."
".venv\Scripts\python.exe" -m tools.bot_levels_optimization %*
exit /b %errorlevel%
