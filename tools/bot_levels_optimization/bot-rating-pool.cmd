@echo off
cd /d "%~dp0\..\.."
".venv\Scripts\python.exe" -m tools.bot_levels_optimization.rating_pool %*
