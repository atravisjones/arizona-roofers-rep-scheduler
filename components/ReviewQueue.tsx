import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLinkIcon, LoadingIcon, RefreshIcon } from './icons';
import { supabase } from '../services/supabaseClient';

const REVIEWER_STORAGE_KEY = 'reviewQueue.reviewer';
const POLL_MS = 60000;
const FLAG_REASONS = ['One legger', 'No legger', 'Roof age unknown', 'Bad address', 'Wrong appt window', 'Missing info', 'Out of area', 'Low intent', 'Other'] as const;
// Flag reasons for the Outcomes view (QA of unqualified/lost dispositions).
const OUTCOME_FLAG_REASONS = ['Should be qualified', 'Wrongly unqualified', 'No-show mislabeled', 'Weak disposition', 'Rep gave up early', 'Needs follow-up', 'Bad reason given', 'Other'] as const;

type ReviewStatus = 'needs_review' | 'reviewed' | 'flagged';
type ReviewTab = 'needs_review' | 'reviewed' | 'flagged' | 'all';
type ReviewMode = 'bookings' | 'outcomes';

// Each mode gets its own URL so a view is linkable and back/forward works:
// /review and /review/bookings = Bookings, /review/outcomes = Outcomes.
// Bare /review stays on Bookings so existing links and bookmarks keep working.
const REVIEW_BASE_PATH = '/review';
const MODE_TO_PATH: Record<ReviewMode, string> = {
    bookings: `${REVIEW_BASE_PATH}/bookings`,
    outcomes: `${REVIEW_BASE_PATH}/outcomes`,
};
const readModeFromUrl = (): ReviewMode => (
    typeof window !== 'undefined' && window.location.pathname.toLowerCase().startsWith(MODE_TO_PATH.outcomes)
        ? 'outcomes'
        : 'bookings'
);
type OutcomeFilter = 'all' | 'overdue' | 'unqualified' | 'lost' | 'working';
type PeriodKind = 'day' | 'week' | 'month' | 'custom';
// List ordering. 'recent' is the original behaviour (newest booking first, risky
// ones floated in the bookings needs-review tab); the rest group the list so one
// CSR / status / technician can be worked through in a block.
type SortKey = 'recent' | 'csr' | 'stage' | 'tech';
type FilterField = 'appt_booker' | 'stage' | 'job_owner';
// The groupable fields are also the filterable ones, so sort and filter stay in
// lockstep — one entry here yields both a Sort button and a filter dropdown.
const FILTER_FIELDS: Array<{ key: Exclude<SortKey, 'recent'>; field: FilterField; label: string }> = [
    { key: 'csr', field: 'appt_booker', label: 'Booking CSR' },
    { key: 'stage', field: 'stage', label: 'Status' },
    { key: 'tech', field: 'job_owner', label: 'Technician' },
];
const SORT_OPTIONS: Array<{ key: SortKey; label: string }> = [
    { key: 'recent', label: 'Newest' },
    ...FILTER_FIELDS.map(entry => ({ key: entry.key as SortKey, label: entry.label })),
];

