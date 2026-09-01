/**
 * South rotation — whose turn it is to take the Limited corridor or Tucson.
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
    ROTATION_WINDOW_DAYS,
    ROOFR_USER_ID_TO_REP,
    ROOFR_NON_REP_USER_IDS,
} from '../constants';
import { normalizeName } from './googleSheetsService';
import { isCommercialOnlyRep, isFieldSalesRep } from '../utils/repUtils';
import type {
    Rep,
    RotationConfig,
    RotationEntry,
    RotationQueue,
    RotationQueueId,
    RotationState,
} from '../types';

export interface RotationArea {
    name: string;
    poly: [number, number][];   // [lat, lng] rings, in precedence order
}

interface TripStat {
    last: string | null;   // YYYY-MM-DD
    days: number;          // distinct days, not appointments
    scheduled: boolean;    // last is today or later — already booked to go
}

export interface RotationData {
    areas: RotationArea[];
    areaPublished: Record<RotationQueueId, boolean>;
    trips: Record<RotationQueueId, Record<string, TripStat>>;
    /** Attendee ids seen on southern appointments that map to no rep — see below. */
    unmappedAttendeeIds: string[];
    windowDays: number;
    loadedAt: number;
    error?: string;
}

const sbHeaders = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };

/** Local YYYY-MM-DD. Never toISOString() — that shifts the day in MST. */
export const dayKey = (d: Date): string =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

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
 * Which queue owns this point, or null. Precedence decides overlaps exactly as
 * the editor shows it: the area listed higher names the address. Every area is
 * considered, not just the two we care about — a corridor point that Phoenix
 * wins belongs to neither queue.
 */
export const classifyPoint = (
    lat: number,
    lng: number,
    areas: RotationArea[],
): RotationQueueId | null => {
    for (const area of areas) {
        if (!pointInPolygon(lat, lng, area.poly)) continue;
        if (area.name === ROTATION_AREA_NAMES.limited) return 'limited';
        if (area.name === ROTATION_AREA_NAMES.tucson) return 'tucson';
        return null;   // a higher-precedence area claimed it
    }
    return null;
};

async function fetchServiceAreas(): Promise<RotationArea[]> {
    const resp = await fetch(SERVICE_AREA_API, { cache: 'no-store' });
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
async function fetchTrips(areas: RotationArea[]): Promise<Pick<RotationData, 'trips' | 'unmappedAttendeeIds'>> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - ROTATION_WINDOW_DAYS);

    // start_date is TEXT ('2026-03-12 13:00:00'), so this is a string compare.
    const events = await fetchPaged(
        `calendar_events?select=event_id,job_id,start_date,attendees` +
        `&category=eq.sales&start_date=gte.${dayKey(cutoff)}&order=start_date.asc,event_id.asc`,
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

    // Coordinates. latitude/longitude are TEXT columns — guard before Number().
    const jobIds = [...new Set(wanted.map(w => w.jobId))];
    const coords = new Map<string, { lat: number; lng: number }>();
    for (let i = 0; i < jobIds.length; i += 200) {
        const chunk = jobIds.slice(i, i + 200);
        const resp = await fetch(
            `${SUPABASE_URL}/rest/v1/jobs?select=job_id,latitude,longitude&job_id=in.(${chunk.join(',')})`,
            { headers: sbHeaders },
        );
        if (!resp.ok) continue;
        for (const row of await resp.json()) {
            const lat = Number(row.latitude), lng = Number(row.longitude);
            if (Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0) {
                coords.set(String(row.job_id), { lat, lng });
            }
        }
    }

    const seen: Record<RotationQueueId, Map<string, Set<string>>> = {
        limited: new Map(), tucson: new Map(),
    };
    const unmapped = new Set<string>();
    for (const { jobId, day, reps, unknown } of wanted) {
        const c = coords.get(jobId);
        if (!c) continue;                       // no coordinates, no classification
        const queue = classifyPoint(c.lat, c.lng, areas);
        if (!queue) continue;
        // Only ids seen on a SOUTHERN appointment are worth flagging — an
        // unmapped id that never goes south costs this feature nothing.
        for (const id of unknown) unmapped.add(id);
        for (const repKey of reps) {
            if (!seen[queue].has(repKey)) seen[queue].set(repKey, new Set());
            seen[queue].get(repKey)!.add(day);
        }
    }

    const today = dayKey(new Date());
    const trips = { limited: {}, tucson: {} } as RotationData['trips'];
    (['limited', 'tucson'] as RotationQueueId[]).forEach(q => {
        for (const [repKey, days] of seen[q]) {
            const sorted = [...days].sort();
            const last = sorted[sorted.length - 1] || null;
            trips[q][repKey] = { last, days: days.size, scheduled: !!last && last >= today };
        }
    });

    return { trips, unmappedAttendeeIds: [...unmapped].sort() };
}

export async function fetchRotationData(): Promise<RotationData> {
    const empty: RotationData = {
        areas: [],
        areaPublished: { limited: false, tucson: false },
        trips: { limited: {}, tucson: {} },
        unmappedAttendeeIds: [],
        windowDays: ROTATION_WINDOW_DAYS,
        loadedAt: Date.now(),
    };
    try {
        const areas = await fetchServiceAreas();
        const { trips, unmappedAttendeeIds } = await fetchTrips(areas);
        return {
            ...empty,
            areas,
            areaPublished: {
                limited: areas.some(a => a.name === ROTATION_AREA_NAMES.limited),
                tucson: areas.some(a => a.name === ROTATION_AREA_NAMES.tucson),
            },
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
        const stat = data.trips[queue][repKey];
        const entry: RotationEntry = {
            repName: rep.name.trim(),
            repKey,
            lastTrip: stat?.last ?? null,
            trips: stat?.days ?? 0,
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
        areas: data.areas,
        unmappedAttendeeIds: data.unmappedAttendeeIds,
        windowDays: data.windowDays,
        loadedAt: data.loadedAt,
        error: data.error,
    };
}

export const EXCLUSION_LABELS: Record<NonNullable<RotationEntry['excludedBy']>, string> = {
    'tucson-resident': 'Tucson resident',
    'commercial': 'Commercial only',
    'not-field-sales': 'Not field sales',
    'skipped': 'Skipped by hand',
};
