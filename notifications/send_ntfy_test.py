#!/usr/bin/env python3
"""Fixed-content, no-argument notification test for the Core action console."""

import urllib.request
from pathlib import Path

TOKEN = Path("/srv/codeblack/config/ntfy/ops-publisher-token.txt")
URL = "http://127.0.0.1:2586/ops-monitoring"


def main():
    token = TOKEN.read_text(encoding="utf-8").strip()
    if not token:
        raise RuntimeError("publisher token missing")
    request = urllib.request.Request(
        URL,
        data=b"Operator-requested delivery test. No action needed.",
        headers={"Authorization": "Bearer " + token, "Title": "Code Black phone delivery test",
                 "Priority": "default", "Tags": "white_check_mark"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=8) as response:
        if response.status != 200:
            raise RuntimeError("ntfy publish failed")


if __name__ == "__main__":
    main()
