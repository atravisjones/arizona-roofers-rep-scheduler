/**
 * Roofr job-card tasks — READ-ONLY live read-through.
 *
 * GET /api/roofr-tasks?job_id=NNN
 *   → { found, tasks: [{ title, done, assignee }] }
 *
 * Borrows the synced Roofr session (KPI Supabase `auth_sessions` row
 * `roofr-main`, maintained by roofr-sync) to call Roofr's
 * GET /api/job/{id}/tasks. Approved by Travis 2026-08-27 on the explicit
 * condition that NOTHING writes back: this endpoint never updates
 * auth_sessions and never sends anything but GETs to Roofr. Request headers
 * mirror roofr-sync's proven consumer (backfill_all_contacts.build_cached_session)
 * so we look identical to the established traffic.
 *
 * Env: KPI_SUPABASE_SERVICE_KEY (anon can't read auth_sessions),
 *      KPI_SUPABASE_URL (optional, defaults to the KPI project).
 */
const SUPABASE_URL = (process.env.KPI_SUPABASE_URL || 'https://ucfqgkbkxbztxlyniuph.supabase.co').replace(/\/$/, '');
const SERVICE_KEY = (process.env.KPI_SUPABASE_SERVICE_KEY || '').trim();
const TEAM_ID = '239329';

export default async function handler(req, res) {
  // Short CDN cache: a card re-opened within 5 minutes doesn't re-hit Roofr.
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=900');
  if (req.method !== 'GET') return res.status(405).json({ found: false, reason: 'method' });
  if (!SERVICE_KEY) return res.status(200).json({ found: false, reason: 'not_configured' });
  const jobId = String((req.query && req.query.job_id) || '').replace(/\D/g, '');
  if (!jobId) return res.status(400).json({ found: false, reason: 'missing_job_id' });

  try {
    const sessResp = await fetch(
      `${SUPABASE_URL}/rest/v1/auth_sessions?id=eq.roofr-main&select=cookies,xsrf_token`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
    );
    const rows = await sessResp.json();
    const sess = Array.isArray(rows) && rows[0];
    if (!sess || !sess.cookies) return res.status(200).json({ found: false, reason: 'no_session' });

    const cookieList = typeof sess.cookies === 'string' ? JSON.parse(sess.cookies) : sess.cookies;
    const cookieHeader = (cookieList || [])
      .filter((c) => c && c.name && (c.domain || '').includes('roofr'))
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');
    if (!cookieHeader) return res.status(200).json({ found: false, reason: 'empty_cookies' });

    const roofr = await fetch(`https://app.roofr.com/api/job/${jobId}/tasks`, {
      headers: {
        cookie: cookieHeader,
        'x-xsrf-token': decodeURIComponent(sess.xsrf_token || ''),
        'team-id': TEAM_ID,
        'x-requested-with': 'XMLHttpRequest',
        accept: 'application/json',
        referer: `https://app.roofr.com/dashboard/team/${TEAM_ID}/jobs/list-view`,
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      },
    });
    if (!roofr.ok) return res.status(200).json({ found: false, reason: `roofr_${roofr.status}` });

    const body = await roofr.json();
    const tasks = (Array.isArray(body.data) ? body.data : [])
      .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
      .map((t) => ({
        title: String(t.title || '').trim(),
        done: t.status === 'complete',
        assignee: t.assignee && t.assignee.name ? t.assignee.name : null,
      }));
    return res.status(200).json({ found: true, tasks });
  } catch (err) {
    return res.status(200).json({ found: false, reason: 'error', error: String((err && err.message) || err) });
  }
}
