# Copy only the Status Center probe fix to CORE and perform a guarded release update.
# SSH and sudo may prompt interactively; no password is stored by this script.
$ErrorActionPreference = 'Stop'

$remote = 'codeblack@codeblack-core.tail1d0673.ts.net'
$source = $PSScriptRoot
$archiveName = 'status-center-edge-probe-fix-{0}.tar' -f [guid]::NewGuid().ToString('N')
$archive = Join-Path ([System.IO.Path]::GetTempPath()) $archiveName
$remoteArchive = '/tmp/' + $archiveName

try {
    foreach ($name in @('server.py', 'registry.json', 'deploy-edge-probe-fix-remote.sh')) {
        if (-not (Test-Path -LiteralPath (Join-Path $source $name) -PathType Leaf)) {
            throw "Missing package input: $name"
        }
    }
    $registry = Get-Content -LiteralPath (Join-Path $source 'registry.json') -Raw | ConvertFrom-Json
    if (@($registry.probes | Where-Object { $_.id -eq 'edge_tcp' }).Count -ne 0) {
        throw 'Local registry still contains edge_tcp; refusing deployment.'
    }
    foreach ($name in @('tar.exe', 'scp.exe', 'ssh.exe')) {
        if (-not (Get-Command $name -ErrorAction SilentlyContinue)) { throw "Missing tool: $name" }
    }

    & tar.exe -cf $archive -C $source server.py registry.json deploy-edge-probe-fix-remote.sh
    if ($LASTEXITCODE -ne 0) { throw 'Package creation failed.' }
    & scp.exe -o StrictHostKeyChecking=yes -o ConnectTimeout=10 $archive "${remote}:$remoteArchive"
    if ($LASTEXITCODE -ne 0) { throw 'Package transfer failed; CORE was not changed.' }

    $command = "tar -xOf '$remoteArchive' deploy-edge-probe-fix-remote.sh | sudo bash -s -- '$remoteArchive'"
    & ssh.exe -tt -o StrictHostKeyChecking=yes -o ConnectTimeout=10 $remote $command
    if ($LASTEXITCODE -ne 0) { throw 'CORE update failed; inspect the remote report before retrying.' }
} catch {
    Write-Output "ERROR = $($_.Exception.Message)"
    Write-Output 'RESULT = FAIL'
    exit 1
} finally {
    if (Test-Path -LiteralPath $archive -PathType Leaf) {
        Remove-Item -LiteralPath $archive -Force
    }
}
