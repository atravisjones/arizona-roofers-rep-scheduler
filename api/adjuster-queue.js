/**
 * "Needs Adjuster Meeting" call queue for the /m/ phone page.
 *
 * GET /api/adjuster-queue
 *   -> { jobs: [{ jobId, customerName, address, phone, jobOwner, leadSource, daysInStage, lat, lon,
 *                 carrier: { name, phone, email } | null, adjuster: { name, phone } | null,
 *                 claimNumber, insuranceCompany, insuranceNotes }] }
 *
 * Base list = Supabase jobs in stage "Ins: Needs Adjuster Meeting". The carrier is the job contact
 * with contact_type = "insurance" and the adjuster is parsed from the job's insurance notes
 * ("Adjuster\nJason F\n469-357-9329"); both come from Roofr live, READ-ONLY, through the same
 * borrowed session as api/roofr-tasks.js (GETs only, never touches auth_sessions).
 */
import { requireM } from './_msession.js';

const SUPABASE_URL = (process.env.KPI_SUPABASE_URL || 'https://ucfqgkbkxbztxlyniuph.supabase.co').replace(/\/$/, '');
const SERVICE_KEY = (process.env.KPI_SUPABASE_SERVICE_KEY || '').trim();
const ANON_KEY = process.env.KPI_SUPABASE_ANON_KEY || SERVICE_KEY;
const TEAM_ID = '239329';
const STAGE = 'Ins: Needs Adjuster Meeting';

async function roofrSession() {
  if (!SERVICE_KEY) return null;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/auth_sessions?id=eq.roofr-main&select=cookies,xsrf_token`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
  const rows = await r.json();
  const sess = Array.isArray(rows) && rows[0];
  if (!sess || !sess.cookies) return null;
  const list = typeof sess.cookies === 'string' ? JSON.parse(sess.cookies) : sess.cookies;
  const cookie = (list || []).filter(c => c && c.name && (c.domain || '').includes('roofr')).map(c => `${c.name}=${c.value}`).join('; ');
  if (!cookie) return null;
  return {
    cookie,
    'x-xsrf-token': decodeURIComponent(sess.xsrf_token || ''),
    'team-id': TEAM_ID,
    'x-requested-with': 'XMLHttpRequest',
    accept: 'application/json',
    referer: `https://app.roofr.com/dashboard/team/${TEAM_ID}/jobs/list-view`,
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  };
}

const digits = s => String(s || '').replace(/\D/g, '');
const PHONE_RE = /\(?(\d{3})\)?[\s.-]*(\d{3})[\s.-]*(\d{4})/;

// "Adjuster \nJason Fecher\n469-357-9329" (or "Adjuster: Jason 469…") -> { name, phone }
// Every phone in the notes is a candidate; the caller drops the carrier's own line.
function parseAdjusters(notes) {
  const text = String(notes || '');
  if (!text.trim()) return [];
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const clean = l => l.replace(/adjuster[:\s-]*/i, '').replace(/[:\-–]\s*$/, '').trim();
  const PH = /\(?(\d{3})\)?[\s.-]*(\d{3})[\s.-]*(\d{4})/g;
  const found = [];
  for (let i = 0; i < lines.length; i++) {
    let m; PH.lastIndex = 0;
    while ((m = PH.exec(lines[i]))) {
      const phone = m[1] + m[2] + m[3];
      let name = clean(lines[i].slice(0, m.index));
      if (!name) for (let k = i - 1; k >= 0; k--) { const l = clean(lines[k]); if (l && !PHONE_RE.test(l)) { name = l; break; } }
      name = name.replace(/^[^A-Za-z]+/, '').replace(/\s*[-–|]\s*\S+@\S+$/, '').replace(/\s*\(\d*$/, '').trim();
      if (/callback|claims? line|main line/i.test(name)) name = '';
      found.push({ name: name.slice(0, 60), phone });
    }
  }
  return found;
}

async function roofrGet(headers, path) {
  try {
    const r = await fetch(`https://app.roofr.com/api/${path}`, { headers });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) { return null; }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, max-age=120');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await requireM(req))) return res.status(401).json({ error: 'Sign in required' });
  if (!ANON_KEY) return res.status(500).json({ error: 'Server configuration error' });

  try {
    const select = 'job_id,name,address,phone,job_owner,lead_source,latitude,longitude,stage_timeline,created_at,all_contacts';
    const r = await fetch(`${SUPABASE_URL}/rest/v1/jobs?select=${select}&deleted_at=is.null&stage=ilike.${encodeURIComponent(STAGE)}&order=created_at.desc&limit=60`, { headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } });
    if (!r.ok) return res.status(502).json({ error: `Supabase ${r.status}` });
    const rows = await r.json();
    const now = Date.now();
    const headers = await roofrSession();

    // Live Roofr reads, 4 at a time.
    const enrich = async j => {
      const out = { carrier: null, adjuster: null, claimNumber: '', insuranceCompany: '', insuranceNotes: '', live: !!headers };
      if (!headers) return out;
      const [job, contacts] = await Promise.all([roofrGet(headers, `job/${j.job_id}`), roofrGet(headers, `job/${j.job_id}/contacts`)]);
      const ins = job && job.insurance && !job.insurance.deleted ? job.insurance : null;
      if (ins) {
        out.claimNumber = ins.claim_number || '';
        out.insuranceCompany = ins.insurance_company || '';
        out.insuranceNotes = ins.notes || '';
        out.adjusters = parseAdjusters(ins.notes);
      }
      const list = contacts && Array.isArray(contacts.data) ? contacts.data : [];
      const insC = list.map(x => x.contact || {}).find(c => c.contact_type === 'insurance' && !c.deleted_at);
      if (insC) out.carrier = { name: insC.name || insC.company_name || insC.first_name || '', phone: digits(insC.phone), email: insC.email || '' };
      // First phone in the notes that is not the carrier's own line (or a toll-free number) = the adjuster.
      const cp = out.carrier ? out.carrier.phone : '';
      out.adjuster = (out.adjusters || []).find(a => a.phone !== cp && !/^8(00|33|44|55|66|77|88)/.test(a.phone)) || null;
      delete out.adjusters;
      return out;
    };
    const results = [];
    for (let i = 0; i < rows.length; i += 4) results.push(...await Promise.all(rows.slice(i, i + 4).map(enrich)));

    const jobs = rows.map((j, i) => {
      let enteredAt = null;
      if (Array.isArray(j.stage_timeline)) for (const e of j.stage_timeline) if (/needs adjuster/i.test(e?.s || '') && e.in && (!enteredAt || e.in > enteredAt)) enteredAt = e.in;
      const since = enteredAt || j.created_at;
      const lat = j.latitude != null ? parseFloat(j.latitude) : null, lon = j.longitude != null ? parseFloat(j.longitude) : null;
      return {
        jobId: String(j.job_id), customerName: j.name || '', address: j.address || '', phone: digits(j.phone),
        jobOwner: j.job_owner || '', leadSource: j.lead_source || '',
        daysInStage: since ? Math.max(0, Math.round((now - new Date(since).getTime()) / 864e5)) : null,
        lat: Number.isFinite(lat) ? lat : null, lon: Number.isFinite(lon) ? lon : null,
        ...results[i],
      };
    });
    return res.status(200).json({ count: jobs.length, live: !!headers, jobs });
  } catch (err) {
    console.error('adjuster-queue error:', err);
    return res.status(502).json({ error: err.message });
  }
}
