#!/usr/bin/env python3
"""Code Black Status Center - read-only host collector (stdlib only, Linux + Windows).

Reports host metrics plus a fixed, config-defined set of checks (units, files, local HTTP probes, allowlisted
commands, release symlinks). The registry (registry.json, section hosts[<id>].checks) is the ONLY source of what may
be read: a request can never name a path, URL or command. Used in-process by the Core backend and standalone
(`collector.py --host edge`) on other machines, bound to a Tailscale IP.

Never returns secrets: HTTP results are reduced to whitelisted `pick` paths, error text is sanitized, and no file
contents are returned unless a `pick` list of JSON keys is configured.
"""
import argparse
import ctypes
import glob
import json
import os
import platform
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

VERSION = "1.0.0"
IS_WIN = os.name == "nt"
SECRET_KEY = re.compile(r"(token|secret|password|passwd|authorization|api[_-]?key|stream[_-]?key|credential|cookie)", re.I)
GPU_PROC_ALLOW = ("ollama", "llama", "comfy", "wan")
COMMANDS = {  # name -> argv. The registry can only reference these names.
    "pihole_version": ["pihole", "-v"],
    "nvidia_gpu": ["nvidia-smi", "--query-gpu=name,memory.total,memory.used,utilization.gpu,temperature.gpu,driver_version", "--format=csv,noheader,nounits"],
    "nvidia_apps": ["nvidia-smi", "--query-compute-apps=process_name,used_memory", "--format=csv,noheader,nounits"],
}


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def sanitize(text, limit=200):
    text = re.sub(r"[A-Za-z]:\\[^\s'\"]*", "<path>", str(text))
    text = re.sub(r"(/[\w.\-]+){2,}", "<path>", text)
    text = re.sub(r"(?i)(token|key|secret|password)=[^\s&]+", r"\1=<redacted>", text)
    return text[:limit]


def run(argv, timeout=4):
    try:
        out = subprocess.run(argv, capture_output=True, text=True, timeout=timeout, creationflags=(0x08000000 if IS_WIN else 0))
        return out.returncode, out.stdout, out.stderr
    except (OSError, subprocess.SubprocessError) as exc:
        return -1, "", sanitize(exc)


# --------------------------------------------------------------------------- host metrics
_cpu_percent = {"value": None}


def _win_cpu_sampler():
    class FT(ctypes.Structure):
        _fields_ = [("lo", ctypes.c_uint32), ("hi", ctypes.c_uint32)]

    def sample():
        idle, kern, user = FT(), FT(), FT()
        ctypes.windll.kernel32.GetSystemTimes(ctypes.byref(idle), ctypes.byref(kern), ctypes.byref(user))
        val = lambda f: (f.hi << 32) | f.lo  # noqa: E731
        return val(idle), val(kern) + val(user)

    prev = sample()
    while True:
        time.sleep(5)
        cur = sample()
        d_idle, d_total = cur[0] - prev[0], cur[1] - prev[1]
        _cpu_percent["value"] = round(100.0 * (1 - d_idle / d_total), 1) if d_total else None
        prev = cur


def host_metrics(disk_paths):
    info = {"hostname": socket.gethostname(), "os": platform.platform(), "uptime_s": None,
            "cpu": {"model": None, "cores": os.cpu_count(), "load1": None, "percent": None},
            "memory": {"used_mb": None, "total_mb": None, "percent": None}, "disks": [], "temperature_c": None}
    try:
        if IS_WIN:
            info["uptime_s"] = int(ctypes.windll.kernel32.GetTickCount64() / 1000)

            class MEM(ctypes.Structure):
                _fields_ = [("l", ctypes.c_uint32), ("load", ctypes.c_uint32), ("tp", ctypes.c_uint64), ("ap", ctypes.c_uint64),
                            ("tpf", ctypes.c_uint64), ("apf", ctypes.c_uint64), ("tv", ctypes.c_uint64), ("av", ctypes.c_uint64), ("ae", ctypes.c_uint64)]
            m = MEM(); m.l = ctypes.sizeof(MEM); ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m))
            info["memory"] = {"total_mb": int(m.tp / 2**20), "used_mb": int((m.tp - m.ap) / 2**20), "percent": int(m.load)}
            import winreg
            with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\DESCRIPTION\System\CentralProcessor\0") as k:
                info["cpu"]["model"] = winreg.QueryValueEx(k, "ProcessorNameString")[0].strip()
            info["cpu"]["percent"] = _cpu_percent["value"]
        else:
            info["uptime_s"] = int(float(open("/proc/uptime").read().split()[0]))
            mem = {l.split(":")[0]: int(l.split()[1]) for l in open("/proc/meminfo") if ":" in l}
            total, avail = mem["MemTotal"] // 1024, mem["MemAvailable"] // 1024
            info["memory"] = {"total_mb": total, "used_mb": total - avail, "percent": round(100 * (total - avail) / total)}
            for line in open("/proc/cpuinfo"):
                if line.startswith("model name"):
                    info["cpu"]["model"] = line.split(":", 1)[1].strip(); break
            l1 = os.getloadavg()[0]
            info["cpu"]["load1"] = round(l1, 2)
            info["cpu"]["percent"] = min(100, round(100 * l1 / (os.cpu_count() or 1), 1))
            temps = []
            for z in glob.glob("/sys/class/thermal/thermal_zone*/temp"):
                try:
                    temps.append(int(open(z).read().strip()) / 1000)
                except (OSError, ValueError):
                    pass
            info["temperature_c"] = round(max(temps), 1) if temps else None
    except Exception as exc:  # noqa: BLE001 - a metric failing must never break the report
        info["error"] = sanitize(exc)
    for p in disk_paths or (["C:\\"] if IS_WIN else ["/"]):
        try:
            u = shutil.disk_usage(p)
            info["disks"].append({"mount": p, "used_gb": round(u.used / 2**30, 1), "total_gb": round(u.total / 2**30, 1),
                                  "free_gb": round(u.free / 2**30, 1), "percent": round(100 * u.used / u.total, 1)})
        except OSError:
            pass
    return info


