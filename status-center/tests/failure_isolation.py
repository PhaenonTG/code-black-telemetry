#!/usr/bin/env python3
"""Failure isolation + stale telemetry qualification (safe: nothing production is touched).
Run ON CORE:  python3 failure_isolation.py <status-center dir>
Starts an isolated backend (port 18797) whose Edge collector is a MOCK we can kill/revive and whose PHAENON3 collector
is a blackholed address; asserts the dashboard keeps working, other hosts are unaffected, and dead sources go
STALE/UNKNOWN instead of staying green."""
import json, os, subprocess, sys, tempfile, threading, time, urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

D = sys.argv[1]
PORT, MOCK = 18797, 19110
real_edge = json.load(urllib.request.urlopen("http://100.88.198.67:9110/v1/metrics", timeout=10))
results = []


def check(name, ok, detail=""):
    results.append(bool(ok)); print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""), flush=True)


class Mock(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        doc = dict(real_edge); doc["collected_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        body = json.dumps(doc).encode()
        self.send_response(200); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)


def start_mock():
    srv = HTTPServer(("127.0.0.1", MOCK), Mock)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


reg = json.load(open(os.path.join(D, "registry.json")))
for h in reg["hosts"]:
    if h["id"] == "edge": h["collector"]["url"] = f"http://127.0.0.1:{MOCK}/v1/metrics"
    if h["id"] == "phaenon3": h["collector"]["url"] = "http://10.255.255.1:9110/v1/metrics"  # blackhole: connect hangs until timeout
reg["defaults"].update({"fast_s": 2, "host_s": 2, "slow_s": 4, "stale_factor": 2})
tmp = tempfile.mkdtemp(); rp = os.path.join(tmp, "registry.json"); json.dump(reg, open(rp, "w"))
env = dict(os.environ, STATUS_CENTER_PORT=str(PORT), STATUS_CENTER_REGISTRY=rp, STATUS_CENTER_WEB=os.path.join(D, "web"), STATUS_CENTER_MIN_STALE_S="6")
proc = subprocess.Popen([sys.executable, os.path.join(D, "server.py")], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
mock = start_mock()


def status():
    t0 = time.time(); d = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/api/status", timeout=10)); return d, time.time() - t0


def host(d, hid): return next(h for h in d["hosts"] if h["id"] == hid)


try:
    time.sleep(14)
    d, lat = status()
    check("API responds fast even while a probe target hangs (blackholed PHAENON3)", lat < 1.5, f"{lat:.2f}s")
    check("Edge (mock, alive): telemetry fresh and has metrics", not host(d, "edge")["telemetry"]["stale"] and host(d, "edge")["memory"]["total_mb"], host(d, "edge")["state"])
    check("PHAENON3 (blackholed) -> not HEALTHY, marked unavailable", host(d, "phaenon3")["state"] in ("UNKNOWN", "OFFLINE"), host(d, "phaenon3")["state"])
    check("CORE unaffected by dead PHAENON3 collector", host(d, "core")["state"] in ("HEALTHY", "DEGRADED") and host(d, "core")["memory"]["total_mb"])
    check("HYTETOWER unaffected", host(d, "hytetower")["state"] == "HEALTHY")
    check("streaming/radar sections still populated", d["radar"]["state"] != "NOT_AVAILABLE" and len(d["streaming"]["sources"]) == 2)
    # kill the Edge source
    mock.shutdown(); mock.server_close()
    t_kill = time.time()
    seen_stale = None
    while time.time() - t_kill < 30:
        d, lat = status()
        if host(d, "edge")["telemetry"]["stale"]:
            seen_stale = time.time() - t_kill; break
        time.sleep(1)
    check("dead Edge source detected as STALE TELEMETRY (not silently green)", seen_stale is not None, f"after {seen_stale:.0f}s" if seen_stale else "never")
    e = host(d, "edge")
    check("Edge host no longer HEALTHY once stale", e["state"] != "HEALTHY", f"{e['state']}: {e['state_reason']}")
    edge_svcs = [s for s in d["services"] if s["host"] == "edge"]
    check("Edge services are UNKNOWN with STALE TELEMETRY (never green)", all(s["state"] != "HEALTHY" for s in edge_svcs) and any("STALE" in (s["state_reason"] or "") for s in edge_svcs), f"{sum(1 for s in edge_svcs if s['state']=='UNKNOWN')}/{len(edge_svcs)} unknown")
    check("attention reports the unavailable Edge telemetry", any(a["source"] == "edge" and "telemetry" in a["title"].lower() for a in d["attention"]) or any(a["source"] == "edge" for a in d["attention"]))
    check("last-known Edge metrics retained for display (not blanked)", e["memory"]["total_mb"] is not None)
    check("other hosts still fine while Edge is dead", host(d, "core")["memory"]["total_mb"] and host(d, "hytetower")["state"] == "HEALTHY")
    check("API still fast with two dead sources", status()[1] < 1.5)
    # revive
    mock = start_mock()
    t0 = time.time(); rec = None
    while time.time() - t0 < 25:
        d, _ = status()
        if not host(d, "edge")["telemetry"]["stale"] and host(d, "edge")["state"] != "UNKNOWN":
            rec = time.time() - t0; break
        time.sleep(1)
    check("Edge source revived -> telemetry fresh again, state recovers", rec is not None, f"after {rec:.0f}s" if rec else "never")
finally:
    proc.kill()
print(f"\nRESULT: {sum(results)}/{len(results)} passed")
sys.exit(0 if all(results) else 1)
