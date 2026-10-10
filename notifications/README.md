# Private iPhone notifications

## Actionable alerts

Operational ntfy messages now include **Open Status** and **View Incident**
actions. The latter opens a separate Tailnet-only Core console at
`https://codeblack-core.tail1d0673.ts.net/alert-actions/incident?id=...`.
It requires the `glenn` operator login. The action console has its own
password, separate from the ntfy app login; Core verifies it against a
separately stored password hash. On PHAENON3, privately display the current
console password with
`ssh codeblack-core 'sudo cat /srv/codeblack/config/alert-actions/operator-password.txt'`.
Never paste the output into a shared chat. The iPhone browser can ask for this
login separately from the ntfy app. Alert URLs and ntfy's seven-day cache
contain no operator password, bearer token, or privileged action URL.

The console supports **Acknowledge**, **Snooze** (15 minutes, 1 hour, 4 hours,
or 24 hours), **Unsnooze**, and **Clear operator mark**. Acknowledgment is
visible beside active Status Center attention and does not conceal a fault.
On iPhone, reopen **View Incident** before retrying a form submitted before a
console restart: its single-use form token is kept in server memory. Same-origin
mobile browsers that omit the `Origin` header are accepted only with a valid
token; explicit foreign origins and cross-site submissions are rejected.
Snooze suppresses new ntfy sends for the matching alert ID, never Discord or
the Status Center itself. An active Status Center issue held during snooze is
sent when the snooze expires. Edge incident and Mesonet event transitions
occurring during snooze are skipped rather than replayed. If the action
service is unavailable, alert delivery fails open.

The **Review service actions** page requires a second typed confirmation
before a restart. Only `codeblack-ntfy.service` and
`codeblack-status-center.service` are allowlisted. Requests and results are
appended to a local audit log. The dedicated `codeblack-actions` account can
run only those exact `systemctl restart` commands through sudoers; it cannot
execute arbitrary unit names or shell commands. Do not treat the restart page
as a general remediation interface.

Deploy on Core using `install-alert-actions.sh` from a staged copy of this
directory. On first install it provisions a password hash from the existing
private ntfy reader password without printing it; the deployed console has
since been rotated to a separate password. It installs the isolated service and narrowly
scoped sudoers rule, and mounts the console with Tailscale Serve. State and
audit live under `/srv/codeblack/data/alert-actions`; credentials remain
outside Git. Removing the Serve mount and stopping the service disables all
remote actions without affecting alert publication.

The Core host serves a private ntfy instance at
`https://codeblack-core.tail1d0673.ts.net:8443` using Tailscale Serve. It is
not exposed via Funnel or Cloudflare. Anonymous access is denied. The server
keeps notification bodies for seven days, then expires them; the AEGIS
discussion audit independently retains its own records for 30 days.

The PHAENON3 `CodeBlack-Silas-Aegis-Notify` task runs
`silas_aegis_watch.py` once per minute using `pythonw.exe`. It reads only
Silas's rows from the local AEGIS `discussion_audit` table. Every new user or
assistant message is published with its full text to the `silas-aegis` topic.
Long texts are split into numbered parts. The first run baselines existing
messages rather than replaying old chats. Its cursor is persisted, and a
failed publish is retried instead of being marked delivered. A successful-run
heartbeat is watched by the status dashboard; if it stops refreshing for
three minutes, the watcher is marked degraded.

The server's iOS upstream integration sends ntfy.sh only a hashed topic URL
and message ID, **not the message body**. Apple's push wakes the iPhone app,
which retrieves the actual message from Core over Tailscale. Tailscale must
be connected on the iPhone for prompt retrieval. Lock-screen previews and
the phone's notification history are controlled on the iPhone and can outlive
the seven-day server cache.

Core stores the reader password and PHAENON3 publisher token outside Git.
Do not paste either into shared ChatGPT, Discord, or Git. The reader account
has read-only access to `silas-aegis`; the publisher has write-only access.

## Whole-system operational alerts

