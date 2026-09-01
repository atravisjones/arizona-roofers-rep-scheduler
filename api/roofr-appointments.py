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


EXCLUDED_TITLE_PREFIXES = ("D2D Sales appointment",)

# Roofr event subtypes (calendar_events.event_subtype) we treat specially.
# D2D never belongs on this board; self-gen + followup pin to their rep.
EXCLUDED_SUBTYPES = ("D2D Sales appointment",)
SELF_GEN_SUBTYPE = "Self-gen appointment"
FOLLOWUP_SUBTYPE = "Sales followup"
# Adjuster meetings live under category='general'. One pins to a sales rep's
# column ONLY when that rep is explicitly tagged as an attendee — insurance
# staff attendees are ignored, and the job owner is never used as a fallback
# (on Insurance jobs the owner is an insurance rep, not the tagged sales rep).
ADJUSTER_SUBTYPE = "Adjuster meeting"


def is_excluded_title(title):
    t = (title or "").strip()
    return any(t.startswith(p) for p in EXCLUDED_TITLE_PREFIXES)


def is_excluded_subtype(subtype):
    return (subtype or "").strip() in EXCLUDED_SUBTYPES


def classify_kind(subtype):
    """Map a Roofr event subtype to a board 'kind'. self_gen/followup pin."""
    s = (subtype or "").strip()
    if s == SELF_GEN_SUBTYPE:
        return "self_gen"
    if s == FOLLOWUP_SUBTYPE:
        return "followup"
    return "sales"


def sb_fetch(path, timeout=8):
    """Fetch from Supabase REST API."""
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    req = urllib.request.Request(url, headers={
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    })
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


# Roofr numeric user ID -> rep name. This is the PRIMARY way an appointment is
# pinned to a column: the attendee tagged on the calendar event is the rep running
# it, and resolve_attendees() only falls back to jobs.job_owner for unmapped ids.
# So a missing entry here silently files that rep's appointments under whoever
# owns the job — usually the CSR who booked it.
#
# Values mirror the exact jobs.job_owner string for that rep (including its odd
# casing) so downstream name-matching behaves identically to the job-linked path.
#
# Regenerate the candidate list with:
#   SELECT ce.attendees AS uid, mode() WITHIN GROUP (ORDER BY j.job_owner) AS rep
#   FROM calendar_events ce JOIN jobs j ON j.job_id = ce.job_id
#   WHERE ce.category='sales' AND ce.attendees ~ '^[0-9]+$'
#     AND j.job_owner <> '' AND ce.start_date >= '<recent>'
#   GROUP BY ce.attendees HAVING count(*) >= 2;
# ...but do NOT trust that output on its own — it is a popularity heuristic and it
# has misattributed a user before (see 372086 below). Confirm each id against the
# attendee email on a real event before adding it:
#   GET /api/calendar/event/<event_id>  ->  attendees[].email
REP_BY_USER_ID = {
    "355304": "Ashkan Etemadi",
    "352704": "Bradley Crohurst",
    # 372086 is Brenda Ochoa (office/insurance), NOT Brandon Cook — the mode()
    # heuristic misattributed her because she's tagged on many events. Verified
    # against the Roofr roster (tools/production-map/roofr-users.json) 2026-07-07.
    # Deliberately unmapped so she never resolves to a rep column.
    "400700": "Brandon Cook",
    # Confirmed 2026-09-01 via the owner<->attendee correlation: sole attendee on
    # job 11005176, whose job_owner reads "Carson Anderson"; Active, D2D Sales.
    "536907": "Carson Anderson",
    "416699": "Chandler Duffy",
    "568255": "Chris Diamond",
    "356679": "Christian Noren",
    "568245": "Claude Springer",
    "354859": "Cole Ludewig",
    "500123": "Connor Hamby",
    # Hunter Fairfield is classified CSR by the roster, so his appointments still
    # land in the CSR rail — mapped anyway so they attach to him rather than to
    # whoever happens to own the job.
    "568859": "Hunter Fairfield",
    "596692": "Irving Lopez",
    "497732": "James Chernek",
    "441144": "Jonathan Marino",
    "522189": "Josh Jewett",
    "355180": "Justin Parker",
    "512700": "KORY DUMONE",
    "373987": "London smith",
    "352971": "Nick Williams",
    "407608": "Oliver Johnson",
    "472015": "Orlando Chavarria",
    "594358": "Preston Burt",
    "355065": "Richard Hadsall",
    "592399": "Ryan Tempel",
    "525242": "Stephen Chaidez",
    "482761": "Tanner Broadbent",
    "594355": "Troy Emerson",
    "451106": "William Ludewig",
}


