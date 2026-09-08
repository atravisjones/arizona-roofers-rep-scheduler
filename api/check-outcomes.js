/**
 * Insurance check pickup outcomes (logged from the /m/ phone page).
 *
 * GET  /api/check-outcomes?days=30      -> { outcomes: [{ job_id, rep, date_key, outcome, created_at }] }
 * POST /api/check-outcomes              -> body { jobId, rep, date, outcome } ; outcome null clears that day
 *
 * Latest row per job+date wins. Uses the service key server-side; the table has no anon policy.
 */
import { requireM } from './_msession.js';

export default async function handler(req, res) {
  if (!(await requireM(req))) return res.status(401).json({ error: 'Sign in required' });
  const SUPABASE_URL = (process.env.KPI_SUPABASE_URL || 'https://ucfqgkbkxbztxlyniuph.supabase.co').replace(/\/$/, '');
  const KEY = process.env.KPI_SUPABASE_SERVICE_KEY || '';
  if (!KEY) return res.status(500).json({ error: 'Server configuration error' });
  const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
  const base = `${SUPABASE_URL}/rest/v1/insurance_check_outcomes`;
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  try {
    if (req.method === 'GET') {
      const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
      const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
      const r = await fetch(`${base}?select=job_id,rep,date_key,outcome,created_at&date_key=gte.${since}&order=created_at.desc&limit=2000`, { headers });
      if (!r.ok) return res.status(502).json({ error: `Supabase ${r.status}` });
      return res.status(200).json({ outcomes: await r.json() });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const jobId = String(body.jobId || '').trim();
      const rep = String(body.rep || '').trim().slice(0, 80);
      const date = String(body.date || '').trim();
      const outcome = body.outcome == null ? null : String(body.outcome);
      if (!jobId || !rep || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'jobId, rep, date required' });
      if (outcome != null && !['confirmed', 'declined', 'no_answer', 'picked_up'].includes(outcome)) return res.status(400).json({ error: 'bad outcome' });

      if (outcome == null) {
        const r = await fetch(`${base}?job_id=eq.${encodeURIComponent(jobId)}&date_key=eq.${date}&rep=eq.${encodeURIComponent(rep)}`, { method: 'DELETE', headers });
        if (!r.ok) return res.status(502).json({ error: `Supabase ${r.status}` });
        return res.status(200).json({ ok: true, cleared: true });
      }
      const r = await fetch(base, { method: 'POST', headers: { ...headers, Prefer: 'return=representation' }, body: JSON.stringify({ job_id: jobId, rep, date_key: date, outcome }) });
      if (!r.ok) return res.status(502).json({ error: `Supabase ${r.status}: ${await r.text()}` });
      const rows = await r.json();
      return res.status(200).json({ ok: true, row: rows[0] });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('check-outcomes error:', err);
    return res.status(502).json({ error: err.message });
  }
}