def gpu_metrics():
    rc, out, _ = run(COMMANDS["nvidia_gpu"])
    if rc != 0 or not out.strip():
        return None
    try:
        name, tot, used, util, temp, drv = [x.strip() for x in out.strip().splitlines()[0].split(",")]
        gpu = {"name": name, "vram_total_mb": int(tot), "vram_used_mb": int(used), "utilization": int(util), "temperature_c": int(temp), "driver": drv, "processes": []}
    except ValueError:
        return None
    rc, out, _ = run(COMMANDS["nvidia_apps"])
    total = 0
    for line in out.strip().splitlines() if rc == 0 else []:
        parts = [x.strip() for x in line.split(",")]
        if len(parts) == 2:
            total += 1
            name = os.path.basename(parts[0])
            # Only AI-runtime processes are reported by name; desktop apps using the GPU (browsers, chat, games) are never listed.
            if any(a in name.lower() for a in GPU_PROC_ALLOW):
                gpu["processes"].append({"name": name, "vram_mb": int(parts[1]) if parts[1].isdigit() else None})
    gpu["process_count"] = total
    return gpu


# --------------------------------------------------------------------------- checks
def pick(obj, paths):
    """Whitelisted extraction. `len:a.b` returns only the length of a list/dict (never its contents, so queues of private
    prompts cannot leak); `names:a.b` returns just the `name` field of each list item."""
    out = {}
    for path in paths:
        mode, _, real = path.partition(":") if path.startswith(("len:", "names:")) else ("", "", path)
        cur = obj
        for part in real.split("."):
            cur = cur.get(part) if isinstance(cur, dict) else None
            if cur is None:
                break
        if mode == "len":
            cur = len(cur) if isinstance(cur, (list, dict)) else None
        elif mode == "names":
            cur = [str(i.get("name"))[:60] for i in cur if isinstance(i, dict)] if isinstance(cur, list) else None
        elif isinstance(cur, str) and SECRET_KEY.search(path):
            cur = None
        out[path] = cur
    return out


def check_units(units):
    res = {}
    for u in units:
        if IS_WIN:
            import csv, io
            rc, out, _ = run(["schtasks", "/query", "/tn", u, "/fo", "csv", "/nh"])
            rows = [r for r in csv.reader(io.StringIO(out)) if r]
            if rc == 0 and rows and len(rows[0]) >= 3:
                res[u] = {"active": rows[0][2], "next": rows[0][1]}
            else:
                res[u] = {"active": None, "error": "not found"}
            continue
        rc, out, _ = run(["systemctl", "show", u, "-p", "ActiveState", "-p", "SubState", "-p", "ActiveEnterTimestamp", "-p", "Result", "-p", "LastTriggerUSec", "-p", "NextElapseUSecRealtime", "-p", "ExecMainExitTimestamp"])
        kv = dict(l.split("=", 1) for l in out.splitlines() if "=" in l)
        res[u] = {"active": kv.get("ActiveState"), "sub": kv.get("SubState"), "since": kv.get("ActiveEnterTimestamp") or None, "result": kv.get("Result"),
                  "last_trigger": kv.get("LastTriggerUSec") or None, "next": kv.get("NextElapseUSecRealtime") or None, "last_exit": kv.get("ExecMainExitTimestamp") or None}
    return res


