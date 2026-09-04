/**
 * Travel rotation — whose turn it is to take the Limited corridor, Tucson, or
 * the long drive up north.
 *
 * Two halves, deliberately split:
 *   fetchRotationData()  the network part (polygons + trip history), cached
 *   buildRotation()      a pure function over reps + config, so toggling a skip
 *                        re-orders the queues instantly without refetching.
 *
 * Regions are NOT defined here. They come from the boundary editor's published
 * shapes (speed-to-leads /api/service-area), so the corridor has exactly one
 * definition company-wide and redrawing it on the map is the only edit needed.
 */

import {
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    SERVICE_AREA_API,
    ROTATION_AREA_NAMES,
    ROTATION_NORTH_MIN_LAT,
    ROTATION_WINDOW_DAYS,
    ROOFR_USER_ID_TO_REP,
    ROOFR_NON_REP_USER_IDS,
    ROTATION_NON_REP_ROWS,
} from '../constants';
import { normalizeName } from './googleSheetsService';
import { isCommercialOnlyRep, isFieldSalesRep } from '../utils/repUtils';
import { ROTATION_QUEUE_IDS } from '../types';
import type {
    Rep,
    RotationConfig,
    RotationEntry,
    RotationQueue,
    RotationQueueId,
    RotationState,
} from '../types';

/** One empty value per queue, so adding a queue never leaves a record half-filled. */
const byQueue = <T,>(make: () => T): Record<RotationQueueId, T> =>
    Object.fromEntries(ROTATION_QUEUE_IDS.map(q => [q, make()])) as Record<RotationQueueId, T>;

export interface RotationArea {
    name: string;
    poly: [number, number][];   // [lat, lng] rings, in precedence order
}

/** Local YYYY-MM-DD. Never toISOString() — that shifts the day in MST. */
export const dayKey = (d: Date): string =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * The slice of history the page is reading, both ends inclusive, YYYY-MM-DD.
 *
 * `to: null` means "no upper bound", which is what every rolling window uses —
 * and it matters. Future-dated events are how a rep already booked south counts
 * as having taken their turn; cap the range at today and that stops working.
 * An explicit historical range loses the booked flag on purpose: nothing was
 * "already booked" as of a window that closed in March.
 */
export interface RotationRange {
    from: string;
    to: string | null;
}

/** The last N days, open-ended at the top so future bookings still count. */
export const rollingRange = (days: number): RotationRange => {
    const from = new Date();
    from.setDate(from.getDate() - days);
    return { from: dayKey(from), to: null };
};

/** start_date is TEXT ('2026-03-12 13:00:00'), so an inclusive upper bound has
 *  to be `lt. the next day` — `lte.2026-03-12` would drop everything with a
 *  time on it, i.e. every appointment that day. */
const nextDayKey = (key: string): string => {
    const [y, m, d] = key.split('-').map(Number);
    return dayKey(new Date(y, m - 1, d + 1));
};

interface TripStat {
    last: string | null;   // YYYY-MM-DD
    days: number;          // distinct days, not appointments
    appts: number;         // appointments run in the region
    won: number;           // distinct WON jobs among them (not appointments)
    wonValue: number;      // summed jobs.value of those won jobs, in dollars
    scheduled: boolean;    // last is today or later — already booked to go
}

export interface RotationData {
    areas: RotationArea[];
    areaPublished: Record<RotationQueueId, boolean>;
    trips: Record<RotationQueueId, Record<string, TripStat>>;
    /** Attendee ids seen on southern appointments that map to no rep — see below. */
    unmappedAttendeeIds: string[];
    range: RotationRange;
    loadedAt: number;
    error?: string;
}

const sbHeaders = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };

/**
 * Ray casting, identical in behaviour to the boundary editor's own inPoly so a
 * point reads the same way in both tools.
 */
export const pointInPolygon = (lat: number, lng: number, poly: [number, number][]): boolean => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const yi = poly[i][0], xi = poly[i][1], yj = poly[j][0], xj = poly[j][1];
        if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
};

/**
 * Which queue owns this point, or null.
 *
 * This deliberately IGNORES the editor's precedence order, because the two
 * tools ask different questions. Precedence answers "which single area names
 * this address" — what the CSR banner and the decline log need. The rotation
 * asks "did the rep actually drive out there", which is a plain geographic
 * question about the shape.
 *
 * Honouring precedence here meant a corridor carve-out drawn INSIDE Phoenix
 * was invisible: Phoenix sits above it, claims every corridor town, and the
 * queue stays permanently empty while looking correctly configured. The fix
 * is not to make Travis outrank Phoenix company-wide — that would rename 13
 * towns in the scanner to satisfy a scheduler page. The corridor is a
 * carve-out, so it is simply checked first.
 *
 * Order is most-specific first: Limited is a carve-out, so it wins over Tucson.
 *
 * Up north is the exception — a plain latitude test, not a shape. See
 * ROTATION_NORTH_MIN_LAT: the published "North" area stops at the Verde Valley,
 * but Sedona, Flagstaff and Payson runs are the longest drives anyone does, and
 * this queue exists to measure driving.
 *
 * Phoenix is checked LAST, which is what makes it "the valley minus the
 * corridor" for free: any corridor point was already claimed two steps earlier.
 */
