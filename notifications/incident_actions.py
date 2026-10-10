#!/usr/bin/env python3
"""Tailnet-only operator console. Never accepts commands or credentials in alert URLs."""

import base64
import datetime as dt
import hashlib
import hmac
import html
import json
import os
import re
import secrets
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

BASE = "https://codeblack-core.tail1d0673.ts.net/alert-actions"
STATUS = "https://codeblack-core.tail1d0673.ts.net/status/"
ROOT = Path(os.environ.get("CODEBLACK_ACTIONS_DIR", "/srv/codeblack/data/alert-actions"))
AUTH = Path(os.environ.get("CODEBLACK_ACTIONS_AUTH", "/srv/codeblack/config/alert-actions/auth.json"))
BIND = os.environ.get("CODEBLACK_ACTIONS_BIND", "127.0.0.1")
PORT = int(os.environ.get("CODEBLACK_ACTIONS_PORT", "8796"))
UNITS = {"codeblack-ntfy.service": "Private ntfy server",
         "codeblack-status-center.service": "Status dashboard",
         "codeblack-core-api.service": "Core API",
         "codeblack-mqtt-bridge.service": "MQTT ingest bridge",
         "codeblack-radar-worker.service": "Radar worker"}
UNIT_NOTE = {"codeblack-ntfy.service": "Notification delivery pauses briefly.",
             "codeblack-status-center.service": "Health pages refresh after a short interruption.",
             "codeblack-core-api.service": "Fabric and Mesonet ingest pause briefly; buffered devices should reconnect.",
             "codeblack-mqtt-bridge.service": "MQTT-to-Fabric messages pause while the bridge restarts.",
             "codeblack-radar-worker.service": "Radar tiles may be stale until the worker catches up."}
STATUS_ONLY_DEVICE_IDS = {"host:hytetower", "hostunk:hytetower",
                          "svc:nick-mesonet-wind", "svc:nick-mesonet-weather"}
ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9:._/\\-]{0,127}$")
LOCK = threading.RLock()
NONCES = {}
SESSIONS = {}
SESSION_TTL = 12 * 60 * 60
TEST_COOLDOWN = 300
LAST_TEST = 0


def utc(epoch=None):
    return dt.datetime.fromtimestamp(time.time() if epoch is None else epoch, dt.timezone.utc).isoformat()


def read_state():
    try:
        obj = json.loads((ROOT / "state.json").read_text(encoding="utf-8"))
        return obj if isinstance(obj, dict) else {}
    except (OSError, ValueError):
        return {}


def save_state(obj):
    ROOT.mkdir(parents=True, exist_ok=True)
    target = ROOT / "state.json"
    temp = ROOT / "state.json.tmp"
    temp.write_text(json.dumps(obj, sort_keys=True) + "\n", encoding="utf-8")
    temp.chmod(0o640)
    os.replace(temp, target)


def public_state(obj=None, at=None):
    at = time.time() if at is None else at
    obj = read_state() if obj is None else obj
    return {key: {"acknowledged_at": value.get("acknowledged_at"),
                  "snoozed_until": value.get("snoozed_until") if value.get("snoozed_until_epoch", 0) > at else None}
            for key, value in obj.items() if ID.fullmatch(key) and isinstance(value, dict)
            and (value.get("acknowledged_at") or value.get("snoozed_until_epoch", 0) > at)}


def current_attention(alert_id):
    try:
        with urllib.request.urlopen("http://127.0.0.1:8795/api/status", timeout=2) as response:
            return next((item for item in json.load(response).get("attention", []) if item.get("id") == alert_id), None)
    except (OSError, ValueError):
        return None


def status_snapshot():
    with urllib.request.urlopen("http://127.0.0.1:8795/api/status", timeout=3) as response:
        payload = json.load(response)
    if not isinstance(payload, dict) or not isinstance(payload.get("attention"), list) or not isinstance(payload.get("hosts"), list):
        raise ValueError("incomplete Status Center snapshot")
    return payload


def recent_audit(limit=12):
    try:
        lines = (ROOT / "audit.jsonl").read_text(encoding="utf-8").splitlines()[-limit:]
        return [json.loads(line) for line in reversed(lines)]
    except (OSError, ValueError):
        return []


