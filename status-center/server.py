#!/usr/bin/env python3
"""Code Black System Status Center - read-only aggregator backend (stdlib only).

Probes run on their own schedule in a bounded thread pool; the browser only ever reads the cached, normalized
document from GET /api/status. Every probe has a timeout, keeps its last-known value and last-success time, and a
result that has not been refreshed within `stale_factor` intervals is flagged STALE TELEMETRY instead of staying green.
Nothing here can change any system: there are no write endpoints and no actions.
"""
import argparse
import json
import mimetypes
import os
import posixpath
import re
import socket
import struct
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from urllib.parse import parse_qs, urlparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import collector  # noqa: E402

VERSION = "1.0.1"
SCHEMA = "codeblack.status.v1"
HERE = os.path.dirname(os.path.abspath(__file__))
REGISTRY_PATH = os.environ.get("STATUS_CENTER_REGISTRY", os.path.join(HERE, "registry.json"))
WEB_DIR = os.environ.get("STATUS_CENTER_WEB", os.path.join(HERE, "web"))
BIND = os.environ.get("STATUS_CENTER_BIND", "127.0.0.1")
PORT = int(os.environ.get("STATUS_CENTER_PORT", "8795"))
SECRET_KEY = collector.SECRET_KEY
MIN_STALE_S = int(os.environ.get("STATUS_CENTER_MIN_STALE_S", "30"))
START = time.time()
STATE_DIR = os.environ.get("STATUS_CENTER_STATE_DIR", "/srv/codeblack/data/status-center")

REG = json.load(open(REGISTRY_PATH, encoding="utf-8"))
DEF = REG["defaults"]
INTERVALS = {"fast": DEF["fast_s"], "host": DEF["host_s"], "slow": DEF["slow_s"]}
HOSTS = {h["id"]: h for h in REG["hosts"]}
SERVICES = REG["services"]
SERVICE_CONFIG = {s["id"]: s for s in SERVICES}
TH = REG["thresholds"]


# ------------------------------------------------------------------------------------------------ helpers
def now():
    return time.time()


def iso(ts):
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if ts else None


def parse_ts(text):
    """systemd style 'Mon 2026-09-28 22:37:21 UTC' or ISO -> epoch (UTC) or None."""
    if not text:
        return None
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})", str(text))
    if not m:
        return None
    return datetime(*map(int, m.groups()), tzinfo=timezone.utc).timestamp()


def scrub(obj, depth=0):
    """Drop secret-looking keys and long strings from any JSON that came from a probe."""
    if depth > 8:
        return None
    if isinstance(obj, dict):
        return {k: scrub(v, depth + 1) for k, v in obj.items() if not SECRET_KEY.search(str(k))}
    if isinstance(obj, list):
        return [scrub(v, depth + 1) for v in obj[:200]]
    if isinstance(obj, str):
        return collector.sanitize(obj, 300) if re.search(r"[A-Za-z]:\\|/srv/|/home/|@", obj) else obj[:300]
    return obj


def worst(states):
    order = ["OFFLINE", "DEGRADED", "UNKNOWN", "BUSY", "HEALTHY"]
    for s in order:
        if s in states:
            return s
    return "UNKNOWN"


# ------------------------------------------------------------------------------------------------ probes
class Probe:
    def __init__(self, d):
        self.d = d
        self.id = d["id"]
        self.interval = INTERVALS.get(d.get("interval", "host"), d.get("interval") if isinstance(d.get("interval"), (int, float)) else DEF["host_s"])
        self.stale_after = max(MIN_STALE_S, self.interval * DEF["stale_factor"])
        self.lock = threading.Lock()
        self.running = False
        self.next_due = now() + (hash(self.id) % 7) * 0.4
        self.last_attempt = None
        self.last_success = None
        self.last_value = None
        self.last_error = None
        self.ok = None
        self.latency_ms = None
        self.fail_streak = 0

    def record(self, ok, value, error, latency_ms):
        with self.lock:
            self.last_attempt = now()
            self.ok = ok
            self.latency_ms = latency_ms
            if ok:
                self.last_success, self.last_value, self.last_error, self.fail_streak = self.last_attempt, value, None, 0
            else:
                self.last_error, self.fail_streak = error, self.fail_streak + 1
                if value is not None and self.last_value is None:
                    self.last_value = None

    @property
    def observing(self):
        """Recent attempts are happening, so a failure is a trustworthy *current* negative observation."""
        return self.last_attempt is not None and (now() - self.last_attempt) <= self.stale_after

    @property
    def stale(self):
        """The cached successful value is older than its max age: it must never be shown as live."""
        return self.last_success is None or (now() - self.last_success) > self.stale_after

    def telemetry(self):
        return {"observed_at": iso(self.last_attempt), "last_success": iso(self.last_success),
                "age_s": int(now() - self.last_success) if self.last_success else None,
                "max_age_s": self.stale_after, "stale": self.stale}


