#!/usr/bin/env python3
"""Code Black Radar Product Service (standalone, server-side).

Continuously acquires the newest complete NEXRAD composite (IEM N0Q USCOMP) on a timer -- never on
client demand -- verifies it, stores it as an immutable timestamped frame, and publishes an
atomic latest-pointer/loop manifest. Consumers (overlay, monitor, future native compositor) read
the manifest and immutable frame assets only; none of them own acquisition or freshness logic.

Contract (all paths relative to the service root; tailnet mount adds PUBLIC_PREFIX):
  GET /v1/composite/latest.json                                     Cache-Control: no-store
  GET /v1/composite/frames/<frame_id>/source.png                    immutable (native EPSG:4326 palette PNG)
  GET /v1/composite/frames/<frame_id>/tiles/{z}/{x}/{y}.png         immutable (Web Mercator RGBA tile)
  GET /v1/composite/frames/<frame_id>/render.png?bbox=w,s,e,n&size=WxH  immutable (Web Mercator RGBA)
  GET /v1/health                                                    Cache-Control: no-store
"""
import hashlib
import io
import json
import logging
import math
import os
import re
import shutil
import sys
import threading
import time
import urllib.error
import urllib.request
from collections import OrderedDict
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from PIL import Image

VERSION = "1.0.1"
SCHEMA_VERSION = 1
PRODUCT_ID = "composite-n0q"

BIND = os.environ.get("RADAR_PRODUCT_BIND", "127.0.0.1")
PORT = int(os.environ.get("RADAR_PRODUCT_PORT", "8791"))
DATA_DIR = os.environ.get("RADAR_PRODUCT_DATA_DIR", "/srv/codeblack/data/radar-product")
PUBLIC_PREFIX = os.environ.get("RADAR_PRODUCT_PUBLIC_PREFIX", "/radar-product").rstrip("/")
SOURCE_BASE = os.environ.get("RADAR_PRODUCT_SOURCE_BASE", "https://mesonet.agron.iastate.edu").rstrip("/")
POLL_SECONDS = float(os.environ.get("RADAR_PRODUCT_POLL_SECONDS", "20"))
LOOP_FRAMES = int(os.environ.get("RADAR_PRODUCT_LOOP_FRAMES", "12"))
RETENTION_FRAMES = int(os.environ.get("RADAR_PRODUCT_RETENTION_FRAMES", "36"))
HTTP_TIMEOUT = float(os.environ.get("RADAR_PRODUCT_HTTP_TIMEOUT", "30"))
USER_AGENT = "CodeBlack-RadarProduct/1.0 (+private tailnet service; contact via codeblackwx.com)"

# Measured: source cadence is 5 min and each file goes live ~90 s BEFORE its `valid` label, so age
# measured from `valid` normally runs 0..~210 s. FRESH allows ~150 s of jitter beyond that; AGING is one
# missed cycle; STALE is a few missed cycles; beyond 20 min the frame is CRITICAL (~25 min old radar is
# never presented as current).
CADENCE_SECONDS = 300
FRESH_MAX_S = int(os.environ.get("RADAR_PRODUCT_FRESH_MAX_S", "360"))
AGING_MAX_S = int(os.environ.get("RADAR_PRODUCT_AGING_MAX_S", "660"))
STALE_MAX_S = int(os.environ.get("RADAR_PRODUCT_STALE_MAX_S", "1200"))

# IEM composite geometry (verified from the world file): EPSG:4326, 0.005 deg pixels, NW origin.
SRC_WEST, SRC_NORTH, SRC_PIXEL = -126.0, 50.0, 0.005
SRC_SIZE = (12200, 5400)
SRC_SOUTH = SRC_NORTH - SRC_SIZE[1] * SRC_PIXEL
SRC_EAST = SRC_WEST + SRC_SIZE[0] * SRC_PIXEL
TILE_MAX_ZOOM = 10  # data is ~0.5 km/px (native at ~z8); z9-z10 are rendered nearest-neighbour upsamples for close-up views

