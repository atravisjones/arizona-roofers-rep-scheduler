import { Rep, TimeSlot } from '../types';
import { SPREADSHEET_ID, SHEET_TITLE_PREFIX, DATA_RANGE, USE_MOCK_DATA_ON_FAILURE, TIME_SLOTS, SKILLS_SHEET_TITLE, SKILLS_DATA_RANGE, ROOFR_JOBS_SPREADSHEET_ID, ROOFR_JOBS_SHEET_TITLE, ROOFR_JOBS_DATA_RANGE, APT_OUTCOME_SPREADSHEET_ID, APT_OUTCOME_SHEET_TITLE, APT_OUTCOME_DATA_RANGE, SUPABASE_URL, SUPABASE_ANON_KEY } from '../constants';

// All Sheets API reads go through /api/sheets (Vercel function) so the API key stays server-side.
function buildSheetsUrl(spreadsheetId: string, range?: string, valueRenderOption?: string): string {
    const params = new URLSearchParams({ spreadsheetId });
    if (range) params.set('range', range);
    if (valueRenderOption) params.set('valueRenderOption', valueRenderOption);
    return `/api/sheets?${params}`;
}
import { MOCK_REPS_DATA } from './mockData';
import { ALL_KNOWN_CITIES } from './geography';
import { applyNorthRoutingZoneConfig, resetNorthRoutingZoneDefault } from './northRoutingConfig';
import type { ConfigurableNorthZone, NorthRoutingZoneConfig } from './northRoutingConfig';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Normalizes an address for reliable matching by extracting the street number and standardizing the street name.
 * For example, "123 N. Main St., City" becomes "123 north main street".
 * @param address The raw address string.
 * @returns A normalized string or null if the address is invalid.
 */
export const normalizeAddressForMatching = (address: string): string | null => {
    if (!address) return null;

    let addr = address.toLowerCase().trim();

    // Cautiously remove state and zip from the very end of the string
    addr = addr.replace(/(,\s*(az|arizona))?\s+\d{5}(?:-\d{4})?$/, '');

    // Cautiously remove just the state from the end if it's there
    addr = addr.replace(/,\s*(az|arizona)$/, '');

    // Clean up any trailing comma left from the removals
    addr = addr.trim().replace(/,$/, '').trim();

    // Now, if the string ends with a known city preceded by a comma, remove it.
    // This is safer than a global city search, as it avoids stripping city names from street names.
    const cityList = [...ALL_KNOWN_CITIES].sort((a, b) => b.length - a.length);
    for (const city of cityList) {
        // Regex to match ", city" at the end of the string, case-insensitive.
        const regex = new RegExp(`,\\s*${city.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}$`, 'i');
        if (regex.test(addr)) {
            addr = addr.replace(regex, '').trim();
            break; // Stop after the first (and longest) match
        }
    }

    // What remains should be the core street address.
    let streetPart = addr;

    // The address must start with a number.
    const streetNumberMatch = streetPart.match(/^(\d+)/);
    if (!streetNumberMatch) return null;

    // Expand abbreviations like St, Rd, N, W, etc. to their full words.
    streetPart = streetPart
        .replace(/\b(n\.?|north)\b/g, 'north')
        .replace(/\b(s\.?|south)\b/g, 'south')
        .replace(/\b(e\.?|east)\b/g, 'east')
        .replace(/\b(w\.?|west)\b/g, 'west')
        .replace(/\b(st\.?|street)\b/g, 'street')
        .replace(/\b(rd\.?|road)\b/g, 'road')
        .replace(/\b(dr\.?|drive)\b/g, 'drive')
        .replace(/\b(ave?\.?|avenue)\b/g, 'avenue')
        .replace(/\b(blvd\.?|boulevard)\b/g, 'boulevard')
        .replace(/\b(ln\.?|lane)\b/g, 'lane')
        .replace(/\b(ct\.?|court)\b/g, 'court')
        .replace(/\b(pl\.?|place)\b/g, 'place')
        .replace(/\b(trl\.?|trail)\b/g, 'trail')
        .replace(/\b(cir\.?|circle)\b/g, 'circle')
        .replace(/\b(wy\.?|way)\b/g, 'way');

    // Transliterate accented characters to ASCII (e.g., Vía → Via, é → e)
    streetPart = streetPart.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    // Remove all non-alphanumeric characters (except spaces) and collapse whitespace.
    streetPart = streetPart.replace(/[^a-z0-9\s]/g, '');
    streetPart = streetPart.replace(/\s+/g, ' ').trim();

    // Remove common street types from the end to make them optional for matching
    // This handles cases where one address has "St" and another doesn't
    streetPart = streetPart.replace(/\s+(street|road|drive|avenue|boulevard|lane|court|place|trail|circle|way)$/i, '').trim();

    // Remove directional prefixes after the street number to make them optional
    // "123 north main" becomes "123 main", "123 west oak" becomes "123 oak"
    streetPart = streetPart.replace(/^(\d+)\s+(north|south|east|west)\s+/i, '$1 ').trim();

    return streetPart;
};


/**
 * Fetches a URL with exponential backoff retry logic for server errors (5xx) and rate limits (429).
 */
async function fetchWithRetry(url: string, retries = 3, initialDelay = 1000): Promise<Response> {
    let currentDelay = initialDelay;

    for (let i = 0; i <= retries; i++) {
        try {
            const response = await fetch(url);

            // If successful or a client error (4xx except 429), return the response immediately.
            // We let the caller handle 404s, 403s etc.
            if (response.ok || (response.status < 500 && response.status !== 429)) {
                return response;
            }

            // If it's a server error (5xx) or rate limit (429), and we have retries left...
            if (i < retries) {
                console.warn(`Google Sheets API attempt ${i + 1} failed (Status ${response.status}). Retrying in ${currentDelay}ms...`);
                await sleep(currentDelay);
                currentDelay *= 2;
                continue;
            }

            // If no retries left, return the last response (likely an error status)
            return response;

        } catch (error) {
            // Network errors (fetch throws)
            if (i < retries) {
                console.warn(`Google Sheets API network attempt ${i + 1} failed. Retrying in ${currentDelay}ms...`, error);
                await sleep(currentDelay);
                currentDelay *= 2;
                continue;
            }
            // Propagate error if out of retries
            throw error;
        }
    }
    throw new Error("Fetch failed unexpectedly.");
}

