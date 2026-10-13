[CmdletBinding()]
param()

# Runs the existing Core-side synthetic publisher without reading or emitting its SRT credentials.
$ErrorActionPreference = 'Stop'
$publisher = 'C:\CodeBlack\bin\core-synthetic-nick-publisher.sh'
if (-not (Test-Path -LiteralPath $publisher)) { throw 'Existing Core synthetic publisher was not found.' }

Get-Content -LiteralPath $publisher -Raw | & ssh.exe codeblack-core 'sudo -n bash -s'
# GNU timeout returns 124 after ending the intentionally bounded 75-second publisher.
if ($LASTEXITCODE -notin @(0, 124)) { throw "Core synthetic publisher exited with $LASTEXITCODE." }
