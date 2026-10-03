# Overlay migration: REF radar from the Core radar product

Base: deployed overlay release `923191e-monitor-settings-v1.1-1` (Code Black Telemetry source; that source
repo is NOT on this machine, so this patch must be ported there).

- `overlay-radar-core-v1.patch` - unified diff of `index.html` (deployed -> radar-core-v1)
- `patch_overlay.py` - the assertion-guarded transform that produced it (each replacement must match exactly once)
- `RELEASE.json` - release metadata deployed as `/srv/codeblack/releases/overlay/radar-core-v1-20260928`

Rollback: `sudo ln -sfn /srv/codeblack/releases/overlay/923191e-monitor-settings-v1.1-1 /srv/codeblack/services/overlay-current`