CUR_META_URL = SOURCE_BASE + "/data/gis/images/4326/USCOMP/n0q_0.json"
CUR_PNG_URL = SOURCE_BASE + "/data/gis/images/4326/USCOMP/n0q_0.png"
ARCHIVE_PNG = SOURCE_BASE + "/archive/data/{y}/{m}/{d}/GIS/uscomp/n0q_{y}{m}{d}{H}{M}.png"

log = logging.getLogger("radar-product")
FRAMES_DIR = os.path.join(DATA_DIR, "composite", "frames")
os.makedirs(FRAMES_DIR, exist_ok=True)


# ----------------------------------------------------------------------------- time helpers
def utcnow():
    return datetime.now(timezone.utc)


def iso(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if dt else None


def parse_iso(text):
    return datetime.strptime(text, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def frame_id_for(dt):
    return dt.strftime("%Y%m%dT%H%MZ")


def parse_frame_id(fid):
    return datetime.strptime(fid, "%Y%m%dT%H%MZ").replace(tzinfo=timezone.utc)


def freshness_state(age_s):
    if age_s is None:
        return "CRITICAL"
    if age_s <= FRESH_MAX_S:
        return "FRESH"
    if age_s <= AGING_MAX_S:
        return "AGING"
    if age_s <= STALE_MAX_S:
        return "STALE"
    return "CRITICAL"


# ----------------------------------------------------------------------------- health state
class Health:
    def __init__(self):
        self.lock = threading.Lock()
        self.started = time.time()
        self.state = "STARTING"
        self.last_source_check = None
        self.last_source_valid = None
        self.last_download_ok = None
        self.last_process_ok = None
        self.last_publish_ok = None
        self.consecutive_failures = 0
        self.total_failures = 0
        self.total_published = 0
        self.last_error = None
        self.last_error_time = None
        self.backlog = 0

    def ok(self, key):
        with self.lock:
            setattr(self, key, iso(utcnow()))

    def fail(self, where, exc):
        text = re.sub(r"(/[\w.\-]+){2,}", "<path>", f"{where}: {type(exc).__name__}: {exc}")[:240]
        with self.lock:
            self.consecutive_failures += 1
            self.total_failures += 1
            self.last_error = text
            self.last_error_time = iso(utcnow())
            self.state = "DEGRADED"
        log.warning("cycle failure %s", text)

    def success_cycle(self):
        with self.lock:
            self.consecutive_failures = 0
            self.state = "OK"

    def snapshot(self):
        with self.lock:
            return {
                "worker_state": self.state,
                "uptime_seconds": int(time.time() - self.started),
                "last_source_check": self.last_source_check,
                "last_source_valid_time": self.last_source_valid,
                "last_successful_download": self.last_download_ok,
                "last_successful_process": self.last_process_ok,
                "last_successful_publish": self.last_publish_ok,
                "consecutive_failures": self.consecutive_failures,
                "total_failures": self.total_failures,
                "frames_published_since_start": self.total_published,
                "backlog_missing_frames": self.backlog,
                "last_error": self.last_error,
                "last_error_time": self.last_error_time,
            }


HEALTH = Health()


# ----------------------------------------------------------------------------- frame store
def frame_dir(fid):
    return os.path.join(FRAMES_DIR, fid)


def read_frame_meta(fid):
    try:
        with open(os.path.join(frame_dir(fid), "frame.json"), "r", encoding="utf-8") as fh:
            meta = json.load(fh)
        if meta.get("status") != "complete":
            return None
        if not os.path.isfile(os.path.join(frame_dir(fid), "source.png")):
            return None
        return meta
    except (OSError, ValueError):
        return None


def list_frame_ids():
    ids = []
    try:
        for name in os.listdir(FRAMES_DIR):
            if re.fullmatch(r"\d{8}T\d{4}Z", name) and read_frame_meta(name):
                ids.append(name)
    except OSError:
        return []
    return sorted(ids)


def cleanup_incomplete():
    try:
        for name in os.listdir(FRAMES_DIR):
            if name.startswith(".tmp-"):
                shutil.rmtree(os.path.join(FRAMES_DIR, name), ignore_errors=True)
    except OSError:
        pass


def enforce_retention():
    ids = list_frame_ids()
    for fid in ids[:-RETENTION_FRAMES] if len(ids) > RETENTION_FRAMES else []:
        shutil.rmtree(frame_dir(fid), ignore_errors=True)
        DECODED.drop(fid)


# ----------------------------------------------------------------------------- acquisition
def http_get(url, want_headers=False):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:
        body = resp.read()
        declared = resp.headers.get("Content-Length")
        if declared and int(declared) != len(body):
            raise IOError(f"short read {len(body)} of {declared}")
        return (body, dict(resp.headers)) if want_headers else body


def fetch_current_meta():
    body = http_get(CUR_META_URL)
    meta = json.loads(body)["meta"]
    return parse_iso(meta["valid"]), meta


def verify_png(data):
    """Full decode + geometry check: a truncated/corrupt/unexpected image must never be published."""
    img = Image.open(io.BytesIO(data))
    img.load()
    if img.mode != "P":
        raise ValueError(f"unexpected image mode {img.mode}")
    if img.size != SRC_SIZE:
        raise ValueError(f"unexpected image size {img.size}")
    if img.getbbox() is None:
        raise ValueError("image contains no data")
    return img


def ingest(valid_dt, png_bytes, headers, src_meta, received_dt, kind):
    fid = frame_id_for(valid_dt)
    if read_frame_meta(fid):
        return False
    started = utcnow()
    t_proc = time.monotonic()
    img = verify_png(png_bytes)
    proc_seconds = time.monotonic() - t_proc
    completed = utcnow()
    t_pub = time.monotonic()
    tmp = os.path.join(FRAMES_DIR, f".tmp-{fid}-{os.getpid()}")
    shutil.rmtree(tmp, ignore_errors=True)
    os.makedirs(tmp)
    with open(os.path.join(tmp, "source.png"), "wb") as fh:
        fh.write(png_bytes)
        fh.flush()
        os.fsync(fh.fileno())
    last_modified = None
    lm = (headers or {}).get("Last-Modified")
    if lm:
        try:
            last_modified = datetime.strptime(lm, "%a, %d %b %Y %H:%M:%S GMT").replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    published = utcnow()
    pub_seconds = time.monotonic() - t_pub
    meta = {
        "frame_id": fid,
        "status": "complete",
        "observation_time": iso(valid_dt),
        "source": {
            "name": "IEM NEXRAD CONUS composite",
            "product": src_meta.get("product", "N0Q"),
            "site": src_meta.get("site", "USCOMP"),
            "radar_quorum": src_meta.get("radar_quorum"),
            "source_processing_seconds": src_meta.get("processing_time_secs"),
            "source_generated_time": iso(last_modified),
            "retrieval": kind,
        },
        "source_received_time": iso(received_dt),
        "processing_started_time": iso(started),
        "processing_completed_time": iso(completed),
        "published_time": iso(published),
        "processing_duration_seconds": round(proc_seconds, 3),
        "publish_duration_seconds": round(pub_seconds, 3),
        "bytes": len(png_bytes),
        "sha256": hashlib.sha256(png_bytes).hexdigest(),
        "width": img.size[0],
        "height": img.size[1],
    }
    with open(os.path.join(tmp, "frame.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, indent=1)
        fh.flush()
        os.fsync(fh.fileno())
    final = frame_dir(fid)
    if os.path.isdir(final):
        shutil.rmtree(tmp, ignore_errors=True)
        return False
    os.rename(tmp, final)  # atomic publication: a frame directory is either absent or complete
    DECODED.put(fid, img)
    return True


def expected_recent_ids(now):
    base = now.replace(second=0, microsecond=0)
    base -= timedelta(minutes=base.minute % 5)
    return [frame_id_for(base - timedelta(minutes=5 * i)) for i in range(LOOP_FRAMES)]


def try_archive(dt):
    url = ARCHIVE_PNG.format(y=dt.strftime("%Y"), m=dt.strftime("%m"), d=dt.strftime("%d"), H=dt.strftime("%H"), M=dt.strftime("%M"))
    data, headers = http_get(url, want_headers=True)
    received = utcnow()
    HEALTH.ok("last_download_ok")
    return ingest(dt, data, headers, {"product": "N0Q", "site": "USCOMP"}, received, "archive")


def acquisition_cycle():
    HEALTH.ok("last_source_check")
    valid_dt, src_meta = fetch_current_meta()
    with HEALTH.lock:
        HEALTH.last_source_valid = iso(valid_dt)
    have = set(list_frame_ids())
    newest = max(have) if have else None
    if frame_id_for(valid_dt) not in have and (newest is None or frame_id_for(valid_dt) > newest):
        data, headers = http_get(CUR_PNG_URL, want_headers=True)
        received = utcnow()
        HEALTH.ok("last_download_ok")
        # The pointer file and image are replaced non-atomically upstream; re-read the pointer and only
        # accept the image for the timestamp it now claims.
        valid_after, meta_after = fetch_current_meta()
        if valid_after != valid_dt:
            valid_dt, src_meta = valid_after, meta_after
        if ingest(valid_dt, data, headers, src_meta, received, "current"):
            HEALTH.ok("last_process_ok")
            HEALTH.ok("last_publish_ok")
            with HEALTH.lock:
                HEALTH.total_published += 1
    # Gap-fill recent history (restart/outage recovery) from immutable archive files, newest first.
    have = set(list_frame_ids())
    missing = [fid for fid in expected_recent_ids(utcnow()) if fid not in have]
    with HEALTH.lock:
        HEALTH.backlog = len(missing)
    for fid in missing[:3]:
        try:
            if try_archive(parse_frame_id(fid)):
                HEALTH.ok("last_process_ok")
                HEALTH.ok("last_publish_ok")
                with HEALTH.lock:
                    HEALTH.total_published += 1
        except urllib.error.HTTPError as exc:
            if exc.code != 404:
                raise
    enforce_retention()
    HEALTH.success_cycle()


def acquisition_loop():
    while True:
        try:
            acquisition_cycle()
        except Exception as exc:  # noqa: BLE001 - every failure is recorded; the loop must survive
            HEALTH.fail("acquisition", exc)
        time.sleep(POLL_SECONDS)


# ----------------------------------------------------------------------------- manifest
def merc_y(lat):
    return math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))


def lat_of_merc(y):
    return math.degrees(2 * math.atan(math.exp(y)) - math.pi / 2)


def tile_url_template(fid):
    return f"{PUBLIC_PREFIX}/v1/composite/frames/{fid}/tiles/{{z}}/{{x}}/{{y}}.png"


def conservative_age(meta, now):
    """Age from the estimated data cut-off (file generation minus the source's own processing time);
    the `valid` label runs ahead of that, so this is the pessimistic view. Null when unknown."""
    gen = meta["source"].get("source_generated_time")
    if not gen:
        return None
    cutoff = parse_iso(gen) - timedelta(seconds=float(meta["source"].get("source_processing_seconds") or 0))
    return max(0, int((now - cutoff).total_seconds()))


def frame_entry(fid, meta, now):
    obs = parse_iso(meta["observation_time"])
    age = max(0, int((now - obs).total_seconds()))
    received = parse_iso(meta["source_received_time"])
    published = parse_iso(meta["published_time"])
    completed = parse_iso(meta["processing_completed_time"])
    started = parse_iso(meta["processing_started_time"])
    return {
        "frame_id": fid,
        "observation_time": meta["observation_time"],
        "source_generated_time": meta["source"].get("source_generated_time"),
        "source_received_time": meta["source_received_time"],
        "processing_started_time": meta["processing_started_time"],
        "processing_completed_time": meta["processing_completed_time"],
        "published_time": meta["published_time"],
        "age_seconds": age,
        "conservative_age_seconds": conservative_age(meta, now),
        "ingest_delay_seconds": int((received - obs).total_seconds()),
        "processing_delay_seconds": meta.get("processing_duration_seconds", round((completed - started).total_seconds(), 2)),
        "publish_delay_seconds": meta.get("publish_duration_seconds", round((published - completed).total_seconds(), 2)),
        "pipeline_delay_seconds": int((published - obs).total_seconds()),
        "retrieval": meta["source"].get("retrieval"),
        "assets": {
            "source_png": f"{PUBLIC_PREFIX}/v1/composite/frames/{fid}/source.png",
            "tile_template": tile_url_template(fid),
            "render_template": f"{PUBLIC_PREFIX}/v1/composite/frames/{fid}/render.png?bbox={{west}},{{south}},{{east}},{{north}}&size={{width}}x{{height}}",
        },
        "sha256": meta["sha256"],
    }


def build_manifest(now=None):
    """Computed from immutable frame metadata + current time on every request, so the reported age and
    state keep advancing even if the acquisition thread is wedged: old radar can never look current."""
    now = now or utcnow()
    ids = list_frame_ids()
    recent = ids[-LOOP_FRAMES:]
    frames = [frame_entry(fid, read_frame_meta(fid), now) for fid in recent if read_frame_meta(fid)]
    health = HEALTH.snapshot()
    manifest = {
        "schema_version": SCHEMA_VERSION,
        "product": {
            "id": PRODUCT_ID,
            "name": "NEXRAD CONUS composite reflectivity (N0Q)",
            "kind": "composite",
            "source": "Iowa Environmental Mesonet USCOMP N0Q",
            "cadence_seconds": CADENCE_SECONDS,
            "attribution": "NWS NEXRAD via Iowa Environmental Mesonet",
        },
        "generated_time": iso(now),
        "geometry": {
            "projection_native": "EPSG:4326",
            "projection_tiles": "EPSG:3857",
            "bounds": {"west": SRC_WEST, "south": SRC_SOUTH, "east": SRC_EAST, "north": SRC_NORTH},
            "native_pixel_degrees": SRC_PIXEL,
            "native_size": {"width": SRC_SIZE[0], "height": SRC_SIZE[1]},
            "tile_size": 256,
            "tile_min_zoom": 0,
            "tile_max_zoom": TILE_MAX_ZOOM,
            "no_echo": "transparent",
        },
        "freshness_thresholds_seconds": {"fresh_max": FRESH_MAX_S, "aging_max": AGING_MAX_S, "stale_max": STALE_MAX_S},
        "frames": frames,  # ordered OLDEST -> NEWEST; the last entry is `latest`
        "latest": None,
        "freshness_state": "CRITICAL",
        "age_seconds": None,
        "pipeline_delay_seconds": None,
        "next_expected_update_time": None,
        "worker": health,
        "cache": {"latest_manifest": "no-store", "frame_assets": "immutable"},
    }
    if frames:
        latest = frames[-1]
        manifest["latest"] = latest
        manifest["age_seconds"] = latest["age_seconds"]
        manifest["pipeline_delay_seconds"] = latest["pipeline_delay_seconds"]
        manifest["freshness_state"] = freshness_state(latest["age_seconds"])
        lags = sorted(f["ingest_delay_seconds"] for f in frames if f["retrieval"] == "current")
        typical_lag = lags[len(lags) // 2] if lags else 150
        manifest["next_expected_update_time"] = iso(parse_iso(latest["observation_time"]) + timedelta(seconds=CADENCE_SECONDS + max(0, typical_lag)))
    return manifest


def heartbeat_loop():
    path = os.path.join(DATA_DIR, "composite", "latest.json")
    while True:
        try:
            tmp = path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump(build_manifest(), fh, indent=1)
            os.replace(tmp, path)  # file-based consumers on this host; HTTP remains authoritative
        except Exception as exc:  # noqa: BLE001
            log.warning("heartbeat write failed: %s", exc)
        time.sleep(10)


# ----------------------------------------------------------------------------- rendering
class DecodedCache:
    def __init__(self, cap=3):
        self.cap, self.items, self.lock = cap, OrderedDict(), threading.Lock()

    def get(self, fid):
        with self.lock:
            img = self.items.get(fid)
            if img is not None:
                self.items.move_to_end(fid)
                return img
        img = Image.open(os.path.join(frame_dir(fid), "source.png"))
        img.load()
        self.put(fid, img)
        return img

    def put(self, fid, img):
        with self.lock:
            self.items[fid] = img
            self.items.move_to_end(fid)
            while len(self.items) > self.cap:
                self.items.popitem(last=False)

    def drop(self, fid):
        with self.lock:
            self.items.pop(fid, None)


DECODED = DecodedCache()
RENDER_LOCK = threading.Semaphore(2)


def render_mercator(src, west, south, east, north, width, height):
    """Reproject a Web Mercator bbox (degrees) out of the native equirectangular palette image.
    Point (nearest-neighbour) sampling on palette indices, matching IEM's own tile rendering
    (verified: identical echo coverage) so dBZ classes are never blended; index 0 = no echo."""
    y_top, y_bot = merc_y(min(north, 85.0511)), merc_y(max(south, -85.0511))
    x0 = (west - SRC_WEST) / SRC_PIXEL
    x1 = (east - SRC_WEST) / SRC_PIXEL
    mesh = []
    for row in range(height):
        lat = lat_of_merc(y_top - (row + 0.5) / height * (y_top - y_bot))
        sy = (SRC_NORTH - lat) / SRC_PIXEL
        mesh.append(((0, row, width, row + 1), (x0, sy, x0, sy, x1, sy, x1, sy)))
    idx = src.transform((width, height), Image.Transform.MESH, mesh, resample=Image.Resampling.NEAREST)
    if idx.getbbox() is None:
        return None
    rgba = idx.convert("RGBA")
    rgba.putalpha(Image.frombytes("L", idx.size, idx.tobytes()).point(lambda v: 0 if v == 0 else 255))
    return rgba


def png_bytes(img):
    buf = io.BytesIO()
    img.save(buf, format="PNG", compress_level=6)
    return buf.getvalue()


BLANK_TILE = png_bytes(Image.new("RGBA", (256, 256), (0, 0, 0, 0)))


def tile_bbox(z, x, y):
    n = 2 ** z
    west = x / n * 360.0 - 180.0
    east = (x + 1) / n * 360.0 - 180.0
    north = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    south = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / n))))
    return west, south, east, north


