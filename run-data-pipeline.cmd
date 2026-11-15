@echo off
title Field Shift - data pipeline (South India)
cd /d "%~dp0"
set LOG=%~dp0pipeline-log.txt
echo Field Shift data pipeline > "%LOG%"
echo Started %date% %time% >> "%LOG%"

rem ---- find Python 3.10+ ----
set PY=
py -3 --version >nul 2>nul && set PY=py -3
if not defined PY ( python --version >nul 2>nul && set PY=python )
if not defined PY (
  echo PYTHON_MISSING >> "%LOG%"
  echo Python is not installed. Install Python 3.11 or newer from https://www.python.org/downloads/ ^(tick "Add python.exe to PATH"^), then run this again.
  pause
  exit /b 1
)
for /f "delims=" %%v in ('%PY% --version') do echo %%v >> "%LOG%"

rem ---- private environment with the pipeline's packages ----
if not exist data\.venv\Scripts\python.exe (
  echo Creating a Python environment...
  echo STEP venv >> "%LOG%"
  %PY% -m venv data\.venv >> "%LOG%" 2>&1
  if errorlevel 1 ( echo VENV_FAILED >> "%LOG%" & echo Could not create the environment, see pipeline-log.txt & pause & exit /b 1 )
)
set VPY=%~dp0data\.venv\Scripts\python.exe
echo Installing packages (first run only takes a few minutes)...
echo STEP packages >> "%LOG%"
"%VPY%" -m pip install --upgrade pip >> "%LOG%" 2>&1
"%VPY%" -m pip install requests numpy shapely netCDF4 >> "%LOG%" 2>&1
if errorlevel 1 ( echo PACKAGES_FAILED >> "%LOG%" & echo Package install failed, see pipeline-log.txt & pause & exit /b 1 )

rem ---- keep the Karnataka data that ships with the app ----
if not exist "_backup_karnataka_data\web_public_data" (
  echo STEP backup >> "%LOG%"
  xcopy /e /i /q "web\public\data" "_backup_karnataka_data\web_public_data" >> "%LOG%" 2>&1
  xcopy /e /i /q "api\data" "_backup_karnataka_data\api_data" >> "%LOG%" 2>&1
)

call :step build_geojson.py || goto failed
call :step fetch_power.py || goto failed
call :step fetch_cmip6.py || goto failed
call :step process_cmip6.py || goto failed
call :step fetch_modis.py || goto failed
call :step build_scores.py || goto failed
call :step validate.py || goto failed

echo PIPELINE_DONE %date% %time% >> "%LOG%"
echo.
echo Data for South India is ready. Rebuilding and starting the app...
call "%~dp0run-field-shift.cmd"
exit /b 0

:step
echo Running %1 ...
echo STEP %1 %time% >> "%LOG%"
"%VPY%" -u "data\scripts\%1" >> "%LOG%" 2>&1
if errorlevel 1 ( echo STEP_FAILED %1 >> "%LOG%" & exit /b 1 )
exit /b 0

:failed
echo.
echo A step failed. The log is in pipeline-log.txt. Downloads are cached, so running this again resumes where it stopped.
pause
exit /b 1
