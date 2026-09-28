$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
Set-Location -LiteralPath $ProjectRoot
$ProjectDrive = [System.IO.DriveInfo]::new([System.IO.Path]::GetPathRoot($ProjectRoot))
if ($ProjectDrive.AvailableFreeSpace -lt 1MB) {
    throw "Puzzle Studio cannot start because $($ProjectDrive.Name) has no free space. Free space on the project drive, then launch it again."
}
$Python = Join-Path $ProjectRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $Python)) {
    & py -3 -m venv (Join-Path $ProjectRoot '.venv')
    if ($LASTEXITCODE -ne 0) { throw 'Python 3.12 or later is required to create the desktop environment.' }
}
& $Python -c "import PySide6,psutil,paramiko,pymongo; assert PySide6.__version__ == '6.11.0' and psutil.__version__ == '7.2.2'"
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Preparing Puzzle Studio dependencies (first launch)…'
    & $Python -m pip install -r (Join-Path $PSScriptRoot 'requirements.txt')
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed. See the output above.' }
}
$PythonWindow = Join-Path $ProjectRoot '.venv\Scripts\pythonw.exe'
Start-Process -FilePath $PythonWindow -ArgumentList '-m tools.puzzle_catalog.desktop' -WorkingDirectory $ProjectRoot -WindowStyle Hidden
