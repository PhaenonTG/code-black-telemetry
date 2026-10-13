[CmdletBinding()]
param(
    [switch]$Background
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSCommandPath
$packageRoot = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
$ffmpeg = Get-ChildItem -LiteralPath $packageRoot -Directory -Filter 'Gyan.FFmpeg_*' -ErrorAction Stop |
    ForEach-Object { Get-ChildItem -LiteralPath $_.FullName -Filter ffmpeg.exe -Recurse -ErrorAction SilentlyContinue } |
    Select-Object -First 1 -ExpandProperty FullName
if (-not $ffmpeg) { throw 'Standalone FFmpeg was not found. Install Gyan.FFmpeg.Essentials before starting Native Broadcaster.' }

$env:CODEBLACK_FFMPEG = $ffmpeg
$arguments = @((Join-Path $root 'native-broadcaster.js'))
if ($Background) {
    Start-Process -FilePath 'node.exe' -ArgumentList $arguments -WorkingDirectory $root -WindowStyle Hidden
    return
}
& node.exe @arguments
