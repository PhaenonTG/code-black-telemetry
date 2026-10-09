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

## iPhone enrollment

1. Install the free **ntfy** iOS app and keep Tailscale connected.
2. Set the app's custom/default server to exactly
   `https://codeblack-core.tail1d0673.ts.net:8443` (including port 8443).
3. Add user `glenn` for that server. On PHAENON3, privately view the password
   in a local terminal with
   `ssh codeblack-core 'cat /srv/codeblack/config/ntfy/reader-password.txt'`.
   Never paste the output into shared chat.
4. Subscribe to topic `silas-aegis` and allow iOS notifications. A harmless
   connection-test message is already cached on the topic.

If iOS shows only "New message" instead of the text, check that Tailscale is
connected and the server URL matches exactly. Disable lock-screen previews
in iOS Settings if message text should not be visible on the lock screen.

Checks:

- `systemctl is-active codeblack-ntfy` and `curl -fsS http://127.0.0.1:2586/v1/health` on Core.
- `Get-ScheduledTaskInfo CodeBlack-Silas-Aegis-Notify` on PHAENON3.
- In the ntfy iPhone app, add the Core server, sign in, and subscribe to
  `silas-aegis`. Send a test notification only after the app is subscribed.
