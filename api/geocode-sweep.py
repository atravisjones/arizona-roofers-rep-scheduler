"""
Cron-only geocode sweep for jobs missing coordinates.

Prioritizes sales appointments on the Today Board horizon, then chips away at
the general missing-coordinate backlog. Persists through fill_job_coords so
existing coordinates are never overwritten.

Env vars: CRON_SECRET, KPI_SUPABASE_URL, KPI_SUPABASE_ANON_KEY
"""

import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler

try:
    from zoneinfo import ZoneInfo
except ImportError:
    ZoneInfo = None


SUPABASE_URL = os.environ.get("KPI_SUPABASE_URL", "https://ucfqgkbkxbztxlyniuph.supabase.co")
SUPABASE_KEY = os.environ.get("KPI_SUPABASE_ANON_KEY", "")
CRON_SECRET = os.environ.get("CRON_SECRET", "")

USER_AGENT = "RepRoutePlanner/1.0 (travis@arizonaroofers.com)"
EMAIL = "travis@arizonaroofers.com"
DEFAULT_BATCH_SIZE = 25
MAX_BATCH_SIZE = 25
ARIZONA_BOUNDS = {
    "min_lat": 31.2,
    "max_lat": 37.1,
    "min_lon": -115.0,
    "max_lon": -108.9,
}


def phoenix_today():
    if ZoneInfo:
        return datetime.now(ZoneInfo("America/Phoenix")).date()
    return datetime.now(timezone(timedelta(hours=-7))).date()


def json_response(handler, status, data):
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(json.dumps(data).encode())


def sb_headers(extra=None):
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    }
    if extra:
        headers.update(extra)
    return headers


def sb_fetch(path, timeout=10, count=False):
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    headers = sb_headers({"Prefer": "count=exact"} if count else None)
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = resp.read().decode()
        data = json.loads(body) if body else []
        return data, resp.headers.get("content-range")


def sb_post_rpc(name, body, timeout=10):
    url = f"{SUPABASE_URL}/rest/v1/rpc/{name}"
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode(),
        headers=sb_headers({"Content-Type": "application/json"}),
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        resp.read()
        return resp.status


def parse_total(content_range):
    if not content_range or "/" not in content_range:
        return None
    total = content_range.rsplit("/", 1)[-1]
    if total == "*":
        return None
    try:
        return int(total)
    except ValueError:
        return None


def has_arizona_context(address):
    return bool(re.search(r"\b(AZ|Arizona)\b", address or "", re.IGNORECASE))


def geocode_query(address):
    address = (address or "").strip()
    if has_arizona_context(address):
        return address
    return f"{address}, Arizona"


def query_nominatim(q):
    url = (
        f"https://nominatim.openstreetmap.org/search"
        f"?q={urllib.parse.quote(q)}&format=json&limit=1"
        f"&email={urllib.parse.quote(EMAIL)}"
    )
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read())


def query_photon(q):
    url = f"https://photon.komoot.io/api/?q={urllib.parse.quote(q)}&limit=1"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = json.loads(resp.read())
    results = []
    for feature in data.get("features", []):
        coords = feature.get("geometry", {}).get("coordinates", [])
        props = feature.get("properties", {})
        if len(coords) >= 2:
            results.append({
                "lat": str(coords[1]),
                "lon": str(coords[0]),
                "display_name": props.get("name", ""),
                "type": props.get("type", ""),
            })
    return results


def is_in_arizona(lat, lon):
    return (
        ARIZONA_BOUNDS["min_lat"] <= lat <= ARIZONA_BOUNDS["max_lat"]
        and ARIZONA_BOUNDS["min_lon"] <= lon <= ARIZONA_BOUNDS["max_lon"]
    )


def geocode_address(address):
    q = geocode_query(address)
    try:
        results = query_nominatim(q)
        if not results:
            results = query_photon(q)
    except urllib.error.HTTPError as e:
        if e.code not in (429, 503):
            raise
        results = query_photon(q)
    except Exception:
        results = query_photon(q)

    if not results:
        return None

    first = results[0]
    lat = float(first["lat"])
    lon = float(first["lon"])
    if not is_in_arizona(lat, lon):
        return None

    return {"lat": str(lat), "lng": str(lon)}


def unique_jobs(rows):
    seen = set()
    jobs = []
    for row in rows:
        job_id = str(row.get("job_id") or "").strip()
        address = str(row.get("address") or "").strip()
        if not job_id or not address or job_id in seen:
            continue
        seen.add(job_id)
        jobs.append({"job_id": job_id, "address": address})
    return jobs