def tile_png(fid, z, x, y):
    cache = os.path.join(frame_dir(fid), "tiles", str(z), str(x))
    path = os.path.join(cache, f"{y}.png")
    if os.path.isfile(path):
        with open(path, "rb") as fh:
            return fh.read()
    west, south, east, north = tile_bbox(z, x, y)
    if east <= SRC_WEST or west >= SRC_EAST or north <= SRC_SOUTH or south >= SRC_NORTH:
        return BLANK_TILE
    with RENDER_LOCK:
        img = render_mercator(DECODED.get(fid), west, south, east, north, 256, 256)
    data = BLANK_TILE if img is None else png_bytes(img)
    try:
        os.makedirs(cache, exist_ok=True)
        tmp = path + f".{threading.get_ident()}.tmp"
        with open(tmp, "wb") as fh:
            fh.write(data)
        os.replace(tmp, path)
    except OSError:
        pass
    return data


# ----------------------------------------------------------------------------- HTTP
IMMUTABLE = "public, max-age=31536000, immutable"
ROUTE_TILE = re.compile(r"^/v1/composite/frames/(\d{8}T\d{4}Z)/tiles/(\d+)/(\d+)/(\d+)\.png$")
ROUTE_SRC = re.compile(r"^/v1/composite/frames/(\d{8}T\d{4}Z)/source\.png$")
ROUTE_RENDER = re.compile(r"^/v1/composite/frames/(\d{8}T\d{4}Z)/render\.png$")