const QUEUE_BY_AREA: [RotationQueueId, string][] = [
    ['limited', ROTATION_AREA_NAMES.limited],
    ['tucson', ROTATION_AREA_NAMES.tucson],
];

export const classifyPoint = (
    lat: number,
    lng: number,
    areas: RotationArea[],
): RotationQueueId | null => {
    for (const [queue, areaName] of QUEUE_BY_AREA) {
        const area = areas.find(a => a.name === areaName);
        if (area && pointInPolygon(lat, lng, area.poly)) return queue;
    }
    if (lat >= ROTATION_NORTH_MIN_LAT) return 'north';
    const phoenix = areas.find(a => a.name === ROTATION_AREA_NAMES.phoenix);
    if (phoenix && pointInPolygon(lat, lng, phoenix.poly)) return 'phoenix';
    return null;
};

async function fetchServiceAreas(): Promise<RotationArea[]> {
    // The endpoint is CDN-cached (max-age 60, stale-while-revalidate 300), and
    // `cache: no-store` only governs the browser's own cache — the edge can
    // still hand back a copy up to five minutes old. That is long enough to
    // republish a boundary, reload this page, see nothing change and conclude
    // it is broken. The 30s bucket keeps repeat loads cheap while capping how
    // stale the answer can be.
    const bucket = Math.floor(Date.now() / 30000);
    const resp = await fetch(`${SERVICE_AREA_API}?t=${bucket}`, { cache: 'no-store' });
    if (!resp.ok) throw new Error(`service-area ${resp.status}`);
    const data = await resp.json();
    if (!data?.success) throw new Error('service-area payload');

    const polys: Record<string, [number, number][]> = data.service_polygons || {};
    const enabled: Record<string, boolean> = data.area_enabled || {};
    const precedence: string[] = Array.isArray(data.precedence) ? data.precedence : [];
    const names = Object.keys(polys);

    // Same ordering rule as the editor: listed precedence first, anything else last.
    return precedence
        .filter(n => polys[n])
        .concat(names.filter(n => !precedence.includes(n)))
        .filter(n => enabled[n] !== false)
        .map(n => ({ name: n, poly: polys[n] }));
}

async function fetchPaged(path: string): Promise<any[]> {
    const rows: any[] = [];
    for (let offset = 0; ; offset += 1000) {
        const resp = await fetch(`${SUPABASE_URL}/rest/v1/${path}&limit=1000&offset=${offset}`, { headers: sbHeaders });
        if (!resp.ok) throw new Error(`supabase ${resp.status}`);
        const page = await resp.json();
        rows.push(...page);
        if (page.length < 1000) return rows;
    }
}

/**
 * Trip history. A trip is a DAY with at least one appointment in the region —
 * three stops in Casa Grande is one turn, not three.
 *
 * Future-dated events count. The scheduler plans tomorrow, so a rep already
 * booked south has taken their turn; without this you would send them twice.
 */