def check_files(files):
    res = {}
    for f in files:
        try:
            st = os.stat(f["path"])
            entry = {"exists": True, "mtime": datetime.fromtimestamp(st.st_mtime, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "age_s": int(time.time() - st.st_mtime), "size": st.st_size}
            if f.get("pick"):
                try:
                    entry["json"] = pick(json.load(open(f["path"], encoding="utf-8")), f["pick"])
                except (OSError, ValueError):
                    entry["json"] = None
            res[f["name"]] = entry
        except OSError:
            res[f["name"]] = {"exists": False}
    return res


def check_newest(items):
    res = {}
    for it in items:
        try:
            best = None
            if it.get("dirs"):  # newest sub-directory (e.g. dated backup snapshots)
                entries = [e for e in os.scandir(it["dir"]) if e.is_dir(follow_symlinks=False) and (not it.get("pattern") or re.search(it["pattern"], e.name))]
                if entries:
                    e = max(entries, key=lambda x: x.stat().st_mtime)
                    m = e.stat().st_mtime
                    res[it["name"]] = {"newest_file": e.name, "count": len(entries), "mtime": datetime.fromtimestamp(m, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "age_s": int(time.time() - m)}
                else:
                    res[it["name"]] = {"newest_file": None, "count": 0}
                continue
            for root, dirs, files in os.walk(it["dir"]):
                depth = root[len(it["dir"]):].count(os.sep)
                if depth >= it.get("depth", 1):
                    dirs[:] = []
                for name in files[:3000]:
                    if it.get("pattern") and not re.search(it["pattern"], name):
                        continue
                    m = os.path.getmtime(os.path.join(root, name))
                    if best is None or m > best[0]:
                        best = (m, name)
            res[it["name"]] = {"newest_file": best[1], "mtime": datetime.fromtimestamp(best[0], timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "age_s": int(time.time() - best[0])} if best else {"newest_file": None}
        except OSError as exc:
            res[it["name"]] = {"error": sanitize(exc)}
    return res


def check_http(probes):
    res = {}
    for p in probes:
        t0 = time.time()
        try:
            req = urllib.request.Request(p["url"], headers={"User-Agent": "CodeBlack-StatusCollector/1.0"})
            with urllib.request.urlopen(req, timeout=p.get("timeout", 3)) as r:
                body = r.read(200_000)
                entry = {"ok": True, "status": r.status, "latency_ms": int((time.time() - t0) * 1000)}
                if p.get("pick"):
                    entry["json"] = pick(json.loads(body), p["pick"])
            res[p["name"]] = entry
        except Exception as exc:  # noqa: BLE001
            res[p["name"]] = {"ok": False, "latency_ms": int((time.time() - t0) * 1000), "error": sanitize(exc)}
    return res


def check_commands(names):
    res = {}
    for n in names:
        if n not in COMMANDS:
            continue
        rc, out, err = run(COMMANDS[n])
        res[n] = {"ok": rc == 0, "output": sanitize(out.strip(), 600) if rc == 0 else None, "error": None if rc == 0 else sanitize(err or "failed")}
    return res


def check_symlinks(items):
    res = {}
    for it in items:
        try:
            target = os.path.realpath(it["path"])
            entry = {"release": os.path.basename(target)}
            rel = os.path.join(target, "RELEASE.json")
            if os.path.isfile(rel):
                d = json.load(open(rel, encoding="utf-8"))
                entry["meta"] = {k: d.get(k) for k in ("release_id", "source_commit", "built_at") if k in d}
            res[it["name"]] = entry
        except (OSError, ValueError):
            res[it["name"]] = {"release": None}
    return res


def collect(checks):
    checks = checks or {}
    out = {"schema": "codeblack.collector.v1", "collector_version": VERSION, "collected_at": now_iso(),
           "host": host_metrics(checks.get("disks"))}
    if checks.get("gpu"):
        out["gpu"] = gpu_metrics()
    out["units"] = check_units(checks.get("units", []))
    out["files"] = check_files(checks.get("files", []))
    out["newest"] = check_newest(checks.get("newest", []))
    out["http"] = check_http(checks.get("http", []))
    out["commands"] = check_commands(checks.get("commands", []))
    out["symlinks"] = check_symlinks(checks.get("symlinks", []))
    return out


# --------------------------------------------------------------------------- standalone server
def serve(host_id, registry_path, bind, port):
    reg = json.load(open(registry_path, encoding="utf-8"))
    checks = next(h for h in reg["hosts"] if h["id"] == host_id).get("checks", {})
    if IS_WIN:
        threading.Thread(target=_win_cpu_sampler, daemon=True).start()

    class H(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *a):
            pass

        def do_GET(self):
            if self.path.split("?")[0] in ("/v1/metrics", "/v1/health"):
                body = json.dumps(collect(checks) if self.path.startswith("/v1/metrics") else {"ok": True, "version": VERSION, "host": host_id}).encode()
                self.send_response(200)
            else:
                body = b'{"error":"not found"}'
                self.send_response(404)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

    ThreadingHTTPServer((bind, port), H).serve_forever()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", required=True)
    ap.add_argument("--registry", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "registry.json"))
    ap.add_argument("--bind")
    ap.add_argument("--port", type=int)
    ap.add_argument("--print", action="store_true", help="print one collection to stdout and exit")
    a = ap.parse_args()
    if a.print:
        reg = json.load(open(a.registry, encoding="utf-8"))
        print(json.dumps(collect(next(h for h in reg["hosts"] if h["id"] == a.host).get("checks", {})), indent=1))
    else:
        reg = json.load(open(a.registry, encoding="utf-8"))
        h = next(x for x in reg["hosts"] if x["id"] == a.host)
        serve(a.host, a.registry, a.bind or h["collector"]["bind"], a.port or h["collector"]["port"])
