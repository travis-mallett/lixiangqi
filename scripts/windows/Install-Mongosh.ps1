[CmdletBinding()]
param([string]$Destination = '')
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if (!$Destination) { $Destination = Join-Path $projectRoot '.tools\mongodb\mongosh-2.10.0-win32-x64' }
$url = 'https://github.com/mongodb-js/mongosh/releases/download/v2.10.0/mongosh-2.10.0-win32-x64.zip'
$sha = '4f52b0bb5a08374b8ceec19d2b8da7544985aab377d5799642f31a198554562a'
$temporary = Join-Path ([IO.Path]::GetTempPath()) ('lixiangqi-mongosh-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temporary | Out-Null
try {
  $archive = Join-Path $temporary 'mongosh.zip'
  Invoke-WebRequest -Uri $url -OutFile $archive -UseBasicParsing
  if ((Get-FileHash $archive -Algorithm SHA256).Hash.ToLower() -ne $sha) { throw 'mongosh checksum mismatch.' }
  Expand-Archive -LiteralPath $archive -DestinationPath $temporary -Force
  $staged = Join-Path $temporary 'mongosh-2.10.0-win32-x64'
  if (-not (Test-Path (Join-Path $staged 'bin\mongosh.exe'))) { throw 'mongosh archive is missing bin\mongosh.exe.' }
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  Copy-Item -Path (Join-Path $staged '*') -Destination $Destination -Recurse -Force
} finally {
  if (Test-Path -LiteralPath $temporary) {
    $resolvedTemp = (Resolve-Path -LiteralPath $temporary).Path
    $tempRoot = (Resolve-Path -LiteralPath ([IO.Path]::GetTempPath())).Path.TrimEnd('\') + '\'
    if (-not $resolvedTemp.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing to remove an unexpected temporary path.' }
    Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
  }
}
Write-Host "Installed mongosh 2.10.0 at $Destination"
