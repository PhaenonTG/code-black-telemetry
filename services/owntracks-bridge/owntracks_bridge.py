#!/usr/bin/env python3
"""Code Black OwnTracks -> Fabric HTTP ingest adapter (V1).

A small, standalone, stdlib-only HTTP service (no new dependency, matching the
project's existing radar-worker convention of a single deployable file). It is
NOT a second tracking system: it accepts OwnTracks' own JSON location payload
over authenticated HTTPS (via Tailscale), normalizes it into the EXISTING
Fabric FabricIngestMessage contract, and POSTs that to core-api's own
POST /api/fabric/v1/ingest (loopback-only, already-authoritative). This
process holds no location state itself -- Fabric remains the single source of
truth; this is purely an adapter/translator.

Binds to 127.0.0.1 only. Exposure to Spencer's phone happens exclusively via
Tailscale Serve mapping a private path to this loopback port -- this process
is never reachable from the public internet.
"""
from __future__ import annotations

import json
import logging
import os
import secrets
import sys
import time
import urllib.error
import urllib.request
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

logger = logging.getLogger("owntracks_bridge")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", stream=sys.stdout)

PORT = int(os.environ.get("OWNTRACKS_BRIDGE_PORT", "8081"))
FABRIC_INGEST_URL = os.environ.get("FABRIC_INGEST_URL", "http://127.0.0.1:8000/api/fabric/v1/ingest")
TOKEN_FILE = os.environ.get("OWNTRACKS_SPENCER_TOKEN_FILE", "/srv/codeblack/config/owntracks/spencer-iphone.token")

# Server-authorized unit mapping (Part 6/7 of the spec): the client's bearer token maps to
# EXACTLY one unit_id -- the client payload can never choose or override this. Spencer's
# OwnTracks is a PERMANENT emergency/fallback location source for his own unit (STRIKER),
# never TESSA/Nick -- Fabric's own unit registry is authoritative for the human/unit identity
# behind this id (operator_name "Spencer", display_name "STRIKER"); this adapter never
# hardcodes that identity itself, only the id. Adding a second publisher later (e.g. a TESSA
# equivalent) means adding one more {token_file: unit/device} entry here, not a credential
# system.
UNIT_ID = "cbwx-unit-striker"
# Reuses STRIKER's ALREADY-registered "ops-ipad" device (Fabric's own registry already lists
# it as one of the two authoritative location sources for this unit, alongside
# cbwx-striker-nav -- see fabric.py's FabricRegistry.default()) rather than inventing/
# registering a new device_id, which would require editing and rebuilding the core-api package
# itself (out of scope for an adapter pass). Documented tradeoff (explicit follow-up, per this
# task's own instruction not to build a large arbitration system now): if the real onboard
# cbwx-striker-nav/ops-ipad hardware is ALSO reporting location at the same time, both sources
# write the same Fabric device slot (last-write-wins by observed_at) -- Fabric does not yet
# have a source-quality/precedence model to prefer one over the other. OwnTracks should be
# understood as "one possible location source for STRIKER," not STRIKER's definition.
DEVICE_ID = "cbwx-striker-ops-ipad"

LAT_MIN, LAT_MAX = -90.0, 90.0
LON_MIN, LON_MAX = -180.0, 180.0
# OwnTracks 'tst' is unix seconds. Reject anything absurd rather than trusting the client
# blindly -- Fabric's own FabricIngestMessage validator already rejects observed_at before
# 2024; this adds a forward/clock-skew bound OwnTracks payloads specifically need since a
# stale/misconfigured phone clock is a real, ordinary failure mode for this transport.
MAX_CLOCK_SKEW_FUTURE_S = 300
MIN_TST = 1_700_000_000  # ~2023-11-14 -- anything before this is not a real OwnTracks report


def _load_token() -> str:
    with open(TOKEN_FILE, encoding="utf-8") as handle:
        return handle.read().strip()


def _constant_time_eq(a: str, b: str) -> bool:
    return secrets.compare_digest(a.encode("utf-8"), b.encode("utf-8"))