const pad2 = (n: number) => String(n).padStart(2, '0');
const toDateStr = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const fmtDateStr = (s: string) => {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// Resolve Day/Week/Month (+ offset steps back) to a concrete date range. Weeks start Sunday.
const getPeriodRange = (kind: Exclude<PeriodKind, 'custom'>, offset: number): { start: string; end: string; label: string } => {
    const today = new Date();
    if (kind === 'day') {
        const d = new Date(today); d.setDate(d.getDate() + offset);
        const label = offset === 0 ? 'Today' : offset === -1 ? 'Yesterday' : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        return { start: toDateStr(d), end: toDateStr(d), label };
    }
    if (kind === 'week') {
        const start = new Date(today); start.setDate(start.getDate() - start.getDay() + offset * 7);
        const end = new Date(start); end.setDate(end.getDate() + 6);
        const label = offset === 0 ? 'This Week' : offset === -1 ? 'Last Week' : `Wk of ${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
        return { start: toDateStr(start), end: toDateStr(end), label };
    }
    const start = new Date(today.getFullYear(), today.getMonth() + offset, 1);
    const end = new Date(today.getFullYear(), today.getMonth() + offset + 1, 0);
    const label = offset === 0 ? 'This Month' : start.toLocaleDateString('en-US', start.getFullYear() === today.getFullYear() ? { month: 'long' } : { month: 'long', year: 'numeric' });
    return { start: toDateStr(start), end: toDateStr(end), label };
};

interface ReviewRow {
    job_id: string;
    customer: string | null;
    name: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    latitude: string | number | null;
    longitude: string | number | null;
    lead_source: string | null;
    workflow: string | null;
    tags: string | null;
    appt_booked_at: string | null;
    appt_booker: string | null;
    link: string | null;
    value: number | null;
    roof_age: string | number | null;
    prop_sqft: string | number | null;
    year_built: string | number | null;
    stories: string | number | null;
    property_type: string | null;
    job_owner?: string | null;   // the rep (technician) who runs the appointment
    stage?: string | null;       // Roofr job-card status, e.g. "Proposal sent/follow-up"
    appt_date?: string | null;   // outcomes: the appointment date (YYYY-MM-DD)
    outcome?: string | null;     // outcomes: stage_category (the coarse bucket)
    review_status: ReviewStatus;
    flag_reason: string | null;
    review_note: string | null;
    reviewed_by: string | null;
    reviewed_at: string | null;
}

// Outcomes urgency. 'overdue' = the appointment already ran but the job still
// sits in "Appointment scheduled" (the rep never dispositioned it) — worst case.
type OutcomeUrgency = 'overdue' | 'unqualified' | 'lost' | 'working';
const normalizeStatus = (value?: string | null) => (value ?? '').toLowerCase().replace(/[_/–—-]+/g, ' ').replace(/\s+/g, ' ').trim();
// Phoenix calendar date, not the browser's — appt_date comparisons must not
// flip a card to overdue at 5pm because the viewer's machine is in UTC.
const phoenixToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Phoenix' }).format(new Date());
const getOutcomeUrgency = (row: ReviewRow): OutcomeUrgency => {
    const stage = normalizeStatus(row.stage);
    const outcome = normalizeStatus(row.outcome);
    if (outcome === 'incoming' || stage === 'appointment scheduled' || stage.startsWith('appointment scheduled ')) {
        return row.appt_date && row.appt_date < phoenixToday() ? 'overdue' : 'working';
    }
    if (outcome === 'unqualified' || stage === 'unqualified') return 'unqualified';
    if (outcome === 'lost' || outcome === 'proposal lost' || stage === 'lost') return 'lost';
    return 'working';
};
const getInitials = (name: string) => name.trim().split(/\s+/).map(word => word[0]).slice(0, 2).join('').toUpperCase() || '?';

// One segmented-control vocabulary for every grouped choice in the header:
// same height, radius, and active treatment, so controls read as one system.
const SEG_WRAP = 'inline-flex items-center rounded-md border border-border-secondary bg-bg-primary p-0.5 gap-0.5';
const SEG_BTN = 'inline-flex items-center gap-1.5 px-2.5 h-6 rounded text-[11px] font-semibold transition-colors duration-150';
const SEG_ON = 'bg-brand-primary text-brand-text-on-primary';
const SEG_OFF = 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary';

// Outcomes summary strip: stat segments with a severity dot; active = filled.
const OUTCOME_STRIP: Array<{ key: OutcomeFilter; label: string; dot: string; on: string }> = [
    { key: 'all', label: 'All', dot: '', on: SEG_ON },
    { key: 'overdue', label: 'Overdue', dot: 'bg-tag-red-text', on: 'bg-tag-red-text text-bg-primary' },
    { key: 'unqualified', label: 'Unqualified', dot: 'bg-tag-red-text/60', on: 'bg-tag-red-bg text-tag-red-text' },
    { key: 'lost', label: 'Lost', dot: 'bg-tag-red-border', on: 'bg-tag-red-bg text-tag-red-text' },
    { key: 'working', label: 'Working', dot: 'bg-tag-blue-text', on: 'bg-bg-tertiary text-text-primary' },
];
const OUTCOME_FILTER_PHRASE: Record<OutcomeFilter, string> = {
    all: 'Not proposal-signed', overdue: 'Overdue · no outcome', unqualified: 'Turned unqualified', lost: 'Turned lost', working: 'Still working',
};

interface ReviewSnapshot { status: ReviewStatus; reason: string | null; note: string | null; reviewer: string | null; }
interface ReviewAction { row: ReviewRow; before: ReviewSnapshot; after: ReviewSnapshot; }
interface RepStat { rep: string; flagged_day: number; flagged_week: number; flagged_month: number; reviewed_day: number; reviewed_week: number; reviewed_month: number; }
interface ReviewStats { today: { booked: number; reviewed: number; flagged: number }; by_rep: RepStat[]; }
const FLAG_COLS: { w: string; key: keyof RepStat }[] = [{ w: 'Today', key: 'flagged_day' }, { w: '7d', key: 'flagged_week' }, { w: '30d', key: 'flagged_month' }];
const REV_COLS: { w: string; key: keyof RepStat }[] = [{ w: 'Today', key: 'reviewed_day' }, { w: '7d', key: 'reviewed_week' }, { w: '30d', key: 'reviewed_month' }];

const formatPhoenixDate = (value: string | null) => {
    if (!value) return 'Unknown time';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString('en-US', {
        timeZone: 'America/Phoenix', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
    });
};

const formatRelativeTime = (value: string | null) => {
    if (!value) return '';
    const delta = new Date(value).getTime() - Date.now();
    if (Number.isNaN(delta)) return '';
    const minutes = Math.round(Math.abs(delta) / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ${delta < 0 ? 'ago' : 'from now'}`;
    const hours = Math.round(minutes / 60);
    if (hours < 48) return `${hours}h ${delta < 0 ? 'ago' : 'from now'}`;
    const days = Math.round(hours / 24);
    return `${days}d ${delta < 0 ? 'ago' : 'from now'}`;
};

const getRiskReasons = (row: ReviewRow) => {
    const reasons: string[] = [];
    if (!row.address?.trim()) reasons.push('no address');
    if (!row.phone?.trim()) reasons.push('no phone');
    if (!row.lead_source?.trim()) reasons.push('no lead source');
    const latitude = Number.parseFloat(String(row.latitude));
    const longitude = Number.parseFloat(String(row.longitude));
    if (Number.isFinite(latitude) && (latitude < 31.2 || latitude > 37.1 || (Number.isFinite(longitude) && (longitude < -115 || longitude > -108.9)))) reasons.push('out-of-AZ geo');
    return reasons;
};

// roofr-search-style filter dropdown: a compact button opening a fixed-position
// panel (the queue's overflow-hidden would clip an absolute one). Clicking an
// item toggles it — first click selects, second deselects — and the panel stays
// open so several values can be picked in one visit.
const FilterDropdown: React.FC<{
    label: string;
    options: Array<{ value: string; count: number }>;
    selected: string[];
    onToggle: (value: string) => void;
    onClear: () => void;
}> = ({ label, options, selected, onToggle, onClear }) => {
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
    const btnRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);

    const toggleOpen = () => {
        if (!open && btnRef.current) {
            const rect = btnRef.current.getBoundingClientRect();
            setPos({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 248)), top: rect.bottom + 4 });
        }
        setOpen(value => !value);
    };

    useEffect(() => {
        if (!open) return;
        const onDown = (event: MouseEvent) => {
            if (!btnRef.current?.contains(event.target as Node) && !panelRef.current?.contains(event.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [open]);

    return <>
        <button ref={btnRef} onClick={toggleOpen} title={`Filter by ${label.toLowerCase()}`}
            className={`inline-flex items-center gap-1.5 px-2.5 h-7 text-[11px] font-semibold rounded-md border transition-colors duration-150 ${selected.length > 0 ? 'border-brand-primary bg-brand-bg-light text-brand-text-light' : 'border-border-secondary bg-bg-primary text-text-secondary hover:border-brand-primary hover:text-brand-primary'} ${open ? 'ring-2 ring-brand-primary/30' : ''}`}>
            <span className="max-w-[140px] truncate">{selected.length === 1 ? selected[0] : label}</span>
            {selected.length > 1 && <span className="px-1 rounded-full bg-brand-primary text-brand-text-on-primary text-[9px] font-bold">{selected.length}</span>}
            <span className={`text-[8px] transition-transform ${open ? 'rotate-180' : ''}`}>▼</span>
        </button>
        {open && pos && <div ref={panelRef} className="fixed z-50 w-60 rounded-md border border-border-primary bg-bg-primary shadow-xl overflow-hidden" style={{ left: pos.left, top: pos.top }}>
            <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-border-secondary/60 bg-bg-secondary">
                <span className="text-[10px] font-bold uppercase tracking-wide text-text-tertiary">{label}</span>
                {selected.length > 0 && <button onClick={onClear} className="text-[10px] font-semibold text-brand-primary hover:underline">Clear</button>}
            </div>
            <div className="max-h-60 overflow-y-auto custom-scrollbar">
                {options.length === 0 ? <div className="px-2.5 py-2 text-[11px] text-text-tertiary italic">No values in this range</div> : options.map(({ value, count }) => {
                    const isSelected = selected.includes(value);
                    return <button key={value} onClick={() => onToggle(value)}
                        className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-[11px] transition hover:bg-bg-tertiary ${isSelected ? 'text-brand-primary font-semibold' : 'text-text-secondary'}`}>
                        <span className={`grid h-4 w-4 flex-shrink-0 place-items-center rounded border text-[10px] font-bold ${isSelected ? 'border-brand-primary bg-brand-primary text-brand-text-on-primary' : 'border-border-secondary'}`}>{isSelected ? '✓' : ''}</span>
                        <span className="flex-1 truncate">{value}</span>
                        <span className="text-[10px] text-text-quaternary">{count}</span>
                    </button>;
                })}
            </div>
        </div>}
    </>;
};

// Quiet utility links — the review actions below them are the primary controls.
const LinkPill: React.FC<{ href: string; label: string }> = ({ href, label }) => (
    <a href={href} target="_blank" rel="noreferrer" onClick={event => event.stopPropagation()} className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold rounded border border-transparent text-text-tertiary hover:border-border-secondary hover:text-brand-primary hover:bg-bg-tertiary transition">
        <ExternalLinkIcon className="h-3 w-3" />{label}
    </a>
);

const ReviewQueue: React.FC<{ onCountChange: (count: number) => void }> = ({ onCountChange }) => {
    const [rows, setRows] = useState<ReviewRow[]>([]);
    const [tab, setTab] = useState<ReviewTab>('needs_review');
    const [reviewer, setReviewer] = useState(() => localStorage.getItem(REVIEWER_STORAGE_KEY) || '');
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [busyJobId, setBusyJobId] = useState<string | null>(null);
    const [activeJobId, setActiveJobId] = useState<string | null>(null);
    const [exiting, setExiting] = useState<Record<string, 'reviewed' | 'flagged'>>({});
    const [undoStack, setUndoStack] = useState<ReviewAction[]>([]);
    const [redoStack, setRedoStack] = useState<ReviewAction[]>([]);
    const [stats, setStats] = useState<ReviewStats | null>(null);
    const [showStats, setShowStats] = useState(false);
    const [statsSort, setStatsSort] = useState<keyof RepStat>('flagged_month');
    const [periodKind, setPeriodKind] = useState<PeriodKind>('day');
    // Outcomes opens on yesterday (today's appointments haven't finished), so the
    // initial value must already match the mode — otherwise mount fires a today
    // fetch AND a yesterday refetch, and whichever response lands last wins.
    const [periodOffset, setPeriodOffset] = useState(() => (readModeFromUrl() === 'outcomes' ? -1 : 0));
    // Multi-select per field: empty/absent array = no filter on that field.
    const [fieldFilters, setFieldFilters] = useState<Partial<Record<FilterField, string[]>>>({});
    const [mode, setMode] = useState<ReviewMode>(readModeFromUrl);
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    // 'all' = every appointment that hasn't reached Proposal signed, which is the
    // whole point of the view; unqualified/lost narrow it to the hard dispositions.
    const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>('all');
    const [sortKey, setSortKey] = useState<SortKey>('recent');
    const [flaggingJobId, setFlaggingJobId] = useState<string | null>(null);
    const [flagReason, setFlagReason] = useState<string>(FLAG_REASONS[0]);
    const [flagNote, setFlagNote] = useState('');
    const priorNeedsIdsRef = useRef<Set<string> | null>(null);
    const noticeTimerRef = useRef<number | null>(null);
    // Monotonic fetch id — a response only lands if no newer fetch has started,
    // so a slow older request can never overwrite a newer period's rows.
    const fetchSeqRef = useRef(0);

    const flashNotice = useCallback((message: string) => {
        setNotice(message);
        if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
        noticeTimerRef.current = window.setTimeout(() => setNotice(null), 6000);
    }, []);

    const fetchQueue = useCallback(async (checkForNewBooking = false) => {
        const seq = ++fetchSeqRef.current;
        setIsRefreshing(true);
        try {
            // Range resolved at call time so the midnight rollover is picked up by the poll.
            const range = periodKind === 'custom'
                ? (dateFrom && dateTo ? { start: dateFrom, end: dateTo } : null)
                : getPeriodRange(periodKind, periodOffset);
            // Outcomes always fetches the whole range; the urgency filter is applied
            // client-side so the summary-strip counts stay accurate for every bucket.
            const resp = mode === 'outcomes'
                ? await supabase.rpc('get_outcome_review', {
                    p_start: range?.start || null, p_end: range?.end || null,
                    p_outcome: null,
                })
                : await supabase.rpc('get_review_queue', range
                    ? { p_days: 7, p_start: range.start, p_end: range.end }
                    : { p_days: 7 });
            if (resp.error) throw new Error(resp.error.message);
            if (seq !== fetchSeqRef.current) return; // a newer fetch superseded this one
            const next = (Array.isArray(resp.data) ? resp.data : []) as ReviewRow[];
            const nextNeedsIds = new Set(next.filter(row => row.review_status === 'needs_review').map(row => row.job_id));
            if (checkForNewBooking && priorNeedsIdsRef.current) {
                const hasNew = [...nextNeedsIds].some(jobId => !priorNeedsIdsRef.current!.has(jobId));
                if (hasNew) {
                    try {
                        const context = new AudioContext();
                        const oscillator = context.createOscillator();
                        const gain = context.createGain();
                        oscillator.frequency.value = 880;
                        gain.gain.setValueAtTime(0.08, context.currentTime);
                        oscillator.connect(gain).connect(context.destination);
                        oscillator.start();
                        oscillator.stop(context.currentTime + 0.15);
                        oscillator.addEventListener('ended', () => void context.close());
                    } catch { /* Audio is optional. */ }
                }
            }
            priorNeedsIdsRef.current = nextNeedsIds;
            setRows(next);
            setError(null);
            if (mode === 'bookings') {
                const { data: statsData } = await supabase.rpc('get_review_stats');
                if (statsData && seq === fetchSeqRef.current) setStats(statsData as ReviewStats);
            } else {
                setStats(null);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load review queue');
        } finally {
            setIsLoading(false);
            setIsRefreshing(false);
        }
    }, [mode, periodKind, periodOffset, dateFrom, dateTo]);

    useEffect(() => {
        fetchQueue();
        const intervalId = window.setInterval(() => { if (!document.hidden) fetchQueue(true); }, POLL_MS);
        return () => {
            window.clearInterval(intervalId);
            if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
        };
    }, [fetchQueue]);

    const needsReviewCount = useMemo(() => rows.filter(row => row.review_status === 'needs_review').length, [rows]);
    useEffect(() => { onCountChange(needsReviewCount); }, [needsReviewCount, onCountChange]);

    // Bookings filter by the CSR who booked; Outcomes by the rep who dispositioned it.
    const activeFlagReasons: readonly string[] = mode === 'outcomes' ? OUTCOME_FLAG_REASONS : FLAG_REASONS;

    // Mode is owned by the URL: MainLayout's Review/Outcomes top tabs push the
    // path and dispatch a synthetic popstate; back/forward fires the real one.
    useEffect(() => {
        const syncModeFromUrl = () => setMode(readModeFromUrl());
        window.addEventListener('popstate', syncModeFromUrl);
        return () => window.removeEventListener('popstate', syncModeFromUrl);
    }, []);

    // Normalize a bare /review to its canonical mode path, without adding a history
    // entry — otherwise Back from Bookings lands on the same view it just left.
    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (window.location.pathname !== MODE_TO_PATH[mode]) {
            window.history.replaceState({}, '', MODE_TO_PATH[mode]);
        }
        // Runs once on mount; mode changes arrive via the popstate listener above.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Reset view state when switching between Bookings and Outcomes.
    // Outcomes opens on YESTERDAY: it reviews appointments that already ran, and
    // today's aren't finished yet. Bookings stays on today -- it's the live queue
    // whose badge and new-booking chime depend on showing bookings as they land.
    useEffect(() => {
        setTab('needs_review'); setFieldFilters({}); setFlaggingJobId(null); setActiveJobId(null);
        setUndoStack([]); setRedoStack([]);
        setFlagReason((mode === 'outcomes' ? OUTCOME_FLAG_REASONS : FLAG_REASONS)[0]);
        setOutcomeFilter('all');
        setPeriodKind('day');
        setPeriodOffset(mode === 'outcomes' ? -1 : 0);
    }, [mode]);

    // Dropdown choices come from the rows actually loaded, so they always reflect the
    // current period rather than offering values that would return nothing. Counted
    // per value (roofr-search style), busiest first.
    const filterOptions = useMemo(() => {
        const options = {} as Record<FilterField, Array<{ value: string; count: number }>>;
        FILTER_FIELDS.forEach(({ field }) => {
            const counts = new Map<string, number>();
            rows.forEach(row => {
                const value = String(row[field] ?? '').trim();
                if (value) counts.set(value, (counts.get(value) || 0) + 1);
            });
            options[field] = Array.from(counts, ([value, count]) => ({ value, count }))
                .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
        });
        return options;
    }, [rows]);
    const activeFilterCount = FILTER_FIELDS.filter(({ field }) => (fieldFilters[field]?.length ?? 0) > 0).length;

    const toggleFieldFilter = (field: FilterField, value: string) => {
        setFieldFilters(prev => {
            const current = prev[field] || [];
            const next = current.includes(value) ? current.filter(v => v !== value) : [...current, value];
            const copy = { ...prev };
            if (next.length > 0) copy[field] = next; else delete copy[field];
            return copy;
        });
    };

    // Switching into Custom pre-fills From/To with the currently shown range.
    const selectPeriod = (kind: PeriodKind) => {
        if (kind === 'custom' && periodKind !== 'custom') {
            const current = getPeriodRange(periodKind, periodOffset);
            setDateFrom(current.start);
            setDateTo(current.end);
        }
        setPeriodKind(kind);
        if (kind !== 'custom') setPeriodOffset(0);
    };

    const period = periodKind === 'custom'
        ? { start: dateFrom, end: dateTo, label: 'Custom' }
        : getPeriodRange(periodKind, periodOffset);
    const rangeText = period.start && period.end
        ? (period.start === period.end ? fmtDateStr(period.start) : `${fmtDateStr(period.start)} – ${fmtDateStr(period.end)}`)
        : 'pick dates';

    // Counts for the Outcomes summary strip — from the full loaded range, before
    // any status-tab or dropdown filters, so the strip reads as a range summary.
    const outcomeCounts = useMemo(() => {
        const counts: Record<OutcomeFilter, number> = { all: rows.length, overdue: 0, unqualified: 0, lost: 0, working: 0 };
        if (mode === 'outcomes') rows.forEach(row => { counts[getOutcomeUrgency(row)] += 1; });
        return counts;
    }, [rows, mode]);

    const visibleRows = useMemo(() => rows
        // Filters compose: picking a CSR and a status narrows to rows matching both.
        .filter(row => (tab === 'all' || row.review_status === tab)
            && (mode !== 'outcomes' || outcomeFilter === 'all' || getOutcomeUrgency(row) === outcomeFilter)
            && FILTER_FIELDS.every(({ field }) => {
                const wanted = fieldFilters[field];
                return !wanted || wanted.length === 0 || wanted.includes((row[field] || '').toString().trim());
            }))
        .sort((a, b) => {
            if (mode === 'bookings' && tab === 'needs_review') {
                const riskDifference = Number(getRiskReasons(b).length > 0) - Number(getRiskReasons(a).length > 0);
                if (riskDifference) return riskDifference;
            }
            // Group by the chosen field, then newest-first inside each group so a
            // block stays in a sensible order. Blanks sort last rather than first.
            const sortField = FILTER_FIELDS.find(entry => entry.key === sortKey)?.field;
            if (sortField) {
                const aKey = (a[sortField] || '').toString().trim();
                const bKey = (b[sortField] || '').toString().trim();
                if (aKey !== bKey) {
                    if (!aKey) return 1;
                    if (!bKey) return -1;
                    return aKey.localeCompare(bKey);
                }
            }
            return new Date(b.appt_booked_at || 0).getTime() - new Date(a.appt_booked_at || 0).getTime();
        }), [rows, tab, fieldFilters, mode, sortKey, outcomeFilter]);

    const sortedReps = useMemo(() => stats ? [...stats.by_rep].sort((a, b) => (Number(b[statsSort]) - Number(a[statsSort])) || a.rep.localeCompare(b.rep)) : [], [stats, statsSort]);

    const setReviewerPersisted = (name: string) => {
        setReviewer(name);
        localStorage.setItem(REVIEWER_STORAGE_KEY, name);
    };

    const runReviewAction = async (row: ReviewRow, status: ReviewStatus, reason: string | null = null, note: string | null = null) => {
        setBusyJobId(row.job_id);
        try {
            const { data, error: rpcError } = await supabase.rpc(mode === 'outcomes' ? 'set_outcome_review' : 'set_job_review', {
                p_job_id: row.job_id, p_status: status, p_flag_reason: reason, p_note: note, p_reviewer: reviewer.trim() || null,
            });
            if (rpcError) throw new Error(rpcError.message);
            if (!(data as { ok?: boolean } | null)?.ok) throw new Error('Review update was not accepted');
            setFlaggingJobId(null);
            setFlagNote('');
        } catch (err) {
            flashNotice(err instanceof Error ? err.message : 'Review update failed');
        } finally {
            setBusyJobId(null);
            fetchQueue();
        }
    };

    const reviewWithAnimation = (row: ReviewRow, status: ReviewStatus, reason: string | null = null, note: string | null = null) => {
        setFlaggingJobId(null);
        setFlagNote('');
        setUndoStack(prev => [...prev, {
            row,
            before: { status: row.review_status, reason: row.flag_reason, note: row.review_note, reviewer: row.reviewed_by },
            after: { status, reason, note, reviewer: reviewer.trim() || null },
        }]);
        setRedoStack([]);
        // In the "All" tab the card stays (status change only) — no exit animation.
        if (tab === 'all' || status === 'needs_review') { runReviewAction(row, status, reason, note); return; }
        setExiting(prev => ({ ...prev, [row.job_id]: status === 'flagged' ? 'flagged' : 'reviewed' }));
        window.setTimeout(() => {
            setRows(prev => prev.filter(r => r.job_id !== row.job_id)); // optimistic remove → list slides up
            setExiting(prev => { const next = { ...prev }; delete next[row.job_id]; return next; });
            runReviewAction(row, status, reason, note);
        }, 320);
    };

    const applySnapshot = useCallback(async (jobId: string, snap: ReviewSnapshot) => {
        try {
            const { error: rpcError } = await supabase.rpc(mode === 'outcomes' ? 'set_outcome_review' : 'set_job_review', { p_job_id: jobId, p_status: snap.status, p_flag_reason: snap.reason, p_note: snap.note, p_reviewer: snap.reviewer });
            if (rpcError) throw new Error(rpcError.message);
        } catch (err) {
            flashNotice(err instanceof Error ? err.message : 'Undo failed');
        } finally {
            fetchQueue();
        }
    }, [fetchQueue, flashNotice, mode]);

    const undo = useCallback(() => {
        setUndoStack(prev => {
            if (prev.length === 0) return prev;
            const action = prev[prev.length - 1];
            applySnapshot(action.row.job_id, action.before);
            setRedoStack(r => [...r, action]);
            flashNotice(`Undid: ${action.row.customer || action.row.name || action.row.job_id} back to ${action.before.status.replace('_', ' ')}`);
            return prev.slice(0, -1);
        });
    }, [applySnapshot, flashNotice]);

    const redo = useCallback(() => {
        setRedoStack(prev => {
            if (prev.length === 0) return prev;
            const action = prev[prev.length - 1];
            applySnapshot(action.row.job_id, action.after);
            setUndoStack(u => [...u, action]);
            return prev.slice(0, -1);
        });
    }, [applySnapshot]);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (!(event.ctrlKey || event.metaKey)) return;
            const key = event.key.toLowerCase();
            if (key === 'z' && !event.shiftKey) { event.preventDefault(); event.stopPropagation(); undo(); }
            else if (key === 'y' || (key === 'z' && event.shiftKey)) { event.preventDefault(); event.stopPropagation(); redo(); }
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [undo, redo]);

    const tabs: Array<{ key: ReviewTab; label: string; count?: number }> = [
        { key: 'needs_review', label: 'Needs Review', count: needsReviewCount }, { key: 'reviewed', label: 'Reviewed' }, { key: 'flagged', label: 'Flagged' }, { key: 'all', label: 'All' },
    ];

    return (
        <main className="h-full min-h-0 flex flex-col overflow-hidden">
            <header className="flex-shrink-0 px-1 pb-3 space-y-2 border-b border-border-secondary/60">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-baseline gap-2.5">
                        <h2 className="text-[15px] font-semibold text-text-primary">{mode === 'outcomes' ? 'Outcomes' : 'Bookings'}</h2>
                        <p className="text-[11.5px] text-text-tertiary">{mode === 'outcomes'
                            ? `${OUTCOME_FILTER_PHRASE[outcomeFilter]} · appointments ${rangeText} · rescheduled excluded`
                            : `Bookings made ${rangeText}`}</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-text-tertiary" htmlFor="reviewer-name">Reviewer</label>
                        <input id="reviewer-name" value={reviewer} onChange={event => setReviewerPersisted(event.target.value)} placeholder="Your name" className="h-7 w-32 px-2 text-xs rounded-md border border-border-secondary bg-bg-primary text-text-primary outline-none focus:border-brand-primary transition-colors duration-150" />
                        <button onClick={undo} disabled={undoStack.length === 0} title="Undo last review (Ctrl+Z)" className="h-7 px-2 text-[11px] font-semibold tabular-nums rounded-md border border-border-secondary bg-bg-primary text-text-secondary hover:border-brand-primary hover:text-brand-primary disabled:opacity-40 transition-colors duration-150">◀ Back{undoStack.length > 0 ? ` (${undoStack.length})` : ''}</button>
                        <button onClick={redo} disabled={redoStack.length === 0} title="Redo (Ctrl+Y)" className="h-7 px-2 text-[11px] font-semibold rounded-md border border-border-secondary bg-bg-primary text-text-secondary hover:border-brand-primary hover:text-brand-primary disabled:opacity-40 transition-colors duration-150">Forward ▶</button>
                        <button onClick={() => fetchQueue()} disabled={isRefreshing} title="Refresh review queue" className="h-7 w-7 grid place-items-center rounded-md text-text-tertiary hover:bg-bg-tertiary hover:text-brand-primary disabled:opacity-40 transition-colors duration-150">{isRefreshing ? <LoadingIcon className="h-3.5 w-3.5 text-brand-primary" /> : <RefreshIcon className="h-3.5 w-3.5" />}</button>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    <div className={SEG_WRAP}>
                        {(['day', 'week', 'month', 'custom'] as const).map(k => (
                            <button key={k} onClick={() => selectPeriod(k)} className={`${SEG_BTN} capitalize ${periodKind === k ? SEG_ON : SEG_OFF}`}>{k}</button>
                        ))}
                    </div>
                    {periodKind !== 'custom' ? (
                        <div className="inline-flex items-center h-7 rounded-md border border-border-secondary bg-bg-primary overflow-hidden">
                            <button onClick={() => setPeriodOffset(o => o - 1)} title={`Previous ${periodKind}`} className="h-full px-2 text-text-secondary hover:bg-bg-tertiary hover:text-brand-primary transition-colors duration-150">◀</button>
                            <span className="px-2 min-w-[96px] text-center font-semibold text-text-primary">{period.label}</span>
                            <button onClick={() => setPeriodOffset(o => o + 1)} disabled={periodOffset === 0} title={`Next ${periodKind}`} className="h-full px-2 text-text-secondary hover:bg-bg-tertiary hover:text-brand-primary disabled:opacity-30 transition-colors duration-150">▶</button>
                        </div>
                    ) : (
                        <div className="inline-flex items-center gap-1.5">
                            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-7 px-1.5 rounded-md border border-border-secondary bg-bg-primary text-text-primary outline-none focus:border-brand-primary" />
                            <span className="text-text-tertiary">→</span>
                            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="h-7 px-1.5 rounded-md border border-border-secondary bg-bg-primary text-text-primary outline-none focus:border-brand-primary" />
                        </div>
                    )}
                    {mode === 'outcomes' && <div className={`${SEG_WRAP} ml-1`}>
                        {OUTCOME_STRIP.map(({ key, label, dot, on }) => (
                            <button key={key} onClick={() => setOutcomeFilter(key)} title={OUTCOME_FILTER_PHRASE[key]}
                                className={`${SEG_BTN} ${outcomeFilter === key ? on : SEG_OFF}`}>
                                {dot && <span className={`h-1.5 w-1.5 rounded-full ${outcomeFilter === key && key === 'overdue' ? 'bg-bg-primary' : dot}`} />}
                                {label}
                                <span className="tabular-nums font-bold">{outcomeCounts[key]}</span>
                            </button>
                        ))}
                    </div>}
                    <div className="ml-auto flex flex-wrap items-center gap-1.5">
                        {FILTER_FIELDS.map(({ field, label }) => (
                            <FilterDropdown
                                key={field}
                                label={label}
                                options={filterOptions[field]}
                                selected={fieldFilters[field] || []}
                                onToggle={value => toggleFieldFilter(field, value)}
                                onClear={() => setFieldFilters(prev => { const copy = { ...prev }; delete copy[field]; return copy; })}
                            />
                        ))}
                        {activeFilterCount > 0 && <button onClick={() => setFieldFilters({})} className="h-7 px-2 rounded-md bg-bg-tertiary text-brand-primary font-semibold tabular-nums hover:opacity-80 transition-opacity duration-150" title="Clear all filters">✕ {visibleRows.length} shown</button>}
                        <span className="text-text-tertiary ml-1.5">Group:</span>
                        <select value={sortKey} onChange={event => setSortKey(event.target.value as SortKey)} title="Group the list" className="h-7 px-2 rounded-md border border-border-secondary bg-bg-primary text-text-primary outline-none focus:border-brand-primary">
                            {SORT_OPTIONS.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
                        </select>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <nav className={SEG_WRAP} aria-label="Review status">
                        {tabs.map(item => <button key={item.key} onClick={() => setTab(item.key)} className={`${SEG_BTN} ${tab === item.key ? SEG_ON : SEG_OFF}`}>{item.label}{item.count != null && <span className="tabular-nums font-bold">{item.count}</span>}</button>)}
                    </nav>
                    {stats && <div className="ml-auto flex flex-wrap items-center gap-2 text-[11px] tabular-nums">
                        <span className="px-2 py-0.5 rounded bg-bg-tertiary text-text-secondary">Today · <b className="text-text-primary">{stats.today.booked}</b> booked</span>
                        <span className="px-2 py-0.5 rounded bg-tag-green-bg text-tag-green-text"><b>{stats.today.reviewed}</b> reviewed</span>
                        <span className="px-2 py-0.5 rounded bg-tag-red-bg text-tag-red-text"><b>{stats.today.flagged}</b> flagged</span>
                        <button onClick={() => setShowStats(value => !value)} className="px-2 py-0.5 rounded-md border border-border-secondary text-text-secondary hover:border-brand-primary hover:text-brand-primary transition-colors duration-150">{showStats ? 'Hide' : 'Show'} CSR scorecard</button>
                    </div>}
                </div>
                {showStats && stats && <div className="overflow-x-auto rounded border border-border-secondary/60 max-h-48 overflow-y-auto"><div className="px-2 py-1 text-[9px] text-text-quaternary bg-bg-tertiary/30">Click a column to sort. Flagged / Reviewed = # of that CSR's bookings you flagged / reviewed in each window.</div><table className="w-full text-[11px]"><thead className="sticky top-0 bg-bg-secondary text-text-tertiary"><tr><th rowSpan={2} onClick={() => setStatsSort('rep')} className={`py-1 px-2 text-left cursor-pointer ${statsSort === 'rep' ? 'text-brand-primary' : 'hover:text-brand-primary'}`}>CSR{statsSort === 'rep' ? ' ▾' : ''}</th><th colSpan={3} className="px-1.5 py-0.5 text-center font-bold text-tag-red-text border-l border-border-secondary/40">Flagged</th><th colSpan={3} className="px-1.5 py-0.5 text-center font-bold text-tag-green-text border-l border-border-secondary/40">Reviewed</th></tr><tr>{FLAG_COLS.map((col, i) => <th key={col.key} onClick={() => setStatsSort(col.key)} className={`px-1.5 pb-1 text-center cursor-pointer hover:text-brand-primary ${i === 0 ? 'border-l border-border-secondary/40' : ''} ${statsSort === col.key ? 'text-brand-primary font-bold' : ''}`}>{col.w}{statsSort === col.key ? ' ▾' : ''}</th>)}{REV_COLS.map((col, i) => <th key={col.key} onClick={() => setStatsSort(col.key)} className={`px-1.5 pb-1 text-center cursor-pointer hover:text-brand-primary ${i === 0 ? 'border-l border-border-secondary/40' : ''} ${statsSort === col.key ? 'text-brand-primary font-bold' : ''}`}>{col.w}{statsSort === col.key ? ' ▾' : ''}</th>)}</tr></thead><tbody>{sortedReps.length === 0 ? <tr><td colSpan={7} className="py-2 px-2 text-text-tertiary italic">No reviews in the last 30 days.</td></tr> : sortedReps.map(rep => <tr key={rep.rep} className="border-t border-border-secondary/40"><td onClick={() => { setFieldFilters({ appt_booker: [rep.rep] }); setTab('flagged'); setPeriodKind('month'); setPeriodOffset(0); setShowStats(false); }} className="py-1 px-2 font-semibold text-text-primary whitespace-nowrap cursor-pointer hover:text-brand-primary hover:underline" title="Show this CSR's flagged jobs">{rep.rep}</td><td className={`px-1.5 text-center border-l border-border-secondary/40 ${rep.flagged_day > 0 ? 'font-bold text-tag-red-text' : 'text-text-tertiary'}`}>{rep.flagged_day}</td><td className={`px-1.5 text-center ${rep.flagged_week > 0 ? 'text-tag-red-text' : 'text-text-tertiary'}`}>{rep.flagged_week}</td><td className={`px-1.5 text-center ${rep.flagged_month > 0 ? 'font-semibold text-tag-red-text' : 'text-text-tertiary'}`}>{rep.flagged_month}</td><td className="px-1.5 text-center border-l border-border-secondary/40 text-text-secondary">{rep.reviewed_day}</td><td className="px-1.5 text-center text-text-secondary">{rep.reviewed_week}</td><td className="px-1.5 text-center pr-2 text-text-secondary">{rep.reviewed_month}</td></tr>)}</tbody></table></div>}
            </header>
            {notice && <div className="mx-1 mt-3 px-2 py-1.5 text-[11px] rounded-md border border-tag-amber-border bg-tag-amber-bg text-tag-amber-text">{notice}</div>}
            {error && <div className="mx-1 mt-3 px-2 py-1.5 text-[11px] rounded-md border border-tag-red-border bg-tag-red-bg text-tag-red-text">{error}</div>}
            <section className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-1 py-3">
                {isLoading ? <div className="space-y-2">{[0, 1, 2, 3].map(i => (
                    <div key={i} className="rounded-md border border-border-secondary bg-bg-primary px-3.5 py-3 animate-pulse" style={{ animationDelay: `${i * 120}ms` }}>
                        <div className="flex items-center gap-3">
                            <div className="h-4 w-44 rounded bg-bg-tertiary" />
                            <div className="h-3 w-24 rounded bg-bg-tertiary" />
                            <div className="ml-auto h-6 w-40 rounded bg-bg-tertiary" />
                        </div>
                        <div className="mt-2.5 flex items-center gap-3">
                            <div className="h-5 w-5 rounded-full bg-bg-tertiary" />
                            <div className="h-3 w-28 rounded bg-bg-tertiary" />
                            <div className="h-3 w-56 rounded bg-bg-tertiary" />
                        </div>
                    </div>
                ))}</div> : rows.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                        <p className="text-[15px] font-semibold text-text-secondary">{mode === 'outcomes'
                            ? (outcomeFilter === 'all' ? `No unsigned appointments ${period.label === 'Custom' ? 'in this range' : `for ${period.label.toLowerCase()}`}` : `No ${outcomeFilter} appointments ${period.label === 'Custom' ? 'in this range' : `for ${period.label.toLowerCase()}`}`)
                            : `No bookings ${period.label === 'Custom' ? 'in this range' : `for ${period.label.toLowerCase()}`}`}</p>
                        <p className="mt-1.5 text-[11.5px] text-text-tertiary">{mode === 'outcomes' ? 'Use ◀ to step back through earlier periods.' : 'New bookings land here in real time. Use ◀ to check earlier periods.'}</p>
                    </div>
                ) : visibleRows.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                        <p className="text-[15px] font-semibold text-text-secondary">{tab === 'needs_review' ? 'Review queue clear' : 'Nothing in this view'}</p>
                        <p className="mt-1.5 text-[11.5px] text-text-tertiary tabular-nums">{mode === 'outcomes'
                            ? `In this range: ${outcomeCounts.overdue} overdue · ${outcomeCounts.unqualified} unqualified · ${outcomeCounts.lost} lost · ${outcomeCounts.working} working. Adjust the tabs or filters above to see them.`
                            : 'Adjust the status tabs or filters above to see more.'}</p>
                    </div>
                ) : <div className="flex flex-col">{visibleRows.map(row => {
                    const risks = getRiskReasons(row);
                    const isRisky = mode === 'bookings' && row.review_status === 'needs_review' && risks.length > 0;
                    const isBusy = busyJobId === row.job_id;
                    const exitState = exiting[row.job_id];
                    const phoneDigits = (row.phone || '').replace(/\D/g, '').slice(-10);
                    const propertyFields = [['Roof age', row.roof_age], ['Sq ft', row.prop_sqft], ['Built', row.year_built], ['Stories', row.stories], ['Type', row.property_type]].filter(([, value]) => value != null && String(value).trim() !== '');
                    const urgency = mode === 'outcomes' ? getOutcomeUrgency(row) : null;
                    const csrName = (row.appt_booker || '').trim();
                    const techName = (row.job_owner || '').trim();
                    // Same person booking and running the appt: one identity is enough.
                    const showTech = techName !== '' && techName.toLowerCase() !== csrName.toLowerCase();
                    const tags = (row.tags || '').split(',').map(tag => tag.trim()).filter(Boolean);
                    // Card-level urgency treatment (Outcomes): full-perimeter red border +
                    // background tint graded to severity; the chip stays the loudest element.
                    // Each branch carries its own bg so utilities never clash.
                    const urgencyCardClass = urgency === 'overdue' ? 'bg-tag-red-bg border-tag-red-text'
                        : urgency === 'unqualified' ? 'bg-tag-red-bg/60 border-tag-red-border'
                            : urgency === 'lost' ? 'bg-bg-primary border-tag-red-border'
                                : '';
                    return <article key={row.job_id} onClick={() => setActiveJobId(row.job_id)} className={`rounded-md border px-3.5 py-2.5 mb-2 overflow-hidden transition-all duration-300 max-h-48 active:scale-[0.99] hover:shadow-sm ${activeJobId === row.job_id ? 'bg-bg-primary border-brand-primary ring-2 ring-brand-primary/40' : urgencyCardClass || 'bg-bg-primary border-border-secondary hover:border-border-primary'} ${isRisky ? 'border-tag-amber-border' : ''} ${exitState === 'reviewed' ? 'translate-x-[110%] opacity-0 !max-h-0 !py-0 !mb-0 !bg-tag-green-bg' : exitState === 'flagged' ? '-translate-x-[110%] opacity-0 !max-h-0 !py-0 !mb-0 !bg-tag-red-bg' : ''}`}>
                        <div className="flex items-start gap-4">
                            <div className="flex-1 min-w-0 space-y-0.5">
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5"><h2 className="text-[15px] font-semibold text-text-primary">{row.customer || row.name || 'Unknown customer'}</h2>{mode === 'outcomes' ? <>
                                    {urgency === 'overdue' && <span className="px-2 py-0.5 text-[9px] font-bold tracking-wide rounded border border-tag-red-text bg-tag-red-text text-bg-primary animate-outcome-attention" title="The appointment ran but the job is still in Appointment scheduled — the rep never entered an outcome">OVERDUE · NOT DISPOSITIONED</span>}
                                    {urgency === 'unqualified' && <span className="px-2 py-0.5 text-[9px] font-bold tracking-wide rounded border border-tag-red-border bg-tag-red-bg text-tag-red-text animate-outcome-attention">UNQUALIFIED</span>}
                                    {urgency === 'lost' && <span className="px-2 py-0.5 text-[9px] font-bold tracking-wide rounded border border-tag-red-text bg-tag-red-text text-bg-primary">LOST</span>}
                                    {urgency === 'working' && <span className="px-1.5 py-0.5 text-[9px] font-semibold rounded border border-border-secondary bg-bg-tertiary text-text-secondary" title="Roofr job-card status">{row.stage || row.outcome || 'In progress'}</span>}
                                    <span className="text-[11px] tabular-nums text-text-tertiary whitespace-nowrap">Appt {row.appt_date || '—'}</span>
                                </> : <span className="text-[11px] text-text-tertiary whitespace-nowrap"><span className="font-semibold text-brand-primary">{formatRelativeTime(row.appt_booked_at)}</span>{' · '}{formatPhoenixDate(row.appt_booked_at)}</span>}{isRisky && <span className="px-1.5 py-0.5 text-[9px] font-bold rounded border border-tag-amber-border bg-tag-amber-bg text-tag-amber-text">⚠ {risks.join(', ')}</span>}</div>
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]">
                                    <span className="inline-flex items-center gap-1.5 font-bold text-brand-text-light" title="CSR who booked this appointment">
                                        <span className="grid h-5 w-5 place-items-center rounded-full bg-brand-primary text-[9px] font-bold text-brand-text-on-primary">{getInitials(csrName || '?')}</span>
                                        {csrName || 'Unknown CSR'}
                                    </span>
                                    {showTech && <span className="text-text-secondary" title="Technician who runs the appointment">Tech: <b className="font-semibold text-text-primary">{techName}</b></span>}
                                    {mode === 'bookings' && row.stage && <span className="px-1.5 py-0.5 rounded border border-border-secondary bg-bg-tertiary text-text-secondary font-semibold" title="Roofr job-card status">{row.stage}</span>}
                                    {row.lead_source && <span className="text-text-tertiary">{row.lead_source}</span>}
                                    {tags.slice(0, 2).map(tag => <span key={tag} className="px-1.5 py-0.5 rounded border border-border-secondary/60 text-text-tertiary">{tag}</span>)}
                                    {tags.length > 2 && <span className="text-text-quaternary" title={tags.join(', ')}>+{tags.length - 2} more</span>}
                                </div>
                                <div className="flex flex-wrap items-center gap-x-3 text-[11.5px] text-text-secondary">{row.address && <span>{row.address}</span>}{row.phone && (phoneDigits
                                    // stopPropagation: the card itself is clickable (sets the active
                                    // row), so opening CTM shouldn't also select the card.
                                    ? <a href={`https://app.calltrackingmetrics.com/calls#filter=${phoneDigits}`} target="_blank" rel="noreferrer" onClick={event => event.stopPropagation()} title="Open this number's calls in CTM" className="font-semibold text-brand-primary hover:underline">{row.phone}</a>
                                    : <span>{row.phone}</span>)}{row.value != null && <span className="font-semibold tabular-nums text-text-primary">${row.value.toLocaleString()}</span>}{propertyFields.map(([label, value]) => <span key={label} className="text-[10px] text-text-tertiary">{label}: <span className="font-semibold text-text-secondary">{String(value)}</span></span>)}</div>
                            </div>
                            <div className="flex-shrink-0 flex flex-col items-end gap-1">
                                <div className="flex flex-wrap justify-end gap-1">{row.job_id && <LinkPill href={`https://app.roofr.com/dashboard/team/239329/jobs/list-view?selectedJobId=${row.job_id}`} label="Roofr" />}{phoneDigits && <LinkPill href={`https://app.calltrackingmetrics.com/calls/desk#filter=${phoneDigits}`} label="CTM" />}{row.address && <LinkPill href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(row.address)}`} label="Map" />}</div>
                                {row.review_status === 'needs_review' ? <div className="flex flex-wrap justify-end gap-1"><button onClick={() => reviewWithAnimation(row, 'reviewed')} disabled={isBusy} className="px-2.5 py-1 text-[10px] font-bold rounded bg-tag-green-text text-bg-primary hover:opacity-90 disabled:opacity-50 transition">{isBusy ? 'Saving…' : 'Mark Reviewed'}</button><button onClick={() => { setFlaggingJobId(flaggingJobId === row.job_id ? null : row.job_id); setFlagNote(''); }} disabled={isBusy} className="px-2 py-1 text-[10px] font-bold rounded border border-tag-amber-border bg-tag-amber-bg text-tag-amber-text disabled:opacity-50">Flag</button></div> : <div className="flex flex-wrap items-center justify-end gap-2 text-[10px] text-text-tertiary text-right"><span>{row.review_status === 'flagged' ? 'Flagged' : 'Reviewed'}{row.reviewed_by ? ` by ${row.reviewed_by}` : ''}{row.reviewed_at ? ` · ${formatPhoenixDate(row.reviewed_at)}` : ''}{row.flag_reason ? ` · ${row.flag_reason}` : ''}{row.review_note ? `: ${row.review_note}` : ''}</span><button onClick={() => runReviewAction(row, 'needs_review')} disabled={isBusy} className="px-2 py-1 font-bold rounded border border-border-secondary text-text-secondary hover:border-brand-primary disabled:opacity-50">Reopen</button></div>}
                            </div>
                        </div>
                        {flaggingJobId === row.job_id && <div className="mt-1 flex flex-wrap gap-1.5 rounded border border-tag-amber-border bg-tag-amber-bg p-2"><select value={flagReason} onChange={event => setFlagReason(event.target.value)} className="px-1.5 py-1 text-[10px] rounded border border-tag-amber-border bg-bg-primary text-text-primary">{activeFlagReasons.map(reason => <option key={reason}>{reason}</option>)}</select><input value={flagNote} onChange={event => setFlagNote(event.target.value)} placeholder="Optional note" className="flex-1 min-w-32 px-2 py-1 text-[10px] rounded border border-tag-amber-border bg-bg-primary text-text-primary" /><button onClick={() => reviewWithAnimation(row, 'flagged', flagReason, flagNote.trim() || null)} disabled={isBusy} className="px-2 py-1 text-[10px] font-bold rounded bg-tag-amber-text text-bg-primary disabled:opacity-50">{isBusy ? 'Saving…' : 'Save flag'}</button></div>}
                    </article>;
                })}</div>}
            </section>
        </main>
    );
};

export default ReviewQueue;
