/**
 * Insurance checks endpoint - every job currently sitting in "INS: Collect ACV"
 * (the homeowner is holding an insurance check we need to pick up) plus
 * "Ins: ACV Meeting Sched." (a pickup is already on the calendar; flagged `scheduled`).
 *
 * Same source as the production map's Insurance tab
 * (https://az-production-map.vercel.app/?tab=insurance): roofr-search Supabase `jobs`.
 *
 * GET /api/insurance-checks
 * Returns: { success: true, count, checks: [...] }
 * Cached at the CDN edge for 5 minutes.
 */
import { requireSession } from './_session.js';

// Roofr jobs can carry several contacts (carrier, adjuster, spouse...). When the primary contact has no
// phone (e.g. primary = insurance company), pick the first non-toll-free 10-digit number from the other
// contacts. all_contacts is a " | "-joined dump: tokens are names, phones (raw + formatted) and emails.
const TOLL_FREE = /^(800|888|877|866|855|844|833)/;
export function fallbackPhone(allContacts) {
  const tokens = String(allContacts || '').split('|').map(t => t.trim()).filter(Boolean);
  let lastName = '';
  for (const t of tokens) {
    const d = t.replace(/[^0-9]/g, '');
    if (/^\d{10,11}$/.test(d) && !/[a-z@]/i.test(t)) {
      const ten = d.length === 11 ? d.slice(1) : d;
      if (!TOLL_FREE.test(ten)) return { phone: ten, name: lastName };
      continue;
    }
    if (!/@/.test(t) && !/^\(?\d/.test(t)) lastName = t;
  }
  return { phone: '', name: '' };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  // Any signed-in scheduler user (planner) or /m/ user; open only when auth is disabled.
  if (!requireSession(req)) return res.status(401).json({ error: 'Sign in required' });

  const SUPABASE_URL = process.env.KPI_SUPABASE_URL || 'https://ucfqgkbkxbztxlyniuph.supabase.co';
  const SUPABASE_KEY = process.env.KPI_SUPABASE_ANON_KEY || '';

  if (!SUPABASE_KEY) {
    console.error('KPI_SUPABASE_ANON_KEY not set');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  try {
    const select = 'job_id,name,address,value,phone,job_owner,assignees,latitude,longitude,lead_source,stage,stage_timeline,created_at,all_contacts';
    const url = `${SUPABASE_URL}/rest/v1/jobs?select=${select}&deleted_at=is.null&or=(stage.ilike.${encodeURIComponent('INS: Collect ACV')},stage.ilike.${encodeURIComponent('Ins: ACV Meeting Sched%')})&order=value.desc.nullslast&limit=500`;

    const resp = await fetch(url, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    });
    if (!resp.ok) {
      console.error(`Supabase jobs query failed: ${resp.status}`);
      return res.status(502).json({ error: 'Failed to fetch insurance checks' });
    }
    const rows = await resp.json();
    const now = Date.now();

    const checks = rows.map(j => {
      const scheduled = /acv meeting/i.test(j.stage || '');
      // Days sitting in the current stage: latest entry into it wins (re-entries happen).
      const stageRe = scheduled ? /acv meeting/i : /collect acv/i;
      let enteredAt = null;
      if (Array.isArray(j.stage_timeline)) {
        for (const e of j.stage_timeline) {
          if (stageRe.test(e?.s || '') && e.in && (!enteredAt || e.in > enteredAt)) enteredAt = e.in;
        }
      }
      const sinceIso = enteredAt || j.created_at || null;
      const daysInStage = sinceIso ? Math.max(0, Math.round((now - new Date(sinceIso).getTime()) / 864e5)) : null;

      const lat = j.latitude != null ? parseFloat(j.latitude) : null;
      const lon = j.longitude != null ? parseFloat(j.longitude) : null;
      const cityMatch = /,\s*([^,]+),\s*AZ\b/i.exec(j.address || '');
      const fallback = j.phone ? { phone: '', name: '' } : fallbackPhone(j.all_contacts);

      return {
        jobId: String(j.job_id),
        customerName: j.name || '',
        address: j.address || '',
        city: cityMatch ? cityMatch[1].trim() : '',
        value: typeof j.value === 'number' ? j.value : (j.value != null ? parseFloat(j.value) : null),
        phone: (j.phone || fallback.phone) || '',
        phoneContact: j.phone ? '' : fallback.name,
        jobOwner: j.job_owner || '',
        assignees: j.assignees || '',
        leadSource: j.lead_source || '',
        isD2D: /door/i.test(j.lead_source || ''),
        stage: j.stage || '',
        scheduled,
        daysInStage,
        daysIsStageTime: !!enteredAt,
        lat: Number.isFinite(lat) ? lat : null,
        lon: Number.isFinite(lon) ? lon : null,
      };
    });

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json({ success: true, count: checks.length, checks });
  } catch (err) {
    console.error('Insurance checks fetch error:', err);
    return res.status(502).json({ error: err.message });
  }
}
