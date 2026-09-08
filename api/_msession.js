/**
 * Access rule for the /m/ phone page (door-knocker day view + adjuster queue).
 *
 * A signed-in scheduler session (see _session.js: Google ID token -> HS256 session JWT, email
 * already limited to ALLOWED_EMAILS domains) is additionally required to be one of:
 *   - an address in M_ALLOWED_EMAILS (comma list, full addresses or @domain), or
 *   - a full address listed in ALLOWED_EMAILS (Travis), or
 *   - a person on the roster (KPI Supabase `teams`, Active) whose department is Management /
 *     Manager / Insurance, or who is Michael Hurff — matched by Google display name, or by an
 *     email local part shaped like first.last / firstlast.
 * Roster-driven so new managers / insurance hires need no code change; the env list is the
 * override for people whose Google name doesn't match the roster.
 */
import { requireSession } from './_session.js';

const SUPABASE_URL = (process.env.KPI_SUPABASE_URL || 'https://ucfqgkbkxbztxlyniuph.supabase.co').replace(/\/$/, '');
const KEY = process.env.KPI_SUPABASE_ANON_KEY || process.env.KPI_SUPABASE_SERVICE_KEY || '';
const M_ALLOWED = (process.env.M_ALLOWED_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const ALLOWED_FULL = (process.env.ALLOWED_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(s => s && !s.startsWith('@'));
const DEPTS = ['management', 'manager', 'insurance'];
const ALWAYS = ['michael hurff'];

const norm = s => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
let rosterCache = { at: 0, names: [] };

async function rosterNames() {
  if (Date.now() - rosterCache.at < 5 * 60e3) return rosterCache.names;
  const names = new Set(ALWAYS.map(norm));
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/teams?select=name,department,status`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
    if (r.ok) for (const row of await r.json()) {
      const active = !row.status || /active/i.test(String(row.status));
      if (active && DEPTS.includes(String(row.department || '').toLowerCase())) names.add(norm(row.name));
    }
  } catch (e) { /* keep whatever we had */ }
  rosterCache = { at: Date.now(), names: [...names] };
  return rosterCache.names;
}

export async function mAllowed(email, name) {
  const e = String(email || '').toLowerCase();
  if (!e) return false;
  if (M_ALLOWED.some(x => x.startsWith('@') ? e.endsWith(x) : e === x)) return true;
  if (ALLOWED_FULL.includes(e)) return true;
  const names = await rosterNames();
  const byName = norm(name);
  const local = norm(e.split('@')[0]);
  return names.some(n => n && (n === byName || n === local));
}

/** Session for /m/: null when missing/invalid/not permitted. auth_disabled passes through. */
export async function requireM(req) {
  const s = requireSession(req);
  if (!s) return null;
  if (s.auth_disabled) return s;
  return (await mAllowed(s.email, s.name)) ? s : null;
}
