[CmdletBinding()]
param([string]$Archive = '', [switch]$Check)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$python = Join-Path $projectRoot '.venv\Scripts\python.exe'
if (-not (Test-Path $python)) { $python = 'python' }
$arguments = @(
  (Join-Path $projectRoot 'scripts\pikafish\install.py'),
  '--browser-dir', (Join-Path $projectRoot 'public\pikafish-web')
)
if ($Archive) { $arguments += @('--archive', $Archive) }
if ($Check) { $arguments += '--check' }
& $python @arguments
if ($LASTEXITCODE) { throw 'Pikafish installation or verification failed.' }
