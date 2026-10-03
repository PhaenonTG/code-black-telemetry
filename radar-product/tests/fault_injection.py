#!/usr/bin/env python3
"""Deterministic failure/recovery qualification for product.py against a mock IEM source.

Usage: python3 fault_injection.py <path/to/product.py> <path/to/real_n0q.png>
Runs an isolated product instance (temp data dir, port 8793, shortened freshness thresholds) and
asserts: freshness transitions, retained-latest on outage, corrupt/truncated/wrong-size rejection,
recovery, crash-restart persistence, atomic publication, and immutability of published assets.
"""
import hashlib
import io
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer

from PIL import Image

PRODUCT, REAL_PNG = sys.argv[1], sys.argv[2]
MOCK_PORT, PROD_PORT = 8794, 8793
THRESH = {"FRESH": 30, "AGING": 60, "STALE": 90}

real = open(REAL_PNG, "rb").read()
buf = io.BytesIO()
Image.new("P", (600, 300)).save(buf, "PNG")
WRONG_SIZE = buf.getvalue()
STATE = {"mode": "ok", "valid": None}


def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


class Mock(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"

    def log_message(self, *a):
        pass

    def do_GET(self):
        mode = STATE["mode"]
        if mode == "503":
            self.send_response(503); self.end_headers(); return
        if mode == "timeout":
            time.sleep(6); return
        if self.path.endswith("n0q_0.json"):
            body = json.dumps({"meta": {"vcp": None, "product": "N0Q", "site": "USCOMP", "valid": STATE["valid"], "processing_time_secs": 100, "radar_quorum": "143/147"}}).encode()
            self.send_response(200); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body); return
        if self.path.endswith("n0q_0.png"):
            data = {"ok": real, "corrupt": os.urandom(200000), "truncated": real, "wrongsize": WRONG_SIZE}[mode]
            self.send_response(200); self.send_header("Content-Length", str(len(data)))
            self.send_header("Last-Modified", datetime.now(timezone.utc).strftime("%a, %d %b %Y %H:%M:%S GMT")); self.end_headers()
            self.wfile.write(data[: len(data) // 2] if mode == "truncated" else data); return
        self.send_response(404); self.end_headers()


def manifest():
    return json.load(urllib.request.urlopen(f"http://127.0.0.1:{PROD_PORT}/v1/composite/latest.json", timeout=5))


def wait_for(pred, timeout, step=0.5):
    end = time.time() + timeout
    while time.time() < end:
        try:
            m = manifest()
            if pred(m):
                return m
        except Exception:
            pass
        time.sleep(step)
    return None


results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""), flush=True)