/**
 * Finds the correct sheet title for a given date from the spreadsheet metadata.
 * This new logic is more robust and correctly handles year rollovers by checking
 * the selected date against ranges constructed for the current, previous, and next year.
 * @param dateToFind The date to find a matching sheet for.
 * @param sheets The list of sheet properties from the spreadsheet metadata.
 * @returns The title of the matching sheet, or a fallback title.
 */
function findSheetNameForDate(dateToFind: Date, sheets: any[]): string | null {
    dateToFind.setHours(0, 0, 0, 0); // Normalize to the start of the day for comparison
    const dateRangeRegex = /(\d{1,2})\/(\d{1,2})\s*-\s*(\d{1,2})\/(\d{1,2})/;

    for (const s of sheets) {
        const title = s.properties.title;
        if (title.startsWith(SHEET_TITLE_PREFIX)) {
            const match = title.match(dateRangeRegex);
            if (match) {
                const [, startMonth, startDay, endMonth, endDay] = match.map(Number);

                // Check for the date in 3 possible years: the selected date's year, the year before, and the year after.
                // This handles viewing past/future schedules correctly.
                for (const yearOffset of [0, -1, 1]) {
                    const searchYear = dateToFind.getFullYear() + yearOffset;

                    let startYear = searchYear;
                    let endYear = searchYear;

                    // Handle year rollover (e.g., a range from December to January)
                    if (startMonth > endMonth) {
                        endYear = startYear + 1;
                    }

                    const startDate = new Date(startYear, startMonth - 1, startDay);
                    startDate.setHours(0, 0, 0, 0);
                    const endDate = new Date(endYear, endMonth - 1, endDay);
                    endDate.setHours(23, 59, 59, 999);

                    // If the date we're looking for is within this constructed range, we found the right sheet.
                    if (dateToFind >= startDate && dateToFind <= endDate) {
                        return title;
                    }
                }
            }
        }
    }

    // Fallback if no matching date range is found after checking multiple years.
    const fallbackSheet = sheets.find((s: any) => s.properties.title.startsWith(SHEET_TITLE_PREFIX));
    if (fallbackSheet) {
        console.warn(`Could not find a sheet for the selected date (${dateToFind.toLocaleDateString()}). Falling back to the first sheet with the prefix: ${fallbackSheet.properties.title}`);
        return fallbackSheet.properties.title;
    }

    return null;
}

/**
 * Helper to normalize names for matching against skill/rank sheets.
 * Creates a consistent "firstlast" key from various name formats.
 * E.g., `"Lee" William Yost Phoenix` -> `leeyost`
 * E.g., `Lee Yost` -> `leeyost`
 */
// Common nickname -> canonical name mappings for consistent matching
const NICKNAME_MAP: Record<string, string> = {
    'will': 'william',
    'bill': 'william',
    'billy': 'william',
    'nick': 'nicholas',
    'mike': 'michael',
    'matt': 'matthew',
    'dan': 'daniel',
    'joe': 'joseph',
    'chris': 'christopher',
    'rob': 'robert',
    'bob': 'robert',
    'tom': 'thomas',
    'dick': 'richard',
    'rich': 'richard',
    'rick': 'richard',
    'jon': 'jonathan',
    'alex': 'alexander',
    'ben': 'benjamin',
    'sam': 'samuel',
    'tony': 'anthony',
    'ed': 'edward',
    'jim': 'james',
    'jimmy': 'james',
    'jake': 'jacob',
    'charlie': 'charles',
    'chuck': 'charles',
    'dave': 'david',
    'steve': 'steven',
    'andy': 'andrew',
    'drew': 'andrew',
    'pat': 'patrick',
    'josh': 'joshua',
    'zach': 'zachary',
    'nate': 'nathan',
    'greg': 'gregory',
};

export const normalizeName = (name: string): string => {
    if (!name) return '';
    // Clean string: lowercase, remove quotes, content in parens, and city suffixes.
    let cleaned = name.toLowerCase().trim()
        .replace(/"/g, '')
        .replace(/\s*\([^)]*\)/g, '')
        .replace(/\s+(phoenix|tucson)$/i, '')
        .trim();

    // Split into parts, filtering out empty strings or stray characters.
    const parts = cleaned.split(/\s+/).filter(p => p.length > 0 && p !== '-');
    if (parts.length === 0) return '';

    // If only one part (e.g., "Cher"), use that.
    if (parts.length === 1) {
        return NICKNAME_MAP[parts[0]] || parts[0];
    }

    // If name is like "Lee Y", the key is "leey".
    if (parts.length === 2 && parts[1].length === 1) {
        const first = NICKNAME_MAP[parts[0]] || parts[0];
        return `${first}${parts[1]}`;
    }

    // For "First Middle Last" or "First Last", the key is "firstlast".
    const first = NICKNAME_MAP[parts[0]] || parts[0];
    const last = parts[parts.length - 1];

    return `${first}${last}`;
};

/**
 * Helper to clean up rep names for display in the UI.
 * E.g., `"Lee" William Yost Phoenix` -> `Lee William Yost`
 */
const cleanDisplayName = (name: string): string => {
    if (!name) return '';
    return name.trim()
        .replace(/"/g, '') // remove quotes
        .replace(/\s*\([^)]*\)/g, '') // remove parentheses content
        .replace(/\s+(phoenix|tucson)$/i, '') // remove city suffixes
        .replace(/\s{2,}/g, ' ') // collapse spaces
        .trim();
};

