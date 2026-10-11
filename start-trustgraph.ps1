# TRUSTGRAPH — start all four services in separate PowerShell windows.
# Run once per module first (see README "Quick start"): npm install / venv + pip install / alembic upgrade head.
$ErrorActionPreference = "Continue"
$ROOT = $PSScriptRoot

Write-Host "`n=== TRUSTGRAPH STARTUP ===" -ForegroundColor Cyan

if (-not (Test-Path "$ROOT\backend\.env")) {
    Write-Host "backend\.env is missing: copy backend\.env.example to backend\.env, otherwise Module 2 uses MOCK adapters." -ForegroundColor Yellow
}

# Module 1: Sentinel DRP (brand registry + scans), port 3000
Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "Set-Location '$ROOT\module1'; npm run dev"
)

# Module 3: Entity & Evidence service, port 8001
Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "Set-Location '$ROOT\module3'; .\.venv\Scripts\Activate.ps1; uvicorn module3.main:app --port 8001"
)

# Module 2: Risk engine + Module 4 AI Security Analyst API, port 8000
Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "Set-Location '$ROOT\backend'; .\.venv\Scripts\Activate.ps1; uvicorn app.main:app --reload --port 8000"
)

# Module 4: TRUSTGRAPH console (unified dashboard), port 5173
Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "Set-Location '$ROOT\frontend'; npm run dev"
)

Write-Host "`nStartup commands launched." -ForegroundColor Green
Write-Host "Console:  http://localhost:5173"
Write-Host "Module 1: http://localhost:3000/api/health"
Write-Host "Module 2: http://localhost:8000/readyz   (API docs: /docs)"
Write-Host "Module 3: http://localhost:8001/healthz"
