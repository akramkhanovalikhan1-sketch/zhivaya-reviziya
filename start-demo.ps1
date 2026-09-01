$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")

Start-Process -WorkingDirectory (Join-Path $root "server") -FilePath "python" -ArgumentList "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"
Start-Process -WorkingDirectory (Join-Path $root "tsd") -FilePath "npm" -ArgumentList "run", "dev"

Write-Host "ТСД:  http://localhost:5173"
Write-Host "АРМ:  http://localhost:8000"
Write-Host "API:  http://localhost:8000/docs"
