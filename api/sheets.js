/**
 * Server-side proxy for Google Sheets API v4 reads.
 *
 * Uses service account auth (GOOGLE_SERVICE_ACCOUNT_KEY) so sheets stay
 * private. The SA email must be granted Viewer access on each sheet.
 *
 * Spreadsheet IDs are allowlisted as defense-in-depth.
 *
 * Query params:
 *   spreadsheetId    - required, must be in ALLOWED_SHEETS
 *   range            - optional, e.g. "'Sheet Name'!A1:B10". For single-range get.
 *   ranges           - optional, repeated. Triggers batchGet when op=batchGet.
 *   op               - optional. "batchGet" to fetch multiple ranges in one call.
 *   valueRenderOption - optional, e.g. "FORMATTED_VALUE" or "UNFORMATTED_VALUE"
 *   fields           - optional, e.g. "sheets.properties.title". For partial metadata.
 *
 * Default (no range and no op): returns spreadsheet metadata.
 */
import { google } from 'googleapis';

const ALLOWED_SHEETS = new Set([
  '1cFFEZNl7wXt40riZHnuZxGc1Zfm5lTlOz0rDCWGZJ0g', // SRA rep schedule (also used as CITIES_SHEET by Calendar extension)
  '1Bw1Tug38f_cEkAN6V4XzlDT_lJf7UDMAUK0NjoBEtK0', // Roofr Master Sheet
  '1TtweJEEhVEO_DAgmvTY7PcaPQdmbxlOtPfffKdiXBcw', // Apt Outcome Tracker (closing rates)
  '1XFJHD0IVZ8sJrQ7H2CrqU26a6n-FulPM8ABKc1hrh9o', // Company Team Roster (People tab: Production/Insurance/D2D sync)
]);

let cachedSheets = null;

function getSheetsClient() {
  if (cachedSheets) return cachedSheets;

  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY not set');

  const credentials = JSON.parse(raw);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  cachedSheets = google.sheets({ version: 'v4', auth });
  return cachedSheets;
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { spreadsheetId, range, ranges, valueRenderOption, fields, op } = req.query;
  if (!spreadsheetId || typeof spreadsheetId !== 'string') {
    return res.status(400).json({ error: 'spreadsheetId required' });
  }
  if (!ALLOWED_SHEETS.has(spreadsheetId)) {
    return res.status(403).json({ error: 'spreadsheetId not allowed' });
  }

  let sheets;
  try {
    sheets = getSheetsClient();
  } catch (err) {
    console.error('Sheets client init failed:', err.message);
    return res.status(500).json({ error: 'Server configuration error' });
  }

  try {
    let body;

    if (op === 'batchGet') {
      const rangeList = Array.isArray(ranges) ? ranges : (ranges ? [ranges] : []);
      if (!rangeList.length) {
        return res.status(400).json({ error: 'ranges required for batchGet' });
      }
      const r = await sheets.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges: rangeList,
        valueRenderOption: valueRenderOption || undefined,
      });
      body = r.data;
    } else if (range) {
      const r = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range,
        valueRenderOption: valueRenderOption || undefined,
      });
      body = r.data;
    } else {
      const r = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: fields || undefined,
      });
      body = r.data;
    }

    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=30');
    return res.status(200).json(body);
  } catch (err) {
    const status = err.code || err.status || 502;
    const message = err.errors?.[0]?.message || err.message || 'Sheets API error';
    return res.status(status).json({ error: { code: status, message } });
  }
}