/**
 * Profit-based rep rankings — mirrors the roofr-search Management tab.
 * Rank order = Gross Profit/Appt = Sales/Appt × GPM%, over a rolling
 * 60-day window of Retail leads (same universe/filters as the dashboard:
 * excludes Self Gen + Door knocking sources, pre-appointment stages, and
 * the owners excluded from the Management view).
 *
 * Profit basis: won jobs that reached the Commission Processing queue with
 * real COGS entered (the financials table, cogs_total > 0).
 *
 * Guardrails:
 *  - A rep needs >= MIN_PROFIT_RANK_APPTS appointments in the window to be
 *    ranked here; everyone else falls back to close-rate ranking.
 *  - A rep with no costed jobs yet gets the team-wide GPM applied to their
 *    own Sales/Appt, so commission-coverage lag doesn't unrank them.
 */
const PROFIT_WINDOW_DAYS = 60;
const MIN_PROFIT_RANK_APPTS = 8;
const PROFIT_EXCLUDED_SOURCES = new Set(['self gen', 'door knocking']);
const PROFIT_EXCLUDED_STAGES = new Set(['unqualified', 'new lead', 'appointment scheduled', 'needs rescheduled']);
const PROFIT_EXCLUDED_OWNERS = ['Nick Williams', 'Ashkan Etemadi', 'Oliver Johnson', 'William Ludewig', 'William Yost'];
// Same stage keywords the KPI dashboard uses for "reached appointment"
const APPT_STAGE_KEYWORDS = ['appointment', 'inspection', 'qualified', 'proposal', 'contract', 'signed', 'install', 'follow', 'won', 'complete'];

async function fetchProfitRankings(): Promise<Map<string, number>> {
    const rankMap = new Map<string, number>();
    const sbHeaders = {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    };
    try {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - PROFIT_WINDOW_DAYS);
        const cutoffStr = cutoff.toISOString().split('T')[0];

        // 1. All Retail leads created in the window (paginated past PostgREST's 1000-row cap)
        type JobRow = { job_id: string; job_owner: string; lead_source: string | null; stage: string | null; stage_category: string | null; value: number | null; appt_booked_at: string | null };
        const jobs: JobRow[] = [];
        for (let offset = 0; ; offset += 1000) {
            const params = new URLSearchParams({
                select: 'job_id,job_owner,lead_source,stage,stage_category,value,appt_booked_at',
                workflow: 'eq.Retail',
                created_at: `gte.${cutoffStr}`,
                deleted_at: 'is.null',
                job_owner: 'not.is.null',
                limit: '1000',
                offset: String(offset),
            });
            const resp = await fetch(`${SUPABASE_URL}/rest/v1/jobs?${params}`, { headers: sbHeaders });
            if (!resp.ok) {
                console.warn(`Failed to fetch jobs for profit rankings: ${resp.statusText}`);
                return rankMap;
            }
            const page: JobRow[] = await resp.json();
            jobs.push(...page);
            if (page.length < 1000) break;
        }

        // 2. Aggregate per rep — appts and won value (Management tab definitions)
        const excludedOwners = new Set(PROFIT_EXCLUDED_OWNERS.map(normalizeName));
        type RepAgg = { appts: number; wonValue: number; gp: number; nr: number };
        const repAgg = new Map<string, RepAgg>();
        const wonIdToRep = new Map<string, string>();
        for (const job of jobs) {
            if (job.lead_source && PROFIT_EXCLUDED_SOURCES.has(job.lead_source.toLowerCase())) continue;
            const stage = (job.stage || '').toLowerCase();
            if (stage && PROFIT_EXCLUDED_STAGES.has(stage)) continue;
            const normalized = normalizeName(job.job_owner);
            if (!normalized || excludedOwners.has(normalized)) continue;

            const reachedAppt = job.appt_booked_at != null || APPT_STAGE_KEYWORDS.some(k => stage.includes(k));
            if (!reachedAppt) continue;

            const agg = repAgg.get(normalized) || { appts: 0, wonValue: 0, gp: 0, nr: 0 };
            agg.appts++;
            const cat = (job.stage_category || '').toLowerCase();
            if (cat === 'won' || cat === 'completed') {
                agg.wonValue += Number(job.value) || 0;
                wonIdToRep.set(job.job_id, normalized);
            }
            repAgg.set(normalized, agg);
        }

        // 3. Of the won jobs, find those that reached Commission Processing (stage timeline)
        const wonIds = [...wonIdToRep.keys()];
        const commissionIds: string[] = [];
        for (let i = 0; i < wonIds.length; i += 200) {
            const chunk = wonIds.slice(i, i + 200);
            const params = new URLSearchParams({
                select: 'job_id,stage_timeline',
                'job_id': `in.(${chunk.join(',')})`,
            });
            const resp = await fetch(`${SUPABASE_URL}/rest/v1/jobs?${params}`, { headers: sbHeaders });
            if (!resp.ok) continue;
            const rows: { job_id: string; stage_timeline: { s: string }[] | null }[] = await resp.json();
            for (const row of rows) {
                if ((row.stage_timeline || []).some(t => (t.s || '').toLowerCase().includes('commission'))) {
                    commissionIds.push(row.job_id);
                }
            }
        }

        // 4. Financials for commission jobs with real COGS (blank-COGS rows fake ~100% margins)
        for (let i = 0; i < commissionIds.length; i += 200) {
            const chunk = commissionIds.slice(i, i + 200);
            const params = new URLSearchParams({
                select: 'job_id,net_revenue,gross_profit',
                'job_id': `in.(${chunk.join(',')})`,
                cogs_total: 'gt.0',
            });
            const resp = await fetch(`${SUPABASE_URL}/rest/v1/financials?${params}`, { headers: sbHeaders });
            if (!resp.ok) continue;
            const rows: { job_id: string; net_revenue: number | null; gross_profit: number | null }[] = await resp.json();
            for (const row of rows) {
                const rep = wonIdToRep.get(String(row.job_id));
                if (!rep) continue;
                const agg = repAgg.get(rep);
                if (!agg) continue;
                agg.gp += Number(row.gross_profit) || 0;
                agg.nr += Number(row.net_revenue) || 0;
            }
        }

        // 5. Rank by Gross Profit/Appt = Sales/Appt × GPM% (team GPM when uncosted)
        let teamGp = 0, teamNr = 0;
        for (const agg of repAgg.values()) { teamGp += agg.gp; teamNr += agg.nr; }
        const teamGpm = teamNr > 0 ? teamGp / teamNr : 0;

        const ranked: { normalized: string; profitPerAppt: number }[] = [];
        for (const [normalized, agg] of repAgg) {
            if (agg.appts < MIN_PROFIT_RANK_APPTS) continue;
            const salesPerAppt = agg.wonValue / agg.appts;
            const gpm = agg.nr > 0 ? agg.gp / agg.nr : teamGpm;
            ranked.push({ normalized, profitPerAppt: salesPerAppt * gpm });
        }
        ranked.sort((a, b) => b.profitPerAppt - a.profitPerAppt);
        ranked.forEach((r, i) => rankMap.set(r.normalized, i + 1));

        console.log(`Fetched profit rankings for ${rankMap.size} reps (${PROFIT_WINDOW_DAYS}d window, min ${MIN_PROFIT_RANK_APPTS} appts, team GPM ${(teamGpm * 100).toFixed(1)}%)`);
    } catch (error) {
        console.error("Error fetching profit rankings:", error);
    }
    return rankMap;
}

