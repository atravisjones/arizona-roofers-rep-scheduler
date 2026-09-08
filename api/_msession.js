/**
 * Access rule for the Insurance Tracker page (/insurance-tracker/).
 *
 * A signed-in scheduler session (see _session.js: Google ID token -> HS256 session JWT, email
 * already limited to ALLOWED_EMAILS domains) must ALSO be one of:
 *   - an address in M_ALLOWED_EMAILS (comma list, full addresses or @domain), or
 *   - a full address listed in ALLOWED_EMAILS (Travis), or
 *   - a person on the company roster sheet ("Add To Team Roster" tab, Status = Active) whose
 *     Company Email or Personal Email matches, and who is either
 *       • Team = Office in Administration / Lead Center / Insurance / Production / Manager /
 *         Management, or
 *       • Michael Hurff (D2D door knocker the page was built for).
 * The sheet is read with the service account (GOOGLE_SERVICE_ACCOUNT_JSON, base64 JSON — same
 * as roofr-appointments.py) and cached 5 minutes. If the sheet can't be read, fall back to the
 * Supabase roster copy (teams / rep_profiles) matched by NAME so a Sheets outage never locks
 * everybody out.
 */
import crypto from 'crypto';
import { requireSession } from './_session.js';

const SUPABASE_URL = (process.env.KPI_SUPABASE_URL || 'https://ucfqgkbkxbztxlyniuph.supabase.co').replace(/\/$/, '');
const KEY = process.env.KPI_SUPABASE_ANON_KEY || process.env.KPI_SUPABASE_SERVICE_KEY || '';
const M_ALLOWED = (process.env.M_ALLOWED_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const ALLOWED_FULL = (process.env.ALLOWED_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(s => s && !s.startsWith('@'));
const ROSTER_SHEET_ID = process.env.TEAM_ROSTER_SHEET_ID || '1XFJHD0IVZ8sJrQ7H2CrqU26a6n-FulPM8ABKc1hrh9o';
const ROSTER_TAB = 'Add To Team Roster';
const OFFICE_DEPTS = ['administration', 'lead center', 'insurance', 'production', 'manager', 'management'];
const ALWAYS_NAMES = ['michael hurff'];

const norm = s => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
const lower = s => String(s || '').trim().toLowerCase();

// ---- Google Sheets via service account (no SDK: RS256 JWT -> access token -> values.get) ----
let tokenCache = { at: 0, token: '' };
async function saToken() {
  if (Date.now() - tokenCache.at < 45 * 60e3 && tokenCache.token) return tokenCache.token;
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '';
  if (!raw) throw new Error('no service account');
  const sa = JSON.parse(raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets.readonly', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
  const sig = crypto.sign('RSA-SHA256', Buffer.from(unsigned), sa.private_key).toString('base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${unsigned}.${sig}` });
  if (!r.ok) throw new Error(`token ${r.status}`);
  const d = await r.json();
  tokenCache = { at: Date.now(), token: d.access_token };
  return d.access_token;
}

// { emails: Set<string>, names: Set<normName> } of people allowed by the sheet
let sheetCache = { at: 0, data: null };
async function sheetAllowed() {
  if (sheetCache.data && Date.now() - sheetCache.at < 5 * 60e3) return sheetCache.data;
  const token = await saToken();
  const range = encodeURIComponent(`${ROSTER_TAB}!A:I`);
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${ROSTER_SHEET_ID}/values/${range}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`sheets ${r.status}`);
  const rows = (await r.json()).values || [];
  const head = (rows[0] || []).map(h => lower(h));
  const col = (name, fallback) => { const i = head.findIndex(h => h === lower(name)); return i >= 0 ? i : fallback; };
  const cStatus = 0, cTeam = col('team', 1), cDept = col('department', 2), cName = col('name', 4), cEmail = col('company email', 7), cPersonal = col('personal email', 8);
  const emails = new Set(), names = new Set();
  for (const row of rows.slice(1)) {
    if (lower(row[cStatus]) !== 'active') continue;
    const dept = lower(row[cDept]), team = lower(row[cTeam]), name = norm(row[cName]);
    const ok = ALWAYS_NAMES.map(norm).includes(name) || (team === 'office' && OFFICE_DEPTS.includes(dept));
    if (!ok) continue;
    for (const e of [row[cEmail], row[cPersonal]]) if (lower(e).includes('@')) emails.add(lower(e));
    if (name) names.add(name);
  }
  sheetCache = { at: Date.now(), data: { emails, names } };
  return sheetCache.data;
}

// Fallback: Supabase copies of the roster, by name only (they carry no emails).
let sbCache = { at: 0, names: [] };
async function supabaseNames() {
  if (Date.now() - sbCache.at < 5 * 60e3 && sbCache.names.length) return sbCache.names;
  const names = new Set(ALWAYS_NAMES.map(norm));
  const h = { apikey: KEY, Authorization: `Bearer ${KEY}` };
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/teams?select=name,department,status`, { headers: h });
    if (r.ok) for (const row of await r.json()) {
      if ((!row.status || /active/i.test(row.status)) && OFFICE_DEPTS.includes(lower(row.department))) names.add(norm(row.name));
    }
  } catch (e) { /* ignore */ }
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rep_profiles?select=display_name,section&active=eq.true`, { headers: h });
    if (r.ok) for (const row of await r.json()) if (OFFICE_DEPTS.includes(lower(row.section))) names.add(norm(row.display_name));
  } catch (e) { /* ignore */ }
  sbCache = { at: Date.now(), names: [...names] };
  return sbCache.names;
}

export async function mAllowed(email, name) {
  const e = lower(email);
  if (!e) return false;
  if (M_ALLOWED.some(x => x.startsWith('@') ? e.endsWith(x) : e === x)) return true;
  if (ALLOWED_FULL.includes(e)) return true;
  try {
    const { emails, names } = await sheetAllowed();
    if (emails.has(e)) return true;
    const n = norm(name);
    return !!n && names.has(n);
  } catch (err) {
    console.error('roster sheet unavailable, name fallback:', err.message);
    const names = await supabaseNames();
    const n = norm(name), local = norm(e.split('@')[0]);
    return names.some(x => x && (x === n || x === local));
  }
}

/** Health for GET /api/m-auth: can we read the roster sheet right now? (no PII) */
export async function rosterHealth() {
  try { const d = await sheetAllowed(); return { roster: 'sheet', people: d.emails.size }; }
  catch (err) { return { roster: 'fallback', error: err.message }; }
}

/** Session for the tracker: null when missing/invalid/not permitted. auth_disabled passes through. */
export async function requireM(req) {
  const s = requireSession(req);
  if (!s) return null;
  if (s.auth_disabled) return s;
  return (await mAllowed(s.email, s.name)) ? s : null;
}
