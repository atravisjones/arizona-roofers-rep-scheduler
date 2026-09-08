import { InsuranceCheck, RouteInfo } from '../types';
import { Coordinates, fetchRoute, geocodeAddresses } from './osmService';
import { haversineDistance } from './geography';

const KM_TO_MI = 0.621371;

/** Every job sitting in "INS: Collect ACV" — a check waiting to be picked up. */
export async function fetchInsuranceChecks(): Promise<InsuranceCheck[]> {
    try {
        const res = await fetch('/api/insurance-checks');
        if (!res.ok) {
            console.error(`Failed to fetch insurance checks: ${res.status}`);
            return [];
        }
        const data = await res.json();
        const checks: InsuranceCheck[] = Array.isArray(data?.checks) ? data.checks : [];
        return fillMissingCoords(checks);
    } catch (err) {
        console.error('Error fetching insurance checks:', err);
        return [];
    }
}

/**
 * Jobs created after the Roofr lat/lon sync stalled carry an address but no coords.
 * Resolve those through the app's cached geocoder so every check can hit the map.
 */
async function fillMissingCoords(checks: InsuranceCheck[]): Promise<InsuranceCheck[]> {
    const missing = checks.filter(c => (c.lat == null || c.lon == null) && c.address);
    if (missing.length === 0) return checks;
    try {
        const results = await geocodeAddresses(missing.map(c => c.address));
        const byAddress = new Map<string, Coordinates>();
        missing.forEach((c, i) => {
            const coord = results[i]?.coordinates;
            if (coord) byAddress.set(c.address, coord);
        });
        return checks.map(c => {
            if (c.lat != null && c.lon != null) return c;
            const coord = byAddress.get(c.address);
            return coord ? { ...c, lat: coord.lat, lon: coord.lon } : c;
        });
    } catch (err) {
        console.error('Failed to geocode insurance checks:', err);
        return checks;
    }
}

const milesBetween = (a: Coordinates, b: Coordinates) => haversineDistance(a, b) * KM_TO_MI;

/** Flatten a GeoJSON LineString / MultiLineString into [lat, lon] points. */
const routeVertices = (route: RouteInfo | null | undefined): Coordinates[] => {
    if (!route) return [];
    const geom = route.geometry;
    const pts: Coordinates[] = [];
    const push = (c: number[]) => { if (Array.isArray(c) && c.length >= 2) pts.push({ lat: c[1], lon: c[0] }); };
    if (geom?.type === 'LineString') geom.coordinates.forEach(push);
    else if (geom?.type === 'MultiLineString') geom.coordinates.forEach((line: number[][]) => line.forEach(push));
    if (pts.length === 0 && route.coordinates) return route.coordinates;
    return pts;
};

/**
 * Straight-line miles from a check to the closest point on the rep's route.
 * OSRM geometry is dense enough that vertex distance is a fine proxy for a detour.
 * Returns null when either side has no coordinates.
 */
export function milesOffRoute(check: InsuranceCheck, route: RouteInfo | null | undefined): number | null {
    if (check.lat == null || check.lon == null) return null;
    const pts = routeVertices(route);
    if (pts.length === 0) return null;
    const here = { lat: check.lat, lon: check.lon };
    let best = Infinity;
    for (const p of pts) {
        const d = milesBetween(here, p);
        if (d < best) best = d;
    }
    return Number.isFinite(best) ? best : null;
}

/**
 * Insert pickups into the rep's stop list at the cheapest position each
 * (greedy cheapest-insertion on straight-line miles), then ask OSRM for the
 * real drive. The returned RouteInfo keeps the ORIGINAL `coordinates` so the
 * map's index-aligned job markers stay put; only geometry/distance/duration
 * reflect the detour. `stopOrder` is the pickup order for the panel list.
 */
export async function buildRouteWithPickups(
    base: RouteInfo,
    pickups: InsuranceCheck[],
): Promise<{ routeInfo: RouteInfo; stopOrder: InsuranceCheck[] } | null> {
    const stops: { coord: Coordinates; check?: InsuranceCheck }[] = base.coordinates.map(coord => ({ coord }));
    const usable = pickups.filter(c => c.lat != null && c.lon != null);
    if (stops.length === 0 || usable.length === 0) return null;

    for (const check of usable) {
        const c = { lat: check.lat as number, lon: check.lon as number };
        let bestIdx = stops.length;
        let bestCost = Infinity;
        if (stops.length === 1) {
            bestIdx = 1; bestCost = 0;
        } else {
            for (let i = 0; i < stops.length - 1; i++) {
                const a = stops[i].coord, b = stops[i + 1].coord;
                const cost = milesBetween(a, c) + milesBetween(c, b) - milesBetween(a, b);
                if (cost < bestCost) { bestCost = cost; bestIdx = i + 1; }
            }
            // Also allow tacking it on after the last stop (on the way home)
            const tail = milesBetween(stops[stops.length - 1].coord, c);
            if (tail < bestCost) { bestCost = tail; bestIdx = stops.length; }
        }
        stops.splice(bestIdx, 0, { coord: c, check });
    }

    const routed = await fetchRoute(stops.map(s => s.coord));
    if (!routed) return null;
    return {
        routeInfo: { ...routed, coordinates: base.coordinates },
        stopOrder: stops.filter(s => s.check).map(s => s.check as InsuranceCheck),
    };
}

export const formatMoney = (v: number | null | undefined) =>
    v == null || !Number.isFinite(v) ? '' : `$${Math.round(v).toLocaleString()}`;

export const roofrJobUrl = (jobId: string) =>
    `https://app.roofr.com/dashboard/jobs/list-view?selectedJobId=${encodeURIComponent(jobId)}`;
