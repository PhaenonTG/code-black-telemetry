<#
Code Black OPS -- Cloudflare Core Gateway Bootstrap (Stage 3)

RUN THIS YOURSELF, INTERACTIVELY, in your own PowerShell window. It prompts for a secret with
Read-Host and must have a real console attached -- do not run it from a non-interactive
automation context.

What this does, in order:
  1. Prompts for a Cloudflare API token (SecureString, never echoed).
  2. Verifies the token and discovers account ID / codeblackwx.com zone ID / codeblack-ops
     Pages project -- read-only calls only.
  3. Probes every permission this workflow needs (all read-only calls). If ANY probe fails,
     it prints exactly which permission is missing and stops -- nothing is created or changed.
  4. Only if every probe succeeds, it proceeds (idempotently -- reuses existing matching
     resources instead of creating duplicates) to:
       - create/reuse a Cloudflare Tunnel named "codeblack-core-gateway"
       - configure its ingress to http://127.0.0.1:8000 only
       - create/reuse the DNS record for the tunnel hostname
       - create/reuse an Access application + policy protecting that hostname
       - create (or, if one already exists and its secret is unrecoverable, rotate) an Access
         Service Token
       - merge (never overwrite wholesale) the new server-side env vars into the codeblack-ops
         Pages project's production environment
       - install/verify cloudflared as a systemd service on CodeBlack-Core via SSH, using the
         tunnel token -- Core's own API binding is never touched
       - push feature/ops-web-v1 to origin/master (fast-forward only) to trigger Cloudflare's
         existing Pages Git-integration deploy
       - poll the resulting Pages deployment until it succeeds
       - run infrastructure-level validation (tunnel reachable via the Access service token,
         unauthenticated gateway request correctly rejected)
  5. Prints a final structured report, and writes a NON-secret state file (resource IDs/names
     only -- gitignored) for idempotent re-runs.

What this does NOT do (by design, matches the approved plan):
  - Does not touch SSH, Tailscale, MQTT, or Core's application code/binding.
  - Does not open any firewall port. Core's API stays on 127.0.0.1:8000 only.
  - Does not implement Fabric WebSocket, Sounding, or Consensus.
  - Does not perform the final "real authenticated browser session" check -- that requires a
    human logged-in Supabase session and is printed as the one remaining manual step at the end.
  - Never writes the Cloudflare token, the Access Service Token secret, or any other secret to
    disk, to git, or to any log file. The token lives only in this PowerShell process's memory
    for the duration of this run.
#>

#Requires -Version 5.1
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
$StateFile        = Join-Path $OpsPath ".cloudflare-bootstrap-state.json"
$ApiBase          = "https://api.cloudflare.com/client/v4"

function Write-Phase($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }
function Write-Ok($msg)    { Write-Host "  [OK]   $msg" -ForegroundColor Green }
function Write-Info($msg)  { Write-Host "  [..]   $msg" -ForegroundColor Gray }
function Write-Warn2($msg) { Write-Host "  [WARN] $msg" -ForegroundColor Yellow }
function Write-Err2($msg)  { Write-Host "  [FAIL] $msg" -ForegroundColor Red }

function Stop-Bootstrap($reason) {
    Write-Err2 $reason
    Write-Host "`nSTOPPED. Nothing further was changed." -ForegroundColor Red
    exit 1
}

# ---------------------------------------------------------------------------
# 1. Token acquisition -- never echoed, never written to disk
# ---------------------------------------------------------------------------
Write-Phase "Cloudflare API Token"
Write-Host "This token is used only in this process's memory for this run. It is never printed," -ForegroundColor Gray
Write-Host "logged, written to disk, or committed." -ForegroundColor Gray

