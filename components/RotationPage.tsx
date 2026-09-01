import React, { useEffect, useMemo, useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { EXCLUSION_LABELS } from '../services/rotationService';
import { ROTATION_AREA_NAMES, ROTATION_WINDOW_DAYS, ROTATION_WINDOW_OPTIONS, SERVICE_AREA_MAP } from '../constants';
import { dayKey, rollingRange } from '../services/rotationService';
import type { RotationEntry, RotationQueue, RotationQueueId } from '../types';

/**
 * Whose turn it is to take each long drive: the Limited corridor, Tucson, or up
 * north. Independent queues — a corridor run, a Tucson day and a Flagstaff day
 * are not the same ask, so they rotate separately.
 *
 * Phoenix is the exception: it is a comparison column, not a rotation. Nobody
 * takes turns going to the valley, so it is off by default and never nudges
 * auto-assign. It is here to answer "is this rep light overall, or only out of
 * town" — a rep at the front of every travel queue reads very differently if
 * their Phoenix column is full.
 *
 * Everything here is derived from appointments that actually happened (or are
 * already booked). Nothing has to be marked off by hand, which is the point:
 * a queue that depends on someone remembering to update it stops being true
 * within a week.
 */

const QUEUES: { id: RotationQueueId; title: string; blurb: string; areaName?: string; optional?: boolean }[] = [
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
    {
        id: 'phoenix',
        title: 'Phoenix',
        blurb: 'The valley, corridor excluded — not a rotation, just the comparison',
        areaName: ROTATION_AREA_NAMES.phoenix,
        optional: true,
    },
];

const SHOW_PHOENIX_KEY = 'rotation.showPhoenix';
const CUSTOM = 'custom';

type SortKey = 'name' | 'lastTrip' | 'trips' | 'appts' | 'won' | 'wonValue';
interface Sort { key: SortKey; dir: 'asc' | 'desc' }

/**
 * Which way a column sorts on its FIRST click. Numbers open biggest-first
 * because "who has done the most of this" is the question you are asking when
 * you reach for a number column; names open A-Z.
 *
 * "Last went" opens most-recent-first on purpose: oldest-first is already the
 * rotation order, so opening that way would look like the click did nothing.
 */
const DEFAULT_DIR: Record<SortKey, 'asc' | 'desc'> = {
    name: 'asc', lastTrip: 'desc', trips: 'desc', appts: 'desc', won: 'desc', wonValue: 'desc',
};

/** null sort = rotation order, which is the whole point of the page. */
const applySort = (rows: RotationEntry[], sort?: Sort): RotationEntry[] => {
    if (!sort) return rows;
    const mul = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
        let primary: number;
        if (sort.key === 'name') primary = a.repName.localeCompare(b.repName);
        // A "never" is an empty string, so it lands at whichever end the
        // direction puts it — the flip stays a true reversal.
        else if (sort.key === 'lastTrip') primary = (a.lastTrip || '').localeCompare(b.lastTrip || '');
        else primary = a[sort.key] - b[sort.key];
        // Name breaks ties OUTSIDE the multiplier, so equal rows keep a stable
        // A-Z order in both directions instead of flipping about.
        return primary !== 0 ? primary * mul : a.repName.localeCompare(b.repName);
    });
};

