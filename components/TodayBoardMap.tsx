import React, { useEffect, useMemo, useRef, useState } from 'react';
import { fetchRoute, type Coordinates } from '../services/osmService';
import type { RouteInfo } from '../types';

declare const L: any;

// Fixed palette of maximally distinct, vivid colors — same sorted-position
// convention as LeafletMap, copied here so this component stays standalone.
const DISTINCT_PALETTE = [
    '#dc2626', // red
    '#2563eb', // blue
    '#16a34a', // green
    '#ea580c', // orange
    '#7c3aed', // violet
    '#0891b2', // cyan
    '#db2777', // pink
    '#ca8a04', // amber
    '#0d9488', // teal
    '#65a30d', // lime
    '#4f46e5', // indigo
    '#c026d3', // fuchsia
    '#b45309', // dark orange
    '#0e7490', // dark cyan
    '#15803d', // dark green
    '#9333ea', // purple
    '#be123c', // crimson
    '#1d4ed8', // royal blue
];

export const getTodayBoardRepColor = (name: string, allNames: string[]): string => {
    const sorted = [...new Set(allNames)].sort();
    const index = sorted.indexOf(name);
    if (index < 0 || sorted.length === 0) return '#808080';
    return DISTINCT_PALETTE[index % DISTINCT_PALETTE.length];
};

export type TodayBoardMapPoint = {
    key: string;
    lat: number;
    lon: number;
    shortAddress: string;
    timeLabel: string;
    status: string;
};

export type TodayBoardMapRep = {
    repName: string;
    color: string;
    isClosest: boolean;
    points: TodayBoardMapPoint[];
    home?: {
        lat: number;
        lon: number;
        zip: string;
    };
};

interface TodayBoardMapProps {
    search: {
        label: string;
        coordinates: Coordinates;
    };
    reps: TodayBoardMapRep[];
    selectedRepNames: string[];
    onToggleRep: (name: string) => void;
}

type NearestTarget = {
    key: string;
    lat: number;
    lon: number;
    shortAddress: string;
    timeLabel: string;
    status: string;
    isHome: boolean;
};

const KM_TO_MILES = 0.621371;
const PHOENIX_COORDS: [number, number] = [33.4484, -112.074];

const haversineMiles = (from: Coordinates, to: Coordinates) => {
    const toRadians = (degrees: number) => degrees * (Math.PI / 180);
    const earthRadiusKm = 6371;
    const latDelta = toRadians(to.lat - from.lat);
    const lonDelta = toRadians(to.lon - from.lon);
    const a =
        Math.sin(latDelta / 2) ** 2 +
        Math.cos(toRadians(from.lat)) *
            Math.cos(toRadians(to.lat)) *
            Math.sin(lonDelta / 2) ** 2;

    return earthRadiusKm * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))) * KM_TO_MILES;
};

const escapeHtml = (value: string) =>
    value.replace(/[&<>"']/g, character => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character]!
    ));

const formatMiles = (miles: number) => `${miles.toFixed(1)} mi`;

const formatDriveTime = (minutes: number) => {
    if (minutes < 60) return `${Math.round(minutes)} min drive`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = Math.round(minutes % 60);
    return `${hours}h${remainingMinutes ? ` ${remainingMinutes}m` : ''} drive`;
};

const makePointIcon = (color: string, label: string) => L.divIcon({
    className: '',
    html: `
        <div style="
            width: 28px;
            height: 28px;
            display: flex;
            align-items: center;
            justify-content: center;
            border: 2px solid white;
            border-radius: 9999px;
            background: ${color};
            color: white;
            box-shadow: 0 2px 5px rgba(0,0,0,.35);
            font-size: 11px;
            font-weight: 800;
        ">${escapeHtml(label)}</div>
    `,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
});

const makeHomeIcon = (color: string) => L.divIcon({
    className: '',
    html: `
        <div style="
            width: 28px;
            height: 28px;
            display: flex;
            align-items: center;
            justify-content: center;
            border: 3px solid ${color};
            border-radius: 9999px;
            background: white;
            color: ${color};
            box-shadow: 0 2px 5px rgba(0,0,0,.3);
            font-size: 15px;
            font-weight: 800;
        ">⌂</div>
    `,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
});

