/**
 * CompanyCam production-report lookup — READ-ONLY.
 *
 * GET /api/companycam?address=<full job address>
 *   → { found, pct, done, total, complete, missing[], project_url, ... }
 *
 * Matches the job address to a CompanyCam project (project names ARE the
 * address), finds the "* Production Report" checklist, and returns task-level
 * completion so Rescue cards can show how far along the rep's report is.
 * The ≥50% "OK to check off" rule is a UI hint only — this app never writes
 * to CompanyCam or Roofr.
 *
 * Env: COMPANYCAM_API_TOKEN (absent = endpoint answers found:false).
 */
const TOKEN = (process.env.COMPANYCAM_API_TOKEN || '').trim();
const API = 'https://api.companycam.com/v2';

// The dozen tasks a CSR actually chases on the report. The rest of the
// checklist (Ridge Vent, Solar, Skylights, ... in Roof Counts) is count/tag
// bookkeeping Travis doesn't want on the card — % still covers everything.
const CORE_TASKS = [
  'All Sides Of The Property & Driveway & Liability Photos',
  'Edge Photos',
  'Fascia Boards',
  'Drip Edge',
  'Shingle Molding',
  'Gutters',
  '360 View Photos On The Roof',
  'Damage Photos',
  'T Top Vents',
  'Pipe Jacks',
  'Gas Pipes',
  'O Hagin / Box Vents',
];
const normTask = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const CORE_SET = new Set(CORE_TASKS.map(normTask));

// Reduce a street line to a comparable key: drop unit markers, abbreviate
// directionals (West -> w), strip suffix words (Road/Rd), squash spacing.
function streetKey(value) {
  return String(value || '').toLowerCase()
    .split(',')[0]
    .replace(/\b(unit|lot|suite|ste|apt|space|spc|#)\s*\S*/g, '')
    .replace(/\b(north|south|east|west)\b/g, (m) => m[0])
    .replace(/\b(street|st|avenue|ave|drive|dr|boulevard|blvd|lane|ln|court|ct|place|pl|road|rd|way|circle|cir|loop|trail|trl|terrace|ter|parkway|pkwy|highway|hwy)\b\.?/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

async function cc(path) {
  const resp = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' },
  });
  if (!resp.ok) throw new Error(`CompanyCam ${resp.status} on ${path.split('?')[0]}`);
  const body = await resp.json();
  return Array.isArray(body) ? body : (body && body.data) || body;
}

export default async function handler(req, res) {
  // Same address asked again within the hour comes off the CDN, not CompanyCam.
  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=3600');
  if (req.method !== 'GET') return res.status(405).json({ found: false, reason: 'method' });
  if (!TOKEN) return res.status(200).json({ found: false, reason: 'not_configured' });
  const address = String((req.query && req.query.address) || '').trim();
  if (!address) return res.status(400).json({ found: false, reason: 'missing_address' });

  const streetRaw = address.split(',')[0].trim();
  const want = streetKey(streetRaw);
  try {
    const projects = await cc(`/projects?query=${encodeURIComponent(streetRaw)}&per_page=5`);
    const list = Array.isArray(projects) ? projects : [];
    const project = list.find((p) => streetKey(p.name) === want) || (list.length === 1 ? list[0] : null);
    if (!project) return res.status(200).json({ found: false, reason: 'no_project' });

    const projectUrl = `https://app.companycam.com/projects/${project.id}`;
    const checklists = await cc(`/projects/${project.id}/checklists`);
    const report = (Array.isArray(checklists) ? checklists : []).find((c) => /production report/i.test(c.name || ''));
    if (!report) {
      return res.status(200).json({ found: false, reason: 'no_report_checklist', project_id: project.id, project_url: projectUrl });
    }

    const tasks = [
      ...(report.sectionless_tasks || []),
      ...((report.sections || []).flatMap((section) => section.tasks || [])),
    ];
    const total = tasks.length;
    const done = tasks.filter((t) => t.completed_at).length;
    const missing = tasks.filter((t) => !t.completed_at)
      .map((t) => String(t.name || t.title || '').replace(/\*/g, '').trim())
      .filter(Boolean);
    const lastDone = tasks.reduce((max, t) => Math.max(max, Number(t.completed_at) || 0), 0);
    const core = tasks
      .filter((t) => CORE_SET.has(normTask(t.name || t.title)))
      .map((t) => ({ name: String(t.name || t.title || '').replace(/\*/g, '').trim(), done: !!t.completed_at }));

    return res.status(200).json({
      found: true,
      project_id: project.id,
      project_url: projectUrl,
      checklist_id: report.id,
      checklist_name: report.name,
      done,
      total,
      pct: total ? Math.round((100 * done) / total) : 0,
      complete: !!report.completed_at || (total > 0 && done === total),
      missing: missing.slice(0, 12),
      tasks: core,
      last_task_at: lastDone ? new Date(lastDone * 1000).toISOString() : null,
    });
  } catch (err) {
    return res.status(200).json({ found: false, reason: 'error', error: String((err && err.message) || err) });
  }
}
