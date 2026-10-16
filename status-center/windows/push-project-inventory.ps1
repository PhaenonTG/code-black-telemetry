# Sends only the bounded discovery document through the existing SSH identity.
# No inbound port, new credential, environment values or raw command lines.
$ErrorActionPreference = 'Stop'
$OutputEncoding = [Text.UTF8Encoding]::new($false)
$document = Invoke-RestMethod -Uri 'http://127.0.0.1:9110/v1/metrics' -TimeoutSec 60
if (-not $document.project_inventory.available) { throw 'Local discovery is unavailable.' }
$inventory = $document.project_inventory
$inventory | Add-Member -NotePropertyName source_host -NotePropertyValue 'phaenon3' -Force
$payload = $inventory | ConvertTo-Json -Depth 20 -Compress
if ([Text.Encoding]::UTF8.GetByteCount($payload) -gt 524288) { throw 'Discovery document exceeds limit.' }
foreach ($target in @('codeblack-core', 'codeblack-core-lan')) {
  $payload | & ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=5 $target 'python3 /srv/codeblack/services/project-landscape/receive_inventory.py phaenon3'
  if ($LASTEXITCODE -eq 0) { return }
}
throw 'Core did not accept the discovery report over either verified connection.'
