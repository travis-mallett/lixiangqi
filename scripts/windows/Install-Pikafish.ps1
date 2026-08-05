[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$target = Join-Path $projectRoot '.tools\pikafish'
$executable = Join-Path $target 'Windows\pikafish-avx2.exe'
$linuxExecutable = Join-Path $target 'Linux\pikafish-avx2'
$network = Join-Path $target 'pikafish.nnue'
$release = 'Pikafish-2026-01-02'
$archiveName = 'Pikafish.2026-01-02.7z'
$download = "https://github.com/official-pikafish/Pikafish/releases/download/$release/$archiveName"
$archiveSha256 = '84257063905615919FB4EE6A70273A94843BB6EC04C45E3AC706098838BC1A49'
$executableSha256 = 'A230D4FF63923EB4BFC82D5C86957201B64290C8BC0D752226B4D780A80FA7EB'
$linuxExecutableSha256 = '98B569626C1F49932D5F8B5571740FE75E1A28BEAA75CFD2FEDA87DB2773F8BC'
$networkSha256 = 'C4026370D7516D9B0F668447F9CA1931241538BDC689CDE6FEC6A991AC4D5F77'

function Assert-Sha256 {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string]$Expected
  )

  $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
  if ($actual -ne $Expected) {
    throw "SHA-256 verification failed for $Path. Expected $Expected, got $actual."
  }
}

if ((Test-Path $executable) -and (Test-Path $linuxExecutable) -and (Test-Path $network)) {
  Assert-Sha256 -Path $executable -Expected $executableSha256
  Assert-Sha256 -Path $linuxExecutable -Expected $linuxExecutableSha256
  Assert-Sha256 -Path $network -Expected $networkSha256
  Write-Host "Pikafish is already installed at $target" -ForegroundColor Green
  exit 0
}

$temporary = Join-Path ([System.IO.Path]::GetTempPath()) ("lixiangqi-pikafish-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temporary | Out-Null
try {
  $archive = Join-Path $temporary $archiveName
  Write-Host "Downloading official Pikafish $release..." -ForegroundColor Cyan
  Invoke-WebRequest -Uri $download -OutFile $archive -UseBasicParsing
  Assert-Sha256 -Path $archive -Expected $archiveSha256
  & tar.exe -xf $archive -C $temporary
  if ($LASTEXITCODE) { throw 'Could not extract the Pikafish release archive.' }

  $stagedExe = Join-Path $temporary 'Windows\pikafish-avx2.exe'
  $stagedLinuxExe = Join-Path $temporary 'Linux\pikafish-avx2'
  $stagedNetwork = Join-Path $temporary 'pikafish.nnue'
  if (
    -not (Test-Path $stagedExe) -or
    -not (Test-Path $stagedLinuxExe) -or
    -not (Test-Path $stagedNetwork)
  ) {
    throw 'The official Pikafish archive did not contain the expected Windows/Linux AVX2 engines and NNUE network.'
  }
  Assert-Sha256 -Path $stagedExe -Expected $executableSha256
  Assert-Sha256 -Path $stagedLinuxExe -Expected $linuxExecutableSha256
  Assert-Sha256 -Path $stagedNetwork -Expected $networkSha256

  New-Item -ItemType Directory -Force -Path $target | Out-Null
  Copy-Item -Path (Join-Path $temporary 'Windows') -Destination $target -Recurse -Force
  Copy-Item -Path (Join-Path $temporary 'Linux') -Destination $target -Recurse -Force
  Copy-Item -Path $stagedNetwork -Destination $network -Force
  foreach ($license in 'AUTHORS','Copying.txt','README.md') {
    $source = Join-Path $temporary $license
    if (Test-Path $source) { Copy-Item -Path $source -Destination (Join-Path $target $license) -Force }
  }
  Write-Host "Installed Pikafish $release at $target" -ForegroundColor Green
} finally {
  if (Test-Path $temporary) { Remove-Item -LiteralPath $temporary -Recurse -Force }
}