def recent_history(limit=12):
    try:
        obj = json.loads((ROOT / "attention_history.json").read_text(encoding="utf-8"))
        return list(reversed([entry for entry in obj if entry.get("id") not in STATUS_ONLY_DEVICE_IDS][-limit:])) if isinstance(obj, list) else []
    except (OSError, ValueError):
        return []


def record_attention(items, at=None):
    """Keep a small local history of transitions observed in Status Center."""
    at = utc() if at is None else at
    current = {item["id"]: {"title": str(item.get("title") or item["id"]),
                            "severity": str(item.get("severity") or "UNKNOWN"),
                            "status_only": bool(item.get("status_only"))}
               for item in items if isinstance(item, dict) and ID.fullmatch(str(item.get("id") or ""))
               and item["id"] not in STATUS_ONLY_DEVICE_IDS}
    with LOCK:
        try:
            previous = json.loads((ROOT / "attention_snapshot.json").read_text(encoding="utf-8"))
            if not isinstance(previous, dict):
                previous = {}
        except (OSError, ValueError):
            previous = {}
        previous = {key: value for key, value in previous.items() if key not in STATUS_ONLY_DEVICE_IDS}
        changes = []
        for alert_id, item in current.items():
            old = previous.get(alert_id)
            event = "observed" if old is None else "changed" if old.get("severity") != item["severity"] else None
            if event:
                changes.append({"at": at, "event": event, "id": alert_id, **item})
        for alert_id, item in previous.items():
            if alert_id not in current:
                changes.append({"at": at, "event": "resolved", "id": alert_id, **item})
        if not changes:
            return []
        ROOT.mkdir(parents=True, exist_ok=True)
        history = list(reversed(recent_history(200))) + changes
        for name, data in (("attention_history.json", history[-200:]), ("attention_snapshot.json", current)):
            target = ROOT / name
            temp = ROOT / (name + ".tmp")
            temp.write_text(json.dumps(data, sort_keys=True) + "\n", encoding="utf-8")
            temp.chmod(0o640)
            os.replace(temp, target)
        return changes


def watch_attention():
    while True:
        try:
            record_attention(status_snapshot().get("attention", []))
            delay = 60
        except (OSError, ValueError, KeyError, TypeError):
            delay = 5
        time.sleep(delay)


def apply_action(alert_id, action, minutes=None, at=None):
    if not ID.fullmatch(alert_id):
        raise ValueError("invalid alert ID")
    at = time.time() if at is None else at
    with LOCK:
        obj = read_state()
        if len(obj) >= 1000 and alert_id not in obj:
            raise ValueError("action store full")
        item = obj.setdefault(alert_id, {})
        if action == "ack":
            item["acknowledged_at"] = utc(at)
        elif action == "snooze":
            if minutes not in (15, 60, 240, 1440):
                raise ValueError("invalid snooze duration")
            item["snoozed_until_epoch"] = at + minutes * 60
            item["snoozed_until"] = utc(at + minutes * 60)
        elif action == "unsnooze":
            item.pop("snoozed_until_epoch", None)
            item.pop("snoozed_until", None)
        elif action == "clear":
            obj.pop(alert_id, None)
        else:
            raise ValueError("invalid action")
        save_state(obj)
        return public_state(obj, at)


def audit(actor, action, target, result):
    ROOT.mkdir(parents=True, exist_ok=True)
    with LOCK, (ROOT / "audit.jsonl").open("a", encoding="utf-8") as out:
        out.write(json.dumps({"at": utc(), "actor": actor, "action": action,
                              "target": target, "result": result}) + "\n")
        out.flush()
        os.fsync(out.fileno())


def verify_basic(header):
    if not header or not header.startswith("Basic "):
        return None
    try:
        supplied = base64.b64decode(header[6:], validate=True).decode("utf-8")
        username, password = supplied.split(":", 1)
        if verify_password(username, password):
            return username
    except (ValueError, OSError, KeyError, UnicodeError):
        pass
    return None