/**
 * Fetches closing rates from the Appointment Summary tab of the Apt Outcome Tracker spreadsheet.
 * Uses the "30 days" Close rate % column to rank reps.
 * Returns a Map where key is normalized rep name and value is their rank based on closing rate.
 * Higher closing rate = lower rank number (rank 1 = best closer).
 */
export type ClosingRateDetail = { name: string; won: number; total: number; rate: number; rank: number };

export async function fetchClosingRateDetails(days: number = 30): Promise<ClosingRateDetail[]> {
    const sbHeaders = {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    };
    try {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        const cutoffStr = cutoff.toISOString().split('T')[0];

        const evtParams = new URLSearchParams({
            select: 'job_id',
            category: 'eq.sales',
            'start_date': `gte.${cutoffStr}`,
        });
        const evtResp = await fetch(`${SUPABASE_URL}/rest/v1/calendar_events?${evtParams}`, { headers: sbHeaders });
        if (!evtResp.ok) return [];
        const events: { job_id: string }[] = await evtResp.json();
        const jobIds = [...new Set(events.map(e => e.job_id).filter(Boolean))];
        if (jobIds.length === 0) return [];

        type JobRow = { job_id: string; job_owner: string; lead_source: string | null; stage: string | null; status: string | null; stage_category: string | null };
        const jobMap = new Map<string, JobRow>();
        for (let i = 0; i < jobIds.length; i += 200) {
            const chunk = jobIds.slice(i, i + 200);
            const jobParams = new URLSearchParams({
                select: 'job_id,job_owner,lead_source,stage,status,stage_category',
                workflow: 'eq.Retail',
                'job_id': `in.(${chunk.join(',')})`,
                'job_owner': 'not.is.null',
            });
            const jobResp = await fetch(`${SUPABASE_URL}/rest/v1/jobs?${jobParams}`, { headers: sbHeaders });
            if (jobResp.ok) {
                const jobs: JobRow[] = await jobResp.json();
                for (const j of jobs) jobMap.set(j.job_id, j);
            }
        }

        const EXCLUDED_SOURCES = new Set(['self gen', 'door knocking']);
        const EXCLUDED_STAGES = new Set(['unqualified', 'appointment scheduled', 'not pitched', 'needs rescheduled', 'new lead', 'door knocking leads']);
        const repStats = new Map<string, { name: string; won: number; total: number }>();
        for (const jobId of jobIds) {
            const job = jobMap.get(jobId);
            if (!job) continue;
            if (job.lead_source && EXCLUDED_SOURCES.has(job.lead_source.toLowerCase())) continue;
            if (job.stage && EXCLUDED_STAGES.has(job.stage.toLowerCase())) continue;
            const key = job.job_owner;
            if (!repStats.has(key)) {
                repStats.set(key, { name: key, won: 0, total: 0 });
            }
            const stats = repStats.get(key)!;
            stats.total++;
            if (job.stage_category === 'won') stats.won++;
        }

        const results: ClosingRateDetail[] = [];
        for (const stats of repStats.values()) {
            if (stats.total >= 3) {
                results.push({ name: stats.name, won: stats.won, total: stats.total, rate: stats.won / stats.total, rank: 0 });
            }
        }
        results.sort((a, b) => b.rate - a.rate);
        results.forEach((r, i) => { r.rank = i + 1; });
        return results;
    } catch (error) {
        console.error("Error fetching closing rate details:", error);
        return [];
    }
}