def get_board_relevant_jobs(limit):
    today = phoenix_today()
    end = today + timedelta(days=14)
    start_str = today.strftime("%Y-%m-%d") + " 00:00:00"
    end_str = end.strftime("%Y-%m-%d") + " 00:00:00"

    event_path = (
        "calendar_events"
        "?select=job_id,start_date"
        "&category=eq.sales"
        f"&start_date=gte.{urllib.parse.quote(start_str, safe=':')}"
        f"&start_date=lt.{urllib.parse.quote(end_str, safe=':')}"
        "&job_id=not.is.null"
        "&order=start_date.asc"
    )
    events, _ = sb_fetch(event_path)
    job_ids = []
    seen = set()
    for event in events:
        job_id = str(event.get("job_id") or "").strip()
        if job_id and job_id not in seen:
            seen.add(job_id)
            job_ids.append(job_id)
    if not job_ids:
        return []

    jobs = []
    for i in range(0, len(job_ids), 100):
        chunk = ",".join(job_ids[i:i + 100])
        jobs_path = (
            "jobs"
            "?select=job_id,address"
            "&deleted_at=is.null"
            "&address=not.is.null"
            "&latitude=is.null"
            f"&job_id=in.({chunk})"
        )
        rows, _ = sb_fetch(jobs_path)
        jobs.extend(unique_jobs(rows))
        if len(jobs) >= limit:
            break

    order = {job_id: idx for idx, job_id in enumerate(job_ids)}
    jobs.sort(key=lambda job: order.get(job["job_id"], len(order)))
    return jobs[:limit]


def get_backlog_jobs(limit, exclude_job_ids):
    if limit <= 0:
        return []

    rows, _ = sb_fetch(
        "jobs"
        "?select=job_id,address"
        "&deleted_at=is.null"
        "&address=not.is.null"
        "&latitude=is.null"
        "&order=job_id.asc"
        f"&limit={limit + len(exclude_job_ids)}"
    )

    jobs = []
    for job in unique_jobs(rows):
        if job["job_id"] in exclude_job_ids:
            continue
        jobs.append(job)
        if len(jobs) >= limit:
            break
    return jobs


def get_remaining_estimate():
    _, content_range = sb_fetch(
        "jobs"
        "?select=job_id"
        "&deleted_at=is.null"
        "&address=not.is.null"
        "&latitude=is.null"
        "&limit=1",
        count=True,
    )
    return parse_total(content_range)


def run_sweep(batch_size):
    if not SUPABASE_KEY:
        return {"error": "KPI_SUPABASE_ANON_KEY not configured"}, 500

    board_jobs = get_board_relevant_jobs(batch_size)
    selected = list(board_jobs)
    exclude = {job["job_id"] for job in selected}
    selected.extend(get_backlog_jobs(batch_size - len(selected), exclude))

    filled = 0
    skipped_nogeo = 0
    errors = 0

    for idx, job in enumerate(selected):
        if idx > 0:
            time.sleep(1.1)
        try:
            coords = geocode_address(job["address"])
            if not coords:
                skipped_nogeo += 1
                continue
            try:
                sb_post_rpc("fill_job_coords", {
                    "p_job_id": job["job_id"],
                    "p_lat": coords["lat"],
                    "p_lng": coords["lng"],
                })
                filled += 1
            except Exception as e:
                errors += 1
                print(f"fill_job_coords failed for {job['job_id']}: {e}")
        except Exception as e:
            errors += 1
            print(f"geocode failed for {job['job_id']}: {e}")

    try:
        remaining_estimate = get_remaining_estimate()
    except Exception as e:
        remaining_estimate = None
        errors += 1
        print(f"remaining estimate failed: {e}")

    return {
        "swept": len(selected),
        "filled": filled,
        "skipped_nogeo": skipped_nogeo,
        "errors": errors,
        "remaining_estimate": remaining_estimate,
    }, 200


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        auth = self.headers.get("Authorization", "")
        if not CRON_SECRET or auth != f"Bearer {CRON_SECRET}":
            json_response(self, 401, {"error": "Unauthorized"})
            return

        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        try:
            batch_size = int(params.get("limit", [DEFAULT_BATCH_SIZE])[0])
        except ValueError:
            batch_size = DEFAULT_BATCH_SIZE
        batch_size = max(1, min(batch_size, MAX_BATCH_SIZE))

        try:
            data, status = run_sweep(batch_size)
        except Exception as e:
            data, status = {
                "swept": 0,
                "filled": 0,
                "skipped_nogeo": 0,
                "errors": 1,
                "remaining_estimate": None,
                "error": str(e),
            }, 200

        json_response(self, status, data)

    def do_POST(self):
        self.do_GET()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