class Handler(BaseHTTPRequestHandler):
    server_version = "codeblack-owntracks-bridge/1"
    _token: str = ""  # set once at process start in main()

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002 - stdlib signature
        # Never let the default access log echo the raw request line, which could contain the
        # Authorization header value if a client mistakenly puts the token in the query string.
        # Path only, no headers, no query string beyond the path OwnTracks itself sends.
        logger.info("%s - %s", self.address_string(), self.command)

    def _send_json(self, status: int, body: dict) -> None:
        payload = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _authorized(self) -> bool:
        auth = self.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            return False
        provided = auth[len("Bearer "):].strip()
        # Never logged: only the boolean result of this comparison is ever observed.
        return bool(provided) and _constant_time_eq(provided, self._token)

    def do_POST(self) -> None:  # noqa: N802 - stdlib handler name
        # Accepts both the full path (direct/local testing) and the suffix Tailscale Serve
        # forwards after stripping its "/owntracks" mount prefix (confirmed behavior: the
        # existing "/overlay" mount strips the same way -- classic-v2.html's own relative
        # asset requests only resolve correctly because of this). Avoids a fragile hard
        # dependency on exactly how Serve rewrites the path.
        accepted_paths = {"/api/owntracks/v1/location", "/v1/location"}
        if self.path.rstrip("/") not in accepted_paths:
            self._send_json(404, {"ok": False, "error": "NOT_FOUND"})
            return
        if not self._authorized():
            logger.info("owntracks ingest rejected: auth")
            self._send_json(401, {"ok": False, "error": "UNAUTHORIZED"})
            return

        length = int(self.headers.get("Content-Length", "0") or "0")
        if length <= 0 or length > 16_384:  # OwnTracks payloads are small; bound it generously
            self._send_json(400, {"ok": False, "error": "BAD_CONTENT_LENGTH"})
            return
        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            logger.info("owntracks ingest rejected: malformed JSON")
            self._send_json(400, {"ok": False, "error": "MALFORMED_JSON"})
            return

        error = self._validate(payload)
        if error:
            logger.info("owntracks ingest rejected: %s", error)
            self._send_json(422, {"ok": False, "error": error})
            return

        now = datetime.now(UTC)
        observed_at = datetime.fromtimestamp(payload["tst"], tz=UTC)
        received_at = now
        measurements = {
            "lat": payload["lat"],
            "lon": payload["lon"],
        }
        for key, src in (("accuracy_m", "acc"), ("altitude_m", "alt"), ("speed_mps", "vel"), ("course_deg", "cog"), ("battery_pct", "batt")):
            if isinstance(payload.get(src), (int, float)):
                measurements[key] = payload[src]

        fabric_message = {
            "schema_version": "1.0.0",
            "unit_id": UNIT_ID,
            "device_id": DEVICE_ID,
            "observed_at": observed_at.isoformat(),
            "received_at": received_at.isoformat(),
            "connected": True,
            "measurements": measurements,
            "transport": {
                "kind": "https",
                "path": "gatewayless",
                "via_device_id": None,
                "endpoint_ref": "/api/owntracks/v1/location",
                "protocol_version": "owntracks-http-v1",
            },
            "metadata": {
                "source": "owntracks",
                "transport": "https",
                "publisher": payload.get("tid") or "spencer-iphone-owntracks",
            },
        }

        try:
            ok, detail = self._forward_to_fabric(fabric_message)
        except Exception as exc:  # noqa: BLE001 - this boundary must never crash the process
            logger.warning("owntracks ingest: fabric forward failed: %s", exc)
            self._send_json(502, {"ok": False, "error": "FABRIC_INGEST_UNAVAILABLE"})
            return
        if not ok:
            logger.warning("owntracks ingest: fabric rejected: %s", detail)
            self._send_json(502, {"ok": False, "error": "FABRIC_INGEST_REJECTED", "detail": detail})
            return

        logger.info("owntracks ingest accepted: unit=%s device=%s", UNIT_ID, DEVICE_ID)
        self._send_json(200, {
            "ok": True,
            "unit_id": UNIT_ID,
            "accepted_at": received_at.isoformat(),
            "source_timestamp": observed_at.isoformat(),
        })

    def _validate(self, payload: object) -> str | None:
        if not isinstance(payload, dict):
            return "MALFORMED_PAYLOAD"
        if payload.get("_type") != "location":
            return "NOT_A_LOCATION_REPORT"
        lat, lon, tst = payload.get("lat"), payload.get("lon"), payload.get("tst")
        if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
            return "MISSING_OR_INVALID_LATLON"
        if not (LAT_MIN <= lat <= LAT_MAX) or not (LON_MIN <= lon <= LON_MAX):
            return "LATLON_OUT_OF_BOUNDS"
        if not isinstance(tst, (int, float)):
            return "MISSING_TIMESTAMP"
        if tst < MIN_TST or tst > time.time() + MAX_CLOCK_SKEW_FUTURE_S:
            return "TIMESTAMP_OUT_OF_RANGE"
        # unit_id is deliberately never read from the payload at all (see UNIT_ID constant
        # above) -- there is no code path by which a client value could reach Fabric.
        return None

    def _forward_to_fabric(self, message: dict) -> tuple[bool, str]:
        body = json.dumps(message).encode("utf-8")
        req = urllib.request.Request(
            FABRIC_INGEST_URL, data=body, method="POST",
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                return resp.status == 200, ""
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")[:200]
            return False, f"{exc.code}: {detail}"
        except urllib.error.URLError as exc:
            return False, str(exc.reason)


def main() -> None:
    Handler._token = _load_token()
    if not Handler._token:
        logger.error("empty OwnTracks token file at %s -- refusing to start", TOKEN_FILE)
        sys.exit(1)
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    logger.info("owntracks bridge listening on 127.0.0.1:%d -> %s (unit=%s device=%s)", PORT, FABRIC_INGEST_URL, UNIT_ID, DEVICE_ID)
    server.serve_forever()


if __name__ == "__main__":
    main()
