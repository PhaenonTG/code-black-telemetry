#!/usr/bin/env python3
"""Guarded Core patch: Mesonet health history stays, direct Discord paging stops.

The dedicated mesonet_ntfy_bridge.py is the sole phone alert delivery path.
"""

import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

TARGET = Path("/srv/codeblack/data/mesonet/ops/mesonet_alerts.py")
OLD_ENDPOINT = "return os.getenv('CODE_BLACK_MESONET_ALERT_WEBHOOK','') or os.getenv('DISCORD_WEBHOOK_URL','')"
NEW_ENDPOINT = "return ''  # Dedicated ntfy bridge owns actionable delivery; never post directly to Discord."
OLD_STATUS = "delivery_active=bool(seen and time.time()-int(seen[0])<30)"
NEW_STATUS = '''try:
            health_path=Path('/srv/codeblack/data/status-center/mesonet-ntfy/health.json')
            health=json.loads(health_path.read_text())
            delivery_active=bool(health.get('ok') and time.time()-health_path.stat().st_mtime<120)
        except (OSError,ValueError): delivery_active=False'''


def transform(source):
    if NEW_ENDPOINT in source and NEW_STATUS in source and OLD_ENDPOINT not in source and OLD_STATUS not in source:
        return source, False
    if source.count(OLD_ENDPOINT) != 1 or source.count(OLD_STATUS) != 1:
        raise ValueError("unexpected Mesonet evaluator source; refusing to patch")
    return source.replace(OLD_ENDPOINT, NEW_ENDPOINT).replace(OLD_STATUS, NEW_STATUS), True


def main():
    if os.geteuid() != 0:
        raise SystemExit("run as root on Core")
    original = TARGET.read_text(encoding="utf-8")
    updated, changed = transform(original)
    if not changed:
        print("Mesonet ntfy-only policy already applied")
        return
    backup = TARGET.with_name(TARGET.name + ".pre-ntfy-only-" + time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()))
    if backup.exists():
        raise SystemExit("backup already exists; refusing to overwrite")
    temporary = TARGET.with_suffix(".py.ntfy-only-tmp")
    st = TARGET.stat()
    shutil.copy2(TARGET, backup)
    try:
        temporary.write_text(updated, encoding="utf-8")
        os.chown(temporary, st.st_uid, st.st_gid)
        os.chmod(temporary, st.st_mode)
        subprocess.run([sys.executable, "-m", "py_compile", str(temporary)], check=True)
        os.replace(temporary, TARGET)
        subprocess.run(["systemctl", "restart", "codeblack-mesonet-alerts.service"], check=True, timeout=30)
        subprocess.run(["systemctl", "is-active", "--quiet", "codeblack-mesonet-alerts.service"], check=True)
    except Exception:
        shutil.copy2(backup, TARGET)
        subprocess.run(["systemctl", "restart", "codeblack-mesonet-alerts.service"], check=False, timeout=30)
        raise
    print("Mesonet direct Discord delivery disabled; ntfy bridge and durable health history retained")


if __name__ == "__main__":
    main()
