@echo off
setlocal
cd /d "%~dp0"

echo ===============================================================
echo ABHAYA MEDICAL CARE - Clinic Management System launcher
echo ===============================================================
echo.

if not exist ".venv" (
    echo [INFO] Creating Python virtual environment...
    py -3 -m venv .venv
)

call .venv\Scripts\activate.bat

echo [INFO] Installing Python dependencies...
.venv\Scripts\python -m pip install --upgrade pip >nul
.venv\Scripts\python -m pip install -r requirements.txt >nul

if not exist "frontend\node_modules" (
    echo [INFO] Installing frontend dependencies...
    cd frontend
    call npm install
    cd ..
)

if not exist "frontend\dist" (
    echo [INFO] Building frontend for production...
    cd frontend
    call npm run build
    cd ..
)

echo [INFO] Launching Abhaya Medical Care...
start "" http://127.0.0.1:5000
.venv\Scripts\python main.py

endlocal