/** "Aug 29" / "never". Parsed as local parts — new Date('2026-08-29') is UTC. */
const fmtDay = (day: string | null): string => {
    if (!day) return 'never';
    const [y, m, d] = day.split('-').map(Number);
    if (!y || !m || !d) return day;
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

/** $412k / $1.2M / —. Compact on purpose: the column is ~50px in a 4-up layout. */
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
    const {
        rotation, rotationConfig, updateRotationConfig,
        isRotationLoading, reloadRotation,
    } = context;
    // The preset select and the two date inputs are one control with two modes.
    // `preset` is what the dropdown shows; CUSTOM swaps in the date pair.
    const [preset, setPreset] = useState<string>(String(ROTATION_WINDOW_DAYS));
    const [from, setFrom] = useState(() => rollingRange(ROTATION_WINDOW_DAYS).from);
    const [to, setTo] = useState(() => dayKey(new Date()));
    const [showExcluded, setShowExcluded] = useState(true);
    // Per queue: each column sorts its own table, so you can rank Tucson by
    // Sold while the corridor stays in turn order.
    const [sorts, setSorts] = useState<Partial<Record<RotationQueueId, Sort>>>({});
    // Off by default, but remembered once you turn it on — it is a wide column
    // most people do not want, and re-ticking it every visit would be a chore.
    const [showPhoenix, setShowPhoenix] = useState(
        () => typeof window !== 'undefined' && window.localStorage.getItem(SHOW_PHOENIX_KEY) === '1'
    );

    useEffect(() => {
        try { window.localStorage.setItem(SHOW_PHOENIX_KEY, showPhoenix ? '1' : '0'); } catch { /* private mode */ }
    }, [showPhoenix]);

    /**
     * Three-state cycle per column: default direction, flipped, then back to
     * rotation order. That last step is the way home — without it there is no
     * obvious way to undo a sort short of reloading.
     */
    const clickHeader = (queue: RotationQueueId, key: SortKey) => setSorts(prev => {
        const cur = prev[queue];
        if (cur?.key !== key) return { ...prev, [queue]: { key, dir: DEFAULT_DIR[key] } };
        const flipped: 'asc' | 'desc' = cur.dir === 'asc' ? 'desc' : 'asc';
        if (flipped === DEFAULT_DIR[key]) {
            const next = { ...prev };
            delete next[queue];
            return next;
        }
        return { ...prev, [queue]: { key, dir: flipped } };
    });

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

    /**
     * "last 360 days" for a rolling window, "Mar 1 - Jun 30" for a fixed one.
     * Read off what was actually loaded, not off the controls, so it can never
     * claim a range the figures below it do not cover.
     */
    const windowLabel = useMemo(() => {
        if (!rotation) return '';
        const { from: f, to: t } = rotation.range;
        if (t) return `${fmtDay(f)} – ${fmtDay(t)}`;
        const [y, m, d] = f.split('-').map(Number);
        const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(y, m - 1, d).getTime()) / 86400000);
        return `last ${days} days`;
    }, [rotation]);

    const changePreset = (value: string) => {
        setPreset(value);
        if (value !== CUSTOM) {
            reloadRotation(rollingRange(Number(value)));
            return;
        }
        // Opening the custom pair pre-filled with the window you were already
        // looking at, so the first thing you see is the same numbers.
        const seed = rollingRange(Number(preset) || ROTATION_WINDOW_DAYS);
        const today = dayKey(new Date());
        setFrom(seed.from);
        setTo(today);
        reloadRotation({ from: seed.from, to: today });
    };

    const changeDate = (which: 'from' | 'to', value: string) => {
        if (!value) return;
        const nextFrom = which === 'from' ? value : from;
        const nextTo = which === 'to' ? value : to;
        setFrom(nextFrom);
        setTo(nextTo);
        // A backwards range would query nothing and read as "nobody has been
        // anywhere", which looks like broken data rather than a bad input.
        if (nextFrom > nextTo) return;
        reloadRotation({ from: nextFrom, to: nextTo });
    };

    const visibleQueues = useMemo(
        () => QUEUES.filter(q => !q.optional || showPhoenix),
        [showPhoenix]
    );

    // Only the FIRST load blanks the page. A reload keeps the controls mounted:
    // every refetch used to unmount the header, so setting the "from" date made
    // the "to" input vanish under the cursor mid-edit.
    if (!rotation) {
        return (
            <div className="h-full flex items-center justify-center text-sm text-text-tertiary">
                Loading rotation…
            </div>
        );
    }

    const queueLabel = (queue: RotationQueueId) =>
        QUEUES.find(q => q.id === queue)?.title.toLowerCase() ?? queue;

    /**
     * One row, used for BOTH the queue and the excluded list. Held-out reps get
     * the same columns rather than a squashed one-line summary — Richard Hadsall
     * is the biggest producer in Tucson by a distance, and his figures are the
     * ones you most want to read against everyone else's.
     */
    const renderRow = (entry: RotationEntry, rank: number | null, queue: RotationQueueId) => (
        <tr
            key={entry.repKey}
            className={`border-b border-border-secondary last:border-0 transition ${
                rank === null ? 'bg-bg-secondary/30' : 'hover:bg-bg-tertiary/50'
            }`}
        >
            <td className="py-1.5 pl-3 pr-2 w-10 text-right tabular-nums text-text-tertiary font-semibold">
                {rank === null ? '' : rank}
            </td>
            <td className={`py-1.5 pr-2 font-medium ${rank === null ? 'text-text-tertiary' : 'text-text-primary'}`}>
                {entry.repName}
                {entry.scheduled && rank !== null && (
                    <span className="ml-2 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-tag-amber-bg text-tag-amber-text">
                        booked
                    </span>
                )}
                {rank === null && entry.excludedBy && (
                    <span className="ml-2 text-[9px] font-normal text-text-quaternary">
                        {EXCLUSION_LABELS[entry.excludedBy]}
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
                {rank !== null ? (
                    <button
                        onClick={() => toggleSkip(entry.repKey, queue, true)}
                        className="px-1.5 py-0.5 text-[10px] font-semibold rounded border border-border-secondary text-text-quaternary hover:border-tag-red-border hover:text-tag-red-text transition"
                        title={`Take ${entry.repName} out of the ${queueLabel(queue)} rotation. The other queues are unaffected.`}
                    >
                        remove
                    </button>
                ) : entry.excludedBy === 'skipped' ? (
                    <button
                        onClick={() => toggleSkip(entry.repKey, queue, false)}
                        className="px-1.5 py-0.5 text-[10px] font-semibold rounded border border-border-secondary text-text-quaternary hover:border-brand-primary hover:text-brand-primary transition"
                        title={`Put ${entry.repName} back in the ${queueLabel(queue)} rotation`}
                    >
                        put back
                    </button>
                ) : null}
            </td>
        </tr>
    );

    /** Up/down marker on the column currently driving the order, blank on the rest. */
    const arrow = (queue: RotationQueueId, key: SortKey) => {
        const s = sorts[queue];
        if (s?.key !== key) return '';
        return s.dir === 'asc' ? ' ▲' : ' ▼';
    };

    const sortableTh = (queue: RotationQueueId, key: SortKey, label: string, align: string, hint?: string) => (
        <th
            className={`py-1.5 pr-2 ${align} cursor-pointer select-none hover:text-text-secondary`}
            onClick={() => clickHeader(queue, key)}
            title={`${hint ? hint + '. ' : ''}Click to sort, again to reverse, once more for rotation order.`}
        >
            {label}{arrow(queue, key)}
        </th>
    );

    const renderQueue = (q: typeof QUEUES[number], data: RotationQueue) => {
        const rankOf = new Map(data.order.map((e, i) => [e.repKey, i + 1]));
        return (
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
                                <th className="py-1.5 pl-3 pr-2 text-right" title="Spot in the rotation. Stays put when you sort, so you can rank by any column and still see who is up next.">#</th>
                                {sortableTh(q.id, 'name', 'Rep', 'text-left')}
                                {sortableTh(q.id, 'lastTrip', 'Last went', 'text-left')}
                                {sortableTh(q.id, 'trips', 'Days', 'text-center', 'Distinct days driven out there')}
                                <th className="py-1.5 pr-2 text-center">
                                    <span
                                        onClick={() => clickHeader(q.id, 'appts')}
                                        className="cursor-pointer select-none hover:text-text-secondary"
                                        title="Appointments run here. Click to sort."
                                    >
                                        Appt{arrow(q.id, 'appts')}
                                    </span>
                                    <span className="mx-0.5">·</span>
                                    <span
                                        onClick={() => clickHeader(q.id, 'won')}
                                        className="cursor-pointer select-none hover:text-text-secondary"
                                        title="How many of them sold. Click to sort."
                                    >
                                        Won{arrow(q.id, 'won')}
                                    </span>
                                </th>
                                {sortableTh(q.id, 'wonValue', 'Sold', 'text-right', 'Contract value of those sales')}
                                <th className="py-1.5 pr-3"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {/* Rank comes from the ROTATION order, not the row index, so
                                sorting by Sold still shows each rep's spot in line. */}
                            {applySort(data.order, sorts[q.id]).map(e => renderRow(e, rankOf.get(e.repKey) ?? null, q.id))}
                            {!data.order.length && (
                                <tr><td colSpan={7} className="py-6 text-center text-text-tertiary">
                                    Nobody in the rotation. Load a schedule so the rep list is populated.
                                </td></tr>
                            )}

                            {showExcluded && data.excluded.length > 0 && (
                                <>
                                    <tr className="bg-bg-secondary/60">
                                        <td colSpan={7} className="px-3 pt-2 pb-1 text-[9px] font-bold uppercase text-text-quaternary border-t border-border-primary">
                                            Not in rotation
                                        </td>
                                    </tr>
                                    {applySort(data.excluded, sorts[q.id]).map(e => renderRow(e, null, q.id))}
                                </>
                            )}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
        );
    };

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
                    {/* Narrowing the window re-reads the whole page, order included:
                        "last went" and the queue order are both window-relative, so a
                        90-day view answers a different question than a 2-year one. */}
                    <label className="flex items-center gap-1.5 text-[11px] text-text-secondary">
                        <span className="text-text-tertiary">Window</span>
                        <select
                            value={preset}
                            onChange={e => changePreset(e.target.value)}
                            className="px-1.5 py-1 text-[11px] font-semibold rounded-md border border-border-secondary bg-bg-primary text-text-secondary cursor-pointer"
                            title="How far back to read. Everything on the page — last went, days, appointments, sold, and the running order — is measured inside this window."
                        >
                            {ROTATION_WINDOW_OPTIONS.map(o => (
                                <option key={o.days} value={String(o.days)}>{o.label}</option>
                            ))}
                            <option value={CUSTOM}>Date range…</option>
                        </select>
                    </label>
                    {preset === CUSTOM && (
                        <span
                            className="flex items-center gap-1 text-[11px] text-text-secondary"
                            title="Both ends inclusive. A fixed range stops at its end date, so nothing shows as BOOKED — there is no such thing as already-booked inside a window that has closed."
                        >
                            <input
                                type="date"
                                value={from}
                                max={to}
                                onChange={e => changeDate('from', e.target.value)}
                                className="px-1.5 py-1 text-[11px] rounded-md border border-border-secondary bg-bg-primary text-text-secondary"
                            />
                            <span className="text-text-quaternary">→</span>
                            <input
                                type="date"
                                value={to}
                                min={from}
                                onChange={e => changeDate('to', e.target.value)}
                                className="px-1.5 py-1 text-[11px] rounded-md border border-border-secondary bg-bg-primary text-text-secondary"
                            />
                        </span>
                    )}
                    <label className="flex items-center gap-1.5 text-[11px] text-text-secondary cursor-pointer">
                        <input
                            type="checkbox"
                            checked={showPhoenix}
                            onChange={e => setShowPhoenix(e.target.checked)}
                            className="accent-brand-primary"
                        />
                        <span title="The valley with the corridor carved out. A comparison column — it never nudges auto-assign.">
                            Phoenix
                        </span>
                    </label>
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
                        title="Boundary editor — where the Limited corridor, Tucson and Phoenix shapes are drawn. Up north is a latitude cut and is not on this map."
                        className="px-2 py-1 text-[11px] font-semibold rounded-md border border-border-secondary text-text-tertiary hover:border-brand-primary hover:text-brand-primary transition"
                    >
                        Corridors map ↗
                    </a>
                    <button
                        onClick={() => reloadRotation()}
                        disabled={isRotationLoading}
                        className="px-2 py-1 text-[11px] font-semibold rounded-md border border-border-secondary text-text-tertiary hover:border-brand-primary hover:text-brand-primary transition disabled:opacity-50"
                    >
                        {isRotationLoading ? 'Loading…' : 'Refresh'}
                    </button>
                </div>
            </div>

            {rotation.error && (
                <div className="flex-shrink-0 px-3 py-2 rounded-md bg-tag-red-bg text-tag-red-text text-[11px]">
                    Could not load rotation data: {rotation.error}. The queues below are empty, and
                    auto-assign is not being nudged.
                </div>
            )}

            <div className={`flex-1 min-h-0 flex gap-3 flex-col lg:flex-row transition-opacity ${
                isRotationLoading ? 'opacity-40 pointer-events-none' : ''
            }`}>
                {visibleQueues.map(q => renderQueue(q, rotation[q.id]))}
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
