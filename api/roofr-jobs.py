"""
Vercel serverless function to fetch Roofr job IDs from the Apt Outcome Tracker.
Uses service account auth so the sheet doesn't need to be public.

Env var: GOOGLE_SERVICE_ACCOUNT_JSON (base64-encoded service account key)
"""

import json
import os
import base64
from http.server import BaseHTTPRequestHandler

import gspread
from google.oauth2.service_account import Credentials

SPREADSHEET_ID = "1Bw1Tug38f_cEkAN6V4XzlDT_lJf7UDMAUK0NjoBEtK0"
SHEET_NAME = "Master Sheet"
SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"]


def get_job_ids():
    sa_json = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON", "")
    if not sa_json:
        return {"error": "GOOGLE_SERVICE_ACCOUNT_JSON not configured"}, 500

    sa_info = json.loads(base64.b64decode(sa_json))
    creds = Credentials.from_service_account_info(sa_info, scopes=SCOPES)
    gc = gspread.authorize(creds)

    sheet = gc.open_by_key(SPREADSHEET_ID).worksheet(SHEET_NAME)

    # Column B = Address (col 2), Column O = Job ID (col 15)
    # Batch get both columns to minimize API calls
    addresses = sheet.col_values(2)  # Column B
    job_ids = sheet.col_values(15)   # Column O

    # Skip header row, build address -> jobId pairs
    result = []
    for i in range(1, max(len(addresses), len(job_ids))):
        addr = addresses[i] if i < len(addresses) else ""
        jid = job_ids[i] if i < len(job_ids) else ""
        if addr and jid:
            result.append([addr, jid])

    return {"values": result, "count": len(result)}, 200


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            data, status = get_job_ids()
        except Exception as e:
            data, status = {"error": str(e)}, 500

        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "public, max-age=300")  # 5 min cache
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.end_headers()
