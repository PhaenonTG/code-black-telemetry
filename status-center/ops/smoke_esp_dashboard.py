"""Core-local, non-mutating check of signed dashboard session and ESP bridge."""

import json
import sys
import urllib.error
import urllib.request

sys.path.insert(0, "/srv/codeblack/releases/status-center/current")
import server  # noqa: E402

base = "http://127.0.0.1:8795"
cookie = "cb_status_session=" + server.status_session("smoke-test")

def request(path, body=None):
    headers = {"Cookie": cookie}
    if body is not None:
        headers.update({"Content-Type": "application/json", "Origin": server.ESP_COMMAND_ORIGIN,
                        "X-Mesonet-UI": "1"})
    item = urllib.request.Request(base + path, data=json.dumps(body).encode() if body is not None else None,
                                  headers=headers, method="POST" if body is not None else "GET")
    try:
        with urllib.request.urlopen(item, timeout=8) as response:
            return response.status, response.read(200_000)
    except urllib.error.HTTPError as error:
        return error.code, error.read(200_000)

assert request("/")[0] == 200
status, payload = request("/api/esp-management/striker-weather")
assert status == 200 and json.loads(payload)["role"] == "striker-weather"
status, _ = request("/api/esp-management/striker-weather/commands", {"action": "not-a-command"})
assert status == 400  # Rejected before Core; no board command is queued.
assert request("/api/radar-control-settings")[0] == 200
print("Signed session, private ESP read, command allowlist, and radar settings: OK")