async function fetchClosingRates(): Promise<Map<string, number>> {
    const rankMap = new Map<string, number>();
    const sbHeaders = {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    };
    try {
        // Closing rate = won / total appointments ran in last 30 days
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 30);
        const cutoffStr = cutoff.toISOString().split('T')[0]; // YYYY-MM-DD

        // 1. Fetch sales appointments from last 30 days (unique job_ids)
        const evtParams = new URLSearchParams({
            select: 'job_id',
            category: 'eq.sales',
            'start_date': `gte.${cutoffStr}`,
        });
        const evtResp = await fetch(`${SUPABASE_URL}/rest/v1/calendar_events?${evtParams}`, { headers: sbHeaders });
        if (!evtResp.ok) {
            console.warn(`Failed to fetch calendar events: ${evtResp.statusText}`);
            return rankMap;
        }
        const events: { job_id: string }[] = await evtResp.json();
        const jobIds = [...new Set(events.map(e => e.job_id).filter(Boolean))];
        if (jobIds.length === 0) return rankMap;

        // 2. Fetch job outcomes for those job_ids (batch in chunks of 200)
        type JobRow = { job_id: string; job_owner: string; lead_source: string | null; stage: string | null; status: string | null; stage_category: string | null };
        const jobMap = new Map<string, JobRow>();
        for (let i = 0; i < jobIds.length; i += 200) {
            const chunk = jobIds.slice(i, i + 200);
            const jobParams = new URLSearchParams({
                select: 'job_id,job_owner,lead_source,stage,status,stage_category',
                workflow: 'eq.Retail',
                'job_id': `in.(${chunk.join(',')})`,
                'job_owner': 'not.is.null',
            });
            const jobResp = await fetch(`${SUPABASE_URL}/rest/v1/jobs?${jobParams}`, { headers: sbHeaders });
            if (jobResp.ok) {
                const jobs: JobRow[] = await jobResp.json();
                for (const j of jobs) jobMap.set(j.job_id, j);
            }
        }

        // 3. Group by rep: count won vs total appointments (apply source/stage exclusions)
        const EXCLUDED_SOURCES = new Set(['self gen', 'door knocking']);
        const EXCLUDED_STAGES = new Set(['unqualified', 'appointment scheduled', 'not pitched', 'needs rescheduled', 'new lead', 'door knocking leads']);
        const repStats = new Map<string, { won: number; total: number }>();
        for (const jobId of jobIds) {
            const job = jobMap.get(jobId);
            if (!job) continue;
            if (job.lead_source && EXCLUDED_SOURCES.has(job.lead_source.toLowerCase())) continue;
            if (job.stage && EXCLUDED_STAGES.has(job.stage.toLowerCase())) continue;
            const normalized = normalizeName(job.job_owner);
            if (!normalized) continue;
            if (!repStats.has(normalized)) {
                repStats.set(normalized, { won: 0, total: 0 });
            }
            const stats = repStats.get(normalized)!;
            stats.total++;
            if (job.stage_category === 'won') stats.won++;
        }

        // 4. Rank by closing rate (min 3 appointments)
        const repRates: { normalized: string; rate: number }[] = [];
        for (const [name, stats] of repStats) {
            if (stats.total >= 3) {
                repRates.push({ normalized: name, rate: stats.won / stats.total });
            }
        }
        repRates.sort((a, b) => b.rate - a.rate);

        repRates.forEach((rep, index) => {
            rankMap.set(rep.normalized, index + 1);
        });

        console.log(`Fetched closing rates for ${rankMap.size} reps from Supabase (30-day appointments)`);
    } catch (error) {
        console.error("Error fetching closing rates:", error);
    }
    return rankMap;
}

async function fetchAssignmentRankings(): Promise<Map<string, number>> {
    const [profitRankings, closingRateRankings] = await Promise.all([
        fetchProfitRankings(),
        fetchClosingRates(),
    ]);

    // Profit ranking (Management tab logic) is primary. Reps it can't rank —
    // not enough appointments in the window, or excluded from the Management
    // view — fall back to their 30-day close-rate order, after all
    // profit-ranked reps.
    const combinedRankings = new Map(profitRankings);
    const fallback = [...closingRateRankings.entries()]
        .filter(([name]) => !combinedRankings.has(name))
        .sort((a, b) => a[1] - b[1]);
    for (const [name] of fallback) {
        combinedRankings.set(name, combinedRankings.size + 1);
    }

    console.log(`Loaded assignment rankings: ${profitRankings.size} profit-ranked reps, ${fallback.length} close-rate fallback reps`);
    return combinedRankings;
}

// Fetches and parses the rep skills from the 'Appointment Blocks' sheet.
async function fetchRepSkills(): Promise<Map<string, { skills: Record<string, number>, zipCodes: string[] }>> {
    const skillsMap = new Map<string, { skills: Record<string, number>, zipCodes: string[] }>();
    try {
        const url = buildSheetsUrl(SPREADSHEET_ID, `'${SKILLS_SHEET_TITLE}'!${SKILLS_DATA_RANGE}`);
        const response = await fetchWithRetry(url);
        if (!response.ok) {
            console.error(`Failed to fetch skills sheet: ${response.statusText}`);
            return skillsMap; // Return empty map on failure
        }
        const data = await response.json();
        const values = data.values;

        if (!values || values.length < 2) {
            console.warn('Skills sheet is empty or has only a header.');
            return skillsMap;
        }

        const headers = values[0].map((h: string) => h.trim());
        const skillRows = values.slice(1);

        const zipCodeColumnIndex = headers.findIndex(h => h.toLowerCase().includes('zip'));

        for (const currentRow of skillRows) {
            const repName = currentRow[0];
            if (!repName) continue; // Skip empty rows

            const normalizedName = normalizeName(repName);
            const skills: Record<string, number> = {};

            // Every headed column except Rep (A) and the Zip column is a skill — the sheet
            // has columns on both sides of Zip Code (…Commercial | Zip | 2 Story Ladder,
            // Veteran, Stories, Spanish). Binary columns use "Yes"-style marks → 1.
            headers.forEach((skillName: string, dataColumnIndex: number) => {
                if (dataColumnIndex === 0 || dataColumnIndex === zipCodeColumnIndex || !skillName) return;
                const raw = String(currentRow[dataColumnIndex] ?? '').trim();
                if (!raw) return;
                const skillValue = parseInt(raw, 10);
                skills[skillName] = !isNaN(skillValue) ? skillValue : (/^(yes|y|x|si|sí|✓|true)$/i.test(raw) ? 1 : 0);
            });

            let zipCodes: string[] = [];
            if (zipCodeColumnIndex > -1 && currentRow[zipCodeColumnIndex]) {
                const zipString = String(currentRow[zipCodeColumnIndex]);
                zipCodes = zipString.split(/[,;\s]+/).map(zip => zip.trim()).filter(Boolean);
            }

            skillsMap.set(normalizedName, { skills, zipCodes });
        }
    } catch (error) {
        console.error("Error fetching or parsing rep skills:", error);
    }
    return skillsMap;
}

