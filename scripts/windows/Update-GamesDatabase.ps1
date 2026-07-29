[CmdletBinding()]
param(
  [string]$Database,
  [switch]$ContinueOnError
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$python = Join-Path $projectRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $python -PathType Leaf)) {
  throw "Python environment not found at $python"
}

$arguments = @('-m', 'tools.games_database.update')
if ($Database) {
  $resolvedDatabase = [System.IO.Path]::GetFullPath($Database)
  $arguments += @('--database', $resolvedDatabase)
}
if ($ContinueOnError) {
  $arguments += '--continue-on-error'
}

Push-Location $projectRoot
try {
  & $python @arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Games database update failed with exit code $LASTEXITCODE"
  }
}
finally {
  Pop-Location
}