class Handler(BaseHTTPRequestHandler):
    server_version = "CodeBlackRadarProduct/" + VERSION
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        log.debug("%s %s", self.address_string(), fmt % args)

    def _send(self, status, body, ctype, cache):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, obj, status=200):
        self._send(status, json.dumps(obj).encode(), "application/json", "no-store")

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        try:
            parsed = urlparse(self.path)
            path = parsed.path
            if path == "/v1/composite/latest.json":
                return self._json(build_manifest())
            if path == "/v1/health":
                manifest = build_manifest()
                return self._json({"ok": manifest["freshness_state"] != "CRITICAL", "version": VERSION, "product": PRODUCT_ID,
                                   "freshness_state": manifest["freshness_state"], "age_seconds": manifest["age_seconds"],
                                   "worker": manifest["worker"]})
            m = ROUTE_SRC.match(path)
            if m and read_frame_meta(m.group(1)):
                with open(os.path.join(frame_dir(m.group(1)), "source.png"), "rb") as fh:
                    return self._send(200, fh.read(), "image/png", IMMUTABLE)
            m = ROUTE_TILE.match(path)
            if m and read_frame_meta(m.group(1)):
                z, x, y = int(m.group(2)), int(m.group(3)), int(m.group(4))
                if z > TILE_MAX_ZOOM or x >= 2 ** z or y >= 2 ** z:
                    return self._json({"error": "tile out of range"}, 404)
                return self._send(200, tile_png(m.group(1), z, x, y), "image/png", IMMUTABLE)
            m = ROUTE_RENDER.match(path)
            if m and read_frame_meta(m.group(1)):
                q = parse_qs(parsed.query)
                west, south, east, north = (float(v) for v in q["bbox"][0].split(","))
                width, height = (int(v) for v in q["size"][0].lower().split("x"))
                if not (16 <= width <= 3840 and 16 <= height <= 2160 and west < east and south < north):
                    return self._json({"error": "bad bbox/size"}, 400)
                with RENDER_LOCK:
                    img = render_mercator(DECODED.get(m.group(1)), west, south, east, north, width, height)
                data = png_bytes(img) if img is not None else png_bytes(Image.new("RGBA", (width, height), (0, 0, 0, 0)))
                return self._send(200, data, "image/png", IMMUTABLE)
            return self._json({"error": "not found"}, 404)
        except (KeyError, ValueError):
            return self._json({"error": "bad request"}, 400)
        except BrokenPipeError:
            return None
        except Exception as exc:  # noqa: BLE001
            log.exception("request failed")
            return self._json({"error": type(exc).__name__}, 500)


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", stream=sys.stdout)
    cleanup_incomplete()
    threads = [threading.Thread(target=acquisition_loop, name="acquire", daemon=True),
               threading.Thread(target=heartbeat_loop, name="heartbeat", daemon=True)]
    for t in threads:
        t.start()
    server = ThreadingHTTPServer((BIND, PORT), Handler)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, name="http", daemon=True).start()
    log.info("radar-product %s listening on %s:%s data=%s", VERSION, BIND, PORT, "<data-dir>")
    while True:  # if any worker thread dies, exit so systemd restarts the whole service
        time.sleep(5)
        if not all(t.is_alive() for t in threads):
            log.error("worker thread died; exiting for supervisor restart")
            sys.exit(1)


if __name__ == "__main__":
    main()
