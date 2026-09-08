/**
 * Adjuster meetings for the /m/ phone page calendar.
 *
 * GET /api/adjuster-days?rep=Michael%20Hurff&month=2026-09
 *   -> { counts: { "2026-09-02": 1, ... } }        meetings per day the rep is an attendee of
 * GET /api/adjuster-days?rep=Michael%20Hurff&date=2026-09-04
 *   -> { stops: [{ n, a, t, la, lo }] }             that day's meetings in the share-link shape
 *
 * Source: Supabase calendar_events (event_subtype = 'Adjuster meeting', attendees = comma list of
 * Roofr user ids) joined to jobs. Mirrors the door-knocker rule in api/roofr-appointments.py.
 */
import { requireM } from './_msession.js';

// Door knockers = active rep_profiles in the INSURANCE / D2D sections that carry a Roofr user id
// (the id is how calendar_events.attendees names them). Add a person there and they appear in the
// tracker's rep dropdown with their own calendar — no code change.
const norm = s => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
let repCache = { at: 0, reps: [] };
async function doorKnockers(SUPABASE_URL, headers) {
  if (Date.now() - repCache.at < 5 * 60e3 && repCache.reps.length) return repCache.reps;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rep_profiles?select=display_name,section,roofr_user_id,sort_order&active=eq.true&section=in.(INSURANCE,D2D)&roofr_user_id=not.is.null&order=sort_order.asc,display_name.asc`, { headers });
  const rows = r.ok ? await r.json() : [];
  repCache = { at: Date.now(), reps: rows.map(x => ({ name: x.display_name, uid: String(x.roofr_user_id), section: x.section })) };
  return repCache.reps;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, max-age=60');
  if (!(await requireM(req))) return res.status(401).json({ error: 'Sign in required' });
  const SUPABASE_URL = (process.env.KPI_SUPABASE_URL || 'https://ucfqgkbkxbztxlyniuph.supabase.co').replace(/\/$/, '');
  const KEY = process.env.KPI_SUPABASE_ANON_KEY || process.env.KPI_SUPABASE_SERVICE_KEY || '';
  if (!KEY) return res.status(500).json({ error: 'Server configuration error' });
  const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };

  const rep = String(req.query.rep || '').trim();
  const reps = await doorKnockers(SUPABASE_URL, headers);
  if (req.query.reps) return res.status(200).json({ reps });
  const uid = (reps.find(x => norm(x.name) === norm(rep)) || {}).uid || '';
  const month = String(req.query.month || '');
  const date = String(req.query.date || '');
  let from, to;
  if (/^\d{4}-\d{2}$/.test(month)) {
    const [y, m] = month.split('-').map(Number);
    from = `${month}-01`; to = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    from = date; to = new Date(Date.parse(date + 'T00:00:00Z') + 864e5).toISOString().slice(0, 10);
  } else return res.status(400).json({ error: 'month=YYYY-MM or date=YYYY-MM-DD required' });

  const mine = e => !uid || String(e.attendees || '').split(',').map(s => s.trim()).includes(uid);
  try {
    const url = `${SUPABASE_URL}/rest/v1/calendar_events?select=event_id,job_id,title,start_date,all_day,attendees&event_subtype=eq.${encodeURIComponent('Adjuster meeting')}&start_date=gte.${from}%2000:00:00&start_date=lt.${to}%2000:00:00&order=start_date.asc&limit=2000`;
    const r = await fetch(url, { headers });
    if (!r.ok) return res.status(502).json({ error: `Supabase ${r.status}` });
    const events = (await r.json()).filter(mine);

    if (month) {
      const counts = {};
      for (const e of events) { const k = String(e.start_date).slice(0, 10); counts[k] = (counts[k] || 0) + 1; }
      return res.status(200).json({ rep, counts });
    }

    const ids = [...new Set(events.map(e => String(e.job_id || '')).filter(Boolean))];
    const jobs = {};
    if (ids.length) {
      const jr = await fetch(`${SUPABASE_URL}/rest/v1/jobs?select=job_id,customer,name,address,latitude,longitude&job_id=in.(${ids.join(',')})`, { headers });
      if (jr.ok) for (const j of await jr.json()) jobs[String(j.job_id)] = j;
    }
    const timeLabel = s => {
      const m = /(\d{2}):(\d{2})/.exec(String(s).slice(11)); if (!m) return '';
      let h = Number(m[1]); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return `${h}:${m[2]} ${ap}`;
    };
    const stops = events.map(e => {
      const j = jobs[String(e.job_id)] || {};
      const addr = j.address || String(e.title || '').replace(/^Adjuster meeting:\s*/i, '');
      const la = j.latitude != null ? parseFloat(j.latitude) : null, lo = j.longitude != null ? parseFloat(j.longitude) : null;
      return { n: j.customer || j.name || 'Adjuster meeting', a: addr, t: e.all_day ? 'All day' : timeLabel(e.start_date), la: Number.isFinite(la) ? Number(la.toFixed(5)) : null, lo: Number.isFinite(lo) ? Number(lo.toFixed(5)) : null };
    });
    return res.status(200).json({ rep, date, stops });
  } catch (err) {
    console.error('adjuster-days error:', err);
    return res.status(502).json({ error: err.message });
  }
}
