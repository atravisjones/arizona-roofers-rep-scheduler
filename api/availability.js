import { google } from 'googleapis';
import { isManager, requireSession } from './_session.js';

const SUPABASE_URL = (process.env.KPI_SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_KEY = process.env.KPI_SUPABASE_SERVICE_KEY || '';
const MAX_DAYS = 56;
const DEFAULT_HOLD_RULE = { per: 4, cap: 3, min_reps: 2 };
const SPREADSHEET_ID = '1cFFEZNl7wXt40riZHnuZxGc1Zfm5lTlOz0rDCWGZJ0g';
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

function fail(res, status, error) { return res.status(status).json({ ok: false, error }); }

async function sb(path, options = {}) {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('KPI Supabase is not configured');
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...options.headers,
    },
  });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) {
    throw new Error(body?.message || body?.hint || body?.error || `Supabase returned ${response.status}`);
  }
  return body;
}

async function rpc(name, args, headers = {}) {
  return sb(`rpc/${name}`, { method: 'POST', body: JSON.stringify(args), headers });
}

function queryValue(value) { return Array.isArray(value) ? value[0] : value; }
function validDate(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value); }

function range(req) {
  const from = queryValue(req.query?.from);
  const to = queryValue(req.query?.to);
  if (!validDate(from) || !validDate(to)) throw new Error('from and to must be YYYY-MM-DD');
  const start = new Date(`${from}T00:00:00Z`).getTime();
  const end = new Date(`${to}T00:00:00Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) throw new Error('invalid date range');
  if ((end - start) / 86400000 + 1 > MAX_DAYS) throw new Error('date range cannot exceed 8 weeks');
  return { from, to };
}

function holdRuleFromRow(row) {
  let config = row?.config || {};
  if (typeof config === 'string') {
    try { config = JSON.parse(config); } catch { config = {}; }
  }
  return Object.fromEntries(Object.keys(DEFAULT_HOLD_RULE).map(key => [
    key, Number.isInteger(config[key]) ? config[key] : DEFAULT_HOLD_RULE[key],
  ]));
}

async function getData({ from, to, session }) {
  const [profiles, resolved, exceptions, policy, requests, patterns, slots, settings] = await Promise.all([
    sb('rep_profiles?select=*'),
    rpc('resolve_availability', { p_from: from, p_to: to }, { Range: '0-9999' }),
    sb(`availability_exceptions?select=*&exception_date=gte.${from}&exception_date=lte.${to}`
      + '&order=exception_date,slot'),
    sb(`sra_template_policy?select=*&effective_week=gte.${from}&effective_week=lte.${to}&order=effective_week`),
    sb(`time_off_requests?select=*&start_date=lte.${to}&end_date=gte.${from}`
      + '&status=in.(pending,approved,auto_approved)&order=start_date'),
    sb(`availability_patterns?select=*&effective_from=lte.${to}`
      + `&or=(effective_to.is.null,effective_to.gte.${from})&status=eq.active&order=effective_from.desc`),
    sb('availability_pattern_slots?select=*'),
    sb('scheduler_settings?select=date_key,config&date_key=eq.availability_hold_rule&limit=1'),
  ]);
  const slotByPattern = new Map();
  for (const slot of slots || []) {
    if (!slotByPattern.has(slot.pattern_id)) slotByPattern.set(slot.pattern_id, []);
    slotByPattern.get(slot.pattern_id).push({ weekday: slot.weekday, slot: slot.slot, available: slot.available });
  }
  return {
    profiles: profiles || [], resolved: resolved || [], exceptions: exceptions || [],
    policy: Object.fromEntries((policy || []).map(row => [row.effective_week, {
      template_kind: row.template_kind, sales_meeting_mon: row.sales_meeting_mon,
      company_meeting_fri: row.company_meeting_fri,
    }])),
    requests: requests || [],
    patterns: (patterns || []).map(pattern => ({ ...pattern, slots: slotByPattern.get(pattern.id) || [] })),
    hold_rule: holdRuleFromRow(settings?.[0]),
    me: {
      email: session.email, name: session.name || session.email,
      is_manager: isManager(session.email, profiles || []),
    },
  };
}

function phoenixDateParts() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Phoenix', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  return Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
}

function isoDate(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function thisWeekMonday() {
  const { year, month, day } = phoenixDateParts();
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return isoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function sheetMonday(title, currentMonday) {
  const match = /^SRA (\d{2})\/(\d{2})-\d{2}\/\d{2}$/.exec(title);
  if (!match) return null;
  const year = Number(currentMonday.slice(0, 4));
  const candidates = [
    isoDate(year, Number(match[1]), Number(match[2])),
    isoDate(year + 1, Number(match[1]), Number(match[2])),
  ];
  return candidates.find(candidate => candidate >= currentMonday) || null;
}

async function syncHoldRule(rule) {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    return { ok: true, sheet_synced: false, error: 'GOOGLE_SERVICE_ACCOUNT_KEY not set' };
  }
  try {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
    const auth = new google.auth.GoogleAuth({ credentials, scopes: [SHEETS_SCOPE] });
    const sheets = google.sheets({ version: 'v4', auth });
    const metadata = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID, fields: 'sheets.properties.title',
    });
    const monday = thisWeekMonday();
    const titles = (metadata.data.sheets || []).map(sheet => sheet.properties?.title).filter(Boolean);
    const targetTitles = titles.filter(title => title === 'Schedule Template '
      || title === 'Storm Template' || sheetMonday(title, monday));
    const data = targetTitles.map(title => ({
      range: `'${title.replace(/'/g, "''")}'!T4:T6`, majorDimension: 'ROWS',
      values: [[rule.per], [rule.cap], [rule.min_reps]],
    }));
    if (data.length) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID, requestBody: { valueInputOption: 'RAW', data },
      });
    }
    return { ok: true, sheet_synced: true };
  } catch (error) {
    return { ok: true, sheet_synced: false, error: error.message || 'Sheets sync failed' };
  }
}