def verify_password(username, password):
    try:
        cfg = json.loads(AUTH.read_text(encoding="utf-8"))
        digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(cfg["salt"]), 600000)
        return (hmac.compare_digest(username, cfg["username"])
                and hmac.compare_digest(digest, bytes.fromhex(cfg["hash"])))
    except (ValueError, OSError, KeyError, UnicodeError):
        return False


def create_session(actor):
    with LOCK:
        now = time.time()
        for key, (_, expiry) in list(SESSIONS.items()):
            if expiry < now:
                SESSIONS.pop(key, None)
        token = secrets.token_urlsafe(32)
        SESSIONS[token] = (actor, now + SESSION_TTL)
        return token


def session_actor(cookie):
    for part in (cookie or "").split(";"):
        name, _, value = part.strip().partition("=")
        if name == "cb_actions_session":
            with LOCK:
                actor, expiry = SESSIONS.get(value, (None, 0))
                return actor if expiry > time.time() else None
    return None


def safe_next(value):
    parsed = urllib.parse.urlsplit(value)
    if not parsed.scheme and not parsed.netloc and not parsed.fragment:
        if parsed.path == "/alert-actions/services" and not parsed.query:
            return "/alert-actions/services"
        if parsed.path == "/alert-actions/incident":
            alert_id = urllib.parse.parse_qs(parsed.query).get("id", [""])[0]
            if ID.fullmatch(alert_id):
                return "/alert-actions/incident?id=" + urllib.parse.quote(alert_id, safe="")
    return "/alert-actions/services"


def login_page(next_url, error=""):
    destination = html.escape(safe_next(next_url), quote=True)
    message = f'<p role=alert>{html.escape(error)}</p>' if error else ""
    return page("Sign in", '<h1>Operator sign-in</h1>' + message
                + '<form method=post action="/alert-actions/login">'
                + f'<input type=hidden name=csrf value="{nonce()}"><input type=hidden name=next value="{destination}">'
                + '<label>Username<br><input name=username autocomplete=username required></label><br>'
                + '<label>Password<br><input name=password type=password autocomplete=current-password required></label><br>'
                + '<button type=submit>Sign in</button></form>')


def same_origin(url):
    """Compare a request Origin/Referer with the Tailnet console origin."""
    try:
        candidate = urllib.parse.urlsplit(url)
        expected = urllib.parse.urlsplit(BASE)
        return (candidate.scheme == expected.scheme and candidate.hostname == expected.hostname
                and candidate.port in (None, 443) and not candidate.username and not candidate.password)
    except ValueError:
        return False


def request_origin_ok(origin, referer, fetch_site):
    # Some iOS notification browsers omit Origin on a normal same-origin form
    # submission. A valid, single-use nonce below is still mandatory. Reject
    # explicit foreign origins and cross-site browser submissions.
    if fetch_site == "cross-site":
        return False
    if origin and origin != "null":
        return same_origin(origin)
    if referer:
        return same_origin(referer)
    return True


def nonce():
    with LOCK:
        now = time.time()
        for key, expiry in list(NONCES.items()):
            if expiry < now:
                NONCES.pop(key, None)
        value = secrets.token_urlsafe(24)
        NONCES[value] = now + 900
        return value


def consume_nonce(value):
    with LOCK:
        expiry = NONCES.pop(value, 0)
        return expiry > time.time()


