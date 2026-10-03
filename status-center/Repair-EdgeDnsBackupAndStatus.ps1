# Owner-run, password-prompting repair. The script stores no credentials.
# Edge is repaired and verified before the guarded Status Center release switch.
$ErrorActionPreference = 'Stop'
$source = $PSScriptRoot
$edge = 'codeblack@codeblack-edge.tail1d0673.ts.net'
$core = 'codeblack@codeblack-core.tail1d0673.ts.net'
$tag = [guid]::NewGuid().ToString('N')
$edgeScript = Join-Path $source 'repair-edge-dns-backup.sh'
$coreScript = Join-Path $source 'deploy-backup-truth-remote.sh'
$server = Join-Path $source 'server.py'
$registry = Join-Path $source 'registry.json'
$remoteEdgeScript = "/tmp/codeblack-edge-dns-backup-$tag.sh"
$archiveName = "status-center-backup-truth-$tag.tar"
$localArchive = Join-Path ([System.IO.Path]::GetTempPath()) $archiveName
$remoteArchive = "/tmp/$archiveName"

try {
    foreach ($path in @($edgeScript, $coreScript, $server, $registry)) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing input: $path" }
    }
    foreach ($name in @('ssh.exe', 'scp.exe', 'tar.exe')) {
        if (-not (Get-Command $name -ErrorAction SilentlyContinue)) { throw "Missing tool: $name" }
    }
    $edgeHash = (Get-FileHash -LiteralPath $edgeScript -Algorithm SHA256).Hash.ToLowerInvariant()
    $serverHash = (Get-FileHash -LiteralPath $server -Algorithm SHA256).Hash.ToLowerInvariant()
    $registryHash = (Get-FileHash -LiteralPath $registry -Algorithm SHA256).Hash.ToLowerInvariant()

    Write-Output 'PHASE = EDGE PI-HOLE + BACKUP'
    & scp.exe -o StrictHostKeyChecking=yes -o ConnectTimeout=10 $edgeScript "${edge}:$remoteEdgeScript"
    if ($LASTEXITCODE -ne 0) { throw 'Edge script transfer failed; no repair ran.' }
    & ssh.exe -tt -o StrictHostKeyChecking=yes -o ConnectTimeout=10 $edge "sudo bash '$remoteEdgeScript' '$edgeHash'"
    if ($LASTEXITCODE -ne 0) { throw 'Edge repair did not pass; Status Center was not deployed.' }

    Write-Output 'PHASE = CORE STATUS CENTER BACKUP TRUTH'
    & tar.exe -cf $localArchive -C $source server.py registry.json deploy-backup-truth-remote.sh
    if ($LASTEXITCODE -ne 0) { throw 'Status Center package creation failed.' }
    & scp.exe -o StrictHostKeyChecking=yes -o ConnectTimeout=10 $localArchive "${core}:$remoteArchive"
    if ($LASTEXITCODE -ne 0) { throw 'Core package transfer failed; Edge repair remains in place.' }
    $remoteCommand = "tar -xOf '$remoteArchive' deploy-backup-truth-remote.sh | sudo bash -s -- '$remoteArchive' '$serverHash' '$registryHash'"
    & ssh.exe -tt -o StrictHostKeyChecking=yes -o ConnectTimeout=10 $core $remoteCommand
    if ($LASTEXITCODE -ne 0) { throw 'Status Center deployment did not pass; Edge repair remains in place.' }

    $health = Invoke-RestMethod -Uri 'https://codeblack-core.tail1d0673.ts.net/status/api/health' -TimeoutSec 10
    if (-not $health.ok -or $health.version -ne '1.0.1' -or $health.probes -ne 47) {
        throw 'New Status Center health/version could not be confirmed.'
    }
    Write-Output "STATUS CENTER VERSION = $($health.version)"
    $qualified = $false
    for ($attempt = 0; $attempt -lt 15; $attempt++) {
        try {
            $status = Invoke-RestMethod -Uri 'https://codeblack-core.tail1d0673.ts.net/status/api/status' -TimeoutSec 10
            $overview = Invoke-RestMethod -Uri 'https://codeblack-edge.tail1d0673.ts.net/api/overview' -TimeoutSec 10
            $dns = @($status.dns.instances | Where-Object { $_.id -eq 'pihole-edge' })[0]
            $backup = @($status.storage.backups | Where-Object { $_.id -eq 'core-backup' })[0]
            $staleAlerts = @($overview.alerts.current_issues | Where-Object { $_ -like 'backup_stale*' })
            if ($dns.state -eq 'HEALTHY' -and $backup.state -eq 'HEALTHY' -and $staleAlerts.Count -eq 0) {
                $qualified = $true
                break
            }
        } catch {
            # The private dashboards may be warming up after their restarts.
        }
        Start-Sleep -Seconds 10
    }
    Write-Output "PI-HOLE DNS STATUS = $($dns.state)"
    Write-Output "BACKUP STATUS = $($backup.state)"
    Write-Output "BACKUP STALE ALERTS = $($staleAlerts.Count)"
    if (-not $qualified) { throw 'Live DNS, backup, and alert qualification is incomplete; inspect before retrying.' }
    Write-Output 'RESULT = PASS'
} catch {
    Write-Output "ERROR = $($_.Exception.Message)"
    Write-Output 'RESULT = FAIL'
    exit 1
} finally {
    if (Test-Path -LiteralPath $localArchive -PathType Leaf) {
        Remove-Item -LiteralPath $localArchive -Force
    }
}
