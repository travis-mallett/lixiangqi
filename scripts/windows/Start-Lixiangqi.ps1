[CmdletBinding()]
param(
  [switch]$NoBrowser,
  [switch]$SkipBuild,
  [switch]$LanAccess,
  [switch]$StopOnly
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
  return Start-Process -FilePath $executable -ArgumentList $arguments -WorkingDirectory $workingDirectory `
    -RedirectStandardOutput $stdout -RedirectStandardError $stderr -WindowStyle Hidden -PassThru
}

function Build-WindowsSelectorPatch([string]$javaExecutable) {
  # Windows 11 build 26200 can advertise AF_UNIX support while connect() fails
  # with WSAEINVAL. JDK selectors prefer AF_UNIX for their internal wakeup pipe,
  # so every Netty event loop then fails before the application can bind a port.
  # Recompile the bundled JDK's matching PipeImpl with its TCP fallback selected.
  $jdkRoot = Split-Path (Split-Path $javaExecutable -Parent) -Parent
  $jdkSources = Join-Path $jdkRoot 'lib\src.zip'
  $javac = Join-Path $jdkRoot 'bin\javac.exe'
  if (-not (Test-Path $jdkSources) -or -not (Test-Path $javac)) {
    throw 'The bundled JDK sources or Java compiler are missing.'
  }

  $patchRoot = Join-Path $dataDir 'jdk-selector-patch'
  $sourceRoot = Join-Path $patchRoot 'src'
  $classesRoot = Join-Path $patchRoot 'classes'
  $sourceFile = Join-Path $sourceRoot 'sun\nio\ch\PipeImpl.java'
  New-Item -ItemType Directory -Force -Path (Split-Path $sourceFile -Parent), $classesRoot | Out-Null

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [IO.Compression.ZipFile]::OpenRead($jdkSources)
  try {
    $entry = $archive.GetEntry('java.base/sun/nio/ch/PipeImpl.java')
    if (-not $entry) { throw 'PipeImpl.java is missing from the bundled JDK sources.' }
    $reader = [IO.StreamReader]::new($entry.Open())
    try { $source = $reader.ReadToEnd() } finally { $reader.Dispose() }
  } finally {
    $archive.Dispose()
  }

  $original = 'Initializer initializer = new Initializer(sp, preferAfUnix);'
  $replacement = 'Initializer initializer = new Initializer(sp, false);'
  if (-not $source.Contains($original)) {
    throw 'The bundled JDK PipeImpl source is incompatible with the Windows selector patch.'
  }
  [IO.File]::WriteAllText(
    $sourceFile,
    $source.Replace($original, $replacement),
    [Text.UTF8Encoding]::new($false)
  )

  & $javac '--patch-module' "java.base=$sourceRoot" '-d' $classesRoot $sourceFile
  if ($LASTEXITCODE) { throw 'Could not build the Windows JDK selector compatibility patch.' }
  return $classesRoot
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

  $action = if ($StopOnly) { 'Stopping' } else { 'Restarting' }
  $reason = if ($StopOnly) { '' } else { ' so source and asset changes take effect' }
  Write-Step "$action $name$reason"
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

function Get-LocalProcesses([string[]]$commandPatterns) {
  return @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      $process = $_
      $matchesCommand = [bool]($commandPatterns | Where-Object { $process.CommandLine -like $_ })
      $matchesCommand -and
      $process.ExecutablePath -and
      $process.ExecutablePath.StartsWith($projectRoot, [StringComparison]::OrdinalIgnoreCase)
    })
}

function Stop-LocalProcess([string]$name, [string[]]$commandPatterns) {
  $processes = @(Get-LocalProcesses $commandPatterns)
  if (-not $processes.Count) { return }

  $action = if ($StopOnly) { 'Stopping' } else { 'Restarting' }
  $reason = if ($StopOnly) { '' } else { ' so source changes take effect' }
  Write-Step "$action $name$reason"
  $deadline = (Get-Date).AddSeconds(15)
  do {
    foreach ($process in $processes) {
      try {
        Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
      } catch [Microsoft.PowerShell.Commands.ProcessCommandException] {
        # A parent and its forked child can exit together. Ignore only processes
        # that disappeared between the CIM snapshot and Stop-Process.
        if (Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue) { throw }
      }
    }

    Start-Sleep -Milliseconds 250
    # Rescan by checkout path and command line instead of trusting stale PIDs.
    # This also catches an SBT launcher that replaces its forked JVM while the
    # cleanup is in progress.
    $processes = @(Get-LocalProcesses $commandPatterns)
  } while ($processes.Count -and (Get-Date) -lt $deadline)

  if ($processes.Count) {
    $details = ($processes | ForEach-Object { "$($_.Name) PID $($_.ProcessId)" }) -join ', '
    throw "$name did not stop: $details."
  }
}

function Remove-StaleSbtBackgroundJobs {
  # SBT creates an isolated target tree for every forked `run`. Force-stopping a
  # preview (which is necessary on Windows when restarting it) can prevent SBT
  # from deleting that tree. Repeated previews can otherwise fill the drive with
  # duplicate dependency jars and compiled classes.
  $expectedPath = [IO.Path]::GetFullPath((Join-Path $projectRoot 'target\bg-jobs'))
  if (-not (Test-Path -LiteralPath $expectedPath)) { return }

  $resolvedPath = (Resolve-Path -LiteralPath $expectedPath).Path
  if (-not $resolvedPath.Equals($expectedPath, [StringComparison]::OrdinalIgnoreCase) -or
      -not $resolvedPath.StartsWith("$projectRoot\target\", [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove unexpected SBT background-job path: $resolvedPath"
  }

  Write-Step 'Removing stale SBT background-job files'
  Remove-Item -LiteralPath $resolvedPath -Recurse -Force
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
$lilaWsPrepare = Join-Path $PSScriptRoot 'Prepare-LilaWs.ps1'
$lilaWsMarker = Join-Path $dataDir 'lila-ws-applied.patch'
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
if (-not (Test-Path $lilaWsPrepare)) { throw 'The lila-ws preparation helper is missing.' }
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
& $lilaWsPrepare -Source $lilaWsDir -Patch $lilaWsPatch -Commit $lilaWsCommit -Marker $lilaWsMarker
if ($LASTEXITCODE) { throw 'Could not prepare the Xiangqi lila-ws source.' }

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

if (-not $SkipBuild -and -not $StopOnly) {
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

# A failed forked JVM can leave its SBT parent (and Windows named-pipe boot
# lock) alive without a listening port. Port-based cleanup cannot see that
# state, so also remove only launchers and children whose command lines and
# executables identify them as belonging to this checkout.
Stop-LocalProcess 'orphaned Lichess/Lixiangqi web application' @(
  '*lila.app.Lila*'
  '*-Xms512m*-Xmx6g*sbt-launch-2.0.3.jar*run*'
)
Stop-LocalProcess 'orphaned Lila websocket service' @(
  "*-Dconfig.file=$lilaWsConf*"
  '*lila.ws.LilaWs*'
)
Stop-LocalProcess 'orphaned Xiangqi explorer' '*external.xiangqi_explorer.server*'
Stop-LocalProcess 'Pikafish AI worker' '*external.pikafish_worker.ai*'

# All project-owned SBT launchers and forked JVMs are stopped at this point, so
# none of these generated per-run directories can still be in use.
Remove-StaleSbtBackgroundJobs

if ($StopOnly) {
  Write-Step 'Project-owned application services are stopped'
  return
}

if ([Environment]::OSVersion.Version.Build -eq 26200) {
  Write-Step 'Applying the Windows 11 Java selector compatibility patch'
  $selectorPatch = Build-WindowsSelectorPatch $java
  $selectorPatchOption = "--patch-module=java.base=`"$selectorPatch`""
  $env:JAVA_TOOL_OPTIONS = "$($env:JAVA_TOOL_OPTIONS) $selectorPatchOption".Trim()
}

