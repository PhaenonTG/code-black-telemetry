param([Parameter(Mandatory=$true)][string]$Path)
# Internal pipe only: called by facebook-output.js with captured stdout. Never invoke this
# helper in a terminal; it deliberately delivers the decrypted key to its parent process.
$ErrorActionPreference='Stop'
# Node may be launched by PowerShell 7; import Windows PowerShell's own security module rather
# than inheriting its incompatible PSModulePath when DPAPI is decrypted by powershell.exe.
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1')
$document=Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
$secureKey=ConvertTo-SecureString $document.protectedKey
$pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
try { [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer); $secureKey.Dispose() }
