$ErrorActionPreference = 'Stop'
$credentialPath = 'C:\CodeBlack\streaming\native-broadcaster\runtime\private-producer.credentials.json'
if (Test-Path -LiteralPath $credentialPath) { throw 'Private credential already exists; refusing overwrite.' }
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1')
$privateToken = [Console]::In.ReadToEnd().Trim()
if ($privateToken -notmatch '^[-_A-Za-z0-9]{40,200}$') { throw 'Private credential format invalid.' }
$secureToken = ConvertTo-SecureString $privateToken -AsPlainText -Force
try {
    $document = @{ protectedKey = ($secureToken | ConvertFrom-SecureString); purpose = 'Private Producer workstation authentication' } | ConvertTo-Json -Compress
    [IO.File]::WriteAllText($credentialPath, $document, [Text.UTF8Encoding]::new($false))
    $acl = New-Object Security.AccessControl.FileSecurity
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($sid in @([Security.Principal.WindowsIdentity]::GetCurrent().User.Value, 'S-1-5-18', 'S-1-5-32-544')) {
        $identity = New-Object Security.Principal.SecurityIdentifier($sid)
        $rule = New-Object Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'Allow')
        $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $credentialPath -AclObject $acl
} finally { $secureToken.Dispose(); $privateToken = $null; $document = $null }
Write-Output 'PRIVATE_CREDENTIAL_INSTALLED'