The existing Edge alert evaluator remains the authority for host reachability,
Core API, MQTT, backups, PHAENON3 functional health, and failed services. The
Core Status Center remains the inventory and dashboard for the broader fleet.
`edge_ntfy_bridge.py` runs once per minute from the existing Edge notification
dispatcher and forwards every new Edge incident/event type and every Status
Center attention transition (Info, Warning, Critical, and severity/state
changes) to the private `ops-monitoring` topic, except status-only HYTETOWER
and Nick WIND/WEATHER offline notices. Future ESP services marked
`offline_status_only` follow the same policy. These remain visible in the dashboard
without push or recovery notifications. A new condition must appear in three
Status Center polls to page and clear in two to recover. Numeric incident updates with the
same underlying issue are suppressed, as is normal GPU occupancy over 90% per
operator preference. Unchanged conditions never generate repeated pushes.
Discord remains the fallback when Core/ntfy itself is down.

Nick's dedicated Core mesonet evaluator also has a private 15-second ntfy
mirror, `codeblack-mesonet-ntfy-bridge.timer`. It reads its durable alert rows
but publishes only reboot loops and OTA update failures, including open and
resolution transitions. Offline and short-stale ESP telemetry remain in the
Mesonet history and Status Center, without ntfy or Discord pages. A row that
opens and clears between checks is reported as a short event. Existing rows
were baselined at install;
failed publishes remain pending for the next run. Its write-only token and
cursor stay under Core's private mesonet management directory. Status Center
shows this separately as **Nick Mesonet iPhone Alerts**. The Mesonet Discord
evaluator follows the same status-only offline/stale policy.
Its Core source currently lives outside this checkout; after replacing that
source, rerun `mesonet_status_only_policy.py` as root on Core before enabling
Discord delivery. The patch is guarded and leaves durable alert history intact.

The dedicated `ops-watcher` account has write-only access to `ops-monitoring`;
`glenn` has read-only access. The Edge token is stored outside Git at
`/srv/codeblack/private/ntfy/ops-publisher-token.txt`. The bridge writes health
to `/srv/codeblack/data/status/ntfy-bridge-status.json`; its health and freshness
are visible as **iPhone Ops Alerts** in Status Center, along with coverage and
tracked-alert counts. A bridge failure also
becomes an Edge incident for Discord fallback.

## iPhone enrollment

1. Install the free **ntfy** iOS app and keep Tailscale connected.
2. In the iOS app, tap **+** to add a subscription. Enter topic
   `ops-monitoring`, enable **Use another server**, and enter exactly
   `https://codeblack-core.tail1d0673.ts.net:8443` (including port 8443,
   with no topic path). Tap **Subscribe**. This bypasses the optional
   Settings → Default server screen.
3. When **Login required** appears, enter user `glenn`. On PHAENON3,
   privately view the password in a local terminal with
   `ssh codeblack-core 'cat /srv/codeblack/config/ntfy/reader-password.txt'`.
   Never paste the output into shared chat.
4. Repeat the same **+ → Use another server** flow for `silas-aegis` (full
   conversation text). The saved `glenn` login should be reused. Allow iOS
   notifications. Harmless connection-test messages are cached on both topics.

If the app refuses the URL, first open
`https://codeblack-core.tail1d0673.ts.net:8443/v1/health` in iPhone Safari
while Tailscale is connected; it should show `{"healthy":true}`. The iOS
app's Save button requires a URL beginning with `https://` or `http://`.

If iOS shows only "New message" instead of the text, check that Tailscale is
connected and the server URL matches exactly. Disable lock-screen previews
in iOS Settings if message text should not be visible on the lock screen.

If a test is visible after manually refreshing a topic but never appears as a
push notification, first test again with the ntfy app in the background and
the phone locked. Confirm iOS Settings → Notifications → ntfy allows alerts.
If still silent, remove and re-add the subscription to force Firebase/APNS
registration; ntfy documents this as a recovery step. On Core, run
`python3 notifications/diagnose_ios_push.py` from a staged copy to verify a
harmless publish produces the hashed upstream `poll_request`. This diagnostic
prints no credentials or message text. It does not prove that the iPhone
registered or that iOS displayed the alert.

Checks:

- `systemctl is-active codeblack-ntfy` and `curl -fsS http://127.0.0.1:2586/v1/health` on Core.
- `Get-ScheduledTaskInfo CodeBlack-Silas-Aegis-Notify` on PHAENON3.
- In the ntfy iPhone app, add the Core server, sign in, and subscribe to
  `silas-aegis`. Send a test notification only after the app is subscribed.
