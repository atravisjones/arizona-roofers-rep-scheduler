import React, { useMemo, useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { EXCLUSION_LABELS } from '../services/rotationService';
import { ROTATION_AREA_NAMES, SERVICE_AREA_MAP } from '../constants';
import type { RotationEntry, RotationQueue, RotationQueueId } from '../types';

/**
 * Whose turn it is to take each long drive: the Limited corridor, Tucson, or up
 * north. Three independent queues — a corridor run, a Tucson day and a Flagstaff
 * day are not the same ask, so they rotate separately.
 *
 * Everything here is derived from appointments that actually happened (or are
 * already booked). Nothing has to be marked off by hand, which is the point:
 * a queue that depends on someone remembering to update it stops being true
 * within a week.
 */

const QUEUES: { id: RotationQueueId; title: string; blurb: string; areaName?: string }[] = [
    {
        id: 'limited',
        title: 'Limited corridor',
        blurb: `Reps sent into the "${ROTATION_AREA_NAMES.limited}" service area`,
        areaName: ROTATION_AREA_NAMES.limited,
    },
    {
        id: 'tucson',
        title: 'Tucson',
        blurb: 'Reps sent south into Tucson and below',
        areaName: ROTATION_AREA_NAMES.tucson,
    },
    {
        // No areaName: this one is a latitude rule, not a published shape, so it
        // can never hit the "area not published" empty state.
        id: 'north',
        title: 'Up north',
        blurb: 'Anything north of Black Canyon City — Prescott, Sedona, Flagstaff, Payson',
    },
];

/** "Aug 29" / "never". Parsed as local parts — new Date('2026-08-29') is UTC. */
const fmtDay = (day: string | null): string => {
    if (!day) return 'never';
    const [y, m, d] = day.split('-').map(Number);
    if (!y || !m || !d) return day;
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

/** $412k / $1.2M / —. Compact on purpose: the column is ~50px in a 3-up layout. */
const fmtMoney = (n: number): string => {
    if (!n) return '—';
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
    if (n >= 1_000) return `$${Math.round(n / 1000)}k`;
    return `$${Math.round(n)}`;
};

const daysAgo = (day: string | null): string => {
    if (!day) return '';
    const [y, m, d] = day.split('-').map(Number);
    const then = new Date(y, m - 1, d).getTime();
    const now = new Date().setHours(0, 0, 0, 0);
    const diff = Math.round((now - then) / 86400000);
    if (diff < 0) return `in ${Math.abs(diff)}d`;
    if (diff === 0) return 'today';
    return `${diff}d ago`;
};

const RotationPage: React.FC = () => {
    const context = useAppContext();
    const { rotation, rotationConfig, updateRotationConfig, isRotationLoading, reloadRotation } = context;
    const [showExcluded, setShowExcluded] = useState(true);

    const toggleSkip = (repKey: string, queue: RotationQueueId, skipped: boolean) => {
        const next = {
            ...rotationConfig,
            skips: {
                ...rotationConfig.skips,
                [repKey]: { ...(rotationConfig.skips[repKey] || {}), [queue]: skipped },
            },
        };
        if (!skipped) delete next.skips[repKey][queue];
        if (next.skips[repKey] && Object.keys(next.skips[repKey]).length === 0) delete next.skips[repKey];
        updateRotationConfig(next);
    };

    const windowLabel = useMemo(
        () => (rotation ? `last ${rotation.windowDays} days` : ''),
        [rotation]
    );

    if (isRotationLoading || !rotation) {
        return (
            <div className="h-full flex items-center justify-center text-sm text-text-tertiary">
                Loading rotation…
            </div>
        );
    }

    const queueLabel = (queue: RotationQueueId) =>
        QUEUES.find(q => q.id === queue)?.title.toLowerCase() ?? queue;

    const renderRow = (entry: RotationEntry, index: number, queue: RotationQueueId) => (
        <tr key={entry.repKey} className="border-b border-border-secondary last:border-0 hover:bg-bg-tertiary/50 transition">
            <td className="py-1.5 pl-3 pr-2 w-10 text-right tabular-nums text-text-tertiary font-semibold">{index + 1}</td>
            <td className="py-1.5 pr-2 text-text-primary font-medium">
                {entry.repName}
                {entry.scheduled && (
                    <span className="ml-2 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-tag-amber-bg text-tag-amber-text">
                        booked
                    </span>
                )}
            </td>
            <td className="py-1.5 pr-2 tabular-nums text-text-secondary">
                {fmtDay(entry.lastTrip)}
                {entry.lastTrip && <span className="ml-1.5 text-[10px] text-text-quaternary">{daysAgo(entry.lastTrip)}</span>}
            </td>
            <td className="py-1.5 pr-2 tabular-nums text-text-tertiary text-center">{entry.trips}</td>
            <td
                className="py-1.5 pr-2 tabular-nums text-center whitespace-nowrap"
                title={`${entry.appts} appointment${entry.appts === 1 ? '' : 's'} here, ${entry.won} sold`}
            >
                <span className="text-text-tertiary">{entry.appts}</span>
                <span className="text-text-quaternary"> · </span>
                <span className={entry.won > 0 ? 'text-tag-green-text font-semibold' : 'text-text-quaternary'}>
                    {entry.won}
                </span>
            </td>
            <td
                className={`py-1.5 pr-2 tabular-nums text-right whitespace-nowrap ${
                    entry.wonValue > 0 ? 'text-tag-green-text font-semibold' : 'text-text-quaternary'
                }`}
                title={entry.wonValue > 0
                    ? `$${Math.round(entry.wonValue).toLocaleString()} sold here in the window`
                    : 'Nothing sold here in the window'}
            >
                {fmtMoney(entry.wonValue)}
            </td>
            <td className="py-1.5 pr-3 text-right">
                <button
                    onClick={() => toggleSkip(entry.repKey, queue, true)}
                    className="px-1.5 py-0.5 text-[10px] font-semibold rounded border border-border-secondary text-text-quaternary hover:border-tag-red-border hover:text-tag-red-text transition"
                    title={`Take ${entry.repName} out of the ${queueLabel(queue)} rotation. The other queues are unaffected.`}
                >
                    remove
                </button>
            </td>
        </tr>
    );

    const renderQueue = (q: typeof QUEUES[number], data: RotationQueue) => (
        <div key={q.id} className="flex-1 min-w-0 flex flex-col bg-bg-primary border border-border-primary rounded-lg overflow-hidden">
            <div className="flex-shrink-0 px-3 py-2 bg-bg-secondary border-b border-border-primary">
                <h2 className="text-sm font-bold text-text-primary">{q.title}</h2>
                <div className="text-[10px] text-text-tertiary">{q.blurb} · {windowLabel}</div>
            </div>

            {!data.areaPublished ? (
                <div className="flex-1 flex items-center justify-center p-6 text-center">
                    <div className="max-w-xs">
                        <div className="text-sm font-semibold text-text-secondary mb-1">
                            No “{q.areaName}” area published
                        </div>
                        <div className="text-[11px] text-text-tertiary leading-relaxed">
                            Draw and publish it on the{' '}
                            <a
                                href={SERVICE_AREA_MAP}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-semibold text-brand-primary hover:underline"
                            >
                                corridors map
                            </a>, then reload this page. The queue fills itself in from there.
                        </div>
                    </div>
                </div>
            ) : (
                <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-bg-primary">
                            <tr className="text-[9px] font-bold uppercase text-text-quaternary border-b border-border-secondary">
                                <th className="py-1.5 pl-3 pr-2 text-right">#</th>
                                <th className="py-1.5 pr-2 text-left">Rep</th>
                                <th className="py-1.5 pr-2 text-left">Last went</th>
                                <th className="py-1.5 pr-2 text-center" title="Distinct days driven out there">Days</th>
                                <th className="py-1.5 pr-2 text-center" title="Appointments run here · how many sold">Appt · Won</th>
                                <th className="py-1.5 pr-2 text-right" title="Contract value of those sales">Sold</th>
                                <th className="py-1.5 pr-3"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.order.map((e, i) => renderRow(e, i, q.id))}
                            {!data.order.length && (
                                <tr><td colSpan={7} className="py-6 text-center text-text-tertiary">
                                    Nobody in the rotation. Load a schedule so the rep list is populated.
                                </td></tr>
                            )}
                        </tbody>
                    </table>

                    {showExcluded && data.excluded.length > 0 && (
                        <div className="border-t border-border-primary bg-bg-secondary/40">
                            <div className="px-3 pt-2 pb-1 text-[9px] font-bold uppercase text-text-quaternary">
                                Not in rotation
                            </div>
                            <table className="w-full text-xs">
                                <tbody>
                                    {data.excluded.map(e => (
                                        <tr key={e.repKey} className="border-b border-border-secondary last:border-0">
                                            <td className="py-1.5 pl-3 pr-2 text-text-tertiary">{e.repName}</td>
                                            <td className="py-1.5 pr-2 text-[10px] text-text-quaternary">
                                                {EXCLUSION_LABELS[e.excludedBy!]}
                                            </td>
                                            <td className="py-1.5 pr-2 tabular-nums text-[10px] text-text-quaternary">
                                                {e.trips > 0
                                                    ? `${e.trips}d · ${e.appts} appt · ${e.won} won · ${fmtMoney(e.wonValue)} · ${fmtDay(e.lastTrip)}`
                                                    : ''}
                                            </td>
                                            <td className="py-1.5 pr-3 text-right">
                                                {e.excludedBy === 'skipped' && (
                                                    <button
                                                        onClick={() => toggleSkip(e.repKey, q.id, false)}
                                                        className="px-1.5 py-0.5 text-[10px] font-semibold rounded border border-border-secondary text-text-quaternary hover:border-brand-primary hover:text-brand-primary transition"
                                                        title={`Put ${e.repName} back in the rotation`}
                                                    >
                                                        put back
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}
        </div>
    );

    return (
        <div className="h-full flex flex-col gap-3 min-h-0">
            <div className="flex-shrink-0 flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                    <h1 className="text-base font-bold text-text-primary">Travel rotation</h1>
                    <div className="text-[11px] text-text-tertiary">
                        Who is up next. Ordered by how long since their last trip — a rep already
                        booked to go counts as having taken their turn. <span className="text-text-quaternary">
                        &ldquo;Remove&rdquo; takes someone out of <em>that one</em> queue only, and holds until
                        you put them back — for a rep who is too far away to be worth sending until a storm hits.
                        </span>
                    </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                    <label className="flex items-center gap-1.5 text-[11px] text-text-secondary cursor-pointer">
                        <input
                            type="checkbox"
                            checked={rotationConfig.rotationInfluence}
                            onChange={e => updateRotationConfig({ ...rotationConfig, rotationInfluence: e.target.checked })}
                            className="accent-brand-primary"
                        />
                        Nudge auto-assign
                    </label>
                    <label className="flex items-center gap-1.5 text-[11px] text-text-secondary cursor-pointer">
                        <input
                            type="checkbox"
                            checked={showExcluded}
                            onChange={e => setShowExcluded(e.target.checked)}
                            className="accent-brand-primary"
                        />
                        Show excluded
                    </label>
                    {/* The corridor and Tucson shapes are drawn here, and redrawing one
                        changes who this page thinks went where. Up north is the exception
                        — a latitude rule, not a shape on that map. */}
                    <a
                        href={SERVICE_AREA_MAP}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Boundary editor — where the Limited corridor and Tucson shapes are drawn. Up north is a latitude cut and is not on this map."
                        className="px-2 py-1 text-[11px] font-semibold rounded-md border border-border-secondary text-text-tertiary hover:border-brand-primary hover:text-brand-primary transition"
                    >
                        Corridors map ↗
                    </a>
                    <button
                        onClick={reloadRotation}
                        className="px-2 py-1 text-[11px] font-semibold rounded-md border border-border-secondary text-text-tertiary hover:border-brand-primary hover:text-brand-primary transition"
                    >
                        Refresh
                    </button>
                </div>
            </div>

            {rotation.error && (
                <div className="flex-shrink-0 px-3 py-2 rounded-md bg-tag-red-bg text-tag-red-text text-[11px]">
                    Could not load rotation data: {rotation.error}. The queues below are empty, and
                    auto-assign is not being nudged.
                </div>
            )}

            <div className="flex-1 min-h-0 flex gap-3 flex-col lg:flex-row">
                {QUEUES.map(q => renderQueue(q, rotation[q.id]))}
            </div>

            {/* An unmapped attendee id is invisible damage: that rep's trips file
                under nobody, so they read as "never went" and sit at the top of
                the queue for good. Surfaced rather than swallowed. */}
            {rotation.unmappedAttendeeIds.length > 0 && (
                <div className="flex-shrink-0 px-3 py-1.5 rounded-md bg-tag-amber-bg text-tag-amber-text text-[10px] leading-relaxed">
                    <span className="font-bold">
                        {rotation.unmappedAttendeeIds.length} unrecognised attendee
                        {rotation.unmappedAttendeeIds.length > 1 ? ' ids' : ' id'}
                    </span>{' '}
                    on out-of-town appointments ({rotation.unmappedAttendeeIds.join(', ')}). Those trips
                    are not credited to anyone, so a rep may look emptier than they are. Add the id to
                    ROOFR_USER_ID_TO_REP once you have confirmed whose it is.
                </div>
            )}
        </div>
    );
};

export default RotationPage;