async function fetchNorthRoutingConfig(): Promise<void> {
    const zones: ConfigurableNorthZone[] = ['I17', 'SR87', 'FLAGSTAFF'];
    const parsedConfig = new Map<ConfigurableNorthZone, NorthRoutingZoneConfig>();
    const appliedZones: ConfigurableNorthZone[] = [];

    try {
        const url = buildSheetsUrl(SPREADSHEET_ID, `'Appointment Blocks'!A40:C45`);
        const response = await fetchWithRetry(url);
        if (response.ok) {
            const data = await response.json();
            const values = Array.isArray(data.values) ? data.values : [];

            values.forEach((row: unknown[]) => {
                const zone = String(row[0] || '').trim().toUpperCase() as ConfigurableNorthZone;
                if (!zones.includes(zone)) return;

                const repNamePrefixes: string[] = [];
                const zipPrefixes: string[] = [];
                String(row[1] || '').split(',').map(entry => entry.trim()).filter(Boolean).forEach(entry => {
                    const zipMatch = entry.match(/^ZIP:(.+)$/i);
                    if (zipMatch) {
                        zipPrefixes.push(zipMatch[1].trim());
                    } else {
                        repNamePrefixes.push(entry.toLowerCase());
                    }
                });

                parsedConfig.set(zone, {
                    repNamePrefixes,
                    zipPrefixes,
                    cities: String(row[2] || '').split(',').map(city => city.trim().toLowerCase()).filter(Boolean),
                });
            });

        }
    } catch {
        // Defaults remain active when the routing block cannot be loaded.
    }

    zones.forEach(zone => {
        resetNorthRoutingZoneDefault(zone);
        const config = parsedConfig.get(zone);
        if (config && applyNorthRoutingZoneConfig(zone, config)) appliedZones.push(zone);
    });

    const defaultZones = zones.filter(zone => !appliedZones.includes(zone));
    console.log(appliedZones.length > 0
        ? `North routing config applied from sheet for ${appliedZones.join(', ')}; defaults kept for ${defaultZones.join(', ') || 'none'}.`
        : 'North routing config defaults kept; sheet config was unavailable or empty.');
}

/**
 * Fetches Job IDs and addresses from the Apt Outcome Tracker via our Vercel API route.
 * The API route uses service account auth so the sheet doesn't need to be public.
 * @returns A promise resolving to a Map where the key is a normalized address and the value is the Roofr Job ID.
 */
export async function fetchRoofrJobIds(): Promise<Map<string, string>> {
    const addressToIdMap = new Map<string, string>();
    try {
        const response = await fetchWithRetry('/api/roofr-jobs');
        if (!response.ok) {
            console.warn(`Failed to fetch Roofr job IDs: ${response.statusText}`);
            return addressToIdMap;
        }
        const data = await response.json();
        const values = data.values; // Array of [address, jobId] pairs

        if (!values || values.length === 0) {
            console.warn('No Roofr job IDs returned from API.');
            return addressToIdMap;
        }

        let successCount = 0;

        values.forEach((row: any[]) => {
            const [address, jobId] = row;
            if (jobId && address) {
                const normalizedAddress = normalizeAddressForMatching(String(address));
                if (normalizedAddress && !addressToIdMap.has(normalizedAddress)) {
                    addressToIdMap.set(normalizedAddress, String(jobId));
                    successCount++;
                }
            }
        });

        console.log(`Loaded ${successCount} Roofr job IDs from Apt Outcome Tracker`);
    } catch (error) {
        console.error("Error fetching Roofr job IDs:", error);
    }
    return addressToIdMap;
}

/**
 * Fetches rep availability data directly from the Google Sheets API based on the visual layout.
 * This requires the spreadsheet to be public ("Anyone with the link can view").
 * @param date The date for which to fetch availability. Defaults to today.
 */
/**
 * Lightweight slot-layout lookup for a date's week tab. Used by the Today Board,
 * whose selected date can differ from the day loaded in the planner (a storm week
 * has 5 slots while today runs 4). Reads only the right-side slot labels (I2:I12):
 * the rows between the "Appointment…" header and the "Total" row. 5 labels ->
 * ts-1..ts-5 with the sheet's labels; anything else -> the standard TIME_SLOTS.
 */
export async function fetchTimeSlotsForDate(date: Date): Promise<TimeSlot[]> {
    try {
        const metaResponse = await fetchWithRetry(buildSheetsUrl(SPREADSHEET_ID));
        if (!metaResponse.ok) return TIME_SLOTS;
        const metaData = await metaResponse.json();
        const sheetName = findSheetNameForDate(date, metaData.sheets);
        if (!sheetName) return TIME_SLOTS;
        const resp = await fetchWithRetry(buildSheetsUrl(SPREADSHEET_ID, `'${sheetName}'!I2:I12`, 'FORMATTED_VALUE'));
        if (!resp.ok) return TIME_SLOTS;
        const rows: string[] = (((await resp.json()).values || []) as any[][]).map(r => String(r?.[0] || '').trim());
        const headerIdx = rows.findIndex(v => v.toUpperCase().startsWith('APPOINTMENT'));
        if (headerIdx < 0) return TIME_SLOTS;
        const labels: string[] = [];
        for (let i = headerIdx + 1; i < rows.length; i++) {
            if (!rows[i] || rows[i].toUpperCase().startsWith('TOTAL')) break;
            labels.push(rows[i]);
        }
        if (labels.length === 5) return labels.map((label, i) => ({ id: `ts-${i + 1}`, label }));
        return TIME_SLOTS;
    } catch {
        return TIME_SLOTS;
    }
}

