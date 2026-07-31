param(
  [string]$Operation = "Operation Cockpit",
  [string]$DeviceSerial = "R5GL53J3Y4J",
  [string]$LocalOutputFolder = "qa-screenshots\operation-cockpit\final",
  [string]$DriveDestination = "Code Black OPS\QA\Appearance Passes\Operation Cockpit",
  [string]$GoogleDriveRoot = $env:GOOGLE_DRIVE_SYNC_ROOT,
  [string]$RcloneRemote = $env:GOOGLE_DRIVE_RCLONE_REMOTE
)

$ErrorActionPreference = "Stop"

function Require-Command($Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command '$Name' was not found."
  }
}

Require-Command adb

$timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$safeOperation = ($Operation -replace "[^A-Za-z0-9_-]+", "-").Trim("-")
$outputDir = Resolve-Path -LiteralPath "." | ForEach-Object { Join-Path $_ $LocalOutputFolder }
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

$fileName = "Code-Black-OPS_${safeOperation}_${timestamp}.png"
$remoteName = "/sdcard/$fileName"
$localPath = Join-Path $outputDir $fileName

& adb -s $DeviceSerial shell screencap -p $remoteName 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Screenshot capture failed on device $DeviceSerial."
}

& adb -s $DeviceSerial pull $remoteName $localPath 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Screenshot pull failed from device $DeviceSerial."
}

& adb -s $DeviceSerial shell rm $remoteName 2>&1 | Out-Null

if (-not (Test-Path -LiteralPath $localPath)) {
  throw "Screenshot capture failed: $localPath was not created."
}

$localItem = Get-Item -LiteralPath $localPath
if ($localItem.Length -le 0) {
  throw "Screenshot capture failed: $localPath is empty."
}

$verifiedDestination = $null
if ($GoogleDriveRoot -and (Test-Path -LiteralPath $GoogleDriveRoot)) {
  $destinationFolder = Join-Path $GoogleDriveRoot $DriveDestination
  New-Item -ItemType Directory -Force -Path $destinationFolder | Out-Null
  $uploadedPath = Join-Path $destinationFolder $fileName
  Copy-Item -LiteralPath $localPath -Destination $uploadedPath -Force
  $uploadedItem = Get-Item -LiteralPath $uploadedPath
  if ($uploadedItem.Length -ne $localItem.Length) {
    throw "Google Drive copy verification failed: size mismatch at $uploadedPath."
  }
  $verifiedDestination = $uploadedPath
} elseif ($RcloneRemote -and (Get-Command rclone -ErrorAction SilentlyContinue)) {
  $target = "$RcloneRemote`:$DriveDestination"
  rclone copy $localPath $target --create-empty-src-dirs
  $listing = rclone ls "$target/$fileName"
  if (-not $listing) {
    throw "rclone upload verification failed for $target/$fileName."
  }
  $verifiedDestination = "$target/$fileName"
} else {
  throw "No authenticated Google Drive upload method found. Set GOOGLE_DRIVE_SYNC_ROOT to a mounted Drive folder or GOOGLE_DRIVE_RCLONE_REMOTE to an authenticated rclone remote. Local screenshot preserved at $localPath."
}

[pscustomobject]@{
  Operation = $Operation
  LocalPath = $localPath
  UploadedTo = $verifiedDestination
  Bytes = $localItem.Length
  CapturedAt = (Get-Date).ToString("o")
} | ConvertTo-Json