def resolve_attendees(raw_attendees, job_owner):
    """Resolve attendee IDs to names.

    Supabase calendar_events stores numeric Roofr user IDs (e.g. '472015')
    instead of names. The tagged attendee is the rep actually running the
    appointment; job_owner is only a proxy for it and goes stale whenever a CSR
    or manager still owns the job. So resolve through REP_BY_USER_ID FIRST and
    fall back to job_owner only when the id isn't mapped.

    Only a single-attendee event overrides the owner. A multi-rep event has no
    one right column, and the frontend renders whatever string it gets as the
    column name (getRepName in TodayBoard.tsx), so joining names there would
    invent a "Rep A, Rep B" column — keep deferring to job_owner for those.
    """
    if not raw_attendees:
        return job_owner or ""
    parts = [p.strip() for p in str(raw_attendees).split(",") if p.strip()]
    if all(p.isdigit() for p in parts):
        mapped = [REP_BY_USER_ID.get(p) for p in parts]
        mapped = list(dict.fromkeys(m for m in mapped if m))  # dedupe, preserve order
        if len(mapped) == 1:
            return mapped[0]
        if job_owner:
            return job_owner
        if mapped:
            return ", ".join(mapped)
        return ""
    return raw_attendees


def resolve_board_rep_names(raw_attendees):
    """Strictly resolve attendee IDs to known sales-rep names via REP_BY_USER_ID.

    Used for adjuster meetings: unknown IDs (insurance staff, office) are
    dropped so a meeting only pins to reps explicitly tagged on it. Returns a
    deduped list, order preserved. No job_owner fallback on purpose.
    """
    parts = [p.strip() for p in str(raw_attendees or "").split(",") if p.strip()]
    names = [REP_BY_USER_ID[p] for p in parts if p in REP_BY_USER_ID]
    return list(dict.fromkeys(names))