def start_product(data_dir):
    env = dict(os.environ, RADAR_PRODUCT_PORT=str(PROD_PORT), RADAR_PRODUCT_DATA_DIR=data_dir, RADAR_PRODUCT_SOURCE_BASE=f"http://127.0.0.1:{MOCK_PORT}",
               RADAR_PRODUCT_POLL_SECONDS="1", RADAR_PRODUCT_HTTP_TIMEOUT="3", RADAR_PRODUCT_LOOP_FRAMES="4", RADAR_PRODUCT_FRESH_MAX_S=str(THRESH["FRESH"]),
               RADAR_PRODUCT_AGING_MAX_S=str(THRESH["AGING"]), RADAR_PRODUCT_STALE_MAX_S=str(THRESH["STALE"]))
    return subprocess.Popen([sys.executable, PRODUCT], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def main():
    threading.Thread(target=HTTPServer(("127.0.0.1", MOCK_PORT), Mock).serve_forever, daemon=True).start()
    data_dir = tempfile.mkdtemp(prefix="rp-fault-")
    now = datetime.now(timezone.utc).replace(microsecond=0)
    v0 = now - timedelta(seconds=10)
    STATE.update(mode="ok", valid=iso(v0))
    proc = start_product(data_dir)
    try:
        # S1 first frame
        m = wait_for(lambda m: m["latest"] is not None, 30)
        check("S1 first frame published from mock source", m and m["latest"]["frame_id"] == v0.strftime("%Y%m%dT%H%MZ"), m and m["latest"]["frame_id"])
        check("S1 state FRESH at low age", m and m["freshness_state"] == "FRESH", m and f"age={m['age_seconds']}")
        v0_id = m["latest"]["frame_id"]
        v0_obs = m["latest"]["observation_time"]
        v0_sha = hashlib.sha256(urllib.request.urlopen(f"http://127.0.0.1:{PROD_PORT}/v1/composite/frames/{v0_id}/source.png").read()).hexdigest()

        # S2 stalled source: freshness must escalate on its own, latest must not be rewritten
        seen, t0 = [], time.time()
        while time.time() - t0 < THRESH["STALE"] + 40:
            m = manifest()
            if not seen or seen[-1][0] != m["freshness_state"]:
                seen.append((m["freshness_state"], m["age_seconds"], round(time.time() - t0, 1)))
            if m["freshness_state"] == "CRITICAL":
                break
            time.sleep(1)
        states = [s[0] for s in seen]
        check("S2 stall escalates FRESH->AGING->STALE->CRITICAL", states == ["FRESH", "AGING", "STALE", "CRITICAL"], str(seen))
        check("S2 observation time never rewritten during stall", m["latest"]["observation_time"] == v0_obs and m["latest"]["frame_id"] == v0_id)
        check("S2 no failures recorded when source is merely unchanged", m["worker"]["consecutive_failures"] == 0)
        frames_before = len(m["frames"])

        # S3 outage
        STATE["mode"] = "503"
        m = wait_for(lambda m: m["worker"]["consecutive_failures"] >= 3, 20)
        check("S3 outage recorded (consecutive_failures>=3)", m is not None, m and str(m["worker"]["consecutive_failures"]))
        check("S3 latest retained and still CRITICAL during outage", m and m["latest"]["frame_id"] == v0_id and m["freshness_state"] == "CRITICAL")
        err = (m or {}).get("worker", {}).get("last_error") or ""
        check("S3 last_error present and contains no filesystem path", err != "" and "/tmp" not in err and data_dir not in err, err[:80])

        # S4-S6 bad payloads with a NEWER valid must never be published
        for mode, label in (("corrupt", "S4 corrupt PNG"), ("truncated", "S5 truncated PNG"), ("wrongsize", "S6 wrong-size PNG")):
            STATE.update(mode=mode, valid=iso(datetime.now(timezone.utc).replace(microsecond=0) - timedelta(seconds=5)))
            fail_before = manifest()["worker"]["total_failures"]
            wait_for(lambda m: m["worker"]["total_failures"] > fail_before + 1, 15)
            m = manifest()
            check(f"{label} rejected, not published", m["latest"]["frame_id"] == v0_id and len(m["frames"]) == frames_before, f"frames={len(m['frames'])} failures={m['worker']['total_failures']}")

        # S7 recovery with a good frame (distinct minute)
        STATE.update(mode="ok", valid=iso(datetime.now(timezone.utc).replace(microsecond=0) + timedelta(seconds=70)))
        v2_id = (datetime.now(timezone.utc) + timedelta(seconds=70)).strftime("%Y%m%dT%H%MZ")
        m = wait_for(lambda m: m["latest"] and m["latest"]["frame_id"] != v0_id, 20)
        check("S7 recovery: new frame ingested and latest advanced", m is not None, m and m["latest"]["frame_id"])
        check("S7 recovery: state returns to FRESH and failures reset", m and m["freshness_state"] == "FRESH" and m["worker"]["consecutive_failures"] == 0, m and f"{m['freshness_state']} f={m['worker']['consecutive_failures']}")
        v2_id = m["latest"]["frame_id"]

        # S8 crash (SIGKILL) + stray partial dirs + restart
        os.kill(proc.pid, signal.SIGKILL); proc.wait()
        frames_dir = os.path.join(data_dir, "composite", "frames")
        os.makedirs(os.path.join(frames_dir, ".tmp-20990101T0000Z-1")); open(os.path.join(frames_dir, ".tmp-20990101T0000Z-1", "source.png"), "wb").write(b"partial")
        os.makedirs(os.path.join(frames_dir, "20990101T0000Z")); open(os.path.join(frames_dir, "20990101T0000Z", "source.png"), "wb").write(b"no-meta")
        STATE.update(mode="ok", valid=iso(datetime.now(timezone.utc).replace(microsecond=0) + timedelta(seconds=140)))
        proc = start_product(data_dir)
        m = wait_for(lambda m: True, 15)
        ids = [f["frame_id"] for f in m["frames"]]
        check("S8 restart: prior frames persisted and served immediately", v2_id in ids and v0_id in ids, str(ids))
        check("S8 restart: half-written/metadata-less frames never listed", "20990101T0000Z" not in ids and not any(i.startswith(".tmp") for i in ids))
        time.sleep(2)
        check("S8 restart: stale .tmp dirs cleaned up", not any(n.startswith(".tmp-") for n in os.listdir(frames_dir)))
        m = wait_for(lambda m: m["latest"]["frame_id"] not in (v0_id, v2_id), 20)
        check("S8 restart: acquisition resumed and latest advanced", m is not None, m and m["latest"]["frame_id"])

        # S9 invariants
        m = manifest()
        obs = [f["observation_time"] for f in m["frames"]]
        check("S9 frames ordered oldest->newest, strictly increasing", obs == sorted(obs) and len(set(obs)) == len(obs), str(obs))
        check("S9 latest is the last frame", m["latest"]["frame_id"] == m["frames"][-1]["frame_id"])
        sha_now = hashlib.sha256(urllib.request.urlopen(f"http://127.0.0.1:{PROD_PORT}/v1/composite/frames/{v0_id}/source.png").read()).hexdigest()
        check("S9 published frame bytes immutable across the whole run", sha_now == v0_sha)
        hdr = urllib.request.urlopen(f"http://127.0.0.1:{PROD_PORT}/v1/composite/latest.json").headers.get("Cache-Control")
        check("S9 latest.json Cache-Control no-store", hdr == "no-store", hdr)
        hdr2 = urllib.request.urlopen(f"http://127.0.0.1:{PROD_PORT}/v1/composite/frames/{v0_id}/source.png").headers.get("Cache-Control")
        check("S9 frame asset Cache-Control immutable", "immutable" in (hdr2 or ""), hdr2)
    finally:
        proc.kill()
        shutil.rmtree(data_dir, ignore_errors=True)
    failed = [r for r in results if not r[1]]
    print(f"\nRESULT: {len(results) - len(failed)}/{len(results)} passed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
