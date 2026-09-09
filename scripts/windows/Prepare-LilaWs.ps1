[CmdletBinding()]
param(
  [Parameter(Mandatory)] [string]$Source,
  [Parameter(Mandatory)] [string]$Patch,
  [Parameter(Mandatory)] [string]$Commit,
  [Parameter(Mandatory)] [string]$Marker
)

$ErrorActionPreference = 'Stop'
$Source = (Resolve-Path -LiteralPath $Source).Path
$Patch = (Resolve-Path -LiteralPath $Patch).Path
$head = (& git -C $Source rev-parse HEAD).Trim()
if ($head -ne $Commit) { throw "Unexpected lila-ws revision $head. Expected $Commit." }

function Copy-Marker {
  $markerParent = Split-Path -Parent $Marker
  if ($markerParent) { New-Item -ItemType Directory -Path $markerParent -Force | Out-Null }
  Copy-Item -LiteralPath $Patch -Destination $Marker -Force
}

$reverse = & git -C $Source apply --reverse --check $Patch 2>$null
if ($LASTEXITCODE -eq 0) { Copy-Marker; return }

$direct = & git -C $Source apply --check $Patch 2>$null
if ($LASTEXITCODE -eq 0) {
  & git -C $Source apply $Patch
  if ($LASTEXITCODE) { throw 'Could not apply the lila-ws patch.' }
  Copy-Marker
  return
}

if (-not (Test-Path -LiteralPath $Marker)) {
  throw 'lila-ws has an unknown or unexpected patch state; refusing to modify it.'
}

$temp = Join-Path ([IO.Path]::GetTempPath()) ('lila-ws-prepare-' + [guid]::NewGuid().ToString('N'))
$separator = [IO.Path]::DirectorySeparatorChar
$tempParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) + $separator
try {
  & git clone --local --no-hardlinks $Source $temp 2>$null
  if ($LASTEXITCODE) { throw 'Could not create an isolated lila-ws preparation checkout.' }
  # A local clone contains only committed files. Copy the actual prepared tree
  # over it so the transition test sees the recorded old patch and any tracked
  # or untracked source edits currently present in the real checkout.
  & robocopy $Source $temp /E /XD (Join-Path $Source '.git') (Join-Path $Source 'target') (Join-Path $Source '.bloop') (Join-Path $Source '.metals') /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
  if ($LASTEXITCODE -gt 7) { throw 'Could not copy the prepared lila-ws tree into isolation.' }
  & git -C $temp apply --reverse --check $Marker
  if ($LASTEXITCODE) { throw 'The recorded previous lila-ws patch does not match the checkout.' }
  & git -C $temp apply --reverse $Marker
  if ($LASTEXITCODE) { throw 'Could not remove the recorded lila-ws patch in the isolated checkout.' }
  & git -C $temp apply --check $Patch
  if ($LASTEXITCODE) { throw 'The new lila-ws patch does not apply after removing the recorded patch.' }
} finally {
  if (Test-Path -LiteralPath $temp) {
    $resolvedTemp = (Resolve-Path -LiteralPath $temp).Path
    if (-not $resolvedTemp.StartsWith($tempParent, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to remove unexpected preparation path: $resolvedTemp"
    }
    Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
  }
}

& git -C $Source apply --reverse $Marker
if ($LASTEXITCODE) { throw 'Could not remove the previous lila-ws patch.' }
try {
  & git -C $Source apply $Patch
  if ($LASTEXITCODE) { throw 'Could not apply the new lila-ws patch.' }
  Copy-Marker
} catch {
  & git -C $Source apply $Marker 2>$null
  throw
}