$mongoData = Join-Path $dataDir 'mongodb'
$redisData = Join-Path $dataDir 'redis'
New-Item -ItemType Directory -Force -Path $mongoData, $redisData | Out-Null

if (-not (Test-Port 27017)) {
  $null = Start-Background 'MongoDB' $mongo @(
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
  $null = Start-Background 'Redis' $redis @(
    '--bind', '127.0.0.1', '--port', '6379', '--protected-mode', 'yes',
    '--dir', $redisPath, '--dbfilename', 'lixiangqi.rdb', '--appendonly', 'no'
  ) (Join-Path $logsDir 'redis.stdout.log') (Join-Path $logsDir 'redis.stderr.log')
  Wait-Port 6379 30 'Redis'
}

Write-Step 'Ensuring the write-time games database indexes are current'
& $python -m tools.games_database.explorer_index ensure
if ($LASTEXITCODE) { throw 'Games database index preparation failed.' }

$env:LIXIANGQI_DOMAIN = $siteDomain
$env:LIXIANGQI_SOCKET_DOMAIN = "${siteAddress}:9664"
if (-not (Test-Port 9664)) {
  $null = Start-Background 'Lila websocket service' $java @(
    '-Xms32m', '-Xmx512m', '-Dsbt.supershell=false', '-Dsbt.color=false',
    "-Dconfig.file=$lilaWsConf", '-jar', $sbt, 'run'
  ) (Join-Path $logsDir 'lila-ws.stdout.log') (Join-Path $logsDir 'lila-ws.stderr.log') $lilaWsDir
  try {
    Wait-Port 9664 180 'Lila websocket service'
  } catch {
    # SBT can stay alive after its forked websocket JVM fails. Never leave that
    # launcher or a partially initialized replacement behind for the next run.
    Stop-LocalProcess 'failed Lila websocket service' @(
      "*-Dconfig.file=$lilaWsConf*"
      '*lila.ws.LilaWs*'
    )
    throw
  }
}

if (-not (Test-Port 9002)) {
  $null = Start-Background 'Xiangqi opening explorer' $python @(
    '-m', 'external.xiangqi_explorer.server', '--host', '127.0.0.1', '--port', '9002'
  ) (Join-Path $logsDir 'xiangqi-explorer.stdout.log') (Join-Path $logsDir 'xiangqi-explorer.stderr.log')
  Wait-Port 9002 30 'Xiangqi explorer'
}

$null = Start-Background 'Pikafish AI worker' $python @(
  '-m', 'external.pikafish_worker.ai'
) (Join-Path $logsDir 'pikafish-worker.stdout.log') (Join-Path $logsDir 'pikafish-worker.stderr.log')

$webProcess = $null
if (-not (Test-Port 9663)) {
  # Typesafe Config gives JVM system properties precedence over application.conf.
  # JAVA_TOOL_OPTIONS reaches both SBT and its forked application JVM, allowing
  # local access without changing the application's checked-in domain settings.
  $env:JAVA_TOOL_OPTIONS = "$($env:JAVA_TOOL_OPTIONS) -Dnet.domain=$siteDomain".Trim()
  $webProcess = Start-Background 'Lichess/Lixiangqi web application' $java @(
    '-Xms512m', '-Xmx6g', '-Dsbt.supershell=false', '-Dsbt.color=false',
    '-jar', $sbt, 'run'
  ) (Join-Path $logsDir 'lixiangqi.stdout.log') (Join-Path $logsDir 'lixiangqi.stderr.log')
}

Write-Step 'Waiting for the full website (first startup can take several minutes)'
$siteUrl = "http://$siteDomain/"
$healthUrl = 'http://127.0.0.1:9663/'
$startupTimeoutMinutes = 15
$deadline = (Get-Date).AddMinutes($startupTimeoutMinutes)
$websiteReady = $false
do {
  if ($webProcess) {
    $webProcess.Refresh()
    if ($webProcess.HasExited) {
      Write-Host "Lixiangqi exited during startup (exit code $($webProcess.ExitCode)). Recent server output:" -ForegroundColor Red
      Get-Content (Join-Path $logsDir 'lixiangqi.stderr.log') -Tail 40 -ErrorAction SilentlyContinue
      Get-Content (Join-Path $logsDir 'lixiangqi.stdout.log') -Tail 40 -ErrorAction SilentlyContinue
      throw 'Website process exited before it became ready.'
    }
  }
  try {
    $response = Invoke-WebRequest -Uri $healthUrl -Headers @{ Host = $siteDomain } -UseBasicParsing -TimeoutSec 5
    if ($response.StatusCode -eq 200) {
      $websiteReady = $true
      break
    }
  } catch {
    Start-Sleep -Seconds 1
  }
} while ((Get-Date) -lt $deadline)

if (-not $websiteReady) {
  Write-Host "Lixiangqi did not become ready. Recent server output:" -ForegroundColor Red
  Get-Content (Join-Path $logsDir 'lixiangqi.stderr.log') -Tail 40 -ErrorAction SilentlyContinue
  Get-Content (Join-Path $logsDir 'lixiangqi.stdout.log') -Tail 40 -ErrorAction SilentlyContinue
  throw "Website startup timed out after $startupTimeoutMinutes minutes. See $logsDir"
}

Write-Host "Lixiangqi is ready: $siteUrl" -ForegroundColor Green
if ($LanAccess) {
  Write-Host 'Devices must be connected to the same local network.' -ForegroundColor Green
}
if (-not $NoBrowser) { Start-Process $siteUrl }
