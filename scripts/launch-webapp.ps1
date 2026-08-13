$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$port = 4173
$url = "http://127.0.0.1:$port"

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

if (-not (Test-PortOpen -Port $port)) {
  $previewCommand = "Set-Location '$repoRoot'; npm run preview -- --host 127.0.0.1 --port $port"
  Start-Process powershell.exe -WindowStyle Hidden -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $previewCommand

  $deadline = (Get-Date).AddSeconds(18)
  while ((Get-Date) -lt $deadline) {
    if (Test-PortOpen -Port $port) {
      break
    }
    Start-Sleep -Milliseconds 350
  }
}

$browser = Find-Browser
if ($browser) {
  Start-Process $browser -ArgumentList "--app=$url"
} else {
  Start-Process $url
}