def page(title, body):
    return ("<!doctype html><html lang=en><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
            "<meta name=theme-color content='#10131b'><title>Code Black · " + html.escape(title) + "</title><style>"
            ":root{color-scheme:dark;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}"
            "*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 10% -8%,#263447 0,transparent 34rem),#0b0e14;color:#edf2f7}"
            ".shell{max-width:1080px;margin:auto;padding:20px 18px 70px}.top{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:10px 0 22px;border-bottom:1px solid #323844}"
            ".brand{font-weight:900;letter-spacing:.14em;font-size:.82rem}.brand b{color:#ff5d67}.private{font-size:.72rem;color:#b6e9cc;border:1px solid #315e46;background:#173324;padding:7px 10px;border-radius:99px}"
            "nav{display:flex;gap:6px;overflow:auto;margin:18px 0 30px}nav a{color:#c7d3e1;text-decoration:none;white-space:nowrap;padding:9px 13px;border:1px solid #39404d;border-radius:99px;font-size:.85rem}nav a:hover{background:#26303c}"
            "h1{font-size:clamp(2rem,7vw,3.6rem);line-height:1.04;letter-spacing:-.045em;margin:0 0 12px}h2{font-size:1.2rem;margin:0 0 12px;letter-spacing:-.02em}h3{font-size:1rem;margin:0 0 8px}p{line-height:1.5}.lead{color:#aebdca;max-width:68ch;margin:0 0 22px}"
            ".eyebrow{color:#8ea2b8;text-transform:uppercase;letter-spacing:.16em;font-size:.68rem;font-weight:800;margin:0 0 10px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}.two{grid-template-columns:repeat(auto-fit,minmax(300px,1fr))}"
            ".card,article{background:linear-gradient(160deg,#1b222d,#141922);border:1px solid #343e4a;border-radius:18px;padding:20px;min-width:0;box-shadow:0 12px 30px #0002}.card.warn{border-color:#75573a}.card.danger{border-color:#79424a}.card.good{border-color:#355f54}"
            ".stat{font-size:1.9rem;letter-spacing:-.04em;font-weight:800;margin:4px 0}.muted,small{color:#9eacbb}.muted{font-size:.9rem}.section{margin-top:38px}.section-head{display:flex;justify-content:space-between;align-items:end;gap:12px;margin-bottom:12px;flex-wrap:wrap}"
            ".row{display:flex;justify-content:space-between;gap:12px;align-items:start;border-top:1px solid #303947;padding:14px 0}.row:first-child{border-top:0;padding-top:0}.row:last-child{padding-bottom:0}.row-main{min-width:0;overflow-wrap:anywhere}"
            ".pill{display:inline-block;border-radius:99px;padding:4px 9px;font-size:.67rem;font-weight:800;letter-spacing:.04em;background:#34404d;color:#dce8f3;white-space:nowrap}.pill.healthy{background:#1b503f;color:#a7f2cb}.pill.warning,.pill.degraded{background:#674829;color:#ffe1ad}.pill.critical,.pill.offline{background:#69333b;color:#ffb9c3}.pill.info{background:#24465d;color:#acdfff}"
            "a{color:#9bd1ff}a:hover{color:#fff}.btn,button{display:inline-flex;align-items:center;justify-content:center;min-height:44px;border:1px solid #607186;border-radius:10px;padding:10px 15px;background:#263545;color:#f5f8fb;font:inherit;font-weight:700;text-decoration:none;cursor:pointer}button:hover,.btn:hover{background:#34465b;color:#fff}.btn.primary,button.primary{background:#e43b50;border-color:#e43b50;color:white}.btn.primary:hover,button.primary:hover{background:#f25263}.btn.danger,button.danger{border-color:#b45c68;background:#472730}"
            "input,select{font:inherit;color:#f4f7fa;background:#0f151e;border:1px solid #536170;border-radius:9px;padding:11px;max-width:100%}input:focus,select:focus{outline:2px solid #8bbdeb}label{color:#c9d3dd;font-size:.9rem}form{margin:14px 0 0}form input:not([type=hidden]){width:100%;max-width:420px}form button{margin-top:10px}"
            ".actions{display:flex;gap:8px;flex-wrap:wrap}.kicker{color:#e4af76;font-size:.78rem;font-weight:800;text-transform:uppercase;letter-spacing:.08em}.empty{padding:18px;border:1px dashed #45505e;border-radius:14px;color:#9eacbb}.mono,code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.88em;overflow-wrap:anywhere}"
            "@media(max-width:600px){.shell{padding:16px 14px 64px}.card{padding:17px}.row{gap:8px}.stat{font-size:1.65rem}}"
            "</style><div class=shell><header class=top><div class=brand>CODE <b>BLACK</b> / OPS</div><span class=private>● TAILNET PRIVATE</span></header>"
            "<nav aria-label='Operations navigation'><a href='/alert-actions/'>Overview</a><a href='/alert-actions/#alerts'>Alerts</a><a href='/alert-actions/#activity'>Activity</a><a href='/alert-actions/#actions'>Actions</a><a href='"
            + STATUS + "'>Status Center ↗</a></nav>" + body + "</div></html>").encode()