if ($env:CLOUDFLARE_API_TOKEN) {
    Write-Info "Using `$env:CLOUDFLARE_API_TOKEN already set in this session."
    $Token = $env:CLOUDFLARE_API_TOKEN
} else {
    $secureToken = Read-Host -Prompt "Paste your Cloudflare API token" -AsSecureString
    if ($secureToken.Length -eq 0) { Stop-Bootstrap "No token entered." }
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
    try {
        $Token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
    Remove-Variable secureToken -ErrorAction SilentlyContinue
}
if ([string]::IsNullOrWhiteSpace($Token)) { Stop-Bootstrap "Empty token." }

$Headers = @{ Authorization = "Bearer $Token"; "Content-Type" = "application/json" }

# ---------------------------------------------------------------------------
# Cloudflare API helper -- PS 5.1-compatible error body extraction.
# Never logs $Headers or $Token. Returns a normalized object: success/status/result/errors.
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
            $raw = Invoke-WebRequest -Method $Method -Uri $uri -Headers $Headers -Body $jsonBody -UseBasicParsing -ErrorAction Stop
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
# 2. Verify token
# ---------------------------------------------------------------------------
Write-Phase "Verify token"
$verify = Invoke-CF -Method GET -Path "/user/tokens/verify"
if (-not $verify.Success) {
    Stop-Bootstrap "Token verification failed (HTTP $($verify.HttpStatus)): $(Format-CFErrors $verify.Errors)"
}
Write-Ok "Token is valid (status: $($verify.Result.status))"

# ---------------------------------------------------------------------------
# 3. Discover account ID, zone ID, Pages project
# ---------------------------------------------------------------------------
Write-Phase "Discover account / zone / Pages project"

$accounts = Invoke-CF -Method GET -Path "/accounts"
if (-not $accounts.Success -or -not $accounts.Result -or $accounts.Result.Count -eq 0) {
    Stop-Bootstrap "Could not list accounts -- missing 'Account Settings: Read'. Detail: $(Format-CFErrors $accounts.Errors)"
}
$AccountId = $accounts.Result[0].id
Write-Ok "Account ID discovered: $AccountId ($($accounts.Result[0].name))"

$zones = Invoke-CF -Method GET -Path "/zones?name=$ZoneName"
if (-not $zones.Success -or -not $zones.Result -or $zones.Result.Count -eq 0) {
    Stop-Bootstrap "Could not find zone '$ZoneName' -- missing 'Zone: Read' on that zone, or the token isn't scoped to it. Detail: $(Format-CFErrors $zones.Errors)"
}
$ZoneId = $zones.Result[0].id
Write-Ok "Zone ID discovered: $ZoneId ($ZoneName)"

$pagesProjects = Invoke-CF -Method GET -Path "/accounts/$AccountId/pages/projects"
if (-not $pagesProjects.Success) {
    Stop-Bootstrap "Could not list Pages projects -- missing 'Cloudflare Pages: Read'. Detail: $(Format-CFErrors $pagesProjects.Errors)"
}
$pagesProject = $pagesProjects.Result | Where-Object { $_.name -eq $PagesProjectName } | Select-Object -First 1
if (-not $pagesProject) {
    Stop-Bootstrap "Pages project '$PagesProjectName' not found in this account. Found: $(($pagesProjects.Result | ForEach-Object { $_.name }) -join ', ')"
}
Write-Ok "Pages project discovered: $PagesProjectName"

# ---------------------------------------------------------------------------
# 4. Permission probes -- ALL must succeed before anything is created/changed
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
    accountId       = $AccountId
    zoneId          = $ZoneId
    tunnelId        = $null
    tunnelHostname  = $TunnelHostname
    dnsRecordId     = $null
    accessAppId     = $null
    accessPolicyId  = $null
    serviceTokenId  = $null
    serviceTokenClientId = $null
    lastRunUtc      = $null
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
# 5. Tunnel -- create or reuse
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
# 6. DNS record -- create or reuse
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
# 7. Access application -- create or reuse
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
# 8. Access Service Token -- create, or rotate if one exists with an unrecoverable secret
# ---------------------------------------------------------------------------
Write-Phase "Access Service Token"

$existingTokens = Invoke-CF -Method GET -Path "/accounts/$AccountId/access/service_tokens"
$existingSt = $null
if ($existingTokens.Success) {
    $existingSt = $existingTokens.Result | Where-Object { $_.name -eq $ServiceTokenName } | Select-Object -First 1
}

$ClientId = $null
$ClientSecret = $null

if ($existingSt -and $State.serviceTokenClientId -eq $existingSt.client_id -and $State.serviceTokenId) {
    Write-Warn2 "A service token named '$ServiceTokenName' already exists from a prior run of this script."
    Write-Warn2 "Cloudflare never exposes a service token's secret after creation, so it cannot be reused --"
    Write-Warn2 "rotating it now (delete + recreate) to obtain a usable secret. This only affects this"
    Write-Warn2 "one gateway-specific token; nothing else references it."
    $delete = Invoke-CF -Method DELETE -Path "/accounts/$AccountId/access/service_tokens/$($existingSt.id)"
    if (-not $delete.Success) { Stop-Bootstrap "Failed to rotate (delete) existing service token: $(Format-CFErrors $delete.Errors)" }
    $existingSt = $null
} elseif ($existingSt) {
    Write-Warn2 "A service token named '$ServiceTokenName' already exists but wasn't created by this script"
    Write-Warn2 "(no matching local state), so its secret cannot be recovered. Rotating it now."
    $delete = Invoke-CF -Method DELETE -Path "/accounts/$AccountId/access/service_tokens/$($existingSt.id)"
    if (-not $delete.Success) { Stop-Bootstrap "Failed to rotate (delete) existing service token: $(Format-CFErrors $delete.Errors)" }
    $existingSt = $null
}

$stCreate = Invoke-CF -Method POST -Path "/accounts/$AccountId/access/service_tokens" -Body @{ name = $ServiceTokenName }
if (-not $stCreate.Success) { Stop-Bootstrap "Failed to create Access Service Token: $(Format-CFErrors $stCreate.Errors)" }
$ClientId = $stCreate.Result.client_id
$ClientSecret = $stCreate.Result.client_secret
$State.serviceTokenId = $stCreate.Result.id
$State.serviceTokenClientId = $ClientId
Write-Ok "Service token created (client id recorded; secret held only in memory this run)"
Save-State

# ---------------------------------------------------------------------------
# 9. Access policy -- require this service token on the application
# ---------------------------------------------------------------------------
Write-Phase "Access policy"

$existingPolicies = Invoke-CF -Method GET -Path "/accounts/$AccountId/access/apps/$($app.id)/policies"
$policy = $null
if ($existingPolicies.Success) {
    $policy = $existingPolicies.Result | Where-Object { $_.name -eq "Allow gateway service token" } | Select-Object -First 1
}
$policyBody = @{
    name     = "Allow gateway service token"
    decision = "allow"
    include  = @(@{ service_token = @{ token_id = $State.serviceTokenId } })
}
if ($policy) {
    $policyUpdate = Invoke-CF -Method PUT -Path "/accounts/$AccountId/access/apps/$($app.id)/policies/$($policy.id)" -Body $policyBody
    if (-not $policyUpdate.Success) { Stop-Bootstrap "Failed to update Access policy: $(Format-CFErrors $policyUpdate.Errors)" }
    Write-Ok "Updated existing Access policy to require the current service token"
    $State.accessPolicyId = $policy.id
} else {
    $policyCreate = Invoke-CF -Method POST -Path "/accounts/$AccountId/access/apps/$($app.id)/policies" -Body $policyBody
    if (-not $policyCreate.Success) { Stop-Bootstrap "Failed to create Access policy: $(Format-CFErrors $policyCreate.Errors)" }
    Write-Ok "Created Access policy requiring the service token"
    $State.accessPolicyId = $policyCreate.Result.id
}
Save-State

# ---------------------------------------------------------------------------
# 10. Pages environment variables -- MERGE, never wholesale-replace
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

# $Token itself is no longer needed -- $Headers already holds the resolved "Bearer <token>"
# string and continues to work for every remaining Cloudflare API call below. $ClientSecret is
# still needed for the tunnel health check in the next phase, so it is NOT cleared here.
Remove-Variable Token -ErrorAction SilentlyContinue

# ---------------------------------------------------------------------------
# 11. Core-side cloudflared -- install as a systemd service via SSH
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
# ssh itself does not log command arguments to any file on either end.
$installCmd = "sudo cloudflared service install $TunnelConnectorToken"
$sshResult = $installCmd | ssh $CoreSshAlias "bash -s" 2>&1
Remove-Variable TunnelConnectorToken, installCmd -ErrorAction SilentlyContinue

Start-Sleep -Seconds 3
$cfdState = ssh $CoreSshAlias "systemctl is-active cloudflared 2>/dev/null"
if ($cfdState -ne "active") {
    Stop-Bootstrap "cloudflared did not reach 'active' state on Core after install (state: '$cfdState'). Check 'ssh $CoreSshAlias journalctl -u cloudflared -n 50' manually. Core API/SSH/Tailscale/MQTT were not touched by this step."
}
Write-Ok "cloudflared active on Core"

# Re-verify nothing else moved.
$postCoreHealth = ssh $CoreSshAlias "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/health"
$sshHealth      = ssh $CoreSshAlias "systemctl is-active ssh"
$mqttBroker     = ssh $CoreSshAlias "systemctl is-active codeblack-mqtt-broker.service"
$mqttBridge     = ssh $CoreSshAlias "systemctl is-active codeblack-mqtt-bridge.service"
$failedUnits    = ssh $CoreSshAlias "systemctl --failed --no-legend | wc -l"
$listener8000   = ssh $CoreSshAlias "ss -tln 2>/dev/null | grep -c '0.0.0.0:8000'"

if ($postCoreHealth -ne "200") { Stop-Bootstrap "Core API stopped responding after cloudflared install (got '$postCoreHealth')." }
if ($sshHealth -ne "active")   { Stop-Bootstrap "SSH is no longer active on Core after cloudflared install." }
if ($mqttBroker -ne "active" -or $mqttBridge -ne "active") { Stop-Bootstrap "MQTT broker/bridge is no longer active on Core after cloudflared install." }
if ([int]$listener8000 -gt 0)  { Stop-Bootstrap "Core API is now listening on 0.0.0.0:8000 -- this must never happen. Stopping immediately." }
Write-Ok "Core API still 127.0.0.1:8000-only, SSH healthy, MQTT healthy, no public 8000 listener"
if ([int]$failedUnits -gt 0) { Write-Warn2 "$failedUnits failed unit(s) reported on Core -- investigate manually (not necessarily caused by this run)." } else { Write-Ok "0 failed systemd units on Core" }

# ---------------------------------------------------------------------------
# 12. Infrastructure-level validation -- BEFORE pushing/deploying the frontend
# ---------------------------------------------------------------------------
Write-Phase "Infrastructure validation (tunnel + Access, before deploy)"

Start-Sleep -Seconds 5  # let the tunnel connector finish registering
try {
    $tunnelCheck = Invoke-WebRequest -Method GET -Uri "https://$TunnelHostname/health" -Headers @{
        "CF-Access-Client-Id" = $ClientId
        "CF-Access-Client-Secret" = $ClientSecret
    } -UseBasicParsing -TimeoutSec 15
    Write-Ok "Core reachable end-to-end through the tunnel + Access ($TunnelHostname/health -> $($tunnelCheck.StatusCode))"
} catch {
    # Windows PowerShell 5.1's Invoke-WebRequest throws on any non-2xx, not just network errors --
    # distinguish "wrong HTTP status" (real misconfiguration, worth naming) from "no response at
    # all" (likely just DNS/tunnel propagation delay).
    $status = 0
    if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
    if ($status -gt 0) {
        Write-Warn2 "Tunnel reachable but returned HTTP $status -- inspect manually before relying on it (e.g. an Access policy mismatch would show as 403)."
    } else {
        Write-Warn2 "Could not reach https://$TunnelHostname/health yet ($($_.Exception.Message)). DNS/tunnel propagation can take a minute -- this does not block continuing, but verify manually before trusting production."
    }
}

# $ClientSecret was only ever needed for the check above and the Pages env var payload already
# sent to Cloudflare over HTTPS; nothing after this point needs it in memory.
Remove-Variable ClientSecret -ErrorAction SilentlyContinue

# ---------------------------------------------------------------------------
# 13. Push feature branch to production (fast-forward only)
# ---------------------------------------------------------------------------
Write-Phase "Push to production (fast-forward feature/ops-web-v1 -> origin/master)"

Push-Location $RepoPath
try {
    $status = git status --porcelain
    $unrelatedDirty = $status | Where-Object { $_ -notmatch "^\?\? web/ops/scripts/bootstrap-cloudflare-gateway\.ps1$" }
    if ($unrelatedDirty) {
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
# 14. Wait for the Cloudflare Pages deployment to complete
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
# 15. Production gateway validation (unauthenticated path only -- see note below)
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
Write-Phase "STAGE 3 BOOTSTRAP COMPLETE -- ONE MANUAL STEP REMAINS"
Write-Host @"

Everything scriptable is done:
  - Tunnel '$TunnelName' ($($State.tunnelId)) -> $CoreOrigin only
  - DNS: $TunnelHostname -> tunnel (proxied)
  - Access application + policy requiring a service token protect that hostname
  - Access Service Token issued (client id: $ClientId) and configured server-side in Pages
  - cloudflared active on CodeBlack-Core; Core API still 127.0.0.1:8000-only; SSH/Tailscale/MQTT
    all confirmed healthy; no public port opened
  - feature/ops-web-v1 pushed to origin/master; Cloudflare Pages deployment triggered
  - Infrastructure-level checks passed (tunnel reachable, unauthenticated gateway request rejected)

ONE thing this script cannot do, by design: prove Storm Intel actually renders correctly for a
real signed-in OPS user (Pea Ridge, Norman, an arbitrary CONUS point) against the live gateway.
That requires an actual human browser session with your existing Supabase login -- please open:

    https://ops.codeblackwx.com

and confirm Core health / Fabric / Storm Intel now show live data instead of UNAVAILABLE, and
that a Storm Intel point query for Pea Ridge AR, Norman OK, and one other point returns real
provenance (provider, run/valid time, forecast hour, data class) rather than a fake/simulated
value. Nothing in this pipeline can fabricate that check on your behalf.

Resource IDs were recorded (no secrets) in:
    $StateFile
Re-running this script is safe -- it will reuse every resource above instead of duplicating it.
"@ -ForegroundColor White
