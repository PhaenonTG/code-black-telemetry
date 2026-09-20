# Code Black stream watch

`stream_watch.py` polls the social gateway's minimal public Facebook state endpoint and writes
`/srv/codeblack/data/status/stream.json` on CodeBlack-Edge. It only enqueues `stream_live` after a
confirmed `false` to `true` transition. First successful polling establishes a baseline, and an
unavailable source preserves the last known state without creating false live/offline events.

The script intentionally reuses `/srv/codeblack/data/notifications/outbox`. The existing Edge
dispatcher remains the only process with the Discord webhook and retains all delivery/retry state.

Install on Edge:

```sh
sudo install -d -o codeblack -g codeblack /srv/codeblack/services/edge-stream-watch
sudo install -o codeblack -g codeblack -m 0755 stream_watch.py /srv/codeblack/services/edge-stream-watch/
sudo install -o root -g root -m 0644 codeblack-stream-watch.service /etc/systemd/system/
sudo install -o root -g root -m 0644 codeblack-stream-watch.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now codeblack-stream-watch.timer
```

The social gateway must have `FACEBOOK_PAGE_ID` and `FACEBOOK_PAGE_ACCESS_TOKEN` configured as
Cloudflare Worker secrets before this monitor can obtain an available state.
