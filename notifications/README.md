# Private iPhone notifications

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
dispatcher and forwards new Edge incident transitions and actionable Status
Center attention transitions to the private `ops-monitoring` topic. A condition
must appear in three Status Center polls to page and clear in two to recover.
Pre-existing conditions are baselined on installation. Numeric incident updates
with the same underlying issue are suppressed. Expected-offline HYTETOWER and
Nick's currently unpowered ESPs are excluded from phone pages, not hidden from
Status Center. Discord remains the fallback when Core/ntfy itself is down.

The dedicated `ops-watcher` account has write-only access to `ops-monitoring`;
`glenn` has read-only access. The Edge token is stored outside Git at
`/srv/codeblack/private/ntfy/ops-publisher-token.txt`. The bridge writes health
to `/srv/codeblack/data/status/ntfy-bridge-status.json`; its health and freshness
are visible as **iPhone Ops Alerts** in Status Center. A bridge failure also
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
