"""
Vercel serverless function to fetch sales appointments.
Primary: Supabase (calendar_events + jobs tables).
Fallback: Google Sheets (Calendar Events + Master Sheet) if Supabase times out.

Env vars: KPI_SUPABASE_URL, KPI_SUPABASE_ANON_KEY, GOOGLE_SERVICE_ACCOUNT_JSON
Query param: date (YYYY-MM-DD)
"""

import json
import os
import base64
import urllib.request
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, quote

SUPABASE_URL = os.environ.get("KPI_SUPABASE_URL", "https://ucfqgkbkxbztxlyniuph.supabase.co")
SUPABASE_KEY = os.environ.get("KPI_SUPABASE_ANON_KEY", "")


def sb_fetch(path, timeout=8):
    """Fetch from Supabase REST API."""
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    req = urllib.request.Request(url, headers={
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    })
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


def resolve_attendees(raw_attendees, job_owner):
    """Resolve attendee IDs to names.

    Supabase calendar_events stores numeric Roofr user IDs (e.g. '472015')
    instead of names. If all parts are numeric, fall back to job_owner.
    """
    if not raw_attendees:
        return job_owner or ""
    parts = [p.strip() for p in str(raw_attendees).split(",") if p.strip()]
    if all(p.isdigit() for p in parts):
        # All numeric IDs — use job_owner as the attendee name
        return job_owner or ""
    return raw_attendees


def get_from_supabase(date_str):
    """Primary: fetch from Supabase."""
    dt = datetime.strptime(date_str, "%Y-%m-%d")
    next_day = (dt + timedelta(days=1)).strftime("%Y-%m-%d")

    cal_path = (
        f"calendar_events"
        f"?select=event_id,job_id,title,start_date,end_date,all_day,category,attendees"
        f"&category=eq.sales"
        f"&start_date=gte.{quote(date_str + ' 00:00:00', safe=':')}"
        f"&start_date=lt.{quote(next_day + ' 00:00:00', safe=':')}"
        f"&order=start_date.asc"
    )
    events = sb_fetch(cal_path)

    if not events:
        return []

    job_ids = list({str(e["job_id"]) for e in events if e.get("job_id")})
    jobs_map = {}
    if job_ids:
        ids_list = ",".join(job_ids)
        jobs = sb_fetch(f"jobs?select=job_id,customer,name,address,job_owner,workflow,tags&job_id=in.({ids_list})")
        for j in jobs:
            jobs_map[str(j["job_id"])] = j

    appointments = []
    for evt in events:
        job = jobs_map.get(str(evt.get("job_id", "")), {})
        job_owner = job.get("job_owner", "")
        appointments.append({
            "eventId": evt.get("event_id", ""),
            "jobId": evt.get("job_id", ""),
            "address": job.get("address", ""),
            "title": evt.get("title", ""),
            "start": evt.get("start_date", ""),
            "end": evt.get("end_date", ""),
            "allDay": evt.get("all_day", False),
            "category": evt.get("category", ""),
            "type": "",
            "attendees": resolve_attendees(evt.get("attendees", ""), job_owner),
            "customerName": job.get("customer") or job.get("name", ""),
            "masterAddress": job.get("address", ""),
            "jobOwner": job_owner,
            "workflow": job.get("workflow", ""),
            "tags": job.get("tags", "") or "",
        })

    return appointments


