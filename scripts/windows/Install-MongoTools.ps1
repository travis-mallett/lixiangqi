[CmdletBinding()]
param([string]$Destination = '')
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if (!$Destination) { $Destination = Join-Path $projectRoot '.tools\mongodb\mongodb-database-tools-windows-x86_64-100.13.0' }
$url = 'https://fastdl.mongodb.org/tools/db/mongodb-database-tools-windows-x86_64-100.13.0.zip'
$sha = '304735512a26efcfe818d78c082ca33f41ace11129f6f6a3e6966c0f1e13be0b'
$temporary = Join-Path ([IO.Path]::GetTempPath()) ('lixiangqi-mongosh-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temporary | Out-Null
try {
  $archive = Join-Path $temporary 'mongo-tools.zip'
  Invoke-WebRequest -Uri $url -OutFile $archive -UseBasicParsing
  if ((Get-FileHash $archive -Algorithm SHA256).Hash.ToLower() -ne $sha) { throw 'MongoDB tools checksum mismatch.' }
  Expand-Archive -LiteralPath $archive -DestinationPath $temporary -Force
  $staged = Join-Path $temporary 'mongodb-database-tools-windows-x86_64-100.13.0'
  if (-not (Test-Path (Join-Path $staged 'bin\mongorestore.exe'))) { throw 'MongoDB tools archive is missing bin\mongorestore.exe.' }
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
Write-Host "Installed MongoDB tools 100.13.0 at $Destination"
