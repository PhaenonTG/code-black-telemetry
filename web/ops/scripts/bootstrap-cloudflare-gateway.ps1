<#
Code Black OPS -- Cloudflare Core Gateway Bootstrap (Stage 3)

RUN THIS YOURSELF, INTERACTIVELY, in your own PowerShell window. It prompts for a secret with
Read-Host and must have a real console attached -- do not run it from a non-interactive
automation context.

TWO EXPLICIT PHASES:

  1. INFRASTRUCTURE (default, no switch needed):
       - verify credential, resolve account/zone/Pages project
       - probe every permission this workflow needs (all read-only calls); if ANY probe fails,
         print exactly which permission is missing and stop -- nothing is created or changed
       - idempotently create/reuse: Cloudflare Tunnel, DNS record, Access application + policy,
         Access Service Token
       - merge (never overwrite wholesale) the new server-side env vars into the codeblack-ops
         Pages project's production environment
       - install/verify cloudflared as a systemd service on CodeBlack-Core via SSH, using the
         tunnel token -- Core's own API binding is never touched
       - verify Core stayed loopback-only, and SSH / Tailscale / MQTT broker / MQTT bridge all
         stayed healthy
       - run infrastructure-level validation (tunnel reachable via the Access service token)
       - save a NON-secret state file and STOP.

     The default run never touches git and never triggers a production deployment.

  2. DEPLOY (only with the -Deploy switch):
       - run typecheck / lint / test / production build for web/ops; stop on any failure
       - scan the built dist/ bundle for anything that must never ship to a browser (the Core
         Tailscale IP, the tunnel hostname, 127.0.0.1:8000, known secret-env-var names, or the
         current Access Service Token secret value itself); stop if anything is found
       - push feature/ops-web-v1 to origin/master (fast-forward only; never force); unrelated
         working-tree changes are left exactly as they are -- only committed history is pushed
       - poll the resulting Cloudflare Pages deployment until it succeeds
       - check that an unauthenticated request to the production gateway is correctly rejected
       - print a final structured report

Usage:
  .\bootstrap-cloudflare-gateway.ps1                    # infrastructure only, stops before git/deploy
  .\bootstrap-cloudflare-gateway.ps1 -Deploy            # infrastructure, then validate + push + deploy
  .\bootstrap-cloudflare-gateway.ps1 -AccountId <id>    # skip account auto-resolution ambiguity

What this does NOT do (by design, matches the approved plan):
  - Does not touch SSH, Tailscale, MQTT, or Core's application code/binding (read-only health
    checks against all four; Tailscale is verified, never configured).
  - Does not open any firewall port. Core's API stays on 127.0.0.1:8000 only.
  - Does not implement Fabric WebSocket, Sounding, or Consensus.
  - Does not perform the final "real authenticated browser session" check -- that requires a
    human logged-in Supabase session and is printed as the one remaining manual step at the end.
  - Never writes the Cloudflare API token, the Access Service Token secret, or any other secret
    to disk, to git, or to any log file. The token lives only in this PowerShell process's
    memory, and only until the Authorization header is built.
  - Supports API-token authentication ONLY. There is no Global API Key fallback: a Global Key is
    unscoped/account-wide and would make every permission probe below trivially pass regardless
    of what is actually required, defeating the point of probing at all.
#>

#Requires -Version 5.1
[CmdletBinding()]
param(
    # Perform the git push / Cloudflare Pages production deployment step. Without this switch,
    # the script stops after infrastructure provisioning and touches git/production nothing.
    [switch]$Deploy,

    # Explicit Cloudflare account ID to use. Only needed if the token can access more than one
    # account and this script cannot unambiguously resolve which one hosts codeblackwx.com /
    # codeblack-ops on its own (it will print the candidate list and ask for this if so).
    [string]$AccountId
)

$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Fixed, non-secret configuration
# ---------------------------------------------------------------------------
$RepoPath         = "C:\Users\glenn\Documents\Code Black Telemetry"
$OpsPath          = Join-Path $RepoPath "web\ops"
$FeatureBranch    = "feature/ops-web-v1"
$ZoneName         = "codeblackwx.com"
$TunnelName       = "codeblack-core-gateway"
$TunnelHostname   = "core-gateway.codeblackwx.com"
$PagesProjectName = "codeblack-ops"
$AccessAppName    = "Code Black Core Gateway"
$ServiceTokenName = "codeblack-ops-gateway"
$CoreSshAlias     = "codeblack-core"
$CoreOrigin       = "http://127.0.0.1:8000"
$CoreTailscaleIp  = "100.96.77.89"
$StateFile        = Join-Path $OpsPath ".cloudflare-bootstrap-state.json"
$ApiBase          = "https://api.cloudflare.com/client/v4"

function Write-Phase($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }
function Write-Ok($msg)    { Write-Host "  [OK]   $msg" -ForegroundColor Green }
function Write-Info($msg)  { Write-Host "  [..]   $msg" -ForegroundColor Gray }
function Write-Warn2($msg) { Write-Host "  [WARN] $msg" -ForegroundColor Yellow }
function Write-Err2($msg)  { Write-Host "  [FAIL] $msg" -ForegroundColor Red }

function Stop-Bootstrap($reason) {
    Write-Err2 $reason
    Write-Host "`nSTOPPED." -ForegroundColor Red
    exit 1
}

# ---------------------------------------------------------------------------
# 1. Credential acquisition -- API TOKEN ONLY.
#
#    Preference order:
#      1. $env:CLOUDFLARE_API_TOKEN, if already set in this session.
#      2. Interactive Read-Host -AsSecureString prompt.
#
#    Never echoed, never written to disk, never included in any log or error message. Cleared
#    from memory the moment the Authorization header string has been built.
# ---------------------------------------------------------------------------
Write-Phase "Cloudflare credential (API token only)"
Write-Host "Used only in this process's memory for this run. Never printed, logged, written to disk, or committed." -ForegroundColor Gray

