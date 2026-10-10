# Radar worker HTTP recovery

The radar worker can remain `active (running)` while its single Node event loop
stops answering HTTP. The Status Center correctly marks its health probe
degraded, but systemd's `Restart=on-failure` does not restart a live process.

`codeblack-radar-health-watchdog.timer` checks the local health endpoint once
per minute. Four consecutive failed checks while the service is active trigger
one targeted restart. A successful check or a gap over three minutes resets
the count. Restarts are limited to once per 15 minutes, and inactive service
recovery remains systemd's responsibility. Check results and restarts are
logged to the watchdog unit's journal. Its small policy state is stored at
`/srv/codeblack/data/radar-worker/health-watchdog.json`.

This recovers a hung HTTP listener; it does not fix the underlying radar
decode or upstream S3 failure. Keep the health probe and failure logs visible
so recurring stalls can be investigated separately.
