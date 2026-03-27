"""
Vercel serverless geocoding proxy.
Primary: Nominatim (with email for priority routing).
Fallback: Photon (if Nominatim returns 429).
Transforms all responses to Nominatim format for client compatibility.
"""

import json
import urllib.request
import urllib.parse
from http.server import BaseHTTPRequestHandler

USER_AGENT = "RepRoutePlanner/1.0 (travis@arizonaroofers.com)"
EMAIL = "travis@arizonaroofers.com"


def query_nominatim(q):
    """Query Nominatim with proper identification."""
    url = (
        f"https://nominatim.openstreetmap.org/search"
        f"?q={urllib.parse.quote(q)}&format=json&limit=1"
        f"&email={urllib.parse.quote(EMAIL)}"
    )
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read())


def query_photon(q):
    """Query Photon and transform to Nominatim format."""
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


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        from urllib.parse import urlparse, parse_qs
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)

        q = params.get("q", [None])[0]
        if not q:
            self._json_response(400, {"error": "Missing ?q= parameter"})
            return

        # Try Nominatim first, fall back to Photon on 429/503
        try:
            data = query_nominatim(q)
            self._json_response(200, data, cache=True)
            return
        except urllib.error.HTTPError as e:
            if e.code in (429, 503):
                # Nominatim rate-limited, try Photon
                try:
                    data = query_photon(q)
                    self._json_response(200, data, cache=True)
                    return
                except Exception as e2:
                    self._json_response(502, {"error": f"Both services failed. Photon: {e2}"})
                    return
            self._json_response(e.code, {"error": f"Nominatim returned {e.code}"})
        except Exception as e:
            # Network error on Nominatim, try Photon
            try:
                data = query_photon(q)
                self._json_response(200, data, cache=True)
            except Exception as e2:
                self._json_response(502, {"error": f"Both services failed: {e}, {e2}"})

    def _json_response(self, status, data, cache=False):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        if cache:
            self.send_header("Cache-Control", "public, max-age=86400")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
