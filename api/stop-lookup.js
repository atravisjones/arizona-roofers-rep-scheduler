/**
 * Resolve the appointments in a /m/ share link to Roofr jobs so the phone page can show a
 * phone number and a Roofr button per stop.
 *
 * POST /api/stop-lookup  body { stops: [{ n: customerName, a: address }] }
 *   -> { stops: [{ jobId, phone, phoneContact } | null] }   (index-aligned with the request)
 *
 * Match = street number + first street word of the address against jobs.address (ilike),
 * tie-broken by customer name. Same Supabase mirror the checks feed reads.
 */
import { fallbackPhone } from './insurance-checks.js';
import { requireM } from './_msession.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await requireM(req))) return res.status(401).json({ error: 'Sign in required' });
  const SUPABASE_URL = (process.env.KPI_SUPABASE_URL || 'https://ucfqgkbkxbztxlyniuph.supabase.co').replace(/\/$/, '');
  const KEY = process.env.KPI_SUPABASE_ANON_KEY || process.env.KPI_SUPABASE_SERVICE_KEY || '';
  if (!KEY) return res.status(500).json({ error: 'Server configuration error' });
  const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const stops = Array.isArray(body.stops) ? body.stops.slice(0, 30) : [];
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

  try {
    const out = await Promise.all(stops.map(async s => {
      const m = /^\s*(\d+)\s+([A-Za-z0-9]+)/.exec(String(s.a || ''));
      if (!m) return null;
      const pat = `${m[1]} ${m[2]}%`;
      const url = `${SUPABASE_URL}/rest/v1/jobs?select=job_id,name,address,phone,all_contacts&deleted_at=is.null&address=ilike.${encodeURIComponent(pat)}&order=created_at.desc&limit=10`;
      const r = await fetch(url, { headers });
      if (!r.ok) return null;
      const rows = await r.json();
      if (!rows.length) return null;
      const want = norm(s.n);
      const wantLast = want.split(' ').pop();
      const pick = rows.find(j => want && norm(j.name) === want)
        || rows.find(j => wantLast && norm(j.name).includes(wantLast))
        || rows[0];
      const fb = pick.phone ? { phone: '', name: '' } : fallbackPhone(pick.all_contacts);
      return { jobId: String(pick.job_id), phone: pick.phone || fb.phone || '', phoneContact: pick.phone ? '' : fb.name };
    }));
    return res.status(200).json({ stops: out });
  } catch (err) {
    console.error('stop-lookup error:', err);
    return res.status(502).json({ error: err.message });
  }
}
