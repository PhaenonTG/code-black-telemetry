#!/usr/bin/env python3
"""Apply the operator's status-only ESP offline policy to Core's Mesonet evaluator.

The evaluator source currently lives on Core outside this checkout. Keep this
small guarded patch in Git until that evaluator is moved into a managed release.
"""

import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

TARGET = Path("/srv/codeblack/data/mesonet/ops/mesonet_alerts.py")
OLD = "WHERE kind!='stale' AND retry_at<=?"
NEW = "WHERE kind NOT IN ('stale','offline') AND retry_at<=?"


def transform(source):
    if source.count(NEW) == 1 and OLD not in source:
        return source, False
    if source.count(OLD) != 1 or NEW in source:
        raise ValueError("unexpected Mesonet evaluator source; refusing to patch")
    return source.replace(OLD, NEW), True


def main():
    if os.geteuid() != 0:
        raise SystemExit("run as root on Core")
    original = TARGET.read_text(encoding="utf-8")
    updated, changed = transform(original)
    if not changed:
        print("Mesonet status-only policy already applied")
        return
    backup = TARGET.with_name(TARGET.name + ".pre-status-only-" + time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()))
    if backup.exists():
        raise SystemExit("backup already exists; refusing to overwrite")
    temporary = TARGET.with_suffix(".py.status-only-tmp")
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
    print("Mesonet Discord offline/stale pages disabled; durable health history retained")


if __name__ == "__main__":
    main()
