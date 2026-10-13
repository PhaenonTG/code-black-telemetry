[CmdletBinding()]
param([switch]$UseExistingObsKey)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSCommandPath
$runtime = Join-Path $root 'runtime'
$destination = Join-Path $runtime 'facebook.credentials.json'
$server = 'rtmps://live-api-s.facebook.com:443/rtmp/'
if ($UseExistingObsKey) {
    $profiles = Join-Path $env:APPDATA 'obs-studio\basic\profiles'
    $profile = Get-ChildItem -LiteralPath $profiles -Recurse -File -Filter basic.ini |
        Where-Object { Select-String -LiteralPath $_.FullName -Pattern '^Name=CODEBLACK-LIVE$' -Quiet } |
        Select-Object -First 1
    if (-not $profile) { throw 'CODEBLACK-LIVE profile was not found.' }
    $existing = Get-Content -LiteralPath (Join-Path $profile.DirectoryName 'service.json') -Raw | ConvertFrom-Json
    if ($existing.settings.server -ne $server) { throw 'The existing profile does not use the expected Facebook RTMPS server.' }
    $secureKey = ConvertTo-SecureString ([string]$existing.settings.key) -AsPlainText -Force
    $existing = $null
} else {
    $secureKey = Read-Host 'Facebook Live stream key (hidden)' -AsSecureString
}
if ($secureKey.Length -lt 10) { throw 'The stream key is missing or too short.' }
New-Item -ItemType Directory -Path $runtime -Force | Out-Null
if (Test-Path -LiteralPath $destination) {
    Copy-Item -LiteralPath $destination -Destination "$destination.before-$(Get-Date -Format yyyyMMdd-HHmmss).bak"
}
$document = @{ server=$server; protectedKey=($secureKey | ConvertFrom-SecureString); savedAt=(Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json
[IO.File]::WriteAllText($destination, $document, [Text.UTF8Encoding]::new($false))
$acl = Get-Acl -LiteralPath $destination
$acl.SetAccessRuleProtection($true, $false)
foreach ($rule in @($acl.Access)) { [void]$acl.RemoveAccessRule($rule) }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($identity,'FullControl','Allow'))
Set-Acl -LiteralPath $destination -AclObject $acl
$secureKey.Dispose()
Write-Output 'Native Facebook credential saved with Windows encryption. Public output remains off until Start Facebook is clicked.'
