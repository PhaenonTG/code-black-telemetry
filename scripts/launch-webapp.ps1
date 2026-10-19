$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$portRange = 4173..4183
$logPath = Join-Path $env:TEMP "codeblack-webapp-preview.log"

function Test-PortOpen {
  param([int] $Port)
  try {
    $client = [System.Net.Sockets.TcpClient]::new()
    $result = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
    if (-not $result.AsyncWaitHandle.WaitOne(250)) {
      $client.Close()
      return $false
    }
    $client.EndConnect($result)
    $client.Close()
    return $true
  } catch {
    return $false
  }
}

function Test-CodeBlackServer {
  param([int] $Port)
  if (-not (Test-PortOpen -Port $Port)) {
    return $false
  }
  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -eq 200 -and $response.Content -match "Code Black OPS"
  } catch {
    return $false
  }
}

function Find-CodeBlackPort {
  foreach ($candidate in $portRange) {
    if (Test-CodeBlackServer -Port $candidate) {
      return $candidate
    }
  }
  return $null
}

function Find-FreePort {
  foreach ($candidate in $portRange) {
    if (-not (Test-PortOpen -Port $candidate)) {
      return $candidate
    }
  }
  throw "No free localhost port found in $($portRange[0])-$($portRange[-1]). Close an old preview server and try again."
}

function Find-Browser {
  $candidates = @(
    "$env:ProgramFiles (x86)\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "$env:ProgramFiles (x86)\Google\Chrome\Application\chrome.exe"
  )

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  return $null
}

Set-Location $repoRoot

if (-not (Test-Path (Join-Path $repoRoot "dist\index.html"))) {
  npm run build
}

$port = Find-CodeBlackPort
if (-not $port) {
  $port = Find-FreePort
  $previewCommand = @"
Set-Location '$repoRoot'
npm run preview -- --host 127.0.0.1 --port $port *> '$logPath'
"@
  Start-Process powershell.exe -WindowStyle Hidden -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $previewCommand

  $deadline = (Get-Date).AddSeconds(20)
  while ((Get-Date) -lt $deadline) {
    if (Test-CodeBlackServer -Port $port) {
      break
    }
    Start-Sleep -Milliseconds 350
  }

  if (-not (Test-CodeBlackServer -Port $port)) {
    throw "Code Black preview did not become ready on port $port. Check $logPath"
  }
}

$url = "http://127.0.0.1:$port"
$browser = Find-Browser
if ($browser) {
  Start-Process $browser -ArgumentList "--app=$url"
} else {
  Start-Process $url
}