const makeSearchIcon = () => L.divIcon({
    className: '',
    html: `
        <div style="
            width: 34px;
            height: 34px;
            display: flex;
            align-items: center;
            justify-content: center;
            border: 3px solid white;
            border-radius: 9999px;
            background: #111827;
            color: white;
            box-shadow: 0 2px 7px rgba(0,0,0,.45);
            font-size: 16px;
        ">⌕</div>
    `,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -17],
});

const getNearestTarget = (
    rep: TodayBoardMapRep,
    searchCoordinates: Coordinates,
): NearestTarget | null => {
    const appointmentTargets: NearestTarget[] = rep.points.map(point => ({
        ...point,
        isHome: false,
    }));

    // Home is a fallback for an otherwise free rep, never an extra stop for a
    // rep who already has appointments.
    const targets = appointmentTargets.length > 0
        ? appointmentTargets
        : rep.home
            ? [{
                key: `home-${rep.repName}`,
                lat: rep.home.lat,
                lon: rep.home.lon,
                shortAddress: `Home base · ${rep.home.zip}`,
                timeLabel: 'Available',
                status: 'home',
                isHome: true,
            }]
            : [];

    return targets.reduce<NearestTarget | null>((nearest, target) => {
        if (!nearest) return target;
        const targetMiles = haversineMiles(searchCoordinates, target);
        const nearestMiles = haversineMiles(searchCoordinates, nearest);
        return targetMiles < nearestMiles ? target : nearest;
    }, null);
};