export async function fetchSheetData(date: Date = new Date()): Promise<{ reps: Omit<Rep, 'schedule'>[], sheetName: string, timeSlots: TimeSlot[] }> {
    let sheetName = '';
    try {
        // 0. Fetch skills, routing config, and sales rankings data in parallel
        const skillsPromise = fetchRepSkills();
        const routingConfigPromise = fetchNorthRoutingConfig();
        const ranksPromise = fetchAssignmentRankings(); // Profit/Appt ranking (Management tab logic) first, then 30-day close rate fallback

        // 1. Get spreadsheet metadata to find the current sheet name
        const metaUrl = buildSheetsUrl(SPREADSHEET_ID);
        const metaResponse = await fetchWithRetry(metaUrl);
        if (!metaResponse.ok) {
            throw new Error(`Failed to fetch spreadsheet metadata (Status: ${metaResponse.status}). Is the spreadsheet ID correct and public?`);
        }
        const metaData = await metaResponse.json();

        const foundSheetName = findSheetNameForDate(date, metaData.sheets);

        if (!foundSheetName) {
            throw new Error(`No sheet found in the spreadsheet with the prefix "${SHEET_TITLE_PREFIX}".`);
        }
        sheetName = foundSheetName;

        // 2. Fetch the data from the specified range, getting the formatted values.
        const dataUrl = buildSheetsUrl(SPREADSHEET_ID, `'${sheetName}'!${DATA_RANGE}`, 'FORMATTED_VALUE');
        const dataResponse = await fetchWithRetry(dataUrl);
        if (!dataResponse.ok) {
            throw new Error(`Failed to fetch sheet data (Status: ${dataResponse.status}). Check API key and spreadsheet permissions.`);
        }
        const data = await dataResponse.json();
        const values = data.values;
        if (!values || values.length < 2) { // Need at least header and one data row
            console.warn("Sheet has no data or only a header row.");
            if (USE_MOCK_DATA_ON_FAILURE) return { reps: MOCK_REPS_DATA.map(rep => ({ ...rep, isMock: true })), sheetName: 'Mock Data', timeSlots: TIME_SLOTS };
            return { reps: [], sheetName, timeSlots: TIME_SLOTS };
        }

        // 3. Parse header row to dynamically find day columns
        const headerRow = values[0];
        const days: { name: string; colIndex: number }[] = [];
        const dayRegex = /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i;

        headerRow.forEach((cell: any, index: number) => {
            if (index > 0 && cell) { // Skip first column (A)
                const cellAsString = String(cell); // Ensure value is a string before trimming
                const match = cellAsString.trim().match(dayRegex);
                if (match) {
                    // Normalize day name to proper case (e.g., "Monday" not "MONDAY")
                    const normalizedDayName = match[0].charAt(0).toUpperCase() + match[0].slice(1).toLowerCase();
                    days.push({ name: normalizedDayName, colIndex: index });
                }
            }
        });

        if (days.length === 0) {
            throw new Error("Could not find valid day headers in row 2 (e.g., 'Monday 10/27').");
        }

        // 4. Parse data rows into Rep structure
        const repsMap = new Map<string, { name: string; unavailableSlots: Record<string, Set<string>>; firstRowIndex: number; region: Rep['region'] }>();
        // Dynamic time range detection — matches any "Xam - Ypm" pattern regardless of specific times
        const timeRangeRegex = /(\d{1,2}(?::\d{2})?\s*[ap]m\s*-\s*\d{1,2}(?::\d{2})?\s*[ap]m)\s*$/i;
        // Auto-assign slot IDs (ts-1, ts-2, ...) in order of first appearance
        const timeSlotLabelsToIds = new Map<string, { id: string; label: string }>();
        let nextSlotNum = 1;
        const dataRows = values.slice(1);

        let currentRepContext: string | null = null;
        let currentRegion: Rep['region'] | null = null;

        for (const [rowIndex, row] of dataRows.entries()) {
            const firstCol = String(row?.[0] || '').trim();
            const sectionBanner = String(row?.[1] || '').trim().toUpperCase();
            if (sectionBanner.includes('PHOENIX')) currentRegion = 'PHX';
            else if (sectionBanner.includes('NORTHERN')) currentRegion = 'NORTH';
            else if (sectionBanner.includes('TUCSON')) currentRegion = 'SOUTH';
            else if (sectionBanner.includes('COMMERCIAL')) currentRegion = 'COMMERCIAL';
            else if (sectionBanner.includes('MANAGEMENT') || sectionBanner.includes('GRINGO')) currentRegion = null;
            if (sectionBanner.includes('PHOENIX') || sectionBanner.includes('NORTHERN') || sectionBanner.includes('TUCSON') ||
                sectionBanner.includes('COMMERCIAL') || sectionBanner.includes('MANAGEMENT') || sectionBanner.includes('GRINGO')) {
                currentRepContext = null;
                continue;
            }
            if (!firstCol) {
                currentRepContext = null;
                continue;
            }

            if (firstCol.toUpperCase() === firstCol && firstCol.replace(/[^A-Z\s]/g, '').length > 1) {
                currentRepContext = null;
                continue;
            }

            let wasRowProcessed = false;

            const timeMatch = firstCol.match(timeRangeRegex);
            if (timeMatch) {
                    if (currentRegion === null) {
                        wasRowProcessed = true;
                        continue;
                    }
                    const matchedLabel = timeMatch[1].toLowerCase().replace(/\s+/g, ' ');
                    if (!timeSlotLabelsToIds.has(matchedLabel)) {
                        timeSlotLabelsToIds.set(matchedLabel, { id: `ts-${nextSlotNum++}`, label: timeMatch[1].trim().replace(/\s+/g, ' ') });
                    }
                    const slotId = timeSlotLabelsToIds.get(matchedLabel)!.id;
                    let repName = firstCol.replace(timeRangeRegex, '').trim().replace(/:$/, '').trim();

                    if (!repName && currentRepContext) {
                        repName = currentRepContext;
                    }

                    if (!repName) {
                        wasRowProcessed = true;
                    } else {

                    currentRepContext = repName;

                    if (!repsMap.has(repName)) {
                        repsMap.set(repName, {
                            name: repName,
                            unavailableSlots: Object.fromEntries(days.map(d => [d.name, new Set()])),
                            firstRowIndex: rowIndex + 3, // DATA_RANGE begins at row 2; dataRows begins at row 3.
                            region: currentRegion,
                        });
                    }

                    const repData = repsMap.get(repName)!;
                    days.forEach(day => {
                        const availabilityMark = row[day.colIndex];

                        // New, more robust availability logic. Default to AVAILABLE unless explicitly marked otherwise.
                        // This handles empty cells, "TRUE", boolean true, and '✅' as AVAILABLE.
                        // It handles "FALSE", boolean false, and any other text as UNAVAILABLE.
                        const availabilityMarkStr = String(availabilityMark ?? '').trim();
                        const isExplicitlyUnavailable =
                            availabilityMark === false ||
                            availabilityMarkStr.toUpperCase() === 'FALSE' ||
                            (availabilityMarkStr !== '' && availabilityMarkStr.toUpperCase() !== 'TRUE' && availabilityMarkStr !== '✅');

                        if (isExplicitlyUnavailable) {
                            repData.unavailableSlots[day.name].add(slotId);
                        }
                    });

                    wasRowProcessed = true;
                    } // end else (repName exists)
            }

            if (!wasRowProcessed && firstCol) {
                currentRepContext = firstCol.replace(/:$/, '').trim();
            }
        }

        const skillsMap = await skillsPromise;
        await routingConfigPromise;
        const rankingsMap = await ranksPromise;
        const discoveredTimeSlots = Array.from(timeSlotLabelsToIds.values()).map(({ id, label }) => ({ id, label }));
        const timeSlots = discoveredTimeSlots.length === 5 ? discoveredTimeSlots : TIME_SLOTS;

        // 5. Convert the map into the final array of Rep objects and merge skills
        const reps: Omit<Rep, 'schedule'>[] = Array.from(repsMap.values()).map((repData, index) => {
            const availableDaysSummary: string[] = [];
            days.forEach(day => {
                const unavailableCount = repData.unavailableSlots[day.name]?.size || 0;
                if (unavailableCount < timeSlots.length) {
                    availableDaysSummary.push(day.name.substring(0, 3));
                }
            });

            const availability = availableDaysSummary.join(', ') || 'Not available';

            const finalUnavailableSlots: Record<string, string[]> = {};
            for (const day in repData.unavailableSlots) {
                finalUnavailableSlots[day] = Array.from(repData.unavailableSlots[day]);
            }

            const displayName = cleanDisplayName(repData.name);
            const normalizedName = normalizeName(displayName); // Use the cleaned name for normalization

            const repInfo = skillsMap.get(normalizedName);
            const skills = repInfo?.skills;
            const zipCodes = repInfo?.zipCodes;
            const salesRank = rankingsMap.get(normalizedName);

            const { firstRowIndex, region } = repData;

            return {
                id: `rep-${index + 1}-${displayName.replace(/\s+/g, '-')}`,
                name: displayName,
                availability,
                unavailableSlots: finalUnavailableSlots,
                skills,
                zipCodes,
                region,
                salesRank,
                sourceRow: firstRowIndex // Track source row for filtering
            }
        });

        if (reps.length === 0) {
            console.warn("Successfully connected and data was found, but no valid rep data could be parsed. Check the sheet format.");
            if (USE_MOCK_DATA_ON_FAILURE) {
                return { reps: MOCK_REPS_DATA.map(rep => ({ ...rep, isMock: true })), sheetName: 'Mock Data', timeSlots: TIME_SLOTS };
            }
        }

        return { reps, sheetName, timeSlots };

    } catch (error) {
        console.error("Error fetching from Google Sheets API:", error);
        if (USE_MOCK_DATA_ON_FAILURE) {
            console.warn("Google Sheets fetch failed. Falling back to mock data.");
            return { reps: MOCK_REPS_DATA.map(rep => ({ ...rep, isMock: true })), sheetName: 'Mock Data', timeSlots: TIME_SLOTS };
        } else {
            throw error;
        }
    }
}