def badge(value):
    label = str(value or "UNKNOWN").upper()
    css = label.lower() if label.lower() in {"healthy", "warning", "degraded", "critical", "offline", "info"} else ""
    return f'<span class="pill {css}">{html.escape(label)}</span>'


def render_dashboard(snapshot):
    esc = lambda value: html.escape(str(value if value is not None else "—"))
    summary = snapshot.get("summary", {})
    hosts = snapshot.get("hosts", [])
    attention = [item for item in snapshot.get("attention", [])
                 if isinstance(item, dict) and item.get("id") not in STATUS_ONLY_DEVICE_IDS]
    services = snapshot.get("services", [])
    notices = snapshot.get("notifications", {})
    title = ('<p class=eyebrow>Live command view</p><h1>System operations.</h1>'
             '<p class=lead>One quiet place to see what needs attention, check delivery, and take a small set of audited repair actions.</p>')
    overview = ('<div class=grid>'
                f'<div class="card {"good" if summary.get("overall") == "HEALTHY" else "warn"}"><p class=eyebrow>System</p><div class=stat>{esc(summary.get("overall", "UNKNOWN"))}</div><small>Latest Status Center snapshot</small></div>'
                f'<div class=card><p class=eyebrow>Active attention</p><div class=stat>{len(attention)}</div><small>{sum(not a.get("status_only") for a in attention)} actionable · {sum(bool(a.get("status_only")) for a in attention)} status-only</small></div>'
                f'<div class=card><p class=eyebrow>Connected hosts</p><div class=stat>{sum(h.get("state") not in ("OFFLINE", "UNKNOWN") for h in hosts)} / {len(hosts)}</div><small>Snapshot: {esc(snapshot.get("generated_at"))}</small></div></div>')
    host_rows = ''.join('<div class=row><div class=row-main><h3>' + esc(h.get("name")) + '</h3><div class=muted>'
                        + esc(h.get("state_reason") or h.get("role") or "") + '</div></div>' + badge(h.get("state")) + '</div>'
                        for h in hosts)
    host_section = '<section class=section id=hosts><div class=section-head><div><p class=eyebrow>Fleet</p><h2>Host pulse</h2></div></div><div class="grid two"><div class=card>' + (host_rows or '<div class=empty>No host data.</div>') + '</div>'
    channels = notices.get("channels", [])
    channel_rows = ''.join('<div class=row><div class=row-main><h3>' + esc(c.get("topic") or c.get("service")) + '</h3><div class=muted>'
                           + esc(c.get("purpose") or c.get("service") or "") + '</div></div>' + badge(c.get("state")) + '</div>'
                           for c in channels if isinstance(c, dict))
    server = notices.get("server", {})
    host_section += ('<div class=card><h2>Notification delivery</h2><div class=row><div class=row-main><h3>Private ntfy</h3><div class=muted>iPhone notification server</div></div>'
                     + badge(server.get("state")) + '</div>' + channel_rows + '</div></div></section>')
    marked = public_state()
    alert_rows = []
    for item in attention:
        alert_id = str(item.get("id") or "")
        if not ID.fullmatch(alert_id):
            continue
        url = '/alert-actions/incident?id=' + urllib.parse.quote(alert_id, safe='')
        chips = badge(item.get("severity")) + (' <span class="pill info">STATUS ONLY</span>' if item.get("status_only") else '')
        state = marked.get(alert_id, {})
        if state.get("acknowledged_at"):
            chips += ' <span class="pill healthy">ACKNOWLEDGED</span>'
        alert_rows.append(f'<div class=row><div class=row-main><h3><a href="{url}">{esc(item.get("title") or alert_id)}</a></h3>'
                          f'<div class=muted>{esc(item.get("detail") or alert_id)}</div></div><div>{chips}</div></div>')
    alerts = ('<section class=section id=alerts><div class=section-head><div><p class=eyebrow>What needs attention</p><h2>Active alerts</h2></div>'
              f'<a class=btn href="{STATUS}#s-attention">Full status ↗</a></div><div class=card>'
              + ''.join(alert_rows) + ('' if alert_rows else '<div class=empty>Nothing active right now.</div>') + '</div></section>')
    events = recent_history(10)
    history_rows = ''.join(f'<div class=row><div class=row-main><h3>{esc(e.get("title") or e.get("id"))}</h3><div class=muted>{esc(e.get("event"))} · {esc(e.get("at"))}</div></div>{badge(e.get("severity"))}</div>' for e in events)
    logs = recent_audit(10)
    audit_rows = ''.join(f'<div class=row><div class=row-main><h3>{esc(e.get("action"))} · {esc(e.get("target"))}</h3><div class=muted>{esc(e.get("at"))} · {esc(e.get("actor"))}</div></div>{badge("HEALTHY" if e.get("result") == "ok" else "WARNING")}</div>' for e in logs)
    activity = ('<section class=section id=activity><div class=section-head><div><p class=eyebrow>Recent signals</p><h2>History & audit</h2></div></div><div class="grid two">'
                '<div class=card><h3>Alert transitions</h3>' + (history_rows or '<div class=empty>Watching for alert changes. History begins when this console starts.</div>') + '</div>'
                '<div class=card><h3>Operator activity</h3>' + (audit_rows or '<div class=empty>No operator actions recorded yet.</div>') + '</div></div></section>')
    unit_rows = []
    for unit, label in UNITS.items():
        service = next((s for s in services if s.get("name") == label or s.get("id") == unit.removeprefix("codeblack-").removesuffix(".service")), None)
        current = badge(service.get("state")) if service else '<span class="pill">ALLOWLISTED</span>'
        safe = esc(unit)
        unit_rows.append(f'<div class=card><div class=row><div class=row-main><h3>{esc(label)}</h3><div class=muted>{safe}</div></div>{current}</div>'
                         f'<p class=muted>{esc(UNIT_NOTE[unit])}</p><form method=post action="/alert-actions/restart"><input type=hidden name=csrf value="{nonce()}">'
                         f'<input type=hidden name=unit value="{safe}"><label>Type <code>RESTART {safe}</code> to confirm<input name=confirmation autocomplete=off required></label><button class=danger>Restart service</button></form></div>')
    actions = ('<section class=section id=actions><div class=section-head><div><p class=eyebrow>Controlled operations</p><h2>Actions</h2></div></div>'
               '<div class="card good"><h3>Send iPhone delivery test</h3><p class=muted>Sends one fixed, harmless message to ops-monitoring. Limited to once every five minutes; it does not prove the phone displayed a push.</p>'
               f'<form method=post action="/alert-actions/test-notification"><input type=hidden name=csrf value="{nonce()}"><button class=primary>Send test notification</button></form></div>'
               '<p class="muted section">Restarts below interrupt the named Core service briefly. Each requires the exact typed confirmation and is recorded in the audit trail.</p>'
               '<div class="grid two">' + ''.join(unit_rows) + '</div></section>')
    return page('Operations', title + overview + host_section + alerts + activity + actions)