const TodayBoardMap: React.FC<TodayBoardMapProps> = ({
    search,
    reps,
    selectedRepNames,
    onToggleRep,
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<any>(null);
    const layerRef = useRef<any>(null);
    const routeCacheRef = useRef<Map<string, RouteInfo | null>>(new Map());
    const routeRequestRef = useRef(0);
    const [drivingRoute, setDrivingRoute] = useState<RouteInfo | null>(null);
    const [isLoadingRoute, setIsLoadingRoute] = useState(false);

    const selectedReps = useMemo(
        () => reps.filter(rep => selectedRepNames.includes(rep.repName)),
        [reps, selectedRepNames],
    );

    const nearestByRep = useMemo(() => (
        new Map(
            selectedReps
                .map(rep => [rep.repName, getNearestTarget(rep, search.coordinates)] as const)
                .filter((entry): entry is [string, NearestTarget] => !!entry[1]),
        )
    ), [search.coordinates, selectedReps]);

    const singleSelectedRep = selectedReps.length === 1 ? selectedReps[0] : null;
    const singleSelectedTarget = singleSelectedRep
        ? nearestByRep.get(singleSelectedRep.repName) || null
        : null;

    // Key on the target coords too — a rep's nearest stop can move as geocodes
    // stream in or the live board refreshes, and the old route must not stick.
    const routeCacheKey = singleSelectedRep && singleSelectedTarget
        ? [
            singleSelectedRep.repName,
            search.coordinates.lat.toFixed(6),
            search.coordinates.lon.toFixed(6),
            singleSelectedTarget.lat.toFixed(6),
            singleSelectedTarget.lon.toFixed(6),
        ].join('|')
        : null;

    useEffect(() => {
        if (!containerRef.current || mapRef.current) return;

        if (typeof L === 'undefined') {
            console.warn('TodayBoardMap could not start because Leaflet was not loaded.');
            return;
        }

        const map = L.map(containerRef.current, {
            center: PHOENIX_COORDS,
            zoom: 9,
            zoomControl: true,
        });

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        }).addTo(map);

        mapRef.current = map;
        layerRef.current = L.featureGroup().addTo(map);

        const resizeObserver = new ResizeObserver(() => {
            window.setTimeout(() => mapRef.current?.invalidateSize(), 0);
        });
        resizeObserver.observe(containerRef.current);

        window.setTimeout(() => map.invalidateSize(), 0);

        return () => {
            resizeObserver.disconnect();
            layerRef.current?.clearLayers();
            map.remove();
            layerRef.current = null;
            mapRef.current = null;
        };
    }, []);

    useEffect(() => {
        const requestId = ++routeRequestRef.current;

        if (!routeCacheKey || !singleSelectedTarget) {
            setDrivingRoute(null);
            setIsLoadingRoute(false);
            return;
        }

        const cached = routeCacheRef.current.get(routeCacheKey);
        if (cached !== undefined) {
            setDrivingRoute(cached);
            setIsLoadingRoute(false);
            return;
        }

        setDrivingRoute(null);
        setIsLoadingRoute(true);

        void fetchRoute([
            search.coordinates,
            { lat: singleSelectedTarget.lat, lon: singleSelectedTarget.lon },
        ])
            .then(route => {
                routeCacheRef.current.set(routeCacheKey, route);
                if (routeRequestRef.current === requestId) setDrivingRoute(route);
            })
            .catch(error => {
                console.warn('Today Board driving-route lookup failed', error);
                routeCacheRef.current.set(routeCacheKey, null);
                if (routeRequestRef.current === requestId) setDrivingRoute(null);
            })
            .finally(() => {
                if (routeRequestRef.current === requestId) setIsLoadingRoute(false);
            });

        // Invalidate the in-flight request on dep change or unmount so a late
        // OSRM response can't set state against a stale selection.
        return () => {
            routeRequestRef.current++;
        };
    }, [routeCacheKey, search.coordinates, singleSelectedTarget]);

    useEffect(() => {
        const map = mapRef.current;
        const layer = layerRef.current;
        if (!map || !layer || typeof L === 'undefined') return;

        layer.clearLayers();

        const visibleCoordinates: [number, number][] = [
            [search.coordinates.lat, search.coordinates.lon],
        ];

        L.marker([search.coordinates.lat, search.coordinates.lon], {
            icon: makeSearchIcon(),
            zIndexOffset: 2000,
        })
            .bindPopup(`
                <div style="min-width: 180px; line-height: 1.35">
                    <strong>Search location</strong><br />
                    <span>${escapeHtml(search.label)}</span>
                </div>
            `)
            .addTo(layer);

        selectedReps.forEach(rep => {
            const color = rep.color || getTodayBoardRepColor(rep.repName, reps.map(item => item.repName));
            const nearest = nearestByRep.get(rep.repName);
            const appointmentPoints = rep.points;

            appointmentPoints.forEach((point, index) => {
                const miles = haversineMiles(search.coordinates, point);
                visibleCoordinates.push([point.lat, point.lon]);

                L.marker([point.lat, point.lon], {
                    icon: makePointIcon(color, String(index + 1)),
                    zIndexOffset: 500,
                })
                    .bindPopup(`
                        <div style="min-width: 185px; line-height: 1.4">
                            <strong>${escapeHtml(rep.repName)}</strong><br />
                            <span>${escapeHtml(point.timeLabel)}</span><br />
                            <span>${escapeHtml(point.shortAddress)}</span><br />
                            <span style="font-weight: 700; color: ${color}">
                                ${formatMiles(miles)} straight-line from search
                            </span>
                            ${point.status === 'cancelled'
                                ? '<br /><span style="color: #b91c1c">Cancelled</span>'
                                : ''}
                        </div>
                    `)
                    .addTo(layer);
            });

            // Only show a home point when it is the free-rep fallback.
            if (appointmentPoints.length === 0 && rep.home) {
                const homePoint = {
                    lat: rep.home.lat,
                    lon: rep.home.lon,
                    shortAddress: `Home base · ${rep.home.zip}`,
                };
                const miles = haversineMiles(search.coordinates, homePoint);
                visibleCoordinates.push([homePoint.lat, homePoint.lon]);

                L.marker([homePoint.lat, homePoint.lon], {
                    icon: makeHomeIcon(color),
                    zIndexOffset: 700,
                })
                    .bindPopup(`
                        <div style="min-width: 185px; line-height: 1.4">
                            <strong>${escapeHtml(rep.repName)}</strong><br />
                            <span>Available from home base · ${escapeHtml(rep.home.zip)}</span><br />
                            <span style="font-weight: 700; color: ${color}">
                                ${formatMiles(miles)} straight-line from search
                            </span>
                        </div>
                    `)
                    .addTo(layer);
            }

            if (!nearest) return;

            const straightLineMiles = haversineMiles(search.coordinates, nearest);
            const line = L.polyline([
                [search.coordinates.lat, search.coordinates.lon],
                [nearest.lat, nearest.lon],
            ], {
                color,
                weight: 2,
                opacity: 0.8,
                dashArray: '7, 7',
            }).addTo(layer);

            line.bindTooltip(
                `${escapeHtml(rep.repName)} · ${formatMiles(straightLineMiles)}`,
                {
                    permanent: true,
                    direction: 'center',
                    className: 'job-tooltip',
                    opacity: 0.95,
                },
            );
        });

        if (
            singleSelectedRep &&
            singleSelectedTarget &&
            drivingRoute?.geometry
        ) {
            L.geoJSON(drivingRoute.geometry, {
                style: () => ({
                    color: singleSelectedRep.color,
                    weight: 5,
                    opacity: 0.7,
                    lineCap: 'round',
                }),
            }).addTo(layer);
        }

        if (visibleCoordinates.length > 1) {
            map.fitBounds(visibleCoordinates, { padding: [28, 28], maxZoom: 13 });
        } else {
            map.setView(visibleCoordinates[0], 13);
        }

        window.setTimeout(() => map.invalidateSize(), 0);
    }, [
        drivingRoute,
        nearestByRep,
        reps,
        search,
        selectedReps,
        singleSelectedRep,
        singleSelectedTarget,
    ]);

    const routeSummary = singleSelectedRep && singleSelectedTarget
        ? drivingRoute
            ? `${formatDriveTime(drivingRoute.duration)} · ${formatMiles(drivingRoute.distance)} by road`
            : isLoadingRoute
                ? 'Finding driving route…'
                : `Driving route unavailable · ${formatMiles(
                    haversineMiles(search.coordinates, singleSelectedTarget),
                )} straight-line`
        : null;

    return (
        <section className="flex-shrink-0 border-b border-border-secondary bg-bg-secondary px-3 py-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-semibold text-text-secondary">
                    Map reps
                </span>

                {reps.map(rep => {
                    const selected = selectedRepNames.includes(rep.repName);
                    const hasMappableLocation = rep.points.length > 0 || !!rep.home;

                    return (
                        <button
                            key={rep.repName}
                            type="button"
                            disabled={!hasMappableLocation}
                            onClick={() => onToggleRep(rep.repName)}
                            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
                                selected
                                    ? 'bg-bg-primary text-text-primary shadow-sm'
                                    : 'border-border-secondary bg-bg-tertiary text-text-tertiary opacity-75'
                            } disabled:cursor-not-allowed disabled:opacity-40`}
                            style={selected
                                ? {
                                    borderColor: rep.color,
                                    boxShadow: rep.isClosest ? `0 0 0 2px ${rep.color}55` : undefined,
                                }
                                : undefined}
                            title={hasMappableLocation
                                ? `${selected ? 'Hide' : 'Show'} ${rep.repName} on the map`
                                : `No coordinates available for ${rep.repName}`}
                        >
                            <span
                                className="h-2 w-2 rounded-full"
                                style={{ backgroundColor: rep.color }}
                            />
                            {rep.isClosest && <span aria-label="One of the three closest reps">★</span>}
                            {rep.repName}
                        </button>
                    );
                })}
            </div>

            {routeSummary && (
                <div className="mb-2 text-[11px] text-text-secondary">
                    <span className="font-semibold text-text-primary">
                        {singleSelectedRep?.repName}:
                    </span>{' '}
                    {routeSummary}
                </div>
            )}

            {/* isolate traps Leaflet's internal z-indexes (400-1000) inside this
                container so they can't punch through the board's z-[60] modals. */}
            <div
                ref={containerRef}
                className="h-72 overflow-hidden rounded-lg border border-border-secondary bg-bg-tertiary relative z-0 isolate"
                aria-label={`Map of reps near ${search.label}`}
            />
        </section>
    );
};

export default TodayBoardMap;
