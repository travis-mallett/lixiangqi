[CmdletBinding()]
param(
  [switch]$NoBrowser,
  [switch]$SkipBuild,
  [switch]$LanAccess
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$logsDir = Join-Path $projectRoot 'logs'
$dataDir = Join-Path $projectRoot 'data\local'
$toolsDir = Join-Path $projectRoot '.tools'

New-Item -ItemType Directory -Force -Path $logsDir, $dataDir | Out-Null

function Write-Step([string]$message) {
  Write-Host "[Lixiangqi] $message" -ForegroundColor Cyan
}

function Test-Port([int]$port) {
  return [bool](Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
}

function Wait-Port([int]$port, [int]$seconds, [string]$name) {
  $deadline = (Get-Date).AddSeconds($seconds)
  do {
    if (Test-Port $port) { return }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)
  throw "$name did not start on port $port. See $logsDir"
}

function Get-LanIPv4Address {
  $route = Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue |
    Where-Object { $_.NextHop -ne '0.0.0.0' } |
    Sort-Object @{ Expression = { $_.RouteMetric + $_.InterfaceMetric } } |
    Select-Object -First 1
  if (-not $route) {
    throw 'No active IPv4 network with a default gateway was found.'
  }

  $address = Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $route.InterfaceIndex -ErrorAction SilentlyContinue |
    Where-Object {
      $_.AddressState -eq 'Preferred' -and
      $_.IPAddress -notlike '127.*' -and
      $_.IPAddress -notlike '169.254.*'
    } |
    Select-Object -First 1 -ExpandProperty IPAddress
  if (-not $address) {
    throw "No usable IPv4 address was found on interface $($route.InterfaceAlias)."
  }
  return $address
}

function Start-Background(
  [string]$name,
  [string]$executable,
  [string[]]$arguments,
  [string]$stdout,
  [string]$stderr,
  [string]$workingDirectory = $projectRoot
) {
  Write-Step "Starting $name"
  Start-Process -FilePath $executable -ArgumentList $arguments -WorkingDirectory $workingDirectory `
    -RedirectStandardOutput $stdout -RedirectStandardError $stderr -WindowStyle Hidden | Out-Null
}

function Stop-LocalService([int]$port, [string]$name, [string[]]$commandPatterns) {
  $listener = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if (-not $listener) { return }

  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue
  $parent = if ($process) {
    Get-CimInstance Win32_Process -Filter "ProcessId=$($process.ParentProcessId)" -ErrorAction SilentlyContinue
  }
  $matchesService = $false
  foreach ($pattern in $commandPatterns) {
    if ($process.CommandLine -like $pattern) {
      $matchesService = $true
      break
    }
  }
  $belongsToProject =
    ($process.ExecutablePath -and $process.ExecutablePath.StartsWith($projectRoot, [StringComparison]::OrdinalIgnoreCase)) -or
    ($parent -and $parent.ExecutablePath -and $parent.ExecutablePath.StartsWith($projectRoot, [StringComparison]::OrdinalIgnoreCase)) -or
    ($parent -and $parent.CommandLine -and $parent.CommandLine.IndexOf($projectRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0)

  if (-not $process -or -not $matchesService -or -not $belongsToProject) {
    throw "Port $port is occupied by another process. Stop it before starting Lixiangqi."
  }

  Write-Step "Restarting $name so source and asset changes take effect"
  Stop-Process -Id $process.ProcessId -Force
  if ($parent -and $parent.ProcessId -ne $PID -and $belongsToProject) {
    Stop-Process -Id $parent.ProcessId -Force -ErrorAction SilentlyContinue
  }
  $deadline = (Get-Date).AddSeconds(10)
  while ((Get-Date) -lt $deadline -and (Test-Port $port)) {
    Start-Sleep -Milliseconds 250
  }
  if (Test-Port $port) { throw "$name did not stop on port $port." }
}

function Stop-LocalProcess([string]$name, [string]$commandPattern) {
  $processes = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      $_.CommandLine -like $commandPattern -and
      $_.ExecutablePath -and
      $_.ExecutablePath.StartsWith($projectRoot, [StringComparison]::OrdinalIgnoreCase)
    }
  foreach ($process in $processes) {
    Write-Step "Restarting $name so source changes take effect"
    Stop-Process -Id $process.ProcessId -Force
  }
}

Set-Location $projectRoot
$siteAddress = 'lixiangqi.localhost'
if ($LanAccess) {
  $siteAddress = Get-LanIPv4Address
  Write-Warning @'
LAN access uses plain HTTP, so browsers will not expose SharedArrayBuffer and
browser Pikafish analysis will be unavailable. Use the default localhost mode
for analysis, or put the LAN site behind trusted HTTPS.
'@
}
$siteDomain = "${siteAddress}:9663"

$mongo = Get-ChildItem (Join-Path $toolsDir 'mongodb') -Filter mongod.exe -Recurse -ErrorAction SilentlyContinue |
  Select-Object -First 1 -ExpandProperty FullName
$redis = Get-ChildItem (Join-Path $toolsDir 'redis') -Filter redis-server.exe -Recurse -ErrorAction SilentlyContinue |
  Select-Object -First 1 -ExpandProperty FullName
$java = Get-ChildItem (Join-Path $toolsDir 'jdk-21') -Filter java.exe -Recurse -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -match '[\\/]bin[\\/]java\.exe$' } |
  Select-Object -First 1 -ExpandProperty FullName
$sbt = Join-Path $toolsDir 'sbt\sbt-launch-2.0.3.jar'
$python = Join-Path $projectRoot '.venv\Scripts\python.exe'
$pikafish = Join-Path $toolsDir 'pikafish\Windows\pikafish-avx2.exe'
$lilaWsDir = Join-Path $toolsDir 'lila-ws'
$lilaWsPatch = Join-Path $PSScriptRoot 'lila-ws-xiangqi.patch'
$lilaWsConf = Join-Path $PSScriptRoot 'lila-ws.conf'
$lilaWsCommit = 'cd3e2e9e5a38be76d89fa76136940f6a5c086437'

if (-not $mongo) { throw 'MongoDB is missing from .tools\mongodb. Run the Windows bootstrap first.' }
if (-not $redis) { throw 'Redis is missing from .tools\redis. Run the Windows bootstrap first.' }
if (-not $java) { throw 'Temurin JDK 21 is missing from .tools\jdk-21.' }
if (-not (Test-Path $sbt)) { throw 'The SBT launcher is missing from .tools\sbt.' }
if (-not (Test-Path $python)) { throw 'The Python virtual environment is missing. Run: python -m venv .venv' }
$pythonRequirements = Join-Path $PSScriptRoot 'requirements.txt'
& $python -c 'import pymongo' 2>$null
if ($LASTEXITCODE) {
  Write-Step 'Installing the local data synchronization dependency'
  & $python -m pip install -r $pythonRequirements
  if ($LASTEXITCODE) { throw 'Python dependency installation failed.' }
}
if (-not (Test-Path $lilaWsPatch)) { throw 'The Xiangqi lila-ws patch is missing.' }
if (-not (Test-Path $lilaWsConf)) { throw 'The local lila-ws configuration is missing.' }
if (-not (Test-Path $pikafish)) {
  Write-Step 'Installing the official Pikafish Xiangqi analysis engine'
  & (Join-Path $PSScriptRoot 'Install-Pikafish.ps1')
  if (-not (Test-Path $pikafish)) { throw 'Pikafish installation failed.' }
}
$env:LIXIANGQI_PIKAFISH = $pikafish

if (-not (Test-Path (Join-Path $lilaWsDir '.git'))) {
  Write-Step 'Installing the native Lila websocket service'
  & git clone https://github.com/lichess-org/lila-ws.git $lilaWsDir
  if ($LASTEXITCODE) { throw 'Could not clone lila-ws.' }
  & git -C $lilaWsDir checkout $lilaWsCommit
  if ($LASTEXITCODE) { throw "Could not check out lila-ws $lilaWsCommit." }
}
$installedLilaWsCommit = (& git -C $lilaWsDir rev-parse HEAD).Trim()
if ($installedLilaWsCommit -ne $lilaWsCommit) {
  throw "Unexpected lila-ws revision $installedLilaWsCommit. Expected $lilaWsCommit."
}
& git -C $lilaWsDir apply --reverse --check $lilaWsPatch 2>$null
if ($LASTEXITCODE -ne 0) {
  & git -C $lilaWsDir apply --check $lilaWsPatch
  if ($LASTEXITCODE) { throw 'The Xiangqi lila-ws patch does not apply cleanly.' }
  & git -C $lilaWsDir apply $lilaWsPatch
  if ($LASTEXITCODE) { throw 'Could not apply the Xiangqi lila-ws patch.' }
}

$applicationConf = Join-Path $projectRoot 'conf\application.conf'
if (-not (Test-Path $applicationConf)) {
  Copy-Item (Join-Path $projectRoot 'conf\application.conf.default') $applicationConf
  Add-Content $applicationConf @'

# Lixiangqi local overrides
net.site.name = "lixiangqi.org"
net.ratelimit = false
'@
}
$applicationText = [IO.File]::ReadAllText($applicationConf)
$applicationTextWithSockets = [Regex]::Replace(
  $applicationText,
  '(?m)^net\.socket\.domains\s*=\s*\[\]\r?\n?',
  ''
)
if ($applicationTextWithSockets -ne $applicationText) {
  [IO.File]::WriteAllText(
    $applicationConf,
    $applicationTextWithSockets,
    [Text.UTF8Encoding]::new($false)
  )
}

if (-not $SkipBuild) {
  Write-Step 'Building the Lichess asset manifest, browser bundles, and styles'
  & node ui\.build\src\main.ts --no-install
  if ($LASTEXITCODE) { throw 'Lichess asset build failed.' }
}

# The launcher is also the local restart command. Keeping an existing process
# here would leave old Scala classes and the old asset manifest in memory even
# though the files above were rebuilt.
Stop-LocalService 9663 'Lichess/Lixiangqi web application' @(
  '*lila.app.Lila*'
)
Stop-LocalService 9664 'Lila websocket service' @(
  '*lila.ws.LilaWs*'
  '*lila-ws*'
)
Stop-LocalService 9002 'Xiangqi explorer' @('*external.xiangqi_explorer.server*')
Stop-LocalProcess 'Pikafish AI worker' '*external.pikafish_worker.ai*'

$mongoData = Join-Path $dataDir 'mongodb'
$redisData = Join-Path $dataDir 'redis'
New-Item -ItemType Directory -Force -Path $mongoData, $redisData | Out-Null

if (-not (Test-Port 27017)) {
  Start-Background 'MongoDB' $mongo @(
    '--bind_ip', '127.0.0.1', '--port', '27017', '--dbpath', $mongoData,
    '--logpath', (Join-Path $logsDir 'mongodb.log'), '--logappend'
  ) (Join-Path $logsDir 'mongodb.stdout.log') (Join-Path $logsDir 'mongodb.stderr.log')
  Wait-Port 27017 30 'MongoDB'
}

$puzzleDatabase = Join-Path $dataDir 'xiangqi-puzzle-mining.sqlite3'
if (Test-Path $puzzleDatabase) {
  Write-Step 'Synchronizing mined puzzles with the puzzle player'
  & $python -m tools.xiangqi_data.puzzle_mining.puzzle_sync --source $puzzleDatabase
  if ($LASTEXITCODE) { throw 'Native puzzle synchronization failed.' }
}

if (-not (Test-Port 6379)) {
  $redisPath = $redisData.Replace('\', '/')
  Start-Background 'Redis' $redis @(
    '--bind', '127.0.0.1', '--port', '6379', '--protected-mode', 'yes',
    '--dir', $redisPath, '--dbfilename', 'lixiangqi.rdb', '--appendonly', 'no'
  ) (Join-Path $logsDir 'redis.stdout.log') (Join-Path $logsDir 'redis.stderr.log')
  Wait-Port 6379 30 'Redis'
}

Write-Step 'Ensuring the write-time opening explorer index is current'
& $python -m tools.games_database.explorer_index ensure
if ($LASTEXITCODE) { throw 'Opening explorer index preparation failed.' }

$env:LIXIANGQI_DOMAIN = $siteDomain
$env:LIXIANGQI_SOCKET_DOMAIN = "${siteAddress}:9664"
if (-not (Test-Port 9664)) {
  Start-Background 'Lila websocket service' $java @(
    '-Xms32m', '-Xmx512m', '-Dsbt.supershell=false', '-Dsbt.color=false',
    "-Dconfig.file=$lilaWsConf", '-jar', $sbt, 'run'
  ) (Join-Path $logsDir 'lila-ws.stdout.log') (Join-Path $logsDir 'lila-ws.stderr.log') $lilaWsDir
  Wait-Port 9664 180 'Lila websocket service'
}

if (-not (Test-Port 9002)) {
  Start-Background 'Xiangqi opening explorer' $python @(
    '-m', 'external.xiangqi_explorer.server', '--host', '127.0.0.1', '--port', '9002'
  ) (Join-Path $logsDir 'xiangqi-explorer.stdout.log') (Join-Path $logsDir 'xiangqi-explorer.stderr.log')
  Wait-Port 9002 30 'Xiangqi explorer'
}

Start-Background 'Pikafish AI worker' $python @(
  '-m', 'external.pikafish_worker.ai'
) (Join-Path $logsDir 'pikafish-worker.stdout.log') (Join-Path $logsDir 'pikafish-worker.stderr.log')

if (-not (Test-Port 9663)) {
  # Typesafe Config gives JVM system properties precedence over application.conf.
  # JAVA_TOOL_OPTIONS reaches both SBT and its forked application JVM, allowing
  # local access without changing the application's checked-in domain settings.
  $env:JAVA_TOOL_OPTIONS = "$($env:JAVA_TOOL_OPTIONS) -Dnet.domain=$siteDomain".Trim()
  Start-Background 'Lichess/Lixiangqi web application' $java @(
    '-Xms512m', '-Xmx6g', '-Dsbt.supershell=false', '-Dsbt.color=false',
    '-jar', $sbt, 'run'
  ) (Join-Path $logsDir 'lixiangqi.stdout.log') (Join-Path $logsDir 'lixiangqi.stderr.log')
}

Write-Step 'Waiting for the full website (first startup can take several minutes)'
$siteUrl = "http://$siteDomain/"
$healthUrl = 'http://127.0.0.1:9663/'
$deadline = (Get-Date).AddMinutes(6)
do {
  try {
    $response = Invoke-WebRequest -Uri $healthUrl -Headers @{ Host = $siteDomain } -UseBasicParsing -TimeoutSec 5
    if ($response.StatusCode -eq 200) { break }
  } catch {
    Start-Sleep -Seconds 1
  }
} while ((Get-Date) -lt $deadline)

if ((Get-Date) -ge $deadline) {
  Write-Host "Lixiangqi did not become ready. Recent server output:" -ForegroundColor Red
  Get-Content (Join-Path $logsDir 'lixiangqi.stderr.log') -Tail 40 -ErrorAction SilentlyContinue
  Get-Content (Join-Path $logsDir 'lixiangqi.stdout.log') -Tail 40 -ErrorAction SilentlyContinue
  throw "Website startup timed out. See $logsDir"
}

Write-Host "Lixiangqi is ready: $siteUrl" -ForegroundColor Green
if ($LanAccess) {
  Write-Host 'Devices must be connected to the same local network.' -ForegroundColor Green
}
if (-not $NoBrowser) { Start-Process $siteUrl }