def get_from_supabase(date_str):
    """Primary: fetch from Supabase."""
    dt = datetime.strptime(date_str, "%Y-%m-%d")
    next_day = (dt + timedelta(days=1)).strftime("%Y-%m-%d")

    cal_path = (
        f"calendar_events"
        f"?select=event_id,job_id,title,start_date,end_date,all_day,category,attendees,event_subtype"
        f"&category=eq.sales"
        f"&start_date=gte.{quote(date_str + ' 00:00:00', safe=':')}"
        f"&start_date=lt.{quote(next_day + ' 00:00:00', safe=':')}"
        f"&order=start_date.asc"
    )
    events = sb_fetch(cal_path)
    events = [e for e in events if not is_excluded_title(e.get("title"))]
    # D2D never belongs on this board — exclude by subtype (robust vs. title prefix,
    # which misses D2D events that carry a normal address title).
    events = [e for e in events if not is_excluded_subtype(e.get("event_subtype"))]

    # Adjuster meetings (category='general') — kept only when a known sales rep
    # is tagged as an attendee; everyone else at the meeting is ignored.
    adj_path = (
        f"calendar_events"
        f"?select=event_id,job_id,title,start_date,end_date,all_day,category,attendees,event_subtype"
        f"&event_subtype=eq.{quote(ADJUSTER_SUBTYPE)}"
        f"&start_date=gte.{quote(date_str + ' 00:00:00', safe=':')}"
        f"&start_date=lt.{quote(next_day + ' 00:00:00', safe=':')}"
        f"&order=start_date.asc"
    )
    adjuster_events = [e for e in sb_fetch(adj_path) if resolve_board_rep_names(e.get("attendees"))]

    if not events and not adjuster_events:
        return []

    job_ids = list({str(e["job_id"]) for e in (events + adjuster_events) if e.get("job_id")})
    jobs_map = {}
    if job_ids:
        ids_list = ",".join(job_ids)
        jobs = sb_fetch(f"jobs?select=job_id,customer,name,address,job_owner,workflow,tags,phone,email,lead_source,appt_booker,latitude,longitude&job_id=in.({ids_list})")
        for j in jobs:
            jobs_map[str(j["job_id"])] = j

    appointments = []
    for evt in events:
        job = jobs_map.get(str(evt.get("job_id", "")), {})
        job_owner = job.get("job_owner", "")
        subtype = evt.get("event_subtype", "") or ""
        kind = classify_kind(subtype)
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
            "eventSubtype": subtype,
            "kind": kind,
            "pinned": kind in ("self_gen", "followup"),
            "attendees": resolve_attendees(evt.get("attendees", ""), job_owner),
            "customerName": job.get("customer") or job.get("name", ""),
            "masterAddress": job.get("address", ""),
            "jobOwner": job_owner,
            "workflow": job.get("workflow", ""),
            "tags": job.get("tags", "") or "",
            "phone": job.get("phone", "") or "",
            "email": job.get("email", "") or "",
            "leadSource": job.get("lead_source", "") or "",
            "bookingCsr": job.get("appt_booker", "") or "",
            "lat": job.get("latitude"),
            "lng": job.get("longitude"),
        })

    # Adjuster meetings: one row per tagged sales rep (so a two-rep meeting
    # blocks both columns). Roofr sometimes carries duplicate events for the
    # same meeting — dedupe on (job, start, rep). jobOwner is intentionally
    # blank: the frontend must never fall back to the insurance job owner.
    seen_adj = set()
    for evt in adjuster_events:
        job = jobs_map.get(str(evt.get("job_id", "")), {})
        title = evt.get("title", "") or ""
        address = job.get("address", "")
        if not address and ":" in title:
            # Titles look like "Adjuster meeting: 8939 W Maryland Ave, Glendale..."
            address = title.split(":", 1)[1].strip()
        for rep_name in resolve_board_rep_names(evt.get("attendees")):
            key = (str(evt.get("job_id") or title), evt.get("start_date"), rep_name)
            if key in seen_adj:
                continue
            seen_adj.add(key)
            appointments.append({
                "eventId": evt.get("event_id", ""),
                "jobId": evt.get("job_id", ""),
                "address": address,
                "title": title,
                "start": evt.get("start_date", ""),
                "end": evt.get("end_date", ""),
                "allDay": evt.get("all_day", False),
                "category": evt.get("category", ""),
                "type": "",
                "eventSubtype": evt.get("event_subtype", "") or "",
                "kind": "adjuster",
                "pinned": True,
                "attendees": rep_name,
                "customerName": job.get("customer") or job.get("name", ""),
                "masterAddress": job.get("address", ""),
                "jobOwner": "",
                "workflow": job.get("workflow", ""),
                "tags": job.get("tags", "") or "",
                "phone": job.get("phone", "") or "",
                "email": job.get("email", "") or "",
                "leadSource": job.get("lead_source", "") or "",
                "bookingCsr": job.get("appt_booker", "") or "",
                "lat": job.get("latitude"),
                "lng": job.get("longitude"),
            })

    appointments.sort(key=lambda a: a.get("start") or "")
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

        title = row[4] if len(row) > 4 else ""
        if is_excluded_title(title):
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
            # Sheets fallback can't read event_subtype — default to unpinned sales.
            "eventSubtype": "",
            "kind": "sales",
            "pinned": False,
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