def _get(url, timeout, accept=(200,)):
    t0 = time.time()
    req = urllib.request.Request(url, headers={"User-Agent": "CodeBlack-StatusCenter/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read(2_000_000)
            status = r.status
    except urllib.error.HTTPError as exc:
        body, status = exc.read(200_000) if hasattr(exc, "read") else b"", exc.code
    return status, body, int((time.time() - t0) * 1000)


def run_http_json(d):
    status, body, ms = _get(d["url"], d.get("timeout", DEF["probe_timeout_s"]))
    accept = d.get("accept", [200])
    value = {"status": status, "latency_ms": ms, "json": None}
    if not d.get("no_json"):
        try:
            parsed = json.loads(body)
            value["json"] = collector.pick(parsed, d["pick"]) if d.get("pick") else scrub(parsed)
        except ValueError:
            if status in accept:
                return False, value, "invalid JSON", ms
    ok = status in accept
    okj = d.get("ok_json")
    if ok and okj and not d.get("no_json"):
        ok = (value["json"] or {}).get(okj["path"]) in okj["in"]
        if not ok:
            return False, value, f"{okj['path']} not in expected values", ms
    return ok, value, None if ok else f"HTTP {status}", ms


def run_mesonet_latest(d):
    """Read only report ages; never retain sensor values, GPS, IDs or the read token."""
    token = os.environ.get("CODE_BLACK_MESONET_READ_TOKEN", "")
    if not token:
        return False, None, "Mesonet read credential unavailable", 0
    t0 = now()
    req = urllib.request.Request(d["url"], headers={
        "User-Agent": "CodeBlack-StatusCenter/1.0",
        "Authorization": "Bearer " + token,
    })
    try:
        with urllib.request.urlopen(req, timeout=d.get("timeout", DEF["probe_timeout_s"])) as response:
            if response.status != 200:
                return False, None, f"HTTP {response.status}", int((now() - t0) * 1000)
            data = json.loads(response.read(64_000))
    except urllib.error.HTTPError as exc:
        return False, None, f"HTTP {exc.code}", int((now() - t0) * 1000)
    if not isinstance(data, dict) or any(role not in data for role in ("wind", "weather")):
        return False, None, "Mesonet response missing roles", int((now() - t0) * 1000)
    ages = {}
    for role in ("wind", "weather"):
        item = data[role]
        age = item.get("received_age_ms") if isinstance(item, dict) else None
        if age is not None and (not isinstance(age, (int, float)) or isinstance(age, bool) or age < 0):
            return False, None, "Invalid Mesonet report age", int((now() - t0) * 1000)
        ages[role] = age
    elapsed = int((now() - t0) * 1000)
    return True, {"status": 200, "latency_ms": elapsed, "json": ages}, None, elapsed


def run_tcp(d):
    t0 = time.time()
    with socket.create_connection((d["host"], d["port"]), timeout=d.get("timeout", DEF["probe_timeout_s"])):
        pass
    ms = int((time.time() - t0) * 1000)
    return True, {"latency_ms": ms}, None, ms


def _dns_name(qname):
    return b"".join(bytes([len(p)]) + p.encode() for p in qname.split(".")) + b"\0"


def _skip_name(buf, i):
    while True:
        n = buf[i]
        if n == 0:
            return i + 1
        if n & 0xC0 == 0xC0:
            return i + 2
        i += 1 + n


def dns_query(server, port, qname, timeout):
    tid = os.urandom(2)
    pkt = tid + struct.pack(">HHHHH", 0x0100, 1, 0, 0, 0) + _dns_name(qname) + struct.pack(">HH", 1, 1)
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.settimeout(timeout)
    t0 = time.time()
    try:
        s.sendto(pkt, (server, port))
        data, _ = s.recvfrom(1500)
    finally:
        s.close()
    ms = int((time.time() - t0) * 1000)
    if data[:2] != tid:
        raise IOError("mismatched DNS id")
    rcode = data[3] & 0x0F
    qd, an = struct.unpack(">HH", data[4:8])
    i = 12
    for _ in range(qd):
        i = _skip_name(data, i) + 4
    addrs = []
    for _ in range(an):
        i = _skip_name(data, i)
        typ, _c, _ttl, rdlen = struct.unpack(">HHIH", data[i:i + 10])
        i += 10
        if typ == 1 and rdlen == 4:
            addrs.append(socket.inet_ntoa(data[i:i + 4]))
        i += rdlen
    return rcode, addrs, ms


def run_dns(d):
    checks, allok, maxms = [], True, 0
    for q in d["queries"]:
        try:
            rcode, addrs, ms = dns_query(d["server"], d.get("port", 53), q["qname"], d.get("timeout", 3))
            blocked = "0.0.0.0" in addrs or rcode == 3 or (rcode == 0 and not addrs and q["expect"] == "blocked")
            ok = (rcode == 0 and bool(addrs) and "0.0.0.0" not in addrs) if q["expect"] == "answer" else blocked
            detail = ("answered" if q["expect"] == "answer" else "blocked (sinkhole)") if ok else (f"rcode {rcode}, {len(addrs)} answer(s)")
        except Exception as exc:  # noqa: BLE001
            ok, ms, detail = False, None, collector.sanitize(exc, 80)
        checks.append({"name": q["name"], "ok": ok, "detail": detail, "latency_ms": ms})
        allok &= ok
        maxms = max(maxms, ms or 0)
    return allok, {"checks": checks}, None if allok else "one or more DNS checks failed", maxms


def run_tailscale(d):
    code, out, err = collector.run(["tailscale", "status", "--json"], timeout=6)
    if code != 0:
        raise IOError(collector.sanitize(err or "tailscale status failed"))
    j = json.loads(out)
    peers = []
    for p in (j.get("Peer") or {}).values():
        online = bool(p.get("Online"))
        cur = p.get("CurAddr") or ""
        path = "unreachable" if not online else ("direct" if cur else ("relayed" if p.get("Relay") else "unknown"))
        name = p.get("HostName")
        if (name or "").lower() == "localhost":
            name = (p.get("DNSName") or "").split(".")[0] or name
        peers.append({"name": name, "ips": p.get("TailscaleIPs") or [], "online": online, "path": path, "relay": p.get("Relay") or None, "last_seen": p.get("LastSeen")})
    return True, {"backend": j.get("BackendState"), "self_ip": (j.get("Self", {}).get("TailscaleIPs") or [None])[0], "tailnet": j.get("MagicDNSSuffix") or REG["instance"]["tailnet"], "peers": peers}, None, 0


def run_collector(d):
    h = HOSTS[d["host"]]
    t0 = time.time()
    status, body, _ = _get(h["collector"]["url"], 8)
    if status != 200:
        raise IOError(f"HTTP {status}")
    return True, json.loads(body), None, int((time.time() - t0) * 1000)


def run_collector_local(d):
    t0 = time.time()
    return True, collector.collect(HOSTS[d["host"]].get("checks", {})), None, int((time.time() - t0) * 1000)


def run_link(d):
    status, _, ms = _get(d["url"], 6)
    ok = 200 <= status < 400 or status in (401, 403)
    return ok, {"status": status}, None if ok else f"HTTP {status}", ms


RUNNERS = {"http_json": run_http_json, "mesonet_latest": run_mesonet_latest, "tcp": run_tcp, "dns": run_dns, "tailscale": run_tailscale, "collector": run_collector,
           "collector_local": run_collector_local, "link": run_link}
PROBES = {}


def build_probes():
    for d in REG["probes"]:
        PROBES[d["id"]] = Probe(d)
    for link in REG["links"]:
        if link.get("verify"):
            PROBES["link:" + link["id"]] = Probe({"id": "link:" + link["id"], "kind": "link", "url": link["url"], "interval": 300})


def execute(p):
    t0 = time.time()
    try:
        ok, value, err, ms = RUNNERS[p.d["kind"]](p.d)
        p.record(ok, value, collector.sanitize(err, 160) if err else None, ms)
    except Exception as exc:  # noqa: BLE001 - a probe can fail in any way; the dashboard must keep working
        p.record(False, None, collector.sanitize(f"{type(exc).__name__}: {exc}", 160), int((time.time() - t0) * 1000))
    finally:
        p.running = False
        p.next_due = now() + p.interval


def scheduler():
    pool = ThreadPoolExecutor(max_workers=14, thread_name_prefix="probe")
    while True:
        t = now()
        for p in PROBES.values():
            if not p.running and t >= p.next_due:
                p.running = True
                pool.submit(execute, p)
        time.sleep(0.5)


# ------------------------------------------------------------------------------------------------ accessors
def pval(pid):
    p = PROBES.get(pid)
    return p.last_value if p and p.last_success else None


def pjson(pid):
    v = pval(pid)
    return (v or {}).get("json") if isinstance(v, dict) else None


def pfresh_ok(pid):
    """(state, reason): ok True/False/None(no data) for the *latest observation*."""
    p = PROBES.get(pid)
    if not p or p.last_attempt is None or not p.observing:
        return None
    return bool(p.ok)


def coll(host_id):
    """Last collector document for a host and its telemetry (or None)."""
    pid = {"core": "core_collector", "edge": "edge_collector", "phaenon3": "phaenon3_collector"}.get(host_id)
    p = PROBES.get(pid) if pid else None
    if not p or not p.last_success:
        return None, (p.telemetry() if p else None), False
    return p.last_value, p.telemetry(), not p.stale and bool(p.ok)


def tel(*pids):
    ps = [PROBES[x] for x in pids if x in PROBES]
    if not ps:
        return {"observed_at": None, "last_success": None, "age_s": None, "max_age_s": None, "stale": True}
    succ = [p.last_success for p in ps if p.last_success]
    att = [p.last_attempt for p in ps if p.last_attempt]
    return {"observed_at": iso(max(att)) if att else None, "last_success": iso(min(succ)) if len(succ) == len(ps) else iso(max(succ)) if succ else None,
            "age_s": int(now() - min(succ)) if succ else None, "max_age_s": max(p.stale_after for p in ps), "stale": any(p.stale for p in ps)}


def disk_state(d):
    t = TH["disk"]
    if d["percent"] >= t["crit_pct"] or d["free_gb"] < t["crit_free_gb"]:
        return "CRITICAL"
    if d["percent"] >= t["warn_pct"] or d["free_gb"] < t["warn_free_gb"]:
        return "WARNING"
    return "HEALTHY"


def tail_peer(name):
    v = pval("tailscale")
    for p in (v or {}).get("peers", []):
        if (p.get("name") or "").lower() == (name or "").lower():
            return p
    return None


# ------------------------------------------------------------------------------------------------ services
def unit_state(host_id, unit):
    """-> (state, reason) from the host collector's unit data; (None, reason) if no telemetry."""
    doc, _t, fresh = coll(host_id)
    if not doc or not fresh:
        return None, "host telemetry unavailable"
    u = doc.get("units", {}).get(unit)
    if not u or u.get("active") is None:
        return "UNKNOWN", "unit not found"
    act, sub = u.get("active"), u.get("sub")
    if unit.endswith(".timer"):
        if act == "active" and sub in ("waiting", "running"):
            return "HEALTHY", "timer running its service now" if sub == "running" else "timer waiting"
        if act == "active" and sub == "elapsed":
            return "DEGRADED", f"timer elapsed - no next run (last {u.get('last_trigger') or 'unknown'})"
        return ("OFFLINE" if act in ("inactive", "failed") else "DEGRADED"), f"timer {act}/{sub}"
    if unit.endswith(".service") and act == "inactive" and u.get("result") == "success":
        return "HEALTHY", f"last run succeeded ({u.get('last_exit') or 'unknown'})"
    if act == "active" or act in ("Running", "Ready"):
        return "HEALTHY", str(sub or act)
    if act == "failed":
        return "DEGRADED", "unit failed"
    if act in ("Disabled",):
        return "OFFLINE", "task disabled"
    return "OFFLINE", f"{act}/{sub}"


def unit_uptime(host_id, unit):
    doc, _t, fresh = coll(host_id)
    u = (doc or {}).get("units", {}).get(unit) or {}
    ts = parse_ts(u.get("since"))
    return int(now() - ts) if ts and u.get("active") == "active" else None


def collector_http(host_id, name):
    doc, _t, fresh = coll(host_id)
    r = (doc or {}).get("http", {}).get(name)
    return r, fresh


def service_metrics(svc, sig):
    sid, m = svc["id"], []
    if svc.get("mesonet_role"):
        pid = svc.get("probe")
        probe = PROBES.get(pid)
        age = (pjson(pid) or {}).get(svc["mesonet_role"]) if probe and probe.ok and probe.observing else None
        age = round((age / 1000) + (now() - probe.last_attempt), 1) if age is not None else None
        m.append(("Core report age (s)", age))
    j = pjson(svc.get("probe")) if svc.get("probe") else None
    if sid == "mediamtx" and j:
        items = j.get("items", [])
        m += [("paths", len(items)), ("ready publishers", sum(1 for i in items if i.get("ready")))]
        m += [("SRT connections", (pval("mtx_srt") or {}).get("json", {}).get("itemCount") if pval("mtx_srt") else None), ("WebRTC sessions", (pval("mtx_webrtc") or {}).get("json", {}).get("itemCount") if pval("mtx_webrtc") else None)]
    elif sid == "stream-monitor" and j:
        m += [(u["unit"], u.get("state")) for u in j.get("units", [])]
    elif sid == "core-api" and j:
        m += [("environment", j.get("environment")), ("service", j.get("service"))]
    elif sid == "radar-product":
        rj = pjson("radar_product")
        if rj:
            m += [("freshness", rj.get("freshness_state")), ("age_s", rj.get("age_seconds")), ("frames", len(rj.get("frames", [])))]
    elif sid == "radar-worker":
        m += [("health meaning", "process liveness only")]
    elif sid == "ai-router" and j:
        m += [("build", j.get("build")), ("ollama reachable", j.get("ollama_reachable")), ("models", ", ".join(j.get("models_available") or []) or None), ("started", j.get("started_at"))]
    elif sid == "media-lab" and j:
        m += [("version", j.get("version"))]
    elif sid == "image-sandbox" and j:
        m += [("draft", f"{j.get('draft.available')} ({j.get('draft.device')})"), ("quality", f"{j.get('quality.state')} - {j.get('quality.model')}"), ("needs free VRAM MiB", j.get("quality.required_free_mib"))]
    elif sid == "sandbox-comfyui":
        r, _f = collector_http("phaenon3", "sandbox-comfy-queue")
        jj = (r or {}).get("json") or {}
        m += [("running", jj.get("len:queue_running")), ("pending", jj.get("len:queue_pending"))]
    elif sid == "ailab-runner":
        r, _f = collector_http("phaenon3", "ailab-status")
        jj = (r or {}).get("json") or {}
        m += [("mode", jj.get("data.mode")), ("queue", json.dumps(jj.get("data.queue")) if jj.get("data.queue") is not None else None), ("experiments", jj.get("data.experiments_total")), ("proposals pending", jj.get("data.proposals_pending"))]
    elif sid == "ollama-phaenon3":
        r, _f = collector_http("phaenon3", "ollama-ps")
        jj = (r or {}).get("json") or {}
        m += [("loaded models", ", ".join(jj.get("names:models") or []) or ("none" if r else None))]
    elif sid == "weather-worker":
        r, _f = collector_http("phaenon3", "weather-worker")
        jj = (r or {}).get("json") or {}
        m += [("latest received", jj.get("latest_received_at")), ("uptime_s", jj.get("uptime_seconds"))]
    elif sid == "pihole-ftl":
        m += [("DNS checks", "; ".join(f"{c['name']}: {'ok' if c['ok'] else 'FAIL'}" for c in (pjson_dns("pihole_dns_lan") or [])) or None)]
    return [{"label": k, "value": v} for k, v in m]


def pjson_dns(pid):
    v = pval(pid)
    return (v or {}).get("checks")


def service_version(svc):
    sid = svc["id"]
    if sid == "ollama-core":
        return (pjson("ollama_core") or {}).get("version")
    if sid == "ollama-phaenon3":
        r, _f = collector_http("phaenon3", "ollama-version")
        return ((r or {}).get("json") or {}).get("version")
    if sid == "ai-router":
        return (pjson("ai_health") or {}).get("version")
    if sid == "media-lab":
        return (pjson("medialab_health") or {}).get("version")
    if sid == "radar-worker":
        return None
    if sid == "radar-product":
        return (pjson("radar_product_health") or {}).get("version")
    if sid == "pihole-ftl":
        doc, _t, _f = coll("edge")
        out = ((doc or {}).get("commands", {}).get("pihole_version") or {}).get("output") or ""
        m = re.search(r"FTL version is (v[\d.]+)", out)
        return m.group(1) if m else None
    if sid == "status-center":
        return VERSION
    return None


def build_service(svc):
    host = HOSTS[svc["host"]]
    sigs, reasons = [], []
    stale = False
    # host telemetry
    ustate, ureason = (unit_state(svc["host"], svc["unit"]) if svc.get("unit") else (None, None))
    if svc.get("unit"):
        if ustate:
            sigs.append(ustate); reasons.append(f"{svc['unit']}: {ureason}")
        else:
            stale = True
    # probe telemetry
    telem_pids = []
    if svc.get("probe") and not svc.get("mesonet_role"):
        pid = svc["probe"]; telem_pids.append(pid)
        p = PROBES.get(pid)
        if p and p.last_attempt is not None and p.observing:
            if p.ok:
                sigs.append("HEALTHY")
            else:
                sigs.append("OFFLINE" if not svc.get("unit") else "DEGRADED"); reasons.append(f"probe failing: {p.last_error}")
        else:
            stale = True
    if svc.get("mesonet_role"):
        pid = svc["probe"]; telem_pids.append(pid)
        p = PROBES.get(pid)
        age = (pjson(pid) or {}).get(svc["mesonet_role"]) if p and p.ok and p.observing else None
        if age is not None:
            age += max(0, now() - p.last_attempt) * 1000
            if age <= 5000:
                sigs.append("HEALTHY")
            elif age < 30000:
                sigs.append("DEGRADED"); reasons.append(f"Core report {age / 1000:.0f}s old")
            else:
                sigs.append("OFFLINE"); reasons.append(f"Core report {age / 1000:.0f}s old")
        else:
            stale = not (p and p.ok and p.observing)
            reasons.append("No Core report yet" if not stale else "Mesonet read telemetry unavailable")
    if svc.get("collector_http"):
        r, fresh = collector_http(svc["host"], svc["collector_http"])
        if r is not None and fresh:
            sigs.append("HEALTHY" if r.get("ok") else "OFFLINE");
            if not r.get("ok"):
                reasons.append(f"local endpoint failing: {r.get('error')}")
        else:
            stale = True
    if svc.get("fresh_file"):
        doc, _t, fresh = coll(svc["host"])
        f = ((doc or {}).get("files", {}) or {}).get(svc["fresh_file"]["name"]) if fresh else None
        if f and f.get("exists"):
            if f["age_s"] > svc["fresh_file"]["max_age_s"]:
                sigs.append("DEGRADED"); reasons.append(f"output file {f['age_s']}s old (max {svc['fresh_file']['max_age_s']}s)")
            else:
                sigs.append("HEALTHY")
        elif fresh:
            sigs.append("DEGRADED"); reasons.append("output file missing")
    # product freshness rules
    if svc["id"] == "radar-product":
        rj = pjson("radar_product")
        if rj:
            fs = rj.get("freshness_state")
            if fs in ("AGING",):
                sigs.append("DEGRADED"); reasons.append(f"radar {fs} ({rj.get('age_seconds')}s)")
            elif fs in ("STALE", "CRITICAL"):
                sigs.append("OFFLINE" if fs == "CRITICAL" else "DEGRADED"); reasons.append(f"radar {fs} ({rj.get('age_seconds')}s)")
    if not sigs:
        state = "UNKNOWN"
        reasons = reasons or ["no telemetry yet" if not stale else "STALE TELEMETRY / host unreachable"]
    else:
        if "OFFLINE" in sigs and "HEALTHY" not in sigs and "DEGRADED" not in sigs:
            state = "OFFLINE"
        elif all(s == "HEALTHY" for s in sigs):
            state = "HEALTHY"
        elif all(s in ("OFFLINE",) for s in sigs):
            state = "OFFLINE"
        else:
            state = "DEGRADED"
        if stale:
            state = "UNKNOWN"; reasons.append("STALE TELEMETRY")
    p0 = PROBES.get(svc.get("probe")) if svc.get("probe") else None
    doc, ctel, _f = coll(svc["host"])
    release = None
    if svc.get("release_symlink") and doc:
        release = (doc.get("symlinks", {}).get(svc["release_symlink"]) or {}).get("release")
    telemetry = tel(*telem_pids) if telem_pids else (ctel or tel())
    if svc.get("unit") or svc.get("collector_http"):
        ct = ctel or {}
        if ct:
            telemetry = ct if not telem_pids else telemetry
            telemetry = dict(telemetry); telemetry["stale"] = bool(telemetry.get("stale") or ct.get("stale"))
    last_ok = (p0.last_success if p0 and p0.last_success else None)
    if not last_ok and ctel and ctel.get("last_success"):
        last_ok = parse_ts(ctel["last_success"])
    out = {"id": svc["id"], "name": svc["name"], "host": svc["host"], "category": svc.get("category"), "role": svc.get("role"), "state": state,
           "state_reason": "; ".join(reasons) if reasons else None, "informational": bool(svc.get("informational")), "critical": bool(svc.get("critical")), "labs": bool(svc.get("labs")),
           "version": service_version(svc), "release": release, "uptime_s": unit_uptime(svc["host"], svc["unit"]) if svc.get("unit") else None,
           "last_success": iso(last_ok), "last_error": (p0.last_error if p0 and p0.ok is False else None),
           "dependencies": svc.get("deps", []), "urls": {k: svc.get("urls", {}).get(k) for k in ("local", "tailscale", "public", "manage", "health")},
           "docs": svc.get("docs"), "metrics": service_metrics(svc, sigs), "telemetry": telemetry}
    return out


# ------------------------------------------------------------------------------------------------ hosts
def build_host(h, services):
    doc, ctel, cfresh = coll(h["id"]) if h["collector"]["mode"] != "none" else (None, None, False)
    peer = tail_peer(h["tailscale_peer"])
    reach = []
    for pid in [r["probe"] for r in h.get("reach", [])]:
        p = PROBES.get(pid)
        reach.append(bool(p and p.ok and not p.stale))
    edge_peer_alive = h["id"] == "edge" and pfresh_ok("tailscale") is True and bool(peer and peer["online"])
    online = cfresh or any(reach) or edge_peer_alive or bool(peer and peer["online"] and h["collector"]["mode"] == "none")
    mem, cpu, disks, gpu = {}, {}, [], None
    hm = (doc or {}).get("host") or {}
    if h["id"] == "phaenon3":
        ms = pjson("medialab_system") or {}
        if not doc and ms:
            hm = {"memory": {"total_mb": (ms.get("memory") or {}).get("total_mib"), "used_mb": None, "percent": (ms.get("memory") or {}).get("load_pct")}, "disks": [
                {"mount": "C:\\", "used_gb": None, "total_gb": None, "free_gb": None, "percent": None}]}
    for dsk in hm.get("disks", []) or []:
        e = dict(dsk); e["state"] = disk_state(dsk) if dsk.get("percent") is not None else "UNKNOWN"; disks.append(e)
    g = (doc or {}).get("gpu")
    if g:
        gpu = {"name": g["name"], "vram_used_mb": g["vram_used_mb"], "vram_total_mb": g["vram_total_mb"], "utilization": g["utilization"], "temperature_c": g["temperature_c"]}
    elif h["id"] == "phaenon3" and (pjson("medialab_system") or {}).get("gpu"):
        g = pjson("medialab_system")["gpu"]
        gpu = {"name": g.get("name"), "vram_used_mb": g.get("vram_used_mib"), "vram_total_mb": g.get("vram_total_mib"), "utilization": g.get("utilization_pct"), "temperature_c": g.get("temperature_c")}
    mine = [s for s in services if s["host"] == h["id"]]
    bad = [s for s in mine if s["state"] in ("DEGRADED", "OFFLINE") and not s["informational"]
           and SERVICE_CONFIG[s["id"]].get("host_impact", True)]
    crit_disk = [d for d in disks if d.get("state") == "CRITICAL"]
    if not online:
        state, why = "OFFLINE", "no telemetry and not reachable"
        if peer and not peer["online"]:
            why = "Tailscale peer offline"
    elif h["collector"]["mode"] == "none":
        state, why = "HEALTHY", "reachable; no service telemetry (reachability only)"
    elif not doc:
        state, why = "UNKNOWN", "collector has not reported"
    elif not cfresh:
        state, why = "UNKNOWN", "STALE TELEMETRY: collector unreachable"
    elif crit_disk or bad:
        state = "DEGRADED"
        why = "; ".join([f"disk {d['mount']} {d['percent']}% used" for d in crit_disk] + [f"{s['name']} {s['state']}" for s in bad][:4])
    else:
        state, why = "HEALTHY", None
    path = "unknown"
    if peer:
        path = peer["path"]
    elif h["id"] == "core":
        path = "self"
    last_contact = ctel["last_success"] if ctel and ctel.get("last_success") else None
    if not last_contact and h["collector"]["mode"] == "none":
        ps = [PROBES[r["probe"]].last_success for r in h.get("reach", []) if PROBES[r["probe"]].last_success]
        last_contact = iso(max(ps)) if ps else None
    return {"id": h["id"], "name": h["name"], "role": h["role"], "state": state, "state_reason": why, "lan_ip": h.get("lan_ip"), "tailscale_ip": h.get("tailscale_ip"),
            "os": hm.get("os"), "uptime_s": hm.get("uptime_s"), "cpu": {"model": (hm.get("cpu") or {}).get("model"), "cores": (hm.get("cpu") or {}).get("cores"), "load1": (hm.get("cpu") or {}).get("load1"), "percent": (hm.get("cpu") or {}).get("percent")},
            "memory": {"used_mb": (hm.get("memory") or {}).get("used_mb"), "total_mb": (hm.get("memory") or {}).get("total_mb"), "percent": (hm.get("memory") or {}).get("percent")},
            "disks": disks, "temperature_c": hm.get("temperature_c"), "gpu": gpu, "last_contact": last_contact, "path": path,
            "collector": h["collector"]["mode"], "expected_online": h.get("expected_online", True), "telemetry": ctel or (tel(*[r["probe"] for r in h.get("reach", [])]) if h.get("reach") else tel()),
            "links": [{"name": l["name"], "url": l["url"]} for l in REG["links"] if l["host"] == h["id"]][:3]}


# ------------------------------------------------------------------------------------------------ domain sections
MTX_PREV = {}


def build_streaming(services_by_id):
    paths_j, mon_j = pjson("mtx_paths"), pjson("monitor_health")
    mtx_ok, mon_ok = pfresh_ok("mtx_paths"), pfresh_ok("monitor_health")
    items = {i.get("name"): i for i in (paths_j or {}).get("items", [])}
    units = {u.get("unit"): u for u in (mon_j or {}).get("units", [])}
    t = now()
    sources = []
    for s in REG["streaming"]["sources"]:
        mu = units.get(s["id"], {})
        live_paths = [items[a] for a in s["aliases"] if a in items and items[a].get("ready")]
        publisher = bool(live_paths) or bool(mu.get("ready"))
        if mon_ok is None and mtx_ok is None:
            state, reason = "UNKNOWN", "STALE TELEMETRY: no MediaMTX/Monitor data"
        elif mon_ok is False and mtx_ok is False:
            state, reason = "UNKNOWN", "MediaMTX and Stream Monitor probes failing"
        elif publisher:
            mstate = (mu.get("state") or "").upper()
            state = "DEGRADED" if mstate not in ("LIVE", "READY", "") else "LIVE"
            reason = "publisher online" if state == "LIVE" else f"publisher online but monitor state {mstate}"
        else:
            state, reason = "OFFLINE", "no publisher (normal when nobody is streaming)"
        p0 = live_paths[0] if live_paths else {}
        bitrate = None
        if p0:
            prev = MTX_PREV.get(s["id"])
            cur = (t, p0.get("bytesReceived") or 0)
            if prev and cur[0] > prev[0] and cur[1] >= prev[1]:
                bitrate = round((cur[1] - prev[1]) * 8 / 1000 / (cur[0] - prev[0]), 1)
            if not prev or cur[0] - prev[0] >= 4:
                MTX_PREV[s["id"]] = cur
        ready_time = parse_ts(p0.get("readyTime")) if p0 else None
        sources.append({"id": s["id"], "name": s["name"], "aliases": s["aliases"], "state": state, "reason": reason, "publisher_online": publisher,
                        "readers": mu.get("readerCount", len((p0 or {}).get("readers", [])) if p0 else 0), "codec": ", ".join(map(str, mu.get("tracks") or [])) or None,
                        "resolution": mu.get("resolution"), "bitrate_kbps": bitrate, "source_age_s": int(t - ready_time) if ready_time else None,
                        "reconnect": None, "informational_offline": state == "OFFLINE"})
    srt, wrtc = pjson("mtx_srt"), pjson("mtx_webrtc")
    mtx_state = services_by_id["mediamtx"]["state"]
    states = [s["state"] for s in sources]
    overall = "LIVE" if "LIVE" in states else "DEGRADED" if "DEGRADED" in states else "UNKNOWN" if states and all(x == "UNKNOWN" for x in states) else "OFFLINE"
    if mtx_state in ("OFFLINE", "DEGRADED") and overall == "OFFLINE":
        overall = "DEGRADED"
    doc, _t, fresh = coll("edge")
    sf = (((doc or {}).get("files") or {}).get("stream-state") or {}).get("json") if fresh else None
    broadcast = None
    if sf:
        broadcast = {"state": str(sf.get("availability") or "unknown").upper(), "detail": f"{sf.get('source')}: availability {sf.get('availability')}" + (f" ({sf.get('last_error')})" if sf.get("last_error") else ""), "checked_at": sf.get("checked_at")}
    return {"state": overall, "summary": f"{sum(1 for x in states if x == 'LIVE')} of {len(states)} sources live", "sources": sources,
            "ingest": {"srt": {"state": mtx_state, "connections": (srt or {}).get("itemCount") if srt is not None else None, "port": 8890},
                       "webrtc": {"state": mtx_state, "sessions": (wrtc or {}).get("itemCount") if wrtc is not None else None}},
            "mediamtx": {"state": mtx_state, "version": None, "paths": [{"name": i.get("name"), "ready": i.get("ready"), "readers": len(i.get("readers", [])), "tracks": i.get("tracks"), "bytes_received": i.get("bytesReceived"), "source_type": (i.get("source") or {}).get("type")} for i in items.values()]},
            "monitor": {"state": services_by_id["stream-monitor"]["state"], "url": REG["streaming"]["monitor_url"]}, "broadcast": broadcast, "telemetry": tel("mtx_paths", "monitor_health")}


def build_radar(services_by_id):
    rj = pjson("radar_product")
    if not rj or not rj.get("latest"):
        return {"state": "NOT_AVAILABLE", "product": None, "latest": None, "manifest_health": {"ok": False, "observed_at": iso(PROBES["radar_product"].last_attempt), "age_s": None},
                "worker": {"state": services_by_id["radar-product"]["state"], "version": None, "consecutive_failures": None, "last_error": PROBES["radar_product"].last_error},
                "legacy_worker": {"state": services_by_id["radar-worker"]["state"], "note": "KSGF single-site worker: health is process liveness only"}, "link": "https://codeblack-core.tail1d0673.ts.net/radar-product/v1/composite/latest.json", "telemetry": tel("radar_product")}
    L, w = rj["latest"], rj.get("worker", {})
    age = int(now() - parse_ts(rj["generated_time"]) + rj["age_seconds"]) if rj.get("generated_time") and PROBES["radar_product"].last_success else rj["age_seconds"]
    state = rj["freshness_state"]
    thr = rj.get("freshness_thresholds_seconds") or {}
    if PROBES["radar_product"].stale:  # cached manifest must not stay FRESH: advance the age and re-classify with the server's own thresholds
        state = "FRESH" if age <= thr.get("fresh_max", 360) else "AGING" if age <= thr.get("aging_max", 660) else "STALE" if age <= thr.get("stale_max", 1200) else "CRITICAL"
    return {"state": state, "product": {"name": rj["product"]["name"], "source": rj["product"]["source"], "cadence_s": rj["product"]["cadence_seconds"]},
            "latest": {"frame_id": L["frame_id"], "observation_time": L["observation_time"], "source_received_time": L["source_received_time"], "published_time": L["published_time"], "age_s": age, "pipeline_delay_s": L["pipeline_delay_seconds"]},
            "manifest_health": {"ok": bool(PROBES["radar_product"].ok), "observed_at": iso(PROBES["radar_product"].last_attempt), "age_s": int(now() - PROBES["radar_product"].last_attempt) if PROBES["radar_product"].last_attempt else None},
            "worker": {"state": services_by_id["radar-product"]["state"], "version": (pjson("radar_product_health") or {}).get("version"), "consecutive_failures": w.get("consecutive_failures"), "last_error": w.get("last_error")},
            "legacy_worker": {"state": services_by_id["radar-worker"]["state"], "note": "KSGF single-site worker (VEL/SRV/CC): health is process liveness only, not data freshness"},
            "link": "https://codeblack-core.tail1d0673.ts.net/radar-product/v1/composite/latest.json", "telemetry": tel("radar_product")}


def fresh_state(age, th):
    if age is None:
        return "UNKNOWN"
    return "HEALTHY" if age <= th["fresh"] else "DEGRADED" if age <= th["aging"] else "DEGRADED" if age <= th["stale"] else "OFFLINE"


def build_weather(services_by_id):
    items = []
    doc, ctel, cfresh = coll("edge")
    for w in REG["weather"]:
        it = {"id": w["id"], "name": w["name"], "host": w["host"], "state": "UNKNOWN", "last_product_time": None, "last_success": None, "age_s": None, "max_age_s": None, "error": None, "note": w.get("note"), "informational": bool(w.get("informational"))}
        if w["kind"] == "core_api_health":
            p = PROBES[w["probe"]]
            it["state"] = "HEALTHY" if pfresh_ok(w["probe"]) else ("DEGRADED" if pfresh_ok(w["probe"]) is False else "UNKNOWN")
            it["last_success"] = iso(p.last_success); it["error"] = p.last_error if p.ok is False else None
        elif w["kind"] in ("edge_newest", "edge_unit_run") and doc and cfresh:
            th = TH[w["thresholds"]] if w["thresholds"] in TH else TH["weather_ingest_s"]
            if w["kind"] == "edge_newest":
                n = (doc.get("newest") or {}).get(w["newest"]) or {}
                it["last_product_time"] = n.get("mtime"); age = n.get("age_s")
            else:
                u = (doc.get("units") or {}).get(w["unit"]) or {}
                timer = (doc.get("units") or {}).get(w.get("timer")) or {}
                ts = parse_ts(u.get("last_exit")) or parse_ts(timer.get("last_trigger"))
                age = int(now() - ts) if ts else None
                it["last_product_time"] = iso(ts)
            u2 = (doc.get("units") or {}).get(w.get("unit") or "") or {}
            timer2 = (doc.get("units") or {}).get(w.get("timer")) or {}
            ts2 = parse_ts(u2.get("last_exit")) or parse_ts(timer2.get("last_trigger"))
            it["last_success"] = iso(ts2) if u2.get("active") == "inactive" and u2.get("result") == "success" and ts2 else None
            it["age_s"], it["max_age_s"] = age, th["fresh"]
            it["state"] = fresh_state(age, th)
            if u2.get("result") not in (None, "success"):
                it["error"] = f"last run result: {u2.get('result')}"; it["state"] = "DEGRADED"
        elif w["kind"] == "worker_latest":
            r, fresh = collector_http(w["host"], w["collector_http"])
            j = (r or {}).get("json") or {}
            th = TH[w["thresholds"]]
            ts = parse_ts(j.get("latest_received_at"))
            age = int(now() - ts) if ts else None
            it.update({"last_product_time": iso(ts), "age_s": age, "max_age_s": th["fresh"], "state": fresh_state(age, th) if fresh and r and r.get("ok") else "UNKNOWN"})
        elif not (doc and cfresh):
            it["note"] = ((it["note"] or "") + " (STALE TELEMETRY: host collector unavailable)").strip()
        items.append(it)
    states = [i["state"] for i in items if not i["informational"]]
    return {"state": worst(states) if states else "UNKNOWN", "items": items, "telemetry": ctel or tel()}


def build_dns(services_by_id):
    doc, ctel, cfresh = coll("edge")
    instances = []
    for d in REG["dns"]:
        checks = []
        dns_ok = []
        for pid in d["dns_probes"]:
            p = PROBES[pid]
            dns_ok.append(pfresh_ok(pid))
            for c in (pjson_dns(pid) or []):
                checks.append({"name": f"{'LAN' if pid.endswith('lan') else 'Tailscale'}: {c['name']}", "ok": c["ok"], "detail": c["detail"], "latency_ms": c["latency_ms"]})
        web = []
        for pid in d["web_probes"]:
            v = pval(pid) or {}
            web.append((pid, pfresh_ok(pid), v.get("status")))
        ftl_u = ((doc or {}).get("units") or {}).get(d["ftl_unit"]) if (doc and cfresh) else None
        ver_out = (((doc or {}).get("commands") or {}).get("pihole_version") or {}).get("output") if (doc and cfresh) else None
        version = None
        if ver_out:
            version = {"core": (re.search(r"Core version is (v[\d.]+)", ver_out) or [None, None])[1], "web": (re.search(r"Web version is (v[\d.]+)", ver_out) or [None, None])[1], "ftl": (re.search(r"FTL version is (v[\d.]+)", ver_out) or [None, None])[1]}
        known = [x for x in dns_ok if x is not None]
        if not known:
            state = "UNKNOWN"
        elif not any(known):
            state = "OFFLINE"
        elif all(known) and all(c["ok"] for c in checks) and any(w[1] for w in web) and (not ftl_u or ftl_u.get("active") == "active"):
            state = "HEALTHY"
        else:
            state = "DEGRADED"
        web_ok = [w for w in web if w[1]]
        instances.append({"id": d["id"], "name": d["name"], "host": d["host"], "lan_ip": d["lan_ip"], "tailscale_ip": d["tailscale_ip"], "dns_port": d["dns_port"],
                          "web_status": (f"OK (HTTP {web_ok[0][2]})" if web_ok else ("UNREACHABLE" if any(w[1] is False for w in web) else "UNKNOWN")),
                          "ftl_status": (f"{ftl_u.get('active')} ({ftl_u.get('sub')})" if ftl_u else "UNKNOWN"), "state": state, "checks": checks, "version": version, "stats": None, "gravity": None,
                          "dashboard_urls": d["dashboard_urls"], "telemetry": tel(*(d["dns_probes"] + d["web_probes"]))})
    st = worst([i["state"] for i in instances]) if instances else "UNKNOWN"
    return {"state": st, "note": REG["dns_note"], "instances": instances}


def build_ai():
    aj = pjson("ai_health")
    p = PROBES["ai_health"]
    ai_ok = pfresh_ok("ai_health")
    items = []
    items.append({"id": "ai-router", "name": "AI Router / AEGIS", "state": "HEALTHY" if ai_ok else ("OFFLINE" if ai_ok is False else "UNKNOWN"),
                  "detail": [{"label": "version", "value": (aj or {}).get("version")}, {"label": "build", "value": (aj or {}).get("build")}, {"label": "ollama reachable", "value": (aj or {}).get("ollama_reachable")},
                             {"label": "models", "value": ", ".join((aj or {}).get("models_available") or []) or None}, {"label": "queue / active job / last request", "value": None},
                             {"label": "status context adapter", "value": (aj or {}).get("status_adapter.state")},
                             {"label": "last status sync", "value": (aj or {}).get("status_adapter.last_sync")},
                             {"label": "ops-context schema", "value": (aj or {}).get("status_adapter.schema")}]})
    r, fresh = collector_http("phaenon3", "ollama-ps")
    loaded = (((r or {}).get("json") or {}).get("names:models") if r and fresh else None)
    r2, _f = collector_http("phaenon3", "ollama-version")
    items.append({"id": "ollama", "name": "Ollama (PHAENON3)", "state": "HEALTHY" if (r and r.get("ok") and fresh) else ("UNKNOWN" if not fresh else "OFFLINE"),
                  "detail": [{"label": "version", "value": (((r2 or {}).get("json") or {}).get("version"))}, {"label": "loaded model", "value": (", ".join(loaded) if loaded else ("none" if r and r.get("ok") else None))}]})
    r3, f3 = collector_http("phaenon3", "ailab-status")
    j3 = (r3 or {}).get("json") or {}
    items.append({"id": "ailab", "name": "AI Lab runner", "state": "HEALTHY" if (r3 and r3.get("ok") and f3) else ("UNKNOWN" if not f3 else "OFFLINE"),
                  "detail": [{"label": "mode", "value": j3.get("data.mode")}, {"label": "queue", "value": json.dumps(j3.get("data.queue")) if j3.get("data.queue") is not None else None}, {"label": "experiments", "value": j3.get("data.experiments_total")}, {"label": "proposals pending", "value": j3.get("data.proposals_pending")}]})
    cj = pjson("core_api_fabric")
    return {"state": worst([i["state"] for i in items]), "note": "Operational health only. Queue depth, active job and last request are behind AEGIS auth (Supabase JWT) and shown as UNKNOWN; no prompts or history are read.",
            "items": items, "model_loaded": (loaded[0] if loaded else None), "queue_depth": None, "active_job": None, "last_request": None, "telemetry": tel("ai_health", "phaenon3_collector")}


def build_labs():
    dj = pjson("medialab_download")
    d = None
    if dj:
        q = dj.get("download.state")
        d = {"model": f"{dj.get('workflow')} / {dj.get('quant')}", "bytes_downloaded": dj.get("download.bytes"), "bytes_total": dj.get("download.expected_bytes"), "percent": dj.get("download.percentage"),
             "rate_bps": dj.get("download.current_rate_bps"), "state": q, "retries": dj.get("download.retry_count"), "last_progress_at": dj.get("download.last_progress_timestamp"),
             "integrity": dj.get("download.integrity_verification") if dj.get("files.diffusion.checksum_verified") is None else ("verified" if dj.get("files.diffusion.checksum_verified") else dj.get("download.integrity_verification"))}
    labs_services = [build_service(s) for s in SERVICES if s.get("labs")]
    items = [{"id": s["id"], "name": s["name"], "state": s["state"], "url": s["urls"].get("manage") or s["urls"].get("tailscale"), "detail": s["metrics"] + [{"label": "state reason", "value": s["state_reason"]}]} for s in labs_services]
    return {"state": worst([i["state"] for i in items if i["id"] not in ("q4-download-recovery",)]), "note": "Spencer Labs infrastructure status only - not Code Black operational authority. No prompts, images, projects or files are read.", "items": items, "download": d, "telemetry": tel("medialab_download", "medialab_health", "sandbox_health")}


def build_compute():
    doc, ctel, cfresh = coll("phaenon3")
    ms = pjson("medialab_system") or {}
    g = (doc or {}).get("gpu")
    if g:
        gpu = {"name": g["name"], "vram_used_mb": g["vram_used_mb"], "vram_total_mb": g["vram_total_mb"], "vram_free_mb": g["vram_total_mb"] - g["vram_used_mb"], "utilization": g["utilization"], "temperature_c": g["temperature_c"]}
    elif ms.get("gpu"):
        x = ms["gpu"]
        gpu = {"name": x.get("name"), "vram_used_mb": x.get("vram_used_mib"), "vram_total_mb": x.get("vram_total_mib"), "vram_free_mb": x.get("vram_free_mib"), "utilization": x.get("utilization_pct"), "temperature_c": x.get("temperature_c")}
    else:
        gpu = None
    r_ps, f_ps = collector_http("phaenon3", "ollama-ps")
    loaded = ((r_ps or {}).get("json") or {}).get("names:models") if r_ps and f_ps else None
    r_q, f_q = collector_http("phaenon3", "sandbox-comfy-queue")
    qj = ((r_q or {}).get("json") or {}) if r_q and f_q else {}
    procs = [p for p in (g or {}).get("processes", []) if (p.get("vram_mb") or 0) >= 300]
    dl = pjson("medialab_download") or {}
    sj = pjson("sandbox_health") or {}
    running = qj.get("len:queue_running") or 0
    pending = qj.get("len:queue_pending") or 0
    owner = None
    if running:
        owner = "Image Sandbox (ComfyUI)"
    elif loaded:
        owner = f"Ollama: {loaded[0]}"
    elif procs:
        owner = f"{procs[0]['name']} ({procs[0]['vram_mb']} MB)"
    busy = bool(owner) or (gpu and (gpu.get("utilization") or 0) >= 30)
    if gpu is None:
        state = "OFFLINE" if not (pfresh_ok("medialab_system") or cfresh) else "UNKNOWN"
    else:
        state = "BUSY" if busy else "IDLE"
    quality = sj.get("quality.state")
    contention = None
    if quality and quality != "AVAILABLE":
        contention = f"Quality image jobs: {quality}"
    elif pending and running:
        contention = f"Image queue: {running} running, {pending} waiting"
    return {"host": "PHAENON3", "state": state, "gpu": gpu, "owner": owner,
            "jobs": {"image": {"state": ("BUSY" if running else ("QUEUED" if pending else "IDLE")) if r_q and f_q else "UNKNOWN", "detail": f"{running} running, {pending} pending" if r_q and f_q else "UNKNOWN"},
                     "media": {"state": dl.get("download.state") or "UNKNOWN", "detail": (f"Q4 {dl.get('download.percentage')}% - {dl.get('download.integrity_verification')}" if dl else "UNKNOWN")},
                     "ai": {"state": ("LOADED" if loaded else "IDLE") if r_ps and f_ps else "UNKNOWN", "detail": (", ".join(loaded) if loaded else "no model loaded") if r_ps and f_ps else "UNKNOWN"}},
            "admission": {"state": quality or "UNKNOWN", "detail": (f"quality jobs need {sj.get('quality.required_free_mib')} MiB free VRAM, {sj.get('quality.gpu.free_mib')} free" if quality else "UNKNOWN")},
            "contention": contention, "telemetry": ctel or tel("medialab_system")}


def build_network(hosts_by_id):
    ts = pval("tailscale") or {}
    peers = []
    for p in ts.get("peers", []):
        latency = None
        for h in REG["hosts"]:
            if (h["tailscale_peer"] or "").lower() == (p["name"] or "").lower():
                pr = {"phaenon3": "phaenon3_tcp", "hytetower": "hytetower_rdp"}.get(h["id"])
                if pr and PROBES[pr].ok and not PROBES[pr].stale:
                    latency = PROBES[pr].latency_ms
        peers.append({"id": (p["name"] or "").lower(), "name": p["name"], "tailscale_ip": (p["ips"] or [None])[0], "online": p["online"], "path": p["path"], "relay": p["relay"], "last_seen": p["last_seen"], "latency_ms": latency})
    pairs = []
    def pair(a, b, pid, via=None):
        p = PROBES.get(pid)
        if p and p.last_attempt is not None and p.observing:
            peer = tail_peer(HOSTS[b]["tailscale_peer"])
            pairs.append({"from": a, "to": b, "state": "HEALTHY" if p.ok else "OFFLINE", "latency_ms": p.latency_ms if p.ok else None, "path": (peer or {}).get("path", "unknown")})
        else:
            pairs.append({"from": a, "to": b, "state": "UNKNOWN", "latency_ms": None, "path": "unknown"})
    edge_peer = tail_peer(HOSTS["edge"]["tailscale_peer"])
    edge_observed = pfresh_ok("tailscale") is True and edge_peer is not None
    pairs.append({"from": "core", "to": "edge", "state": ("HEALTHY" if edge_peer["online"] else "OFFLINE") if edge_observed else "UNKNOWN",
                  "latency_ms": None, "path": edge_peer.get("path", "unknown") if edge_observed else "unknown"})
    pair("core", "phaenon3", "phaenon3_tcp"); pair("core", "hytetower", "hytetower_rdp")
    doc, _t, fresh = coll("edge")
    fp = (((doc or {}).get("files") or {}).get("functional-probes") or {}).get("json") if fresh else None
    if fp:
        lat = fp.get("mqtt.connect_latency_ms")
        pairs.append({"from": "edge", "to": "core", "state": "HEALTHY" if fp.get("core_api.ok") else "OFFLINE", "latency_ms": lat, "path": "direct"})
        pairs.append({"from": "edge", "to": "phaenon3", "state": "HEALTHY" if fp.get("phaenon3.ok") else "OFFLINE", "latency_ms": None, "path": "direct"})
    else:
        pairs += [{"from": "edge", "to": "core", "state": "UNKNOWN", "latency_ms": None, "path": "unknown"}, {"from": "edge", "to": "phaenon3", "state": "UNKNOWN", "latency_ms": None, "path": "unknown"}]
    inet = PROBES["internet_dns"]
    inet_ok = pfresh_ok("internet_dns")
    tsst = "UNKNOWN" if not ts else ("HEALTHY" if ts.get("backend") == "Running" else "DEGRADED")
    return {"tailscale": {"state": tsst, "backend": ts.get("backend"), "self_ip": ts.get("self_ip"), "tailnet": ts.get("tailnet")}, "peers": peers, "pairs": pairs,
            "internet": {"state": "HEALTHY" if inet_ok else ("OFFLINE" if inet_ok is False else "UNKNOWN"), "detail": ("DNS via 1.1.1.1 resolves" if inet_ok else (inet.last_error if inet_ok is False else "no data"))}, "telemetry": tel("tailscale", "internet_dns")}


def build_storage(hosts):
    hs, states = [], []
    for h in hosts:
        if h["disks"]:
            hs.append({"host": h["id"], "disks": h["disks"]})
            states += [d["state"] for d in h["disks"]]
    doc, ctel, cfresh = coll("edge")
    backups = []
    if doc and cfresh:
        snap = (doc.get("newest") or {}).get("core-snapshots") or {}
        ver = (((doc.get("files") or {}).get("backup-verification") or {}).get("json")) or {}
        u = (doc.get("units") or {}).get("codeblack-core-backup.service") or {}
        # A failed pull may create its dated directory before copying anything.
        # Directory mtime is not proof of a completed backup: only an exact,
        # healthy verification of that snapshot may advance last_backup.
        verified_path = ver.get("snapshot") if isinstance(ver.get("snapshot"), str) else ""
        snapshot_root = "/srv/codeblack/backups/core/snapshots"
        verified_name = posixpath.basename(verified_path)
        verified_ts = None
        if (posixpath.dirname(verified_path) == snapshot_root
                and re.fullmatch(r"\d{8}T\d{6}Z", verified_name)
                and ver.get("status") == "healthy"
                and ver.get("backup_complete") is True
                and ver.get("inventory_present") is True
                and isinstance(ver.get("repositories_expected"), int)
                and ver["repositories_expected"] > 0
                and ver.get("repositories_checked") == ver["repositories_expected"]):
            try:
                verified_ts = datetime.strptime(verified_name, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc).timestamp()
            except ValueError:
                pass
        age = max(0, int(now() - verified_ts)) if verified_ts is not None else None
        bt = TH["backup_age_s"]
        state = ("DEGRADED" if snap.get("newest_file") else "UNKNOWN") if age is None else ("HEALTHY" if age <= bt["warn"] else "DEGRADED" if age <= bt["crit"] else "OFFLINE")
        vts = parse_ts(ver.get("generated_at"))
        vage = int(now() - vts) if vts else None
        vt = TH["verification_age_s"]
        vstate = "UNKNOWN" if vage is None else ("HEALTHY" if vage <= vt["warn"] and verified_ts is not None else "OFFLINE" if vage > vt["crit"] else "DEGRADED")
        newest_verified = verified_ts is not None and snap.get("newest_file") == verified_name
        latest_state = "HEALTHY" if newest_verified else "DEGRADED" if snap.get("newest_file") else "UNKNOWN"
        pull_state = "DEGRADED" if u.get("result") not in (None, "success") else "HEALTHY"
        backups.append({"id": "core-backup", "name": "Core snapshots (pulled to Edge)", "host": "edge", "state": worst([state, vstate, latest_state, pull_state]) if state != "UNKNOWN" else "UNKNOWN", "last_backup": iso(verified_ts), "age_s": age, "last_verification": ver.get("generated_at"),
                        "detail": [{"label": "snapshot directories", "value": snap.get("count")}, {"label": "newest directory", "value": snap.get("newest_file")}, {"label": "verified snapshot", "value": verified_name if verified_ts is not None else None}, {"label": "newest verified", "value": newest_verified}, {"label": "last pull unit result", "value": u.get("result")},
                                   {"label": "verification", "value": f"{ver.get('status')} ({ver.get('repositories_checked')}/{ver.get('repositories_expected')} repos)" if ver else None}, {"label": "verification age_s", "value": vage}]})
    else:
        backups.append({"id": "core-backup", "name": "Core snapshots (pulled to Edge)", "host": "edge", "state": "UNKNOWN", "last_backup": None, "age_s": None, "last_verification": None, "detail": [{"label": "note", "value": "STALE TELEMETRY: Edge collector unavailable"}]})
    st = "CRITICAL" if "CRITICAL" in states else "WARNING" if "WARNING" in states else "HEALTHY" if states else "UNKNOWN"
    return {"state": st, "hosts": hs, "backups": backups, "telemetry": ctel or tel()}


# ------------------------------------------------------------------------------------------------ attention
ATTENTION_FILE = os.path.join(STATE_DIR, "attention-first-seen.json")


def load_attention_seen():
    try:
        with open(ATTENTION_FILE, encoding="utf-8") as fh:
            data = json.load(fh)
        if not isinstance(data, dict):
            return {}
        return {k: v for k, v in data.items() if isinstance(k, str) and len(k) <= 128
                and isinstance(v, (int, float)) and not isinstance(v, bool) and 0 < v < now() + 60}
    except (OSError, ValueError, TypeError):
        return {}


FIRST_SEEN = load_attention_seen()


def save_attention_seen():
    try:
        os.makedirs(STATE_DIR, exist_ok=True)
        tmp = ATTENTION_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(FIRST_SEEN, fh, separators=(",", ":"))
        os.replace(tmp, ATTENTION_FILE)
    except OSError:
        pass  # Live status must remain available even if persistence fails.


def build_attention(hosts, services, streaming, radar, weather, dns, storage, labs, network):
    items = []
    active = set()
    previous = set(FIRST_SEEN)

    def add(key, sev, title, detail, source, link=None):
        active.add(key)
        FIRST_SEEN.setdefault(key, now())
        items.append({"id": key, "severity": sev, "title": title, "detail": detail, "source": source, "since": iso(FIRST_SEEN[key]), "link": link})

    for h in hosts:
        if h["state"] == "OFFLINE":
            add(f"host:{h['id']}", "INFO" if not h.get("expected_online", True) else ("CRITICAL" if h["id"] in ("core", "edge") else "WARNING"), f"{h['name']} offline", h["state_reason"], h["id"])
        elif h["state"] == "UNKNOWN":
            add(f"hostunk:{h['id']}", "WARNING", f"{h['name']} telemetry unavailable", h["state_reason"], h["id"])
        for d in h["disks"]:
            if d.get("state") in ("WARNING", "CRITICAL"):
                add(f"disk:{h['id']}:{d['mount']}", d["state"], f"{h['name']} disk {d['mount']} {d['percent']}% used", f"{d['free_gb']} GB free of {d['total_gb']} GB", h["id"])
    elapsed = {}
    for s in services:
        if not s["informational"] and s["state"] == "DEGRADED" and "timer elapsed" in (s["state_reason"] or ""):
            elapsed.setdefault(s["host"], []).append(s)
    for hid, lst in elapsed.items():
        if len(lst) >= 2:
            names = ", ".join(x["name"] for x in lst)
            add(f"timers:{hid}", "WARNING", f"{hid.upper()}: {len(lst)} scheduled timers stopped (no next run)", f"{names}. Likely stalled since the last run; alert delivery and status files may be stale.", hid)
    grouped = {s["id"] for lst in elapsed.values() if len(lst) >= 2 for s in lst}
    for s in services:
        if s["informational"] or s["id"] in grouped:
            continue
        host_state = next((h["state"] for h in hosts if h["id"] == s["host"]), None)
        if s["state"] in ("DEGRADED", "OFFLINE") and host_state != "OFFLINE":
            sev = "CRITICAL" if (s["critical"] and s["state"] == "OFFLINE") else "WARNING"
            add(f"svc:{s['id']}", sev, f"{s['name']} {s['state']}", s["state_reason"], s["host"], (s["urls"].get("manage") or s["urls"].get("tailscale")))
    rs = radar["state"]
    if rs in ("STALE", "CRITICAL"):
        add("radar", "CRITICAL" if rs == "CRITICAL" else "WARNING", f"RADAR {rs} - {int((radar['latest'] or {}).get('age_s', 0)) // 60}m", "server-side radar product is not current", "radar", radar["link"])
    elif rs == "AGING":
        add("radar", "INFO", f"Radar aging - {int(radar['latest']['age_s']) // 60}m", "one source cycle missed", "radar")
    elif rs == "NOT_AVAILABLE":
        add("radar", "WARNING", "Radar product not available", (radar["worker"] or {}).get("last_error"), "radar")
    for w in weather["items"]:
        if w["state"] in ("DEGRADED", "OFFLINE"):
            add(f"wx:{w['id']}", "INFO" if w.get("informational") else "WARNING", f"{w['name']} {'STALE' if w['age_s'] else w['state']}" + (f" - {w['age_s'] // 3600}h {w['age_s'] % 3600 // 60}m old" if w.get("age_s") else ""), w.get("error") or w.get("note"), w["host"])
    for i in dns["instances"]:
        if i["state"] in ("DEGRADED", "OFFLINE"):
            add(f"dns:{i['id']}", "CRITICAL" if i["state"] == "OFFLINE" else "WARNING", f"{i['name']} DNS {i['state']}", "; ".join(c["name"] + ": " + c["detail"] for c in i["checks"] if not c["ok"]) or f"web {i['web_status']}, FTL {i['ftl_status']}", i["host"])
    for src in streaming["sources"]:
        if src["state"] == "DEGRADED":
            add(f"stream:{src['id']}", "WARNING", f"{src['name']} degraded", src["reason"], "streaming")
        elif src["state"] == "OFFLINE":
            add(f"stream:{src['id']}", "INFO", f"{src['name']} offline", "no publisher (normal when nobody is streaming)", "streaming")
    b = streaming.get("broadcast")
    if b and b["state"] not in ("AVAILABLE", "LIVE", "ONLINE"):
        add("broadcast", "WARNING", f"Facebook live state {b['state']}", b["detail"], "streaming")
    d = labs.get("download")
    if d:
        if d["state"] == "VERIFYING":
            add("q4", "INFO", f"Q4 download verifying SHA-256 ({d['percent']}%)", f"integrity {d['integrity']}", "labs")
        elif d["state"] not in ("COMPLETE", "READY", "VERIFIED", "IDLE") and d["state"] not in (None,):
            add("q4", "WARNING", f"Q4 download {d['state']}", f"{d['percent']}% - retries {d['retries']}", "labs")
    for bk in storage["backups"]:
        if bk["state"] in ("DEGRADED", "OFFLINE"):
            add(f"backup:{bk['id']}", "CRITICAL" if bk["state"] == "OFFLINE" else "WARNING", f"{bk['name']} {bk['state']}", f"last backup {bk['last_backup']}", bk["host"])
    order = {"CRITICAL": 0, "WARNING": 1, "INFO": 2}
    items.sort(key=lambda x: (order[x["severity"]], x["since"] or ""))
    if active != previous:
        # Cold-start UNKNOWN states are not recoveries. Retain persisted alerts
        # until every probe has had a chance to report.
        if probes_warmed():
            for key in list(FIRST_SEEN):
                if key not in active:
                    del FIRST_SEEN[key]
        save_attention_seen()
    return items


# ------------------------------------------------------------------------------------------------ assemble
CACHE = {"doc": None, "at": 0}
LOCK = threading.Lock()


def link_state(l):
    p = PROBES.get("link:" + l["id"])
    if not p or not l.get("verify") or not p.last_attempt:
        return None
    return {"ok": bool(p.ok) and not p.stale, "status": (p.last_value or {}).get("status") if p.ok else None, "checked_at": iso(p.last_attempt)}


def build_status():
    services = [build_service(s) for s in SERVICES if not s.get("labs") or True]
    sby = {s["id"]: s for s in services}
    hosts = [build_host(h, services) for h in REG["hosts"]]
    hby = {h["id"]: h for h in hosts}
    streaming, radar = build_streaming(sby), build_radar(sby)
    weather, dns, ai, labs = build_weather(sby), build_dns(sby), build_ai(), build_labs()
    compute, network, storage = build_compute(), build_network(hby), build_storage(hosts)
    if compute["state"] == "BUSY" and "phaenon3" in hby and hby["phaenon3"]["state"] == "HEALTHY":
        pass
    attention = build_attention(hosts, services, streaming, radar, weather, dns, storage, labs, network)
    tiles = []
    for h in hosts:
        if h["id"] == "raspberrypi":
            continue
        st = "BUSY" if (h["id"] == "phaenon3" and compute["state"] == "BUSY" and h["state"] == "HEALTHY") else h["state"]
        tiles.append({"id": h["id"], "label": h["name"], "state": st, "detail": h["state_reason"], "group": "host", "informational": False})
    dom = [("radar", "RADAR", radar["state"], f"{(radar['latest'] or {}).get('age_s', '?')}s old" if radar["latest"] else "no data"), ("weather", "WEATHER", weather["state"], None), ("dns", "DNS", dns["state"], None),
           ("streaming", "STREAMING", streaming["state"], streaming["summary"]), ("ai", "AI", ai["state"], None), ("labs", "SPENCER LABS", labs["state"], None), ("storage", "STORAGE", "HEALTHY" if storage["state"] == "HEALTHY" else "DEGRADED" if storage["state"] in ("WARNING", "CRITICAL") else "UNKNOWN", storage["state"]), ("network", "NETWORK", network["tailscale"]["state"], None)]
    # STREAMING offline is intentional when every source is simply idle (informational, not a fault)
    idle_stream = streaming["state"] == "OFFLINE" and all(x["informational_offline"] for x in streaming["sources"])
    tiles += [{"id": i, "label": l, "state": s, "detail": d, "group": "domain", "informational": bool(i == "streaming" and idle_stream)} for i, l, s, d in dom]
    host_states = [h["state"] for h in hosts if h["expected_online"]]
    crit = any(a["severity"] == "CRITICAL" for a in attention)
    overall = "OFFLINE" if hby["core"]["state"] == "OFFLINE" else "UNKNOWN" if hby["core"]["state"] == "UNKNOWN" else ("DEGRADED" if crit or any(s in ("DEGRADED", "OFFLINE") for s in host_states) or any(a["severity"] == "WARNING" for a in attention) else "HEALTHY")
    probes = list(PROBES.values())
    links = [{"id": l["id"], "name": l["name"], "purpose": l["purpose"], "host": l["host"], "access": l["access"], "url": l["url"], "group": l["group"], "verified": link_state(l)} for l in REG["links"]]
    book = []
    for h in hosts:
        book.append({"name": h["name"] + " (host)", "host": h["name"], "lan": h["lan_ip"], "tailscale": h["tailscale_ip"], "url": None, "purpose": h["role"], "access": "TAILSCALE" if h["tailscale_ip"] else "LAN"})
    for l in links:
        hh = hby.get(l["host"])
        book.append({"name": l["name"], "host": (hh or {}).get("name", l["host"]), "lan": (hh or {}).get("lan_ip"), "tailscale": (hh or {}).get("tailscale_ip"), "url": l["url"], "purpose": l["purpose"], "access": l["access"]})
    return {"schema": SCHEMA, "generated_at": iso(now()),
            "backend": {"version": VERSION, "host": socket.gethostname(), "uptime_s": int(now() - START), "probes_total": len(probes), "probes_stale": sum(1 for p in probes if p.stale), "probes_failing": sum(1 for p in probes if p.ok is False),
                        "refresh_hints": {"fast_s": DEF["fast_s"], "host_s": DEF["host_s"], "slow_s": DEF["slow_s"]}},
            "summary": {"overall": overall, "attention_count": sum(1 for a in attention if a["severity"] != "INFO"), "tiles": tiles}, "attention": attention, "hosts": hosts,
            "services": [s for s in services if True], "streaming": streaming, "radar": radar, "weather": weather, "dns": dns, "ai": ai, "labs": labs, "compute": compute,
            "network": network, "storage": storage, "links": links, "address_book": book}


def status_doc():
    with LOCK:
        if CACHE["doc"] is None or now() - CACHE["at"] > 2:
            try:
                CACHE["doc"], CACHE["at"] = build_status(), now()
            except Exception as exc:  # noqa: BLE001
                if CACHE["doc"] is None:
                    raise
                CACHE["doc"]["backend"]["build_error"] = collector.sanitize(exc, 120)
        return CACHE["doc"]


# ------------------------------------------------------------------------------------------------ change log
CHANGE_MAX_EVENTS = int(os.environ.get("STATUS_CENTER_CHANGE_MAX_EVENTS", "300"))
CHANGE_MAX_AGE_S = int(os.environ.get("STATUS_CENTER_CHANGE_MAX_AGE_S", str(7 * 86400)))
CHANGE_CONFIRM_S = float(os.environ.get("STATUS_CENTER_CHANGE_CONFIRM_S", "12"))
CHANGE_SCHEMA = "codeblack.status.changes.v1"
_GOOD = {"HEALTHY", "FRESH", "LIVE", "IDLE", "AVAILABLE", "ONLINE", "BUSY"}
_WARN = {"AGING", "DEGRADED", "WARNING"}
_BAD = {"OFFLINE", "STALE", "CRITICAL", "UNAVAILABLE"}


def state_rank(v):
    return 0 if v in _GOOD else 2 if v in _BAD else 1


def significant_signature(doc):
    """Only discrete state values that mean something to an operator. Numbers (CPU %, ages, latencies) never appear here,
    so routine fluctuation can never become an event. Returns {key: (value, label)}."""
    sig = {}
    sig["overall"] = (doc["summary"]["overall"], "Code Black overall")
    for h in doc["hosts"]:
        if h.get("expected_online", True) or h["state"] != "OFFLINE":
            sig["host:" + h["id"]] = (h["state"], h["name"])
    for s_ in doc["services"]:
        sig["service:" + s_["id"]] = (s_["state"], s_["name"])
    for src in doc["streaming"]["sources"]:
        sig["stream:" + src["id"]] = (src["state"], src["name"])
    sig["streaming"] = (doc["streaming"]["state"], "Streaming")
    if doc["streaming"].get("broadcast"):
        sig["broadcast"] = (doc["streaming"]["broadcast"]["state"], "Broadcast (Facebook)")
    sig["radar"] = (doc["radar"]["state"], "Radar")
    for w in doc["weather"]["items"]:
        sig["weather:" + w["id"]] = (w["state"], w["name"])
    for d in doc["dns"]["instances"]:
        sig["dns:" + d["id"]] = (d["state"], d["name"])
    sig["ai"] = (doc["ai"]["state"], "AI")
    sig["compute"] = (doc["compute"]["state"], "GPU compute")
    sig["network"] = (doc["network"]["tailscale"]["state"], "Tailscale")
    sig["internet"] = (doc["network"]["internet"]["state"], "Internet/DNS")
    sig["storage"] = (doc["storage"]["state"], "Storage")
    for b in doc["storage"]["backups"]:
        sig["backup:" + b["id"]] = (b["state"], b["name"])
    for a in doc["attention"]:
        if a["severity"] != "INFO":
            sig["attention:" + a["id"]] = (a["severity"], a["title"])
    return sig


class ChangeLog:
    """Bounded, debounced state-transition history. A new value must persist CHANGE_CONFIRM_S before it is recorded, so
    flapping/transient probe blips do not become events. Survives Status Center restarts (baseline + events persisted)."""

    def __init__(self, path):
        self.path, self.lock = path, threading.Lock()
        self.events, self.baseline, self.pending = [], None, {}
        self.tracking_since = iso(now())
        self.persist_ok = True
        self._load()

    def _load(self):
        try:
            with open(self.path, "r", encoding="utf-8") as fh:
                d = json.load(fh)
            self.events = d.get("events", [])
            self.baseline = {k: tuple(v) for k, v in (d.get("baseline") or {}).items()} or None
            self.tracking_since = d.get("tracking_since", self.tracking_since)
        except (OSError, ValueError):
            pass

    def _save(self):
        try:
            os.makedirs(os.path.dirname(self.path), exist_ok=True)
            tmp = self.path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump({"schema": CHANGE_SCHEMA, "saved_at": iso(now()), "tracking_since": self.tracking_since, "events": self.events,
                           "baseline": {k: list(v) for k, v in (self.baseline or {}).items()}}, fh)
            os.replace(tmp, self.path)
            self.persist_ok = True
        except OSError:
            self.persist_ok = False  # history keeps working in memory; only restart-survival is lost

    def _emit(self, key, label, old, new, ts):
        kind = key.split(":")[0]
        if kind == "attention":
            summary = f"Attention raised ({new}): {label}" if old is None else f"Attention cleared: {label}" if new is None else f"Attention {label}: {old} -> {new}"
            direction = "degraded" if new is not None and (old is None or new == "CRITICAL") else "improved"
        else:
            summary = f"{label}: {old} -> {new}"
            direction = "changed" if kind in ("stream", "streaming") else ("improved" if state_rank(new) < state_rank(old) else "degraded" if state_rank(new) > state_rank(old) else "changed")
        self.events.append({"t": iso(ts), "key": key, "kind": kind, "name": label, "from": old, "to": new, "direction": direction, "summary": summary})

    def observe(self, doc, ts=None):
        ts = ts or now()
        sig = significant_signature(doc)
        with self.lock:
            changed = False
            if self.baseline is None:
                self.baseline = dict(sig)
                self.tracking_since = iso(ts)
                self._save()
                return
            for key, (val, label) in sig.items():
                base = self.baseline.get(key)
                if base is not None and base[0] == val:
                    self.pending.pop(key, None)
                    continue
                if base is None and not key.startswith("attention:"):
                    self.baseline[key] = (val, label)  # a newly registered service/host: silent baseline
                    changed = True
                    continue
                pend = self.pending.get(key)
                if pend and pend[0] == val:
                    if ts - pend[1] >= CHANGE_CONFIRM_S:
                        self._emit(key, label, base[0] if base else None, val, ts)
                        self.baseline[key] = (val, label)
                        self.pending.pop(key, None)
                        changed = True
                else:
                    self.pending[key] = (val, ts)
            for key in list(self.baseline):
                if key in sig:
                    continue
                val, label = self.baseline[key]
                if key.startswith("attention:"):
                    pend = self.pending.get(key)
                    if pend and pend[0] is None:
                        if ts - pend[1] >= CHANGE_CONFIRM_S:
                            self._emit(key, label, val, None, ts)
                            del self.baseline[key]
                            self.pending.pop(key, None)
                            changed = True
                    else:
                        self.pending[key] = (None, ts)
                else:
                    del self.baseline[key]
                    changed = True
            cutoff = ts - CHANGE_MAX_AGE_S
            keep = [e for e in self.events if (parse_ts(e["t"]) or 0) >= cutoff][-CHANGE_MAX_EVENTS:]
            if len(keep) != len(self.events):
                self.events, changed = keep, True
            if changed:
                self._save()

    def query(self, since=None, limit=50):
        with self.lock:
            ev = self.events
            if since is not None:
                ev = [e for e in ev if (parse_ts(e["t"]) or 0) > since]
            return {"schema": CHANGE_SCHEMA, "generated_at": iso(now()), "tracking_since": self.tracking_since,
                    "retention": {"max_events": CHANGE_MAX_EVENTS, "max_age_s": CHANGE_MAX_AGE_S, "debounce_s": CHANGE_CONFIRM_S},
                    "persisted": self.persist_ok, "pending_unconfirmed": len(self.pending), "events": ev[-max(1, min(int(limit), CHANGE_MAX_EVENTS)):]}


CHANGELOG = ChangeLog(os.path.join(STATE_DIR, "changes.json"))


def probes_warmed():
    """True once every probe has completed at least one attempt. Until then most states are a cold-start UNKNOWN, which must
    never be recorded as a transition (or as a baseline)."""
    return time.time() - START > 15 and all(p.last_attempt is not None for p in PROBES.values())


def changelog_loop():
    deadline = time.time() + 180
    while not probes_warmed() and time.time() < deadline:
        time.sleep(2)
    while True:
        try:
            CHANGELOG.observe(status_doc())
        except Exception as exc:  # noqa: BLE001 - history must never affect serving
            print("changelog error:", collector.sanitize(exc, 120), flush=True)
        time.sleep(5)


# ------------------------------------------------------------------------------------------------ http
SECTIONS = {"hosts", "services", "network", "streaming", "radar", "weather", "ai", "labs", "dns", "storage", "links", "compute", "attention", "summary"}


class Handler(BaseHTTPRequestHandler):
    server_version = "CodeBlackStatusCenter/" + VERSION
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def send_bytes(self, status, body, ctype, cache):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        path = self.path.split("?")[0]
        try:
            if path == "/api/health":
                return self.send_bytes(200, json.dumps({"ok": True, "version": VERSION, "uptime_s": int(now() - START), "probes": len(PROBES)}).encode(), "application/json", "no-store")
            if path == "/api/status":
                return self.send_bytes(200, json.dumps(status_doc()).encode(), "application/json", "no-store")
            if path in ("/api/changes", "/api/status/changes"):
                q = parse_qs(urlparse(self.path).query)
                since = parse_ts(q["since"][0]) if q.get("since") else None
                return self.send_bytes(200, json.dumps(CHANGELOG.query(since, q.get("limit", ["50"])[0])).encode(), "application/json", "no-store")
            m = re.fullmatch(r"/api/status/(\w+)", path)
            if m and m.group(1) in SECTIONS:
                return self.send_bytes(200, json.dumps(status_doc()[m.group(1)]).encode(), "application/json", "no-store")
            rel = "index.html" if path in ("/", "") else path.lstrip("/")
            full = os.path.realpath(os.path.join(WEB_DIR, rel))
            if full.startswith(os.path.realpath(WEB_DIR) + os.sep) and os.path.isfile(full) and not full.endswith(".py"):
                return self.send_bytes(200, open(full, "rb").read(), mimetypes.guess_type(full)[0] or "application/octet-stream", "no-cache")
            return self.send_bytes(404, b'{"error":"not found"}', "application/json", "no-store")
        except Exception as exc:  # noqa: BLE001
            return self.send_bytes(500, json.dumps({"error": type(exc).__name__}).encode(), "application/json", "no-store")


def main():
    build_probes()
    threading.Thread(target=scheduler, name="scheduler", daemon=True).start()
    threading.Thread(target=changelog_loop, name="changelog", daemon=True).start()
    ThreadingHTTPServer.allow_reuse_address = True
    srv = ThreadingHTTPServer((BIND, PORT), Handler)
    srv.daemon_threads = True
    print(f"status-center {VERSION} on {BIND}:{PORT} probes={len(PROBES)}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