async function fetchTrips(areas: RotationArea[], range: RotationRange): Promise<Pick<RotationData, 'trips' | 'unmappedAttendeeIds'>> {
    // start_date is TEXT ('2026-03-12 13:00:00'), so these are string compares.
    const upper = range.to ? `&start_date=lt.${nextDayKey(range.to)}` : '';
    const events = await fetchPaged(
        `calendar_events?select=event_id,job_id,start_date,attendees` +
        `&category=eq.sales&start_date=gte.${range.from}${upper}&order=start_date.asc,event_id.asc`,
    );

    // A LIST, not a map keyed by job_id: one job can carry several sales
    // appointments (a reschedule, a second rep going back out), and keying by
    // job would silently collapse them into one and undercount turns.
    const wanted: { jobId: string; day: string; reps: string[]; unknown: string[] }[] = [];
    for (const ev of events) {
        if (!ev.job_id || !ev.start_date) continue;
        const ids = String(ev.attendees || '').split(',').map((s: string) => s.trim()).filter(Boolean);
        if (!ids.length || !ids.every((id: string) => /^\d+$/.test(id))) continue;

        // Credit every mapped attendee: a ride-along to Tucson is still a day
        // spent driving to Tucson. Unmapped ids are collected, not guessed at —
        // jobs.job_owner is the booking CSR on a future appointment, so falling
        // back to it would invent trips for whoever booked them.
        const reps: string[] = [];
        const unknown: string[] = [];
        for (const id of ids) {
            const name = ROOFR_USER_ID_TO_REP[id];
            if (name) reps.push(normalizeName(name));
            else if (!ROOFR_NON_REP_USER_IDS.has(id)) unknown.push(id);
        }
        // Keep events whose only attendee is unmapped: they still tell us an id
        // is costing us accuracy, even though we cannot credit the trip.
        if (!reps.length && !unknown.length) continue;
        wanted.push({ jobId: String(ev.job_id), day: String(ev.start_date).slice(0, 10), reps, unknown });
    }

    // Coordinates + outcome. latitude/longitude are TEXT columns — guard before
    // Number(). stage_category is Roofr's own rollup; 'won' and 'completed'
    // together are "sold", which is what the job reads as on the board. won_at
    // is NOT the test: 204 jobs carry a won_at and have since gone to lost, and
    // counting a cancelled deal as a win would flatter whoever sold it.
    const jobIds = [...new Set(wanted.map(w => w.jobId))];
    const coords = new Map<string, { lat: number; lng: number }>();
    // job_id -> contract value in dollars. Only won jobs are in here. About 3%
    // of won jobs carry no value, so they land as 0 rather than dropping the
    // job from the win count — a sale with no number on it is still a sale.
    const wonValueByJob = new Map<string, number>();
    for (let i = 0; i < jobIds.length; i += 200) {
        const chunk = jobIds.slice(i, i + 200);
        const resp = await fetch(
            `${SUPABASE_URL}/rest/v1/jobs?select=job_id,latitude,longitude,stage_category,value&job_id=in.(${chunk.join(',')})`,
            { headers: sbHeaders },
        );
        if (!resp.ok) continue;
        for (const row of await resp.json()) {
            const lat = Number(row.latitude), lng = Number(row.longitude);
            if (Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0) {
                coords.set(String(row.job_id), { lat, lng });
            }
            if (row.stage_category === 'won' || row.stage_category === 'completed') {
                const v = Number(row.value);
                wonValueByJob.set(String(row.job_id), Number.isFinite(v) ? v : 0);
            }
        }
    }

    const seen = byQueue(() => new Map<string, Set<string>>());
    const appts = byQueue(() => new Map<string, number>());
    // Distinct jobs, not appointments: a second visit to the same house is a
    // second appointment but not a second sale.
    const won = byQueue(() => new Map<string, Set<string>>());
    const unmapped = new Set<string>();
    for (const { jobId, day, reps, unknown } of wanted) {
        const c = coords.get(jobId);
        if (!c) continue;                       // no coordinates, no classification
        const queue = classifyPoint(c.lat, c.lng, areas);
        if (!queue) continue;
        // Only ids seen on an OUT-OF-TOWN appointment are worth flagging — an
        // unmapped id that never leaves the valley costs this feature nothing.
        // Phoenix is explicitly excluded: it covers nearly every appointment the
        // company runs, so counting it turned a 1-id warning into a 17-id list
        // of office and CSR accounts, which is how a real signal becomes noise
        // nobody reads.
        if (queue !== 'phoenix') for (const id of unknown) unmapped.add(id);
        for (const repKey of reps) {
            if (!seen[queue].has(repKey)) seen[queue].set(repKey, new Set());
            seen[queue].get(repKey)!.add(day);
            appts[queue].set(repKey, (appts[queue].get(repKey) || 0) + 1);
            if (wonValueByJob.has(jobId)) {
                if (!won[queue].has(repKey)) won[queue].set(repKey, new Set());
                won[queue].get(repKey)!.add(jobId);
            }
        }
    }

    const today = dayKey(new Date());
    const trips = byQueue(() => ({})) as RotationData['trips'];
    ROTATION_QUEUE_IDS.forEach(q => {
        for (const [repKey, days] of seen[q]) {
            const sorted = [...days].sort();
            const last = sorted[sorted.length - 1] || null;
            const wonIds = won[q].get(repKey);
            trips[q][repKey] = {
                last,
                days: days.size,
                appts: appts[q].get(repKey) || 0,
                won: wonIds?.size || 0,
                // Summed over the deduped job ids, so a job with two appointments
                // contributes its value once.
                wonValue: wonIds
                    ? [...wonIds].reduce((sum, id) => sum + (wonValueByJob.get(id) || 0), 0)
                    : 0,
                scheduled: !!last && last >= today,
            };
        }
    });

    return { trips, unmappedAttendeeIds: [...unmapped].sort() };
}