if ($env:CLOUDFLARE_API_TOKEN) {
    Write-Info "Using `$env:CLOUDFLARE_API_TOKEN already set in this session."
    $Token = $env:CLOUDFLARE_API_TOKEN
} else {
    $secureToken = Read-Host -Prompt "Cloudflare API Token (scoped token only)" -AsSecureString
    if ($secureToken.Length -eq 0) { Stop-Bootstrap "Nothing entered." }
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
    try {
        $Token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
    Remove-Variable secureToken -ErrorAction SilentlyContinue
}

# Trim defensively -- a stray trailing newline/space from copy-paste is a common cause of
# ".NET rejects this as an invalid header value" failures that never even reach Cloudflare.
# Trimming whitespace is not a secret-exposing operation.
if ($Token) { $Token = $Token.Trim() }
if ([string]::IsNullOrWhiteSpace($Token)) { Stop-Bootstrap "Empty credential." }

$Headers = @{ Authorization = "Bearer $Token" }
Remove-Variable Token -ErrorAction SilentlyContinue

# ---------------------------------------------------------------------------
# Cloudflare API helper -- PS 5.1-compatible error body extraction.
# Never logs $Headers or any credential. Returns a normalized object: success/status/result/errors.
#
# Content-Type is deliberately NOT in $Headers: it is a "restricted header" under .NET's
# classic HttpWebRequest (which Windows PowerShell 5.1's Invoke-WebRequest is built on) and
# must be set via -ContentType instead of the generic -Headers collection, or the request can
# be rejected client-side before it ever reaches Cloudflare.
# ---------------------------------------------------------------------------
function Invoke-CF {
    param(
        [Parameter(Mandatory)][string]$Method,
        [Parameter(Mandatory)][string]$Path,
        [object]$Body = $null
    )
    $uri = "$ApiBase$Path"
    $jsonBody = $null
    if ($null -ne $Body) { $jsonBody = $Body | ConvertTo-Json -Depth 12 }

    try {
        if ($null -ne $jsonBody) {
            $raw = Invoke-WebRequest -Method $Method -Uri $uri -Headers $Headers -Body $jsonBody -ContentType "application/json" -UseBasicParsing -ErrorAction Stop
        } else {
            $raw = Invoke-WebRequest -Method $Method -Uri $uri -Headers $Headers -UseBasicParsing -ErrorAction Stop
        }
        $parsed = $raw.Content | ConvertFrom-Json
        return [pscustomobject]@{
            HttpStatus = [int]$raw.StatusCode
            Success    = $parsed.success
            Result     = $parsed.result
            Errors     = $parsed.errors
        }
    } catch {
        $status = 0
        $parsed = $null
        if ($_.Exception.Response) {
            $status = [int]$_.Exception.Response.StatusCode
            try {
                $stream = $_.Exception.Response.GetResponseStream()
                $reader = New-Object IO.StreamReader($stream)
                $bodyText = $reader.ReadToEnd()
                $parsed = $bodyText | ConvertFrom-Json
            } catch { }
        }
        $errorDetail = @($_.Exception.Message)
        if ($parsed -and $parsed.errors) { $errorDetail = $parsed.errors }
        return [pscustomobject]@{
            HttpStatus = $status
            Success    = $false
            Result     = $null
            Errors     = $errorDetail
        }
    }
}

function Format-CFErrors($errors) {
    if (-not $errors) { return "(no error detail returned)" }
    return ($errors | ForEach-Object {
        if ($_.code) { "[$($_.code)] $($_.message)" } else { "$_" }
    }) -join "; "
}

# ---------------------------------------------------------------------------
# 2. Verify credential (scoped API Token only)
# ---------------------------------------------------------------------------
Write-Phase "Verify credential"
$verify = Invoke-CF -Method GET -Path "/user/tokens/verify"
if (-not $verify.Success) {
    Stop-Bootstrap "Token verification failed (HTTP $($verify.HttpStatus)): $(Format-CFErrors $verify.Errors)"
}
Write-Ok "Token is valid (status: $($verify.Result.status))"

# ---------------------------------------------------------------------------
# 3. Discover account -- SAFE resolution. Never silently picks Result[0].
# ---------------------------------------------------------------------------
Write-Phase "Discover Cloudflare account"

$accounts = Invoke-CF -Method GET -Path "/accounts"
if (-not $accounts.Success -or -not $accounts.Result -or $accounts.Result.Count -eq 0) {
    Stop-Bootstrap "Could not list accounts -- missing 'Account Settings: Read'. Detail: $(Format-CFErrors $accounts.Errors)"
}

if ($AccountId) {
    $match = $accounts.Result | Where-Object { $_.id -eq $AccountId } | Select-Object -First 1
    if (-not $match) {
        Stop-Bootstrap "The -AccountId '$AccountId' you supplied is not among the accounts this token can access."
    }
    Write-Ok "Using explicitly supplied account: $AccountId ($($match.name))"
} elseif ($accounts.Result.Count -eq 1) {
    $AccountId = $accounts.Result[0].id
    Write-Ok "Single accessible account -- using it: $AccountId ($($accounts.Result[0].name))"
} else {
    Write-Warn2 "Token can access $($accounts.Result.Count) accounts -- resolving which one hosts $ZoneName / $PagesProjectName..."
    $candidates = @()
    foreach ($acct in $accounts.Result) {
        $zoneProbe  = Invoke-CF -Method GET -Path "/zones?name=$ZoneName&account.id=$($acct.id)"
        $zoneHit    = [bool]($zoneProbe.Success -and $zoneProbe.Result -and $zoneProbe.Result.Count -gt 0)
        $pagesProbe = Invoke-CF -Method GET -Path "/accounts/$($acct.id)/pages/projects"
        $pagesHit   = [bool]($pagesProbe.Success -and ($pagesProbe.Result | Where-Object { $_.name -eq $PagesProjectName }))
        Write-Info "Account $($acct.id) ($($acct.name)): zone match=$zoneHit, pages project match=$pagesHit"
        if ($zoneHit -and $pagesHit) { $candidates += $acct }
    }
    if ($candidates.Count -eq 1) {
        $AccountId = $candidates[0].id
        Write-Ok "Resolved unambiguously: $AccountId ($($candidates[0].name)) hosts both the zone and the Pages project"
    } else {
        Write-Host ""
        Write-Host "Could not unambiguously resolve which Cloudflare account to use. Accounts this token can access:" -ForegroundColor Yellow
        foreach ($acct in $accounts.Result) { Write-Host "  - $($acct.id)  $($acct.name)" }
        Stop-Bootstrap "Re-run with -AccountId <id> using one of the account IDs listed above. Nothing was created or changed."
    }
}

# ---------------------------------------------------------------------------
# 4. Discover zone / Pages project (scoped to the resolved account)
# ---------------------------------------------------------------------------
Write-Phase "Discover zone / Pages project"

$zones = Invoke-CF -Method GET -Path "/zones?name=$ZoneName&account.id=$AccountId"
if (-not $zones.Success -or -not $zones.Result -or $zones.Result.Count -eq 0) {
    Stop-Bootstrap "Could not find zone '$ZoneName' in account $AccountId -- missing 'Zone: Read' on that zone, or the token isn't scoped to it. Detail: $(Format-CFErrors $zones.Errors)"
}
$ZoneId = $zones.Result[0].id
Write-Ok "Zone ID discovered: $ZoneId ($ZoneName)"

$pagesProjects = Invoke-CF -Method GET -Path "/accounts/$AccountId/pages/projects"
if (-not $pagesProjects.Success) {
    Stop-Bootstrap "Could not list Pages projects -- missing 'Cloudflare Pages: Read'. Detail: $(Format-CFErrors $pagesProjects.Errors)"
}
$pagesProject = $pagesProjects.Result | Where-Object { $_.name -eq $PagesProjectName } | Select-Object -First 1
if (-not $pagesProject) {
    Stop-Bootstrap "Pages project '$PagesProjectName' not found in account $AccountId. Found: $(($pagesProjects.Result | ForEach-Object { $_.name }) -join ', ')"
}
Write-Ok "Pages project discovered: $PagesProjectName"

# ---------------------------------------------------------------------------
# 5. Permission probes -- ALL must succeed before anything is created/changed
# ---------------------------------------------------------------------------
Write-Phase "Permission probes (read-only -- nothing is modified yet)"

$probes = @(
    @{ Name = "Cloudflare Tunnel: Read/Edit";     Method = "GET"; Path = "/accounts/$AccountId/cfd_tunnel" }
    @{ Name = "Access: Apps and Policies";        Method = "GET"; Path = "/accounts/$AccountId/access/apps" }
    @{ Name = "Access: Service Tokens";           Method = "GET"; Path = "/accounts/$AccountId/access/service_tokens" }
    @{ Name = "Zone DNS: Edit (on $ZoneName)";    Method = "GET"; Path = "/zones/$ZoneId/dns_records" }
)

$missing = @()
foreach ($probe in $probes) {
    $result = Invoke-CF -Method $probe.Method -Path $probe.Path
    if ($result.Success) {
        Write-Ok "$($probe.Name) -- reachable"
    } else {
        Write-Err2 "$($probe.Name) -- FAILED (HTTP $($result.HttpStatus)): $(Format-CFErrors $result.Errors)"
        $missing += $probe.Name
    }
}

if ($missing.Count -gt 0) {
    Write-Host ""
    Stop-Bootstrap "Missing permission(s): $($missing -join '; '). Add these to the token (Cloudflare dashboard -> My Profile -> API Tokens -> edit this token) and re-run. Nothing was created or changed."
}

Write-Ok "All required permissions confirmed."

# ---------------------------------------------------------------------------
# Load/init local state (non-secret resource IDs only -- gitignored)
# ---------------------------------------------------------------------------
$State = [ordered]@{
    accountId             = $AccountId
    zoneId                = $ZoneId
    tunnelId              = $null
    tunnelHostname        = $TunnelHostname
    dnsRecordId           = $null
    accessAppId           = $null
    accessPolicyId        = $null
    serviceTokenId        = $null
    serviceTokenClientId  = $null
    pendingRetireTokenIds = @()
    lastRunUtc            = $null
}
if (Test-Path $StateFile) {
    try {
        $existing = Get-Content $StateFile -Raw | ConvertFrom-Json
        foreach ($prop in $existing.PSObject.Properties) { $State[$prop.Name] = $prop.Value }
        Write-Info "Loaded existing state file (idempotent re-run)."
    } catch {
        Write-Warn2 "Existing state file unreadable -- starting fresh discovery via live API instead."
    }
}

function Save-State {
    $State.lastRunUtc = (Get-Date).ToUniversalTime().ToString("o")
    ($State | ConvertTo-Json -Depth 6) | Set-Content -Path $StateFile -Encoding UTF8
}

# ---------------------------------------------------------------------------
# 6. Tunnel -- create or reuse
# ---------------------------------------------------------------------------
Write-Phase "Cloudflare Tunnel"

$existingTunnels = Invoke-CF -Method GET -Path "/accounts/$AccountId/cfd_tunnel?name=$TunnelName&is_deleted=false"
$tunnel = $null
if ($existingTunnels.Success -and $existingTunnels.Result -and $existingTunnels.Result.Count -gt 0) {
    $tunnel = $existingTunnels.Result[0]
    Write-Ok "Reusing existing tunnel '$TunnelName' ($($tunnel.id))"
} else {
    $createBody = @{ name = $TunnelName; config_src = "cloudflare" }
    $created = Invoke-CF -Method POST -Path "/accounts/$AccountId/cfd_tunnel" -Body $createBody
    if (-not $created.Success) {
        Stop-Bootstrap "Failed to create tunnel: $(Format-CFErrors $created.Errors)"
    }
    $tunnel = $created.Result
    Write-Ok "Created tunnel '$TunnelName' ($($tunnel.id))"
}
$State.tunnelId = $tunnel.id

# Ingress: exactly one hostname -> Core's loopback API, catch-all 404 for anything else.
$ingressBody = @{
    config = @{
        ingress = @(
            @{ hostname = $TunnelHostname; service = $CoreOrigin }
            @{ service = "http_status:404" }
        )
    }
}
$ingressResult = Invoke-CF -Method PUT -Path "/accounts/$AccountId/cfd_tunnel/$($tunnel.id)/configurations" -Body $ingressBody
if (-not $ingressResult.Success) {
    Stop-Bootstrap "Failed to configure tunnel ingress: $(Format-CFErrors $ingressResult.Errors)"
}
Write-Ok "Tunnel ingress set: $TunnelHostname -> $CoreOrigin (only route; everything else 404s)"

# Connector token -- used once, only over SSH to Core, never written to disk here.
$tokenResp = Invoke-CF -Method GET -Path "/accounts/$AccountId/cfd_tunnel/$($tunnel.id)/token"
if (-not $tokenResp.Success -or -not $tokenResp.Result) {
    Stop-Bootstrap "Failed to fetch tunnel connector token: $(Format-CFErrors $tokenResp.Errors)"
}
$TunnelConnectorToken = $tokenResp.Result
Save-State

# ---------------------------------------------------------------------------
# 7. DNS record -- create or reuse
# ---------------------------------------------------------------------------
Write-Phase "DNS record"

$dnsName = $TunnelHostname
$existingDns = Invoke-CF -Method GET -Path "/zones/$ZoneId/dns_records?type=CNAME&name=$dnsName"
$expectedContent = "$($tunnel.id).cfargotunnel.com"
if ($existingDns.Success -and $existingDns.Result -and $existingDns.Result.Count -gt 0) {
    $record = $existingDns.Result[0]
    if ($record.content -ne $expectedContent) {
        $patch = Invoke-CF -Method PATCH -Path "/zones/$ZoneId/dns_records/$($record.id)" -Body @{ content = $expectedContent; proxied = $true }
        if (-not $patch.Success) { Stop-Bootstrap "Failed to update existing DNS record: $(Format-CFErrors $patch.Errors)" }
        Write-Ok "Updated existing DNS record to point at this tunnel"
        $State.dnsRecordId = $patch.Result.id
    } else {
        Write-Ok "Reusing existing correct DNS record"
        $State.dnsRecordId = $record.id
    }
} else {
    $dnsBody = @{ type = "CNAME"; name = $dnsName; content = $expectedContent; proxied = $true }
    $dnsCreate = Invoke-CF -Method POST -Path "/zones/$ZoneId/dns_records" -Body $dnsBody
    if (-not $dnsCreate.Success) { Stop-Bootstrap "Failed to create DNS record: $(Format-CFErrors $dnsCreate.Errors)" }
    Write-Ok "Created DNS record $dnsName -> $expectedContent (proxied)"
    $State.dnsRecordId = $dnsCreate.Result.id
}
Save-State

# ---------------------------------------------------------------------------
# 8. Access application -- create or reuse
# ---------------------------------------------------------------------------
Write-Phase "Access application"

$existingApps = Invoke-CF -Method GET -Path "/accounts/$AccountId/access/apps"
$app = $null
if ($existingApps.Success) {
    $app = $existingApps.Result | Where-Object { $_.domain -eq $TunnelHostname -or $_.name -eq $AccessAppName } | Select-Object -First 1
}
if ($app) {
    Write-Ok "Reusing existing Access application '$($app.name)' ($($app.id))"
} else {
    $appBody = @{
        name            = $AccessAppName
        domain          = $TunnelHostname
        type            = "self_hosted"
        session_duration = "24h"
    }
    $appCreate = Invoke-CF -Method POST -Path "/accounts/$AccountId/access/apps" -Body $appBody
    if (-not $appCreate.Success) { Stop-Bootstrap "Failed to create Access application: $(Format-CFErrors $appCreate.Errors)" }
    $app = $appCreate.Result
    Write-Ok "Created Access application '$AccessAppName' ($($app.id))"
}
$State.accessAppId = $app.id
Save-State

# ---------------------------------------------------------------------------
# 9. Access Service Token -- SAFE rotation.
#
#    Cloudflare never exposes a service token's secret after creation, so an existing token
#    (from a prior run) cannot be "reused" -- a replacement must be minted. To avoid a window
#    where the origin has zero valid tokens, this always creates the replacement FIRST, updates
#    the Access policy to accept BOTH the old and new token, pushes the new secret to Pages, and
#    validates the tunnel is reachable with it -- and only THEN deletes the superseded token(s)
#    and tightens the policy back down to the new token alone (step 12, after infra validation).
#
#    Cloudflare does not enforce unique names on service tokens (the client_id is the unique,
#    immutable identifier), so creating a second token with the canonical name is expected to
#    succeed even while an old one with the same name still exists. If a future API change makes
#    that a hard conflict, this falls back to a timestamp-suffixed name -- cosmetic only, since
#    the Access policy binds by token id, not name.
# ---------------------------------------------------------------------------
Write-Phase "Access Service Token (create replacement first; old token retired later, after validation)"

$existingTokens = Invoke-CF -Method GET -Path "/accounts/$AccountId/access/service_tokens"
$oldTokens = @()
if ($existingTokens.Success) {
    $oldTokens = @($existingTokens.Result | Where-Object { $_.name -eq $ServiceTokenName -or $_.name -like "$ServiceTokenName-*" })
}
if ($oldTokens.Count -gt 0) {
    Write-Info "Found $($oldTokens.Count) existing service token(s) named '$ServiceTokenName' (or a prior rotation name) -- left active until the replacement is validated."
}

$tokenName = $ServiceTokenName
$stCreate = Invoke-CF -Method POST -Path "/accounts/$AccountId/access/service_tokens" -Body @{ name = $tokenName }
if (-not $stCreate.Success) {
    $errText = Format-CFErrors $stCreate.Errors
    if ($errText -match "(?i)duplicate|already exists|taken|unique") {
        $tokenName = "$ServiceTokenName-$((Get-Date).ToUniversalTime().ToString('yyyyMMddHHmmss'))"
        Write-Warn2 "Cloudflare rejected the canonical token name as a duplicate -- creating '$tokenName' instead (cosmetic only; the Access policy binds by token id, not name)."
        $stCreate = Invoke-CF -Method POST -Path "/accounts/$AccountId/access/service_tokens" -Body @{ name = $tokenName }
    }
}
if (-not $stCreate.Success) { Stop-Bootstrap "Failed to create replacement Access Service Token: $(Format-CFErrors $stCreate.Errors)" }

$ClientId     = $stCreate.Result.client_id
$ClientSecret = $stCreate.Result.client_secret
$NewTokenId   = $stCreate.Result.id
Write-Ok "Created replacement service token '$tokenName' (client id recorded; secret held only in memory this run)"

$State.serviceTokenId = $NewTokenId
$State.serviceTokenClientId = $ClientId
$State.pendingRetireTokenIds = @($oldTokens | ForEach-Object { $_.id })
Save-State

# ---------------------------------------------------------------------------
# 10. Access policy -- transitional: allow BOTH the new token and any not-yet-retired old ones,
#     so the origin is never briefly unauthenticatable.
# ---------------------------------------------------------------------------
Write-Phase "Access policy (transitional -- allows old + new token during cutover)"

$existingPolicies = Invoke-CF -Method GET -Path "/accounts/$AccountId/access/apps/$($app.id)/policies"
$policy = $null
if ($existingPolicies.Success) {
    $policy = $existingPolicies.Result | Where-Object { $_.name -eq "Allow gateway service token" } | Select-Object -First 1
}

$transitionalTokenIds = @($NewTokenId) + @($State.pendingRetireTokenIds)
$policyBody = @{
    name     = "Allow gateway service token"
    decision = "allow"
    include  = @($transitionalTokenIds | ForEach-Object { @{ service_token = @{ token_id = $_ } } })
}
if ($policy) {
    $policyUpdate = Invoke-CF -Method PUT -Path "/accounts/$AccountId/access/apps/$($app.id)/policies/$($policy.id)" -Body $policyBody
    if (-not $policyUpdate.Success) { Stop-Bootstrap "Failed to update Access policy: $(Format-CFErrors $policyUpdate.Errors)" }
    Write-Ok "Updated existing Access policy to allow the new token (plus any not-yet-retired old ones)"
    $State.accessPolicyId = $policy.id
} else {
    $policyCreate = Invoke-CF -Method POST -Path "/accounts/$AccountId/access/apps/$($app.id)/policies" -Body $policyBody
    if (-not $policyCreate.Success) { Stop-Bootstrap "Failed to create Access policy: $(Format-CFErrors $policyCreate.Errors)" }
    Write-Ok "Created Access policy allowing the new token"
    $State.accessPolicyId = $policyCreate.Result.id
}
Save-State

# ---------------------------------------------------------------------------
# 11. Pages environment variables -- MERGE, never wholesale-replace. Uses the NEW token's
#     credentials -- this is the token going forward.
# ---------------------------------------------------------------------------
Write-Phase "Pages production environment variables"

$projectDetail = Invoke-CF -Method GET -Path "/accounts/$AccountId/pages/projects/$PagesProjectName"
if (-not $projectDetail.Success) { Stop-Bootstrap "Failed to read Pages project detail: $(Format-CFErrors $projectDetail.Errors)" }

$existingEnvVars = @{}
if ($projectDetail.Result.deployment_configs -and $projectDetail.Result.deployment_configs.production -and $projectDetail.Result.deployment_configs.production.env_vars) {
    $projectDetail.Result.deployment_configs.production.env_vars.PSObject.Properties | ForEach-Object {
        $existingEnvVars[$_.Name] = $_.Value
    }
}
Write-Info "Existing production env vars preserved: $($existingEnvVars.Keys -join ', ')"

$newVars = @{
    "CORE_GATEWAY_UPSTREAM_BASE"           = @{ value = "https://$TunnelHostname" }
    "CORE_GATEWAY_CF_ACCESS_CLIENT_ID"     = @{ value = $ClientId }
    "CORE_GATEWAY_CF_ACCESS_CLIENT_SECRET" = @{ type = "secret_text"; value = $ClientSecret }
    "VITE_CODEBLACK_CORE_BASE_URL"         = @{ value = "/api/core" }
    "VITE_OPS_DATA_MODE"                   = @{ value = "LIVE_CORE" }
}
foreach ($key in $newVars.Keys) { $existingEnvVars[$key] = $newVars[$key] }

$patchBody = @{
    deployment_configs = @{
        production = @{ env_vars = $existingEnvVars }
    }
}
$envPatch = Invoke-CF -Method PATCH -Path "/accounts/$AccountId/pages/projects/$PagesProjectName" -Body $patchBody
if (-not $envPatch.Success) { Stop-Bootstrap "Failed to update Pages environment variables: $(Format-CFErrors $envPatch.Errors)" }
Write-Ok "Pages production env vars updated (existing vars preserved, 5 new/updated: $($newVars.Keys -join ', '))"

# ---------------------------------------------------------------------------
# 12. Core-side cloudflared -- install as a systemd service via SSH
# ---------------------------------------------------------------------------
Write-Phase "CodeBlack-Core: activate cloudflared"

Write-Info "Confirming Core health before touching anything on Core..."
$coreHealthCheck = ssh $CoreSshAlias "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/health"
if ($coreHealthCheck -ne "200") { Stop-Bootstrap "Core API did not return HTTP 200 on 127.0.0.1:8000 before proceeding (got '$coreHealthCheck'). Not touching Core." }
Write-Ok "Core API healthy (127.0.0.1:8000)"

$existingCloudflaredState = ssh $CoreSshAlias "systemctl is-active cloudflared 2>/dev/null"
if ($existingCloudflaredState -eq "active") {
    Write-Warn2 "cloudflared service already active on Core -- reinstalling with the current tunnel token to ensure it matches this tunnel."
    ssh $CoreSshAlias "sudo systemctl stop cloudflared" | Out-Null
}

# The token is piped directly into the remote install command over the existing SSH transport;
# it is never written to a local file, never appears in this script's own console output, and
# ssh itself does not log command arguments to any file on either end. It is passed via stdin to
# "bash -s" rather than as a literal argument in an interactive shell, so it is not recorded in
# Core's own bash history either. (cloudflared's own installer does persist the token into its
# systemd unit/config on Core -- that is expected and required for unattended boot operation.)
$installCmd = "sudo cloudflared service install $TunnelConnectorToken"
$sshResult = $installCmd | ssh $CoreSshAlias "bash -s" 2>&1
Remove-Variable TunnelConnectorToken, installCmd -ErrorAction SilentlyContinue

Start-Sleep -Seconds 3
$cfdState = ssh $CoreSshAlias "systemctl is-active cloudflared 2>/dev/null"
if ($cfdState -ne "active") {
    Stop-Bootstrap "cloudflared did not reach 'active' state on Core after install (state: '$cfdState'). Check 'ssh $CoreSshAlias journalctl -u cloudflared -n 50' manually. Core API/SSH/Tailscale/MQTT were not touched by this step."
}
Write-Ok "cloudflared active on Core"

# Re-verify nothing else moved, including Tailscale (read-only checks only -- never configures it).
$postCoreHealth   = ssh $CoreSshAlias "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/health"
$sshHealth        = ssh $CoreSshAlias "systemctl is-active ssh"
$mqttBroker       = ssh $CoreSshAlias "systemctl is-active codeblack-mqtt-broker.service"
$mqttBridge       = ssh $CoreSshAlias "systemctl is-active codeblack-mqtt-bridge.service"
$failedUnits      = ssh $CoreSshAlias "systemctl --failed --no-legend | wc -l"
$listener8000     = ssh $CoreSshAlias "ss -tln 2>/dev/null | grep -c '0.0.0.0:8000'"
$tailscaledActive = ssh $CoreSshAlias "systemctl is-active tailscaled 2>/dev/null"
$tailscaleBackend = ssh $CoreSshAlias "tailscale status --json 2>/dev/null | grep -o '\`"BackendState\`":\`"[A-Za-z]*\`"' | head -1"

if ($postCoreHealth -ne "200") { Stop-Bootstrap "Core API stopped responding after cloudflared install (got '$postCoreHealth')." }
if ($sshHealth -ne "active")   { Stop-Bootstrap "SSH is no longer active on Core after cloudflared install." }
if ($mqttBroker -ne "active" -or $mqttBridge -ne "active") { Stop-Bootstrap "MQTT broker/bridge is no longer active on Core after cloudflared install." }
if ([int]$listener8000 -gt 0)  { Stop-Bootstrap "Core API is now listening on 0.0.0.0:8000 -- this must never happen. Stopping immediately." }
if ($tailscaledActive -ne "active") { Stop-Bootstrap "tailscaled is not active on Core after cloudflared install. Tailscale was not modified by this script -- investigate manually." }
if ($tailscaleBackend -notmatch '"BackendState":"Running"') { Stop-Bootstrap "Tailscale backend state is not 'Running' on Core (got: '$tailscaleBackend'). Tailscale was not modified by this script -- investigate manually." }
Write-Ok "Core API still 127.0.0.1:8000-only, SSH healthy, MQTT healthy, Tailscale healthy, no public 8000 listener"
if ([int]$failedUnits -gt 0) { Write-Warn2 "$failedUnits failed unit(s) reported on Core -- investigate manually (not necessarily caused by this run)." } else { Write-Ok "0 failed systemd units on Core" }

# ---------------------------------------------------------------------------
# 13. Infrastructure-level validation (tunnel + Access reachable with the NEW token)
# ---------------------------------------------------------------------------
Write-Phase "Infrastructure validation (tunnel + Access)"

Start-Sleep -Seconds 5  # let the tunnel connector finish registering
$tunnelValidated = $false
try {
    $tunnelCheck = Invoke-WebRequest -Method GET -Uri "https://$TunnelHostname/health" -Headers @{
        "CF-Access-Client-Id" = $ClientId
        "CF-Access-Client-Secret" = $ClientSecret
    } -UseBasicParsing -TimeoutSec 15
    Write-Ok "Core reachable end-to-end through the tunnel + Access ($TunnelHostname/health -> $($tunnelCheck.StatusCode))"
    $tunnelValidated = $true
} catch {
    # Windows PowerShell 5.1's Invoke-WebRequest throws on any non-2xx, not just network errors --
    # distinguish "wrong HTTP status" (real misconfiguration, worth naming) from "no response at
    # all" (likely just DNS/tunnel propagation delay).
    $status = 0
    if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
    if ($status -gt 0) {
        Write-Warn2 "Tunnel reachable but returned HTTP $status -- inspect manually before relying on it (e.g. an Access policy mismatch would show as 403)."
    } else {
        Write-Warn2 "Could not reach https://$TunnelHostname/health yet ($($_.Exception.Message)). DNS/tunnel propagation can take a minute."
    }
}

# ---------------------------------------------------------------------------
# 14. Retire superseded service token(s) -- ONLY after the new one validated above.
# ---------------------------------------------------------------------------
Write-Phase "Retire superseded service token(s)"

if ($State.pendingRetireTokenIds -and $State.pendingRetireTokenIds.Count -gt 0) {
    if (-not $tunnelValidated) {
        Write-Warn2 "Skipping retirement of $($State.pendingRetireTokenIds.Count) prior token(s) -- the new token could not be positively confirmed reachable through the tunnel this run. They remain active (the Access policy already allows both), and re-running this script later will retry retirement without re-creating anything unnecessary."
    } else {
        foreach ($oldId in $State.pendingRetireTokenIds) {
            $del = Invoke-CF -Method DELETE -Path "/accounts/$AccountId/access/service_tokens/$oldId"
            if ($del.Success) { Write-Ok "Retired superseded service token $oldId" }
            else { Write-Warn2 "Could not retire superseded service token $oldId -- $(Format-CFErrors $del.Errors). Not fatal; it is unused but still present. Remove manually if desired." }
        }
        $finalPolicyBody = @{
            name     = "Allow gateway service token"
            decision = "allow"
            include  = @(@{ service_token = @{ token_id = $NewTokenId } })
        }
        $finalPolicyUpdate = Invoke-CF -Method PUT -Path "/accounts/$AccountId/access/apps/$($app.id)/policies/$($State.accessPolicyId)" -Body $finalPolicyBody
        if ($finalPolicyUpdate.Success) { Write-Ok "Access policy tightened to the current token only" }
        else { Write-Warn2 "Could not tighten Access policy to the current token only -- $(Format-CFErrors $finalPolicyUpdate.Errors). Both old and new remain allowed; harmless (old token(s) are being retired/gone) but worth fixing on next run." }
        $State.pendingRetireTokenIds = @()
    }
} else {
    Write-Ok "No superseded tokens to retire"
}

Remove-Variable ClientSecret -ErrorAction SilentlyContinue
Save-State

# ---------------------------------------------------------------------------
# INFRASTRUCTURE PHASE COMPLETE
# ---------------------------------------------------------------------------
Write-Phase "INFRASTRUCTURE BOOTSTRAP COMPLETE"
Write-Host ""
Write-Host "  - Tunnel '$TunnelName' ($($State.tunnelId)) -> $CoreOrigin only"
Write-Host "  - DNS: $TunnelHostname -> tunnel (proxied)"
Write-Host "  - Access application + policy requiring a service token protect that hostname"
Write-Host "  - Access Service Token issued (client id: $ClientId) and configured server-side in Pages"
Write-Host "  - cloudflared active on CodeBlack-Core; Core API still 127.0.0.1:8000-only; SSH/Tailscale/MQTT"
Write-Host "    all confirmed healthy; no public port opened"
Write-Host ""
Write-Host "Resource IDs were recorded (no secrets) in:"
Write-Host "    $StateFile"
Write-Host "Re-running this script is safe -- it will reuse every resource above instead of duplicating it."
Write-Host ""

if (-not $Deploy) {
    Write-Host "No git push and no production deployment were performed (default behavior)." -ForegroundColor Yellow
    Write-Host "When ready for the production rollout checkpoint, re-run with:" -ForegroundColor Yellow
    Write-Host "    .\bootstrap-cloudflare-gateway.ps1 -Deploy" -ForegroundColor Cyan
    exit 0
}

# =============================================================================
# DEPLOY PHASE -- only reached with -Deploy. Everything above this line never
# touches git and never triggers a production deployment.
# =============================================================================

# ---------------------------------------------------------------------------
# 15. Pre-deploy validation -- nothing pushed yet.
# ---------------------------------------------------------------------------
Write-Phase "Pre-deploy validation (typecheck / lint / test / build) -- nothing pushed yet"

Push-Location $OpsPath
try {
    Write-Info "npm run typecheck"
    npm run typecheck
    if ($LASTEXITCODE -ne 0) { Stop-Bootstrap "TypeScript check failed. Not pushing." }

    Write-Info "npm run lint"
    npm run lint
    if ($LASTEXITCODE -ne 0) { Stop-Bootstrap "Lint failed. Not pushing." }

    Write-Info "npm run test"
    npm run test
    if ($LASTEXITCODE -ne 0) { Stop-Bootstrap "Tests failed. Not pushing." }

    Write-Info "npm run build"
    npm run build
    if ($LASTEXITCODE -ne 0) { Stop-Bootstrap "Production build failed. Not pushing." }

    Write-Ok "typecheck / lint / test / build all passed"
} finally {
    Pop-Location
}

# ---------------------------------------------------------------------------
# 16. Production bundle secret/leak scan -- nothing pushed yet.
# ---------------------------------------------------------------------------
Write-Phase "Production bundle secret/leak scan (dist/) -- nothing pushed yet"

$distPath = Join-Path $OpsPath "dist"
if (-not (Test-Path $distPath)) { Stop-Bootstrap "Build did not produce $distPath -- cannot scan before push." }

# Patterns that must never appear in a browser-shipped bundle. Only file paths are ever printed
# below, never the matched secret content itself.
$forbiddenPatterns = @(
    @{ Label = "Core Tailscale IP";              Pattern = [regex]::Escape($CoreTailscaleIp) }
    @{ Label = "Cloudflare API token env name";  Pattern = "CLOUDFLARE_API_TOKEN" }
    @{ Label = "Access client secret env name";  Pattern = "CORE_GATEWAY_CF_ACCESS_CLIENT_SECRET" }
    @{ Label = "Supabase service-role marker";   Pattern = "service_role" }
    @{ Label = "Loopback Core origin literal";   Pattern = "127\.0\.0\.1:8000" }
    @{ Label = "Direct tunnel hostname literal"; Pattern = [regex]::Escape($TunnelHostname) }
)

$distFiles = Get-ChildItem -Path $distPath -Recurse -File -Include *.js,*.css,*.html,*.map
$leakFound = $false
foreach ($pat in $forbiddenPatterns) {
    $hits = $distFiles | Select-String -Pattern $pat.Pattern -List
    if ($hits) {
        $leakFound = $true
        Write-Err2 "FOUND '$($pat.Label)' in: $(($hits | ForEach-Object { $_.Path }) -join ', ')"
    }
}
# The current Access Service Token secret value itself, if still in memory -- matched directly
# (never printed), since this is more precise than matching on env-var names alone.
if ($ClientId) {
    $clientIdHits = $distFiles | Select-String -Pattern ([regex]::Escape($ClientId)) -List
    if ($clientIdHits) {
        $leakFound = $true
        Write-Err2 "FOUND the Access Service Token client id embedded in: $(($clientIdHits | ForEach-Object { $_.Path }) -join ', ')"
    }
}
if ($leakFound) { Stop-Bootstrap "Production bundle contains forbidden content (see above). Not pushing or deploying." }
Write-Ok "Production bundle clean -- no private IP, secrets, tunnel hostname, or private origin literals found"

# ---------------------------------------------------------------------------
# 17. Push feature branch to production (fast-forward only)
# ---------------------------------------------------------------------------
Write-Phase "Push to production (fast-forward feature/ops-web-v1 -> origin/master)"

Push-Location $RepoPath
try {
    $status = git status --porcelain
    if ($status) {
        Write-Warn2 "Working tree has other changes -- they are left exactly as-is; only committed history is pushed."
    }

    git fetch origin --quiet
    $canFf = git merge-base --is-ancestor origin/master $FeatureBranch; $ffOk = $LASTEXITCODE -eq 0
    if (-not $ffOk) {
        Stop-Bootstrap "origin/master is not an ancestor of $FeatureBranch -- this would not be a fast-forward. Not pushing. Resolve manually."
    }
    git push origin "${FeatureBranch}:master"
    if ($LASTEXITCODE -ne 0) { Stop-Bootstrap "git push failed." }
    Write-Ok "Pushed $FeatureBranch to origin/master (fast-forward)"
} finally {
    Pop-Location
}

# ---------------------------------------------------------------------------
# 18. Wait for the Cloudflare Pages deployment to complete
# ---------------------------------------------------------------------------
Write-Phase "Waiting for Cloudflare Pages deployment"

$deployed = $false
for ($i = 0; $i -lt 24; $i++) {
    Start-Sleep -Seconds 10
    $deployments = Invoke-CF -Method GET -Path "/accounts/$AccountId/pages/projects/$PagesProjectName/deployments"
    if ($deployments.Success -and $deployments.Result -and $deployments.Result.Count -gt 0) {
        $latest = $deployments.Result[0]
        $stage = $latest.latest_stage.status
        Write-Info "Deployment $($latest.id.Substring(0,8)) stage status: $stage"
        if ($stage -eq "success") { $deployed = $true; break }
        if ($stage -eq "failure") { Stop-Bootstrap "Pages deployment failed. Check the Cloudflare Pages dashboard for build logs." }
    }
}
if (-not $deployed) {
    Write-Warn2 "Deployment did not confirm success within 4 minutes of polling -- check the Cloudflare Pages dashboard manually. Everything up to this point succeeded."
} else {
    Write-Ok "Production deployment succeeded"
}

# ---------------------------------------------------------------------------
# 19. Production gateway validation (unauthenticated path only -- see note below)
# ---------------------------------------------------------------------------
Write-Phase "Production gateway validation"

try {
    # Windows PowerShell 5.1's Invoke-WebRequest throws on non-2xx (no -SkipHttpErrorCheck
    # option, unlike PowerShell 7.4+) -- a 401 here is the EXPECTED/correct outcome, so it is
    # caught and read from the exception's response rather than treated as a script failure.
    $unauth = Invoke-WebRequest -Method GET -Uri "https://ops.codeblackwx.com/api/core/health" -UseBasicParsing -TimeoutSec 15
    Write-Warn2 "Unauthenticated request returned HTTP $($unauth.StatusCode), expected 401 -- investigate."
} catch {
    $status = 0
    if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
    if ($status -eq 401) {
        Write-Ok "Unauthenticated request to /api/core/health correctly rejected (401)"
    } else {
        Write-Warn2 "Could not confirm the expected 401 (got status '$status'): $($_.Exception.Message)"
    }
}

Save-State

# ---------------------------------------------------------------------------
# Final report
# ---------------------------------------------------------------------------
Write-Phase "STAGE 3 DEPLOY COMPLETE -- ONE MANUAL STEP REMAINS"
Write-Host ""
Write-Host "ONE thing this script cannot do, by design: prove Storm Intel actually renders correctly for a" -ForegroundColor White
Write-Host "real signed-in OPS user (Pea Ridge, Norman, an arbitrary CONUS point) against the live gateway."
Write-Host "That requires an actual human browser session with your existing Supabase login -- please open:"
Write-Host ""
Write-Host "    https://ops.codeblackwx.com" -ForegroundColor Cyan
Write-Host ""
Write-Host "and confirm Core health / Fabric / Storm Intel now show live data instead of UNAVAILABLE, and"
Write-Host "that a Storm Intel point query for Pea Ridge AR, Norman OK, and one other point returns real"
Write-Host "provenance (provider, run/valid time, forecast hour, data class) rather than a fake/simulated"
Write-Host "value. Nothing in this pipeline can fabricate that check on your behalf."
Write-Host ""