def get_from_sheets(date_str):
    """Fallback: fetch from Google Sheets."""
    import gspread
    from google.oauth2.service_account import Credentials

    sa_json = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON", "")
    if not sa_json:
        return None  # Can't fall back

    sa_info = json.loads(base64.b64decode(sa_json))
    creds = Credentials.from_service_account_info(sa_info,
        scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"])
    gc = gspread.authorize(creds)

    spreadsheet = gc.open_by_key("1Bw1Tug38f_cEkAN6V4XzlDT_lJf7UDMAUK0NjoBEtK0")

    # Calendar Events: A=EventID, B=JobID, C=JobCard, D=Address,
    # E=Title, F=Start, G=End, H=AllDay, I=Category, J=Type, K=Attendees
    cal_rows = spreadsheet.worksheet("Calendar Events").get('A:K')
    if len(cal_rows) < 2:
        return []

    filtered = []
    job_ids_needed = set()

    for row in cal_rows[1:]:
        if len(row) < 6:
            continue
        start = row[5] if len(row) > 5 else ""
        category = row[8] if len(row) > 8 else ""

        # Date match
        is_match = False
        if start:
            if start.startswith(date_str):
                is_match = True
            else:
                try:
                    date_part = start.split(' ')[0]
                    if '/' in date_part:
                        m, d, y = date_part.split('/')
                        if f"{y}-{int(m):02d}-{int(d):02d}" == date_str:
                            is_match = True
                except:
                    pass

        if not is_match:
            continue
        # Accept "sales" or empty category (sheet often has blank category for valid sales events)
        cat = category.strip().lower()
        if cat and cat != "sales":
            continue

        job_id = row[1] if len(row) > 1 else ""
        filtered.append({
            "eventId": row[0] if len(row) > 0 else "",
            "jobId": job_id,
            "address": row[3] if len(row) > 3 else "",
            "title": row[4] if len(row) > 4 else "",
            "start": start,
            "end": row[6] if len(row) > 6 else "",
            "allDay": row[7] if len(row) > 7 else "",
            "category": category,
            "type": row[9] if len(row) > 9 else "",
            "attendees": row[10] if len(row) > 10 else "",
        })
        if job_id:
            job_ids_needed.add(job_id)

    # Enrich from Master Sheet
    master_data = {}
    if job_ids_needed:
        ms = spreadsheet.worksheet("Master Sheet")
        ranges = [f"'Master Sheet'!{c}2:{c}" for c in ['A', 'B', 'E', 'F', 'O', 'S']]
        results = spreadsheet.values_batch_get(ranges)
        vr = results.get('valueRanges', [])
        def col(idx):
            return [v[0] if v else '' for v in vr[idx].get('values', [])] if idx < len(vr) else []

        customers, addresses, owners, workflows, jids, tags = col(0), col(1), col(2), col(3), col(4), col(5)
        for i in range(len(jids)):
            jid = jids[i] if i < len(jids) else ""
            if jid in job_ids_needed:
                master_data[jid] = {
                    "customerName": customers[i] if i < len(customers) else "",
                    "masterAddress": addresses[i] if i < len(addresses) else "",
                    "jobOwner": owners[i] if i < len(owners) else "",
                    "workflow": workflows[i] if i < len(workflows) else "",
                    "tags": tags[i] if i < len(tags) else "",
                }

    appointments = []
    for event in filtered:
        e = master_data.get(event["jobId"], {})
        appointments.append({
            **event,
            "customerName": e.get("customerName", ""),
            "masterAddress": e.get("masterAddress", ""),
            "jobOwner": e.get("jobOwner", ""),
            "workflow": e.get("workflow", ""),
            "tags": e.get("tags", ""),
        })

    return appointments


def get_appointments(date_str):
    if not date_str:
        return {"error": "date query parameter is required (YYYY-MM-DD)"}, 400

    source = "supabase"
    appointments = None

    # Try Supabase first
    if SUPABASE_KEY:
        try:
            appointments = get_from_supabase(date_str)
        except Exception as e:
            print(f"Supabase failed, falling back to Sheets: {e}")

    # Fallback to Google Sheets
    if appointments is None:
        source = "sheets"
        try:
            appointments = get_from_sheets(date_str)
        except Exception as e:
            return {"error": f"Both sources failed. Sheets: {e}"}, 500

    if appointments is None:
        return {"error": "No data source available"}, 500

    return {"appointments": appointments, "count": len(appointments), "source": source}, 200


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            parsed = urlparse(self.path)
            params = parse_qs(parsed.query)
            date_str = params.get("date", [None])[0]
            data, status = get_appointments(date_str)
        except Exception as e:
            data, status = {"error": str(e)}, 500

        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "public, max-age=120")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.end_headers()