export async function fetchRotationData(
    range: RotationRange = rollingRange(ROTATION_WINDOW_DAYS),
): Promise<RotationData> {
    const empty: RotationData = {
        areas: [],
        areaPublished: byQueue(() => false),
        trips: byQueue(() => ({})),
        unmappedAttendeeIds: [],
        range,
        loadedAt: Date.now(),
    };
    try {
        const areas = await fetchServiceAreas();
        const { trips, unmappedAttendeeIds } = await fetchTrips(areas, range);
        return {
            ...empty,
            areas,
            areaPublished: {
                ...Object.fromEntries(
                    QUEUE_BY_AREA.map(([q, name]) => [q, areas.some(a => a.name === name)]),
                ),
                // Nothing to publish: up north is a latitude rule, so this queue
                // works whether or not a "North" area exists on the map.
                north: true,
                phoenix: areas.some(a => a.name === ROTATION_AREA_NAMES.phoenix),
            } as Record<RotationQueueId, boolean>,
            trips,
            unmappedAttendeeIds,
            loadedAt: Date.now(),
        };
    } catch (err) {
        return { ...empty, error: err instanceof Error ? err.message : String(err) };
    }
}

/**
 * Why a rep is held out. Order matters — the first reason found is the one shown,
 * and the sheet-derived ones come first because they are the standing policy
 * rather than someone's decision.
 */
function exclusionFor(rep: Rep, queue: RotationQueueId, config: RotationConfig): RotationEntry['excludedBy'] {
    if (rep.region === 'SOUTH') return 'tucson-resident';
    if (isCommercialOnlyRep(rep)) return 'commercial';
    if (!isFieldSalesRep(rep)) return 'not-field-sales';
    if (config.skips[normalizeName(rep.name)]?.[queue]) return 'skipped';
    return undefined;
}

function buildQueue(
    reps: Rep[],
    queue: RotationQueueId,
    data: RotationData,
    config: RotationConfig,
): RotationQueue {
    const order: RotationEntry[] = [];
    const excluded: RotationEntry[] = [];

    for (const rep of reps) {
        if (rep.isMock) continue;
        const repKey = normalizeName(rep.name);
        if (!repKey) continue;
        // Sheet rows that are not people never take a turn, and showing them as
        // "held out" would imply someone decided to hold them out.
        if (ROTATION_NON_REP_ROWS.has(repKey)) continue;
        // Commercial reps, door knockers (Insurance section) and the Flex placeholder
        // rows never travel on rotation — leave them off the page entirely rather
        // than listing them as held out.
        if (isCommercialOnlyRep(rep) || rep.region === 'D2D' || /^flex\b/i.test(rep.name.trim())) continue;
        const stat = data.trips[queue][repKey];
        const entry: RotationEntry = {
            repName: rep.name.trim(),
            repKey,
            lastTrip: stat?.last ?? null,
            trips: stat?.days ?? 0,
            appts: stat?.appts ?? 0,
            won: stat?.won ?? 0,
            wonValue: stat?.wonValue ?? 0,
            scheduled: stat?.scheduled ?? false,
            excludedBy: exclusionFor(rep, queue, config),
        };
        (entry.excludedBy ? excluded : order).push(entry);
    }

    // Longest since their last trip first; never-been ahead of everyone. Then
    // fewest trips in the window, then name so the order never jitters.
    order.sort((a, b) => {
        if (a.lastTrip !== b.lastTrip) {
            if (a.lastTrip === null) return -1;
            if (b.lastTrip === null) return 1;
            return a.lastTrip < b.lastTrip ? -1 : 1;
        }
        if (a.trips !== b.trips) return a.trips - b.trips;
        return a.repName.localeCompare(b.repName);
    });
    excluded.sort((a, b) => a.repName.localeCompare(b.repName));

    return { order, excluded, areaPublished: data.areaPublished[queue] };
}

export function buildRotation(reps: Rep[], data: RotationData, config: RotationConfig): RotationState {
    return {
        limited: buildQueue(reps, 'limited', data, config),
        tucson: buildQueue(reps, 'tucson', data, config),
        north: buildQueue(reps, 'north', data, config),
        phoenix: buildQueue(reps, 'phoenix', data, config),
        areas: data.areas,
        unmappedAttendeeIds: data.unmappedAttendeeIds,
        range: data.range,
        loadedAt: data.loadedAt,
        error: data.error,
    };
}

export const EXCLUSION_LABELS: Record<NonNullable<RotationEntry['excludedBy']>, string> = {
    'tucson-resident': 'Tucson resident',
    'commercial': 'Commercial only',
    'not-field-sales': 'Not field sales',
    'skipped': 'Removed by hand',
};