/**
 * Fetches a single cell's value from a given sheet.
 * @param cell The cell reference (e.g., "A1").
 * @param sheetName The name of the sheet to query.
 * @returns The value of the cell as a string.
 */
export async function fetchSheetCell(cell: string, sheetName: string): Promise<string> {
    if (!sheetName) {
        throw new Error('Sheet name must be provided to fetch a cell.');
    }
    const url = buildSheetsUrl(SPREADSHEET_ID, `'${sheetName}'!${cell}`, 'FORMATTED_VALUE');

    try {
        const response = await fetchWithRetry(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch cell ${cell} (Status: ${response.status})`);
        }
        const data = await response.json();
        const value = data.values?.[0]?.[0];

        if (value === undefined || value === null || value === "") {
            return '(empty)';
        }
        return String(value);
    } catch (err) {
        console.error(`Error fetching cell data for ${cell} from ${sheetName}:`, err);
        throw new Error(`Could not retrieve data for cell ${cell}.`);
    }
}

/**
 * Appointment data returned from the roofr-appointments API endpoint.
 */
export interface SheetAppointment {
    eventId: string;
    jobId: string;
    address: string;
    title: string;
    start: string;    // "YYYY-MM-DD HH:MM:SS"
    end: string;      // "YYYY-MM-DD HH:MM:SS"
    allDay: string;
    category: string;
    type: string;
    attendees: string; // comma-separated rep names
    customerName: string;
    masterAddress: string;
    jobOwner: string;
    workflow: string;
    tags: string;
    eventSubtype?: string;                          // Roofr event subtype
    kind?: 'self_gen' | 'followup' | 'adjuster' | 'sales'; // derived classification
    pinned?: boolean;                               // true for self-gen / follow-up / adjuster
    lat?: number | null;                            // Known coordinates from Roofr-search (jobs.latitude)
    lng?: number | null;                            // Known coordinates from Roofr-search (jobs.longitude)
}

/**
 * Fetches sales appointments for a given date from the Calendar Events sheet
 * via the roofr-appointments API endpoint (service account auth).
 * @param date Date string in YYYY-MM-DD format
 * @returns Array of SheetAppointment objects
 */
export async function fetchAppointmentsFromSheet(date: string): Promise<SheetAppointment[]> {
    try {
        const response = await fetchWithRetry(`/api/roofr-appointments?date=${encodeURIComponent(date)}`);
        if (!response.ok) {
            console.warn(`Failed to fetch appointments from sheet: ${response.statusText}`);
            return [];
        }
        const data = await response.json();
        return data.appointments || [];
    } catch (error) {
        console.error("Error fetching appointments from sheet:", error);
        return [];
    }
}