class Handler(BaseHTTPRequestHandler):
    server_version = "CodeBlackAlertActions/1.0"

    def log_message(self, fmt, *args):
        # No URL query strings, Basic headers, or message bodies in logs.
        pass

    def respond(self, code, body, ctype="text/html; charset=utf-8", extra_headers=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'")
        for name, value in (extra_headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def actor(self, next_url):
        actor = session_actor(self.headers.get("Cookie")) or verify_basic(self.headers.get("Authorization"))
        if not actor:
            self.respond(401, login_page(next_url))
        return actor

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/health":
            return self.respond(200, b'{"ok":true}', "application/json")
        if parsed.path == "/api/state":
            return self.respond(200, json.dumps(public_state()).encode(), "application/json")
        if parsed.path == "/login":
            return self.respond(200, login_page(urllib.parse.parse_qs(parsed.query).get("next", [""])[0]))
        if not self.actor("/alert-actions" + self.path):
            return
        if parsed.path in ("/", "/services"):
            try:
                snapshot = status_snapshot()
            except (OSError, ValueError):
                snapshot = {"summary": {"overall": "UNAVAILABLE"}, "attention": [], "hosts": [], "services": [], "notifications": {}}
            return self.respond(200, render_dashboard(snapshot))
        if parsed.path == "/incident":
            alert_id = urllib.parse.parse_qs(parsed.query).get("id", [""])[0]
            if not ID.fullmatch(alert_id):
                return self.respond(400, page("Invalid alert", "<h1>Invalid alert ID</h1>"))
            state = public_state().get(alert_id, {})
            live = current_attention(alert_id)
            current = html.escape(alert_id)
            token = nonce()
            hidden = f'<input type=hidden name=id value="{current}"><input type=hidden name=csrf value="{token}">'
            description = (f'<h2>{html.escape(str(live.get("title") or ""))}</h2><p>{html.escape(str(live.get("detail") or ""))}</p>'
                           f'<small>Severity: {html.escape(str(live.get("severity") or "unknown"))}</small>'
                           if live else '<p><small>No current Status Center entry for this ID. This may be an Edge or Mesonet event, or an issue that has cleared.</small></p>')
            detail = (f'<h1>Alert {current}</h1>{description}<p>Accepted by operator: {html.escape(state.get("acknowledged_at") or "not yet")}<br>'
                      f'Snoozed until: {html.escape(state.get("snoozed_until") or "not snoozed")}</p>'
                      f'<p><a href="{STATUS}#s-attention">Open Status Center</a> · <a href="{BASE}/services">Review service actions</a></p>'
                      '<small>Acknowledge records that you saw it. Snooze mutes future notifications until expiry; neither hides the issue from Status Center.</small>')
            forms = (f'<form method=post action="/alert-actions/action">{hidden}<button name=action value=ack>Acknowledge</button>'
                     '<select name=minutes><option value=15>15 minutes</option><option value=60>1 hour</option>'
                     '<option value=240>4 hours</option><option value=1440>24 hours</option></select>'
                     '<button name=action value=snooze>Snooze</button><button name=action value=unsnooze>Unsnooze</button>'
                     '<button name=action value=clear>Clear operator mark</button></form>')
            return self.respond(200, page("Incident", f"<article>{detail}{forms}</article>"))
        return self.respond(404, page("Not found", "<h1>Not found</h1>"))

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/login":
            return self.handle_login()
        actor = self.actor("/alert-actions/services")
        if not actor:
            return
        if parsed.path not in ("/action", "/restart", "/test-notification"):
            return self.respond(404, page("Not found", "<h1>Not found</h1>"))
        if not request_origin_ok(self.headers.get("Origin"), self.headers.get("Referer"), self.headers.get("Sec-Fetch-Site")):
            return self.respond(403, page("Forbidden", "<h1>Origin check failed</h1>"))
        if not self.headers.get("Content-Type", "").startswith("application/x-www-form-urlencoded"):
            return self.respond(415, page("Unsupported", "<h1>Form required</h1>"))
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size < 1 or size > 2048:
                raise ValueError("invalid form size")
            form = urllib.parse.parse_qs(self.rfile.read(size).decode("utf-8"), keep_blank_values=True)
            value = lambda key: form.get(key, [""])[0]
            if not consume_nonce(value("csrf")):
                return self.respond(403, page("Expired", "<h1>Page expired; reopen the alert and try again.</h1>"))
            if parsed.path == "/action":
                alert_id, action = value("id"), value("action")
                minutes = int(value("minutes")) if action == "snooze" else None
                apply_action(alert_id, action, minutes)
                audit(actor, action, alert_id, "ok")
                return self.respond(200, page("Saved", f'<h1>Saved: {html.escape(action)}</h1><p>Alert {html.escape(alert_id)}</p><a href="{BASE}/incident?id={urllib.parse.quote(alert_id)}">Back to alert</a>'))
            if parsed.path == "/test-notification":
                return self.send_test_notification(actor)
            unit = value("unit")
            if unit not in UNITS or value("confirmation") != "RESTART " + unit:
                raise ValueError("unit or confirmation invalid")
            audit(actor, "restart", unit, "requested")
            result = subprocess.run(["/usr/bin/sudo", "-n", "/usr/bin/systemctl", "restart", unit],
                                    capture_output=True, timeout=25, check=False)
            success = result.returncode == 0
            audit(actor, "restart", unit, "ok" if success else f"exit:{result.returncode}")
            return self.respond(200 if success else 502, page("Restart result", f'<h1>{"Restart requested" if success else "Restart failed"}</h1><p>{html.escape(unit)}</p><a href="{BASE}/services">Service actions</a>'))
        except (ValueError, UnicodeError) as exc:
            return self.respond(400, page("Invalid request", f"<h1>Invalid request</h1><p>{html.escape(str(exc))}</p>"))
        except subprocess.TimeoutExpired:
            audit(actor, "restart", value("unit"), "timeout")
            return self.respond(504, page("Timeout", "<h1>Restart timed out; check Status Center before retrying.</h1>"))

    def send_test_notification(self, actor):
        global LAST_TEST
        with LOCK:
            if time.time() - LAST_TEST < TEST_COOLDOWN:
                return self.respond(429, page("Please wait", '<h1>Test recently sent</h1><p>Wait five minutes before another delivery test.</p><a class=btn href="/alert-actions/#actions">Back to actions</a>'))
            LAST_TEST = time.time()
        audit(actor, "test_notification", "ops-monitoring", "requested")
        try:
            result = subprocess.run(["/usr/bin/sudo", "-n", "/usr/bin/python3",
                                     "/srv/codeblack/services/alert-actions/send_ntfy_test.py"],
                                    capture_output=True, timeout=12, check=False)
            success = result.returncode == 0
            audit(actor, "test_notification", "ops-monitoring", "ok" if success else f"exit:{result.returncode}")
            message = ('Test message sent to ops-monitoring. Check the ntfy app on your phone.' if success
                       else 'Delivery test failed on Core. Check private ntfy service health.')
            return self.respond(200 if success else 502, page("Delivery test", f'<h1>{message}</h1><a class=btn href="/alert-actions/#actions">Back to operations</a>'))
        except subprocess.TimeoutExpired:
            audit(actor, "test_notification", "ops-monitoring", "timeout")
            return self.respond(504, page("Delivery test", '<h1>Delivery test timed out</h1><a class=btn href="/alert-actions/#actions">Back to operations</a>'))

    def handle_login(self):
        if not request_origin_ok(self.headers.get("Origin"), self.headers.get("Referer"), self.headers.get("Sec-Fetch-Site")):
            return self.respond(403, page("Forbidden", "<h1>Origin check failed</h1>"))
        if not self.headers.get("Content-Type", "").startswith("application/x-www-form-urlencoded"):
            return self.respond(415, page("Unsupported", "<h1>Form required</h1>"))
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size < 1 or size > 2048:
                raise ValueError("invalid form size")
            form = urllib.parse.parse_qs(self.rfile.read(size).decode("utf-8"), keep_blank_values=True)
            value = lambda key: form.get(key, [""])[0]
            destination = safe_next(value("next"))
            if not consume_nonce(value("csrf")):
                return self.respond(403, login_page(destination, "Page expired. Please sign in again."))
            if not verify_password(value("username"), value("password")):
                return self.respond(401, login_page(destination, "Incorrect username or password."))
            token = create_session(value("username"))
            return self.respond(303, b"", extra_headers={
                "Location": destination,
                "Set-Cookie": f"cb_actions_session={token}; Path=/alert-actions; Secure; HttpOnly; SameSite=Strict; Max-Age={SESSION_TTL}"})
        except (ValueError, UnicodeError):
            return self.respond(400, login_page("/alert-actions/services", "Invalid sign-in form."))


def main():
    if len(sys.argv) == 3 and sys.argv[1] == "--provision-from":
        password = Path(sys.argv[2]).read_text(encoding="utf-8").strip()
        if not password:
            raise SystemExit("empty password")
        salt = secrets.token_bytes(24)
        digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 600000)
        AUTH.parent.mkdir(parents=True, exist_ok=True)
        AUTH.write_text(json.dumps({"username": "glenn", "salt": salt.hex(), "hash": digest.hex()}) + "\n")
        AUTH.chmod(0o640)
        print("operator credential hash provisioned")
        return
    if not AUTH.is_file():
        raise SystemExit("operator auth configuration missing")
    ROOT.mkdir(parents=True, exist_ok=True)
    threading.Thread(target=watch_attention, daemon=True, name="alert-history").start()
    ThreadingHTTPServer((BIND, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
