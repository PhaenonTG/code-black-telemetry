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
         "codeblack-status-center.service": "Status dashboard"}
ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9:._/\\-]{0,127}$")
LOCK = threading.RLock()
NONCES = {}
SESSIONS = {}
SESSION_TTL = 12 * 60 * 60


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
            "<title>Code Black · " + html.escape(title) + "</title><style>"
            "body{font:16px system-ui;background:#09090b;color:#eee;max-width:750px;margin:auto;padding:22px}"
            "a{color:#9cc0ff}header{border-bottom:2px solid #e5252a;padding-bottom:12px;margin-bottom:20px}"
            "article{background:#17171b;border:1px solid #333;padding:18px;border-radius:10px;margin:14px 0}"
            "button,select,input{font:inherit;padding:10px;margin:5px;background:#24242b;color:#fff;border:1px solid #666;border-radius:6px}"
            "button{cursor:pointer}button.danger{border-color:#e5252a}small{color:#aaa}form{margin:12px 0}"
            "</style><header><strong>CODE BLACK · ALERT ACTIONS</strong></header>" + body + "</html>").encode()


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
        if parsed.path in ("/", "/incident"):
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
        if parsed.path == "/services":
            cards = []
            for unit, label in UNITS.items():
                safe = html.escape(unit)
                cards.append(f'<article><h2>{html.escape(label)}</h2><p><code>{safe}</code></p>'
                             f'<form method=post action="/alert-actions/restart"><input type=hidden name=csrf value="{nonce()}">'
                             f'<input type=hidden name=unit value="{safe}"><label>Type <code>RESTART {safe}</code> to confirm:<br>'
                             '<input name=confirmation autocomplete=off required></label><br>'
                             '<button class=danger>Confirm restart</button></form></article>')
            return self.respond(200, page("Service actions", '<h1>Allowlisted service actions</h1><p>Every attempt is audited. There is no arbitrary command execution.</p>' + ''.join(cards) + f'<p><a href="{STATUS}">Back to Status Center</a></p>'))
        return self.respond(404, page("Not found", "<h1>Not found</h1>"))

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/login":
            return self.handle_login()
        actor = self.actor("/alert-actions/services")
        if not actor:
            return
        if parsed.path not in ("/action", "/restart"):
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
    ThreadingHTTPServer((BIND, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