async function logAction(action, body, email, result) {
  const dateKey = body.date || body.monday || body.effective_from || new Date().toISOString().slice(0, 10);
  const jobId = action === 'set_hold_rule' ? 'hold_rule' : (body.rep_id || 'policy');
  await sb('scheduler_change_log', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ date_key: dateKey, job_external_id: jobId, change_type: `availability:${action}`,
      timestamp: new Date().toISOString(), before_state: null,
      after_state: { ...body, action, result }, details: email,
    }),
  });
}

async function write(action, body, email) {
  let result = { ok: true };
  if (action === 'set_exception') {
    const { rep_id, date, slot, available, note } = body;
    if (!rep_id || !validDate(date) || !/^s[1-5]$/.test(slot)
      || ![true, false, null].includes(available)) throw new Error('invalid exception');
    if (available === null) {
      await sb(`availability_exceptions?rep_id=eq.${encodeURIComponent(rep_id)}&exception_date=${date}`
        + `&slot=eq.${slot}`, { method: 'DELETE' });
    } else {
      await sb('availability_exceptions?on_conflict=rep_id,exception_date,slot', {
        method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify({ rep_id, exception_date: date, slot, available, source: 'manager',
          created_by: email, note: note || null }),
      });
    }
  } else if (action === 'set_week_policy') {
    const { monday, template_kind = 'standard', sales_meeting_mon = true, company_meeting_fri = true } = body;
    if (!validDate(monday) || !['standard', 'storm'].includes(template_kind)) throw new Error('invalid week policy');
    await sb('sra_template_policy?on_conflict=effective_week', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({ effective_week: monday, template_kind,
        sales_meeting_mon: !!sales_meeting_mon, company_meeting_fri: !!company_meeting_fri }),
    });
  } else if (action === 'set_pattern') {
    const { rep_id, effective_from, slots } = body;
    if (!rep_id || !validDate(effective_from) || !Array.isArray(slots)) throw new Error('invalid pattern');
    await rpc('set_rep_pattern', {
      p_rep_id: rep_id, p_effective_from: effective_from, p_slots: slots, p_created_by: email,
    });
  } else if (action === 'upsert_rep') {
    const allowed = ['id', 'display_name', 'section', 'active', 'email', 'roofr_user_id', 'home_zip',
      'tile', 'shingle', 'flat', 'metal', 'insurance', 'commercial', 'two_story_ladder', 'veteran',
      'stories', 'spanish', 'metadata'];
    const profile = Object.fromEntries(allowed
      .filter(key => Object.prototype.hasOwnProperty.call(body, key)).map(key => [key, body[key]]));
    if (!profile.display_name || !profile.section) throw new Error('display_name and section are required');
    if (!profile.id) {
      const rows = await sb('rep_profiles?select=sort_order&order=sort_order.desc&limit=1');
      profile.sort_order = (rows[0]?.sort_order || 0) + 1;
    }
    await sb(`rep_profiles${profile.id ? `?id=eq.${encodeURIComponent(profile.id)}` : ''}`, {
      method: profile.id ? 'PATCH' : 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify(profile),
    });
  } else if (action === 'set_rep_active') {
    if (!body.rep_id || typeof body.active !== 'boolean') throw new Error('rep_id and active are required');
    await sb(`rep_profiles?id=eq.${encodeURIComponent(body.rep_id)}`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ active: body.active }),
    });
  } else if (action === 'set_hold_rule') {
    const { per, cap, min_reps } = body;
    if (![per, cap, min_reps].every(Number.isInteger)) throw new Error('hold rule values must be integers');
    if (per < 1 || per > 10 || cap < 0 || cap > 10 || min_reps < 0 || min_reps > 10) {
      throw new Error('hold rule values are out of range');
    }
    const rule = { per, cap, min_reps, updated_by: email };
    await sb('scheduler_settings?on_conflict=date_key', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({ date_key: 'availability_hold_rule', config: rule, updated_by: email }),
    });
    result = await syncHoldRule(rule);
  } else throw new Error('unknown action');
  await logAction(action, body, email, result);
  return result;
}

export default async function handler(req, res) {
  const session = requireSession(req);
  if (!session) return fail(res, 401, 'Unauthorized');
  try {
    if (req.method === 'GET') return res.status(200).json(await getData({ ...range(req), session }));
    if (req.method !== 'POST') return fail(res, 405, 'Method not allowed');
    const profiles = await sb('rep_profiles?select=email,section');
    if (!isManager(session.email, profiles || [])) return fail(res, 403, 'Manager access required');
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    return res.status(200).json(await write(body.action, body, session.email));
  } catch (error) {
    const message = error instanceof SyntaxError ? 'Invalid JSON' : error.message;
    return fail(res, message.includes('range') || message.includes('YYYY') ? 400 : 500, message || 'Request failed');
  }
}
