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
$payload | & ssh -o BatchMode=yes -o ConnectTimeout=10 codeblack-core 'python3 /srv/codeblack/services/project-landscape/receive_inventory.py phaenon3'
if ($LASTEXITCODE -ne 0) { throw 'Core did not accept the discovery report.' }
