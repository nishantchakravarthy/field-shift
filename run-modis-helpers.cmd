@echo off
title Field Shift - MODIS helpers
cd /d "%~dp0"
set VPY=%~dp0data\.venv\Scripts\python.exe
rem Three extra workers starting at different years; finished years are skipped by everyone.
start "MODIS 2006+" /min cmd /c ""%VPY%" -u data\scripts\fetch_modis.py --from 2006 > modis-helper-2006.txt 2>&1"
start "MODIS 2011+" /min cmd /c ""%VPY%" -u data\scripts\fetch_modis.py --from 2011 > modis-helper-2011.txt 2>&1"
start "MODIS 2016+" /min cmd /c ""%VPY%" -u data\scripts\fetch_modis.py --from 2016 > modis-helper-2016.txt 2>&1"
