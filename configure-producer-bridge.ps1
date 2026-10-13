[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSCommandPath
$runtime = Join-Path $root 'runtime'
$destination = Join-Path $runtime 'producer-bridge.credentials.json'
$worker = 'C:\CodeBlack\Projects\ChaseGatewayPublic\workers\chase-gateway'
$bytes = [byte[]]::new(48)
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
$token = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
$secureToken = ConvertTo-SecureString $token -AsPlainText -Force

Push-Location $worker
try {
    $token | & npx.cmd wrangler secret put PRODUCER_BRIDGE_TOKEN
    if ($LASTEXITCODE -ne 0) { throw 'Cloudflare rejected the producer bridge secret.' }
} finally { Pop-Location }

New-Item -ItemType Directory -Path $runtime -Force | Out-Null
$document = @{ protectedKey=($secureToken | ConvertFrom-SecureString); savedAt=(Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json
[IO.File]::WriteAllText($destination, $document, [Text.UTF8Encoding]::new($false))
$acl = Get-Acl -LiteralPath $destination
$acl.SetAccessRuleProtection($true, $false)
foreach ($rule in @($acl.Access)) { [void]$acl.RemoveAccessRule($rule) }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($identity,'FullControl','Allow'))
Set-Acl -LiteralPath $destination -AclObject $acl
$secureToken.Dispose()
$token = $null
Write-Output 'Producer bridge credential installed in Cloudflare and protected locally with Windows encryption.'
