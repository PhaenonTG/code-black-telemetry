"""Copy only the Core ESP admin token into a restricted Status Center credential.

Run as root on Core. Never prints the credential. Existing matching files are
left alone; rotation replaces the file atomically and invalidates old sessions.
"""

from pathlib import Path
import grp
import os

SOURCE = Path("/srv/codeblack/config/core-api/mesonet.env")
DIRECTORY = Path("/srv/codeblack/config/status-esp")
TARGET = DIRECTORY / "admin.token"

if os.geteuid() != 0:
    raise SystemExit("root required")

lines = SOURCE.read_text(encoding="utf-8").splitlines()
values = [line.partition("=")[2].strip().strip("\"'") for line in lines
          if line.startswith("CODE_BLACK_MESONET_ADMIN_TOKEN=")]
if len(values) != 1 or not 16 <= len(values[0]) <= 512 or any(ord(char) < 33 or ord(char) > 126 for char in values[0]):
    raise SystemExit("Core ESP operator credential is missing or invalid")

group = grp.getgrnam("codeblack").gr_gid
DIRECTORY.mkdir(mode=0o750, exist_ok=True)
os.chown(DIRECTORY, 0, group)
os.chmod(DIRECTORY, 0o750)
value = values[0]
if TARGET.exists() and TARGET.read_text(encoding="ascii").strip() == value:
    print("Status Center ESP credential is current")
    raise SystemExit(0)

temporary = DIRECTORY / (".admin.token." + str(os.getpid()))
try:
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="ascii") as out:
        out.write(value + "\n")
        out.flush()
        os.fsync(out.fileno())
    os.chown(temporary, 0, group)
    os.chmod(temporary, 0o640)
    os.replace(temporary, TARGET)
finally:
    if temporary.exists():
        temporary.unlink()
print("Status Center ESP credential provisioned")
