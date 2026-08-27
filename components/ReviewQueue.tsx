import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLinkIcon, LoadingIcon, RefreshIcon } from './icons';
import { supabase } from '../services/supabaseClient';
import { SEG_WRAP, SEG_BTN, SEG_ON, SEG_OFF } from './ui';
import { getAuthUser } from './AuthGate';

const REVIEWER_STORAGE_KEY = 'reviewQueue.reviewer';
const POLL_MS = 60000;
const FLAG_REASONS = ['One legger', 'No legger', 'Roof age unknown', 'Bad address', 'Wrong appt window', 'Missing info', 'Out of area', 'Low intent', 'Other'] as const;
// Flag reasons for the Outcomes view (QA of unqualified/lost dispositions).
const OUTCOME_FLAG_REASONS = ['Should be qualified', 'Wrongly unqualified', 'No-show mislabeled', 'Weak disposition', 'Rep gave up early', 'Needs follow-up', 'Bad reason given', 'Other'] as const;

type ReviewStatus = 'needs_review' | 'reviewed' | 'flagged';
type ReviewTab = 'needs_review' | 'reviewed' | 'flagged' | 'all';
type ReviewMode = 'bookings' | 'outcomes' | 'rescue';

// Each mode gets its own URL so a view is linkable and back/forward works:
// /review and /review/bookings = Bookings, /review/outcomes = Outcomes,
// /review/rescue = Rescue (the stuck-deal CSR work queue).
// Bare /review stays on Bookings so existing links and bookmarks keep working.
const REVIEW_BASE_PATH = '/review';
const MODE_TO_PATH: Record<ReviewMode, string> = {
    bookings: `${REVIEW_BASE_PATH}/bookings`,
    outcomes: `${REVIEW_BASE_PATH}/outcomes`,
    rescue: `${REVIEW_BASE_PATH}/rescue`,
};
const readModeFromUrl = (): ReviewMode => {
    if (typeof window === 'undefined') return 'bookings';
    const path = window.location.pathname.toLowerCase();
    if (path.startsWith(MODE_TO_PATH.outcomes)) return 'outcomes';
    if (path.startsWith(MODE_TO_PATH.rescue)) return 'rescue';
    return 'bookings';
};
type OutcomeFilter = 'all' | 'overdue' | 'unqualified' | 'lost' | 'working';
type PeriodKind = 'day' | 'week' | 'month' | 'custom';
// List ordering. 'oldest' reads the queue top-to-bottom in booking order, so new
// bookings append at the BOTTOM and the reviewer's place in the list holds still;
// 'recent' is newest-first (risky ones float in the bookings needs-review tab
// either way); the rest group the list so one CSR / status / technician can be
// worked through in a block.
type SortKey = 'recent' | 'oldest' | 'csr' | 'stage' | 'tech';
type FilterField = 'appt_booker' | 'stage' | 'job_owner';
// The groupable fields are also the filterable ones, so sort and filter stay in
// lockstep — one entry here yields both a Sort button and a filter dropdown.
const FILTER_FIELDS: Array<{ key: Exclude<SortKey, 'recent'>; field: FilterField; label: string }> = [
    { key: 'csr', field: 'appt_booker', label: 'Booking CSR' },
    { key: 'stage', field: 'stage', label: 'Status' },
    { key: 'tech', field: 'job_owner', label: 'Technician' },
];
const SORT_OPTIONS: Array<{ key: SortKey; label: string }> = [
    { key: 'oldest', label: 'Oldest' },
    { key: 'recent', label: 'Newest' },
    ...FILTER_FIELDS.map(entry => ({ key: entry.key as SortKey, label: entry.label })),
];

// ── Bookmarkable views ────────────────────────────────────────────────────────
// Every choice a reviewer makes — period, status tab, outcome urgency, the
// multi-select dropdowns, grouping — is mirrored into the query string and read
// back on load, so "my unqualified outcomes, grouped by tech" is just a URL you
// bookmark. The period is stored RELATIVE (kind + offset), so a saved link keeps
// meaning "yesterday" every morning instead of freezing the date it was made;
// only a Custom range stores absolute dates. Values equal to the mode's defaults
// are left out, so an untouched view stays a clean /review/outcomes.
interface ViewState {
    tab: ReviewTab;
    outcomeFilter: OutcomeFilter;
    fieldFilters: Partial<Record<FilterField, string[]>>;
    sortKey: SortKey;
    periodKind: PeriodKind;
    periodOffset: number;
    dateFrom: string;
    dateTo: string;
}
// Outcomes defaults to YESTERDAY: the appointments it reviews have already run,
// and today's aren't finished yet. Bookings stays on today — it's the live queue,
// and it defaults to OLDEST first so the queue is worked top-down in the order
// the bookings came in.
const defaultView = (mode: ReviewMode): ViewState => ({
    tab: 'needs_review', outcomeFilter: 'all', fieldFilters: {}, sortKey: mode === 'outcomes' ? 'recent' : 'oldest',
    periodKind: 'day', periodOffset: mode === 'outcomes' ? -1 : 0, dateFrom: '', dateTo: '',
});
// Short query keys for the dropdowns, so a shared link stays human-readable.
// Multi-select repeats the key: ?csr=Ana&csr=Bo.
const FILTER_PARAM: Record<FilterField, string> = { appt_booker: 'csr', stage: 'status', job_owner: 'tech' };
const REVIEW_TABS: ReviewTab[] = ['needs_review', 'reviewed', 'flagged', 'all'];
const OUTCOME_FILTERS: OutcomeFilter[] = ['all', 'overdue', 'unqualified', 'lost', 'working'];
const PERIOD_KINDS: PeriodKind[] = ['day', 'week', 'month', 'custom'];
const isDateParam = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

// Anything unrecognized falls back to the default — a mangled or half-copied link
// should open the normal view, never an empty list the reviewer can't explain.
const readViewFromUrl = (mode: ReviewMode): ViewState => {
    const view = defaultView(mode);
    if (typeof window === 'undefined') return view;
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab') as ReviewTab | null;
    if (tab && REVIEW_TABS.includes(tab)) view.tab = tab;
    const outcome = params.get('outcome') as OutcomeFilter | null;
    if (outcome && OUTCOME_FILTERS.includes(outcome)) view.outcomeFilter = outcome;
    const sort = params.get('sort') as SortKey | null;
    if (sort && SORT_OPTIONS.some(option => option.key === sort)) view.sortKey = sort;
    const periodKind = params.get('period') as PeriodKind | null;
    if (periodKind && PERIOD_KINDS.includes(periodKind)) view.periodKind = periodKind;
    if (params.has('off')) {
        const offset = Number(params.get('off'));
        // Offsets only ever run backwards (the ▶ button stops at 0); the floor keeps
        // a junk value from firing off a query for the year 1200.
        if (Number.isInteger(offset) && offset <= 0 && offset > -600) view.periodOffset = offset;
    }
    const from = params.get('from') || '';
    const to = params.get('to') || '';
    if (isDateParam(from) && isDateParam(to)) { view.dateFrom = from; view.dateTo = to; }
    FILTER_FIELDS.forEach(({ field }) => {
        const values = params.getAll(FILTER_PARAM[field]).map(value => value.trim()).filter(Boolean);
        if (values.length > 0) view.fieldFilters[field] = values;
    });
    return view;
};

const viewToSearch = (view: ViewState, mode: ReviewMode): string => {
    const base = defaultView(mode);
    const params = new URLSearchParams();
    if (view.tab !== base.tab) params.set('tab', view.tab);
    if (mode === 'outcomes' && view.outcomeFilter !== base.outcomeFilter) params.set('outcome', view.outcomeFilter);
    if (view.sortKey !== base.sortKey) params.set('sort', view.sortKey);
    if (view.periodKind !== base.periodKind) params.set('period', view.periodKind);
    if (view.periodKind === 'custom') {
        if (view.dateFrom) params.set('from', view.dateFrom);
        if (view.dateTo) params.set('to', view.dateTo);
    } else if (view.periodOffset !== base.periodOffset) {
        params.set('off', String(view.periodOffset));
    }
    FILTER_FIELDS.forEach(({ field }) => (view.fieldFilters[field] || []).forEach(value => params.append(FILTER_PARAM[field], value)));
    const query = params.toString();
    return query ? `?${query}` : '';
};

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
    // Booking-grader scorecard (left join on booking_grades; null until the
    // grader has processed the booking — it runs every 5 minutes)
    grade?: string | null;          // A–F, or NO_CALL / NO_TRANSCRIPT
    grade_score?: number | null;
    grade_dispatch?: boolean | null; // false = SOP says this shouldn't have been booked
    grade_flags?: string[] | null;
    grade_coach?: string | null;
    grade_layers?: Record<string, string | null> | null; // per-layer PASS/PARTIAL/FAIL/UNKNOWN
    grade_layer_notes?: Record<string, string | null> | null; // per-layer one-line explanation from the call
    grade_layer_fixes?: Record<string, string | null> | null; // per-layer "say this next time" script line
    grade_checklist?: number | null;
    grade_checklist_total?: number | null;
    grade_checklist_missed?: string[] | null;
    grade_call_seconds?: number | null;
    // Rescue mode (get_rescue_queue): how long the job has sat in its current
    // stage, the active phone-claim, and the latest CSR action logged on it.
    days_in_stage?: number | null;
    claimed_by?: string | null;
    claimed_at?: string | null;
    last_action?: string | null;
    last_action_note?: string | null;
    last_action_by?: string | null;
    last_action_at?: string | null;
    action_count?: number | null;
}

// Outcomes urgency. 'overdue' = the appointment already ran but the job still
// sits in "Appointment scheduled" (the rep never dispositioned it) — worst case.
type OutcomeUrgency = 'overdue' | 'unqualified' | 'lost' | 'working';
const normalizeStatus = (value?: string | null) => (value ?? '').toLowerCase().replace(/[_/–—-]+/g, ' ').replace(/\s+/g, ' ').trim();
// Phoenix calendar date, not the browser's — appt_date comparisons must not
// flip a card to overdue at 5pm because the viewer's machine is in UTC.
const phoenixToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Phoenix' }).format(new Date());
const phoenixDateOf = (value: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Phoenix' }).format(new Date(value));
// Rescue is a DAILY touch queue: a card counts as handled once anyone logs an
// action today (Phoenix day); it resurfaces tomorrow and only leaves the queue
// when the job's Roofr stage actually changes.
const isTouchedToday = (row: ReviewRow) => !!row.last_action_at && phoenixDateOf(row.last_action_at) === phoenixToday();
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

// Booking-grade chip styling (grades written by the marvin booking-grader
// against the CSR Booking SOP). Unknown grades (NO_CALL / NO_TRANSCRIPT)
// render as a muted "no call" chip instead.
const GRADE_CHIP: Record<string, string> = {
    A: 'border-tag-green-border bg-tag-green-bg text-tag-green-text',
    B: 'border-tag-blue-border bg-tag-blue-bg text-tag-blue-text',
    C: 'border-tag-amber-border bg-tag-amber-bg text-tag-amber-text',
    D: 'border-tag-amber-border bg-tag-amber-bg text-tag-amber-text',
    F: 'border-tag-red-border bg-tag-red-bg text-tag-red-text',
};
// Per-layer verdict pill colors for the expanded grade panel.
const LAYER_PILL: Record<string, string> = {
    PASS: 'border-tag-green-border bg-tag-green-bg text-tag-green-text',
    PARTIAL: 'border-tag-amber-border bg-tag-amber-bg text-tag-amber-text',
    FAIL: 'border-tag-red-border bg-tag-red-bg text-tag-red-text',
    UNKNOWN: 'border-border-secondary bg-bg-tertiary text-text-tertiary',
};
const formatCallDuration = (seconds?: number | null) =>
    seconds == null ? null : seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
// jsonb loses key order — render the layer pills in the SOP's layer order.
const LAYER_ORDER = ['Eligibility', 'Availability', 'Expectations', 'Path to sale', 'Presence', 'Decision-makers'];
// Deep links from the grade panel into the CSR Booking SOP Google Doc (the
// grading rubric). Google heading anchors are stable ids that survive edits as
// long as the heading itself isn't deleted; an unknown anchor just opens the
// top of the doc. The three dispatch-gate layers all live in the Layer 2
// section, so they share its anchor. Re-fetch ids via the Docs API if the doc
// is restructured (paragraphStyle.headingId per heading).
// The ?tab= param is REQUIRED: since the Docs tabs rollout, the editor ignores
// a #heading= fragment unless the tab is named in the URL (this doc: t.0).
const SOP_DOC_URL = 'https://docs.google.com/document/d/1tqQu23LjIkPI538hucUa5Ul5UyhXg98Sfr6dG6-TPps/edit?tab=t.0';
// Every SOP link shares one NAMED browser tab, so clicking another section
// re-navigates that tab instead of stacking new ones. Two load-bearing rules:
// (1) no rel="noopener"/"noreferrer" on these links — noopener discards the
// window name, which brings back a fresh tab per click; (2) the &h= param
// makes each section's URL unique, because two URLs differing only in the
// #fragment are a same-document navigation the Docs editor ignores (it only
// reads the heading fragment at load time).
const SOP_TARGET = 'ar-sop';
const sopUrl = (anchor?: string) => (anchor ? `${SOP_DOC_URL}&h=${anchor}#heading=${anchor}` : SOP_DOC_URL);
const SOP_LAYER_ANCHOR: Record<string, string> = {
    'Eligibility': 'h.bd56bgmdif6t',      // Layer 1 — Eligibility (What We Book)
    'Availability': 'h.5fr7w6u5880',      // Gate 1 — Decision-Maker Available
    'Expectations': 'h.iac4ausxfx2e',     // Gate 2 — Expectations Set
    'Path to sale': 'h.hvkttg3s5z87',     // Gate 3 — Real Path to Move Forward
    'Presence': 'h.ytuj1ykzw9nb',         // Layer 3 — Presence Policy (Safety)
    'Decision-makers': 'h.aot17cywlfxn',  // Layer 4 — Both Decision-Makers
};
const SOP_INTAKE_ANCHOR = 'h.w9k85rh2qa02'; // Intake Checklist — Collect ALL of These

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

// ── Rescue mode ──────────────────────────────────────────────────────────────
// Signed retail deals stuck in the production-manager chase stages. Each stage
// maps to ONE concrete CSR task; the card leads with it so the queue reads as
// a to-do list, not a job dump. Claims stop two CSRs calling the same customer.
const RESCUE_TASK: Record<string, { task: string; who: 'customer' | 'rep'; chip: string }> = {
    'Needs Deposit': { task: 'Call customer — collect the deposit', who: 'customer', chip: 'border-tag-green-border bg-tag-green-bg text-tag-green-text' },
    'Colors & Selection': { task: 'Get shingle/tile colors — rep or customer', who: 'customer', chip: 'border-tag-blue-border bg-tag-blue-bg text-tag-blue-text' },
    'Failed Sales Audit': { task: 'Chase rep — audit items / production report', who: 'rep', chip: 'border-tag-red-border bg-tag-red-bg text-tag-red-text' },
    'Deposits On Hold': { task: 'Deposit blocked — check in and revive', who: 'customer', chip: 'border-tag-amber-border bg-tag-amber-bg text-tag-amber-text' },
    'Appointment Ran': { task: 'Nudge rep — appointment needs an outcome', who: 'rep', chip: 'border-border-secondary bg-bg-tertiary text-text-secondary' },
};
// Stage strip order = the money order: deposits first, then colors, then audit.
const RESCUE_STAGES = ['Needs Deposit', 'Colors & Selection', 'Failed Sales Audit', 'Deposits On Hold', 'Appointment Ran'];
// What a CSR can log after working a card. Per-stage primaries come first;
// the common outcomes (LM / no answer / hand-offs) apply everywhere.
const RESCUE_ACTIONS: Array<{ key: string; label: string; stages?: string[]; primary?: boolean }> = [
    { key: 'deposit_collected', label: '💰 Deposit collected', stages: ['Needs Deposit', 'Deposits On Hold'], primary: true },
    { key: 'deposit_promised', label: '🤝 Deposit promised', stages: ['Needs Deposit', 'Deposits On Hold'] },
    { key: 'colors_collected', label: '🎨 Colors picked', stages: ['Colors & Selection'], primary: true },
    { key: 'rep_chased', label: '📣 Rep chased', stages: ['Failed Sales Audit', 'Appointment Ran'], primary: true },
    { key: 'left_message', label: 'Left message' },
    { key: 'no_answer', label: 'No answer' },
    { key: 'needs_rep', label: '→ Needs rep' },
    { key: 'needs_bradley', label: '→ Needs Bradley' },
];
const RESCUE_ACTION_LABEL: Record<string, string> = Object.fromEntries(RESCUE_ACTIONS.map(a => [a.key, a.label.replace(/^[^\w→]+\s*/, '')]));
// A claim is a soft phone-lock, not ownership — the backend expires it at 45
// minutes and logging any action releases it.
const RESCUE_CLAIM_MS = 45 * 60 * 1000;
const daysChipClass = (days: number) => days >= 14
    ? 'border-tag-red-border bg-tag-red-bg text-tag-red-text'
    : days >= 7 ? 'border-tag-amber-border bg-tag-amber-bg text-tag-amber-text'
        : 'border-border-secondary bg-bg-tertiary text-text-secondary';

// Read-only CompanyCam production-report status (from /api/companycam).
// ≥50% complete = Bradley's bar for hand-checking "Sales - Production Report"
// in Roofr — the app only surfaces it, it never writes anywhere.
const CC_CHECKOFF_PCT = 50;
interface CcReport { found: boolean; pct?: number; done?: number; total?: number; complete?: boolean; missing?: string[]; project_url?: string; last_task_at?: string | null; reason?: string; }

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
// An optional named target shares ONE browser tab across clicks (like the SOP
// links) — rel="noreferrer" must be dropped for those, since its implied
// noopener discards the window name and forces a fresh tab per click.
// Middle/Ctrl-click still opens a separate tab either way.
const LinkPill: React.FC<{ href: string; label: string; target?: string }> = ({ href, label, target }) => (
    <a href={href} target={target || '_blank'} rel={target ? undefined : 'noreferrer'} onClick={event => event.stopPropagation()} className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold rounded border border-transparent text-text-tertiary hover:border-border-secondary hover:text-brand-primary hover:bg-bg-tertiary transition">
        <ExternalLinkIcon className="h-3 w-3" />{label}
    </a>
);

const ReviewQueue: React.FC<{ onCountChange: (count: number) => void }> = ({ onCountChange }) => {
    // A bookmarked link opens exactly as it was saved, so every control below seeds
    // from the URL rather than from a hardcoded default.
    const initialView = useMemo(() => readViewFromUrl(readModeFromUrl()), []);
    const [rows, setRows] = useState<ReviewRow[]>([]);
    const [tab, setTab] = useState<ReviewTab>(initialView.tab);
    // Signed in = identity comes from the Google account and can't be edited;
    // the free-text input only survives as a fallback when auth is off.
    const authUser = useMemo(() => getAuthUser(), []);
    const [reviewer, setReviewer] = useState(() => (getAuthUser()?.name) || localStorage.getItem(REVIEWER_STORAGE_KEY) || '');
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
    const [periodKind, setPeriodKind] = useState<PeriodKind>(initialView.periodKind);
    // The period must already match the mode/link at mount — otherwise mount fires a
    // today fetch AND a refetch for the real period, and whichever lands last wins.
    const [periodOffset, setPeriodOffset] = useState(initialView.periodOffset);
    // Multi-select per field: empty/absent array = no filter on that field.
    const [fieldFilters, setFieldFilters] = useState<Partial<Record<FilterField, string[]>>>(initialView.fieldFilters);
    const [mode, setMode] = useState<ReviewMode>(readModeFromUrl);
    const [dateFrom, setDateFrom] = useState(initialView.dateFrom);
    const [dateTo, setDateTo] = useState(initialView.dateTo);
    // 'all' = every appointment that hasn't reached Proposal signed, which is the
    // whole point of the view; unqualified/lost narrow it to the hard dispositions.
    const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>(initialView.outcomeFilter);
    const [sortKey, setSortKey] = useState<SortKey>(initialView.sortKey);
    const [flaggingJobId, setFlaggingJobId] = useState<string | null>(null);
    const [flagReason, setFlagReason] = useState<string>(FLAG_REASONS[0]);
    const [flagNote, setFlagNote] = useState('');
    const [rescueNote, setRescueNote] = useState('');
    // Per-job action trail, fetched lazily when a rescue card is expanded.
    const [rescueHistory, setRescueHistory] = useState<Record<string, Array<{ action: string; note: string | null; actor: string | null; created_at: string }>>>({});
    // CompanyCam production-report status per job (null = fetch in flight).
    const [ccReports, setCcReports] = useState<Record<string, CcReport | null>>({});
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
            // Rescue isn't date-ranged — the queue IS every currently stuck job.
            const resp = mode === 'rescue'
                ? await supabase.rpc('get_rescue_queue')
                : mode === 'outcomes'
                    ? await supabase.rpc('get_outcome_review', {
                        p_start: range?.start || null, p_end: range?.end || null,
                        p_outcome: null,
                    })
                    : await supabase.rpc('get_review_queue', range
                        ? { p_days: 7, p_start: range.start, p_end: range.end }
                        : { p_days: 7 });
            if (resp.error) throw new Error(resp.error.message);
            if (seq !== fetchSeqRef.current) return; // a newer fetch superseded this one
            let next = (Array.isArray(resp.data) ? resp.data : []) as ReviewRow[];
            // Rescue rows have no review state; derive one from TODAY's touches so
            // the badge counts jobs still needing contact today (Phoenix day).
            if (mode === 'rescue') next = next.map(row => ({ ...row, review_status: (isTouchedToday(row) ? 'reviewed' : 'needs_review') as ReviewStatus }));
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

    // Point every control at a saved view (or, with no query params, the mode's defaults).
    const applyView = useCallback((view: ViewState) => {
        setTab(view.tab); setOutcomeFilter(view.outcomeFilter); setFieldFilters(view.fieldFilters);
        setSortKey(view.sortKey); setPeriodKind(view.periodKind); setPeriodOffset(view.periodOffset);
        setDateFrom(view.dateFrom); setDateTo(view.dateTo);
    }, []);

    // Mode is owned by the URL: MainLayout's Review/Outcomes top tabs push the
    // path and dispatch a synthetic popstate; back/forward fires the real one.
    // Back/forward between two saved views of the SAME mode doesn't retrigger the
    // mode effect below, so the view is re-read here as well.
    useEffect(() => {
        const syncFromUrl = () => {
            const nextMode = readModeFromUrl();
            setMode(nextMode);
            applyView(readViewFromUrl(nextMode));
        };
        window.addEventListener('popstate', syncFromUrl);
        return () => window.removeEventListener('popstate', syncFromUrl);
    }, [applyView]);

    // Normalize a bare /review to its canonical mode path, without adding a history
    // entry — otherwise Back from Bookings lands on the same view it just left. The
    // query string rides along so /review?csr=Ana keeps its filters.
    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (window.location.pathname !== MODE_TO_PATH[mode]) {
            window.history.replaceState({}, '', `${MODE_TO_PATH[mode]}${window.location.search}`);
        }
        // Runs once on mount; mode changes arrive via the popstate listener above.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Switching between Bookings and Outcomes reloads the view from the URL: a
    // bookmarked link arrives with its filters in the query, while the top tabs push
    // a bare path and so land on the mode's defaults. Review progress (undo stack,
    // open flag form) is per-mode and always cleared.
    useEffect(() => {
        applyView(readViewFromUrl(mode));
        setFlaggingJobId(null); setActiveJobId(null);
        setUndoStack([]); setRedoStack([]);
        setFlagReason((mode === 'outcomes' ? OUTCOME_FLAG_REASONS : FLAG_REASONS)[0]);
    }, [mode, applyView]);

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

    // Rescue strip counts per stage, from the full queue before any filters.
    const rescueStageCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        if (mode === 'rescue') rows.forEach(row => { const stage = (row.stage || '').trim(); if (stage) counts[stage] = (counts[stage] || 0) + 1; });
        return counts;
    }, [rows, mode]);

    const visibleRows = useMemo(() => rows
        // Filters compose: picking a CSR and a status narrows to rows matching both.
        // Rescue skips the review-status tabs (its strip filters by stage instead).
        .filter(row => (mode === 'rescue' || tab === 'all' || row.review_status === tab)
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
            // Rescue: today's touched cards sink to the bottom (done for the day),
            // then grouping, then Oldest = most days stuck first / Newest = least.
            if (mode === 'rescue') {
                const touchDifference = Number(isTouchedToday(a)) - Number(isTouchedToday(b));
                if (touchDifference) return touchDifference;
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
                const daysDifference = (b.days_in_stage ?? 0) - (a.days_in_stage ?? 0);
                return sortKey === 'recent' ? -daysDifference : daysDifference;
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
            const newestFirst = new Date(b.appt_booked_at || 0).getTime() - new Date(a.appt_booked_at || 0).getTime();
            return sortKey === 'oldest' ? -newestFirst : newestFirst;
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

    // ── Rescue actions ──────────────────────────────────────────────────────
    // Claim = soft phone-lock (45 min, backend-enforced) so two CSRs never call
    // the same customer; logging any action releases the claim server-side.
    const requireName = (): string | null => {
        const name = reviewer.trim();
        if (!name) { flashNotice('Enter your name (top right) first — claims and actions are logged under it.'); return null; }
        return name;
    };
    const claimRescue = async (row: ReviewRow) => {
        const name = requireName(); if (!name) return;
        setBusyJobId(row.job_id);
        try {
            const { data, error: rpcError } = await supabase.rpc('claim_rescue', { p_job_id: row.job_id, p_by: name });
            if (rpcError) throw new Error(rpcError.message);
            const result = data as { ok?: boolean; holder?: string } | null;
            if (!result?.ok) flashNotice(`Already claimed by ${result?.holder || 'someone else'} — pick another card.`);
        } catch (err) {
            flashNotice(err instanceof Error ? err.message : 'Claim failed');
        } finally { setBusyJobId(null); fetchQueue(); }
    };
    const releaseRescue = async (row: ReviewRow) => {
        const name = requireName(); if (!name) return;
        setBusyJobId(row.job_id);
        try {
            const { error: rpcError } = await supabase.rpc('release_rescue', { p_job_id: row.job_id, p_by: name });
            if (rpcError) throw new Error(rpcError.message);
        } catch (err) {
            flashNotice(err instanceof Error ? err.message : 'Release failed');
        } finally { setBusyJobId(null); fetchQueue(); }
    };
    const logRescue = async (row: ReviewRow, action: string, note: string | null) => {
        const name = requireName(); if (!name) return;
        setBusyJobId(row.job_id);
        try {
            const { data, error: rpcError } = await supabase.rpc('log_rescue_action', { p_job_id: row.job_id, p_action: action, p_note: note, p_actor: name });
            if (rpcError) throw new Error(rpcError.message);
            if (!(data as { ok?: boolean } | null)?.ok) throw new Error('Action was not accepted');
            setRescueNote('');
            // Drop the cached trail so the expanded card refetches with this action.
            setRescueHistory(prev => { const next = { ...prev }; delete next[row.job_id]; return next; });
            flashNotice(`Logged: ${RESCUE_ACTION_LABEL[action] || action} — ${row.customer || row.name || row.job_id}`);
        } catch (err) {
            flashNotice(err instanceof Error ? err.message : 'Action failed');
        } finally { setBusyJobId(null); fetchQueue(); }
    };

    // Expanded rescue card loads the job's full action trail (who did what, when).
    useEffect(() => {
        if (mode !== 'rescue' || !activeJobId || rescueHistory[activeJobId]) return;
        let cancelled = false;
        supabase.rpc('get_rescue_history', { p_job_id: activeJobId }).then(({ data }) => {
            if (!cancelled) setRescueHistory(prev => ({ ...prev, [activeJobId]: Array.isArray(data) ? data : [] }));
        });
        return () => { cancelled = true; };
    }, [mode, activeJobId, rescueHistory]);

    // Expanded rescue card also checks CompanyCam: how far along is the rep's
    // production report? Fetched once per job per visit, cached in state.
    useEffect(() => {
        if (mode !== 'rescue' || !activeJobId || ccReports[activeJobId] !== undefined) return;
        const row = rows.find(r => r.job_id === activeJobId);
        if (!row?.address?.trim()) return;
        // No cancellation: results are keyed by job id, so a late resolve is
        // still correct — and the null placeholder below re-runs this effect,
        // which would trip a naive cleanup flag and strand the card on
        // "Checking…" forever.
        const jobId = activeJobId;
        setCcReports(prev => ({ ...prev, [jobId]: null }));
        fetch(`/api/companycam?address=${encodeURIComponent(row.address)}`)
            .then(resp => resp.json())
            .then((data: CcReport) => setCcReports(prev => ({ ...prev, [jobId]: data })))
            .catch(() => setCcReports(prev => ({ ...prev, [jobId]: { found: false, reason: 'fetch_failed' } })));
    }, [mode, activeJobId, rows, ccReports]);

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
        // The clicked card is about to leave the list, taking the last-clicked
        // highlight with it. Park the ring on the card after it (or before it, at
        // the bottom) so the reviewer's place in the queue stays visible.
        const exitingIndex = visibleRows.findIndex(r => r.job_id === row.job_id);
        const nextActiveJobId = visibleRows[exitingIndex + 1]?.job_id ?? visibleRows[exitingIndex - 1]?.job_id ?? null;
        window.setTimeout(() => {
            setRows(prev => prev.filter(r => r.job_id !== row.job_id)); // optimistic remove → list slides up
            setExiting(prev => { const next = { ...prev }; delete next[row.job_id]; return next; });
            // Guard: only move the ring if it still sits on the removed card.
            setActiveJobId(current => (current === row.job_id ? nextActiveJobId : current));
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

    // The address bar IS the saved view: mirror the controls into the query string on
    // every change. replaceState, not push — working the filters shouldn't stack up a
    // history entry per click, and Back should still leave the page.
    const viewSearch = viewToSearch({ tab, outcomeFilter, fieldFilters, sortKey, periodKind, periodOffset, dateFrom, dateTo }, mode);
    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (window.location.search === viewSearch) return;
        window.history.replaceState({}, '', `${MODE_TO_PATH[mode]}${viewSearch}`);
    }, [viewSearch, mode]);

    // Saves a trip to the address bar — the link is already live there.
    const copyViewLink = async () => {
        const url = `${window.location.origin}${MODE_TO_PATH[mode]}${viewSearch}`;
        try {
            await navigator.clipboard.writeText(url);
            flashNotice('Link copied — bookmark it to reopen this exact view (filters, period and grouping included).');
        } catch {
            flashNotice(`Copy failed — bookmark this URL: ${url}`);
        }
    };

    const tabs: Array<{ key: ReviewTab; label: string; count?: number }> = [
        { key: 'needs_review', label: 'Needs Review', count: needsReviewCount }, { key: 'reviewed', label: 'Reviewed' }, { key: 'flagged', label: 'Flagged' }, { key: 'all', label: 'All' },
    ];

    // The last card acted on this session — kept as a header chip so "which one
    // did I just review?" survives the card sliding out of the queue.
    const lastAction = undoStack.length > 0 ? undoStack[undoStack.length - 1] : null;
    const lastActionFlagged = lastAction?.after.status === 'flagged';
    const lastActionName = lastAction ? (lastAction.row.customer || lastAction.row.name || lastAction.row.job_id) : '';

    return (
        <main className="h-full min-h-0 flex flex-col overflow-hidden">
            <header className="flex-shrink-0 px-1 pb-3 space-y-2 border-b border-border-secondary/60">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-baseline gap-2.5">
                        <h2 className="text-[15px] font-semibold text-text-primary">{mode === 'rescue' ? 'Rescue' : mode === 'outcomes' ? 'Outcomes' : 'Bookings'}</h2>
                        <p className="text-[11.5px] text-text-tertiary">{mode === 'rescue'
                            ? `${needsReviewCount} of ${rows.length} still need a touch today — cards clear for the day once contacted, and leave when the stage moves`
                            : mode === 'outcomes'
                                ? `${OUTCOME_FILTER_PHRASE[outcomeFilter]} · appointments ${rangeText} · rescheduled excluded`
                                : `Bookings made ${rangeText}`}</p>
                    </div>
                    <div className="flex items-center gap-2">
                        {authUser ? (
                            <span title={`Every review, flag, claim and rescue action is logged as ${authUser.email}`}
                                className="inline-flex items-center gap-1.5 h-7 px-2 text-[11px] font-semibold rounded-md border border-border-secondary bg-bg-tertiary/60 text-text-primary">
                                <span className="grid h-5 w-5 place-items-center rounded-full bg-brand-primary text-[9px] font-bold text-brand-text-on-primary">{getInitials(authUser.name || authUser.email)}</span>
                                <span className="max-w-[140px] truncate">{authUser.name || authUser.email}</span>
                            </span>
                        ) : <>
                            <label className="text-[10px] font-bold uppercase tracking-wider text-text-tertiary" htmlFor="reviewer-name">Reviewer</label>
                            <input id="reviewer-name" value={reviewer} onChange={event => setReviewerPersisted(event.target.value)} placeholder="Your name" className="h-7 w-32 px-2 text-xs rounded-md border border-border-secondary bg-bg-primary text-text-primary outline-none focus:border-brand-primary transition-colors duration-150" />
                        </>}
                        {lastAction && <span title={`Last action: ${lastActionFlagged ? 'flagged' : 'reviewed'} ${lastActionName}`} className={`inline-flex items-center gap-1 h-7 px-2 text-[11px] font-semibold rounded-md border max-w-[180px] ${lastActionFlagged ? 'border-tag-amber-border bg-tag-amber-bg text-tag-amber-text' : 'border-tag-green-border bg-tag-green-bg text-tag-green-text'}`}>{lastActionFlagged ? '⚑' : '✓'}<span className="truncate">{lastActionName}</span></span>}
                        <button onClick={undo} disabled={undoStack.length === 0} title="Undo last review (Ctrl+Z)" className="h-7 px-2 text-[11px] font-semibold tabular-nums rounded-md border border-border-secondary bg-bg-primary text-text-secondary hover:border-brand-primary hover:text-brand-primary disabled:opacity-40 transition-colors duration-150">◀ Back{undoStack.length > 0 ? ` (${undoStack.length})` : ''}</button>
                        <button onClick={copyViewLink} title="Copy a link to this exact view — status tab, period, filters and grouping included. Bookmark it to reopen the same list every day." className="h-7 px-2 text-[11px] font-semibold rounded-md border border-border-secondary bg-bg-primary text-text-secondary hover:border-brand-primary hover:text-brand-primary transition-colors duration-150">🔗 Copy link</button>
                        <button onClick={redo} disabled={redoStack.length === 0} title="Redo (Ctrl+Y)" className="h-7 px-2 text-[11px] font-semibold rounded-md border border-border-secondary bg-bg-primary text-text-secondary hover:border-brand-primary hover:text-brand-primary disabled:opacity-40 transition-colors duration-150">Forward ▶</button>
                        <button onClick={() => fetchQueue()} disabled={isRefreshing} title="Refresh review queue" className="h-7 w-7 grid place-items-center rounded-md text-text-tertiary hover:bg-bg-tertiary hover:text-brand-primary disabled:opacity-40 transition-colors duration-150">{isRefreshing ? <LoadingIcon className="h-3.5 w-3.5 text-brand-primary" /> : <RefreshIcon className="h-3.5 w-3.5" />}</button>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    {/* Rescue has no date range — the queue is whatever is stuck right now. */}
                    {mode !== 'rescue' && <div className={SEG_WRAP}>
                        {(['day', 'week', 'month', 'custom'] as const).map(k => (
                            <button key={k} onClick={() => selectPeriod(k)} className={`${SEG_BTN} capitalize ${periodKind === k ? SEG_ON : SEG_OFF}`}>{k}</button>
                        ))}
                    </div>}
                    {mode === 'rescue' ? (
                        <div className={SEG_WRAP}>
                            <button onClick={() => setFieldFilters(prev => { const copy = { ...prev }; delete copy.stage; return copy; })}
                                className={`${SEG_BTN} ${!(fieldFilters.stage?.length) ? SEG_ON : SEG_OFF}`}>All<span className="tabular-nums font-bold">{rows.length}</span></button>
                            {RESCUE_STAGES.map(stage => (
                                <button key={stage} onClick={() => setFieldFilters(prev => ({ ...prev, stage: [stage] }))} title={RESCUE_TASK[stage]?.task || stage}
                                    className={`${SEG_BTN} ${fieldFilters.stage?.length === 1 && fieldFilters.stage[0] === stage ? SEG_ON : SEG_OFF}`}>
                                    {stage.replace(' & Selection', '').replace('Sales ', '')}
                                    <span className="tabular-nums font-bold">{rescueStageCounts[stage] || 0}</span>
                                </button>
                            ))}
                        </div>
                    ) : periodKind !== 'custom' ? (
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
                        <span className="text-text-tertiary ml-1.5">Sort:</span>
                        <select value={sortKey} onChange={event => setSortKey(event.target.value as SortKey)} title="Sort or group the list" className="h-7 px-2 rounded-md border border-border-secondary bg-bg-primary text-text-primary outline-none focus:border-brand-primary">
                            {SORT_OPTIONS.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
                        </select>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {mode !== 'rescue' && <nav className={SEG_WRAP} aria-label="Review status">
                        {tabs.map(item => <button key={item.key} onClick={() => setTab(item.key)} className={`${SEG_BTN} ${tab === item.key ? SEG_ON : SEG_OFF}`}>{item.label}{item.count != null && <span className="tabular-nums font-bold">{item.count}</span>}</button>)}
                    </nav>}
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
                        <p className="text-[15px] font-semibold text-text-secondary">{mode === 'rescue'
                            ? 'Nothing stuck — the pipeline is clear 🎉'
                            : mode === 'outcomes'
                                ? (outcomeFilter === 'all' ? `No unsigned appointments ${period.label === 'Custom' ? 'in this range' : `for ${period.label.toLowerCase()}`}` : `No ${outcomeFilter} appointments ${period.label === 'Custom' ? 'in this range' : `for ${period.label.toLowerCase()}`}`)
                                : `No bookings ${period.label === 'Custom' ? 'in this range' : `for ${period.label.toLowerCase()}`}`}</p>
                        <p className="mt-1.5 text-[11.5px] text-text-tertiary">{mode === 'rescue' ? 'Jobs land here when they enter a chase stage in Roofr.' : mode === 'outcomes' ? 'Use ◀ to step back through earlier periods.' : 'New bookings land here in real time. Use ◀ to check earlier periods.'}</p>
                    </div>
                ) : visibleRows.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                        <p className="text-[15px] font-semibold text-text-secondary">{mode === 'rescue' || tab === 'needs_review' ? 'Nothing in this view' : 'Review queue clear'}</p>
                        <p className="mt-1.5 text-[11.5px] text-text-tertiary tabular-nums">{mode === 'outcomes'
                            ? `In this range: ${outcomeCounts.overdue} overdue · ${outcomeCounts.unqualified} unqualified · ${outcomeCounts.lost} lost · ${outcomeCounts.working} working. Adjust the tabs or filters above to see them.`
                            : 'Adjust the status tabs or filters above to see more.'}</p>
                    </div>
                ) : <div className="flex flex-col">{visibleRows.map((row, rowIndex) => {
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
                    // ── Rescue card: task first, claim-to-call, log what happened ──
                    if (mode === 'rescue') {
                        const stageKey = (row.stage || '').trim();
                        const stageInfo = RESCUE_TASK[stageKey];
                        const days = Math.round(row.days_in_stage ?? 0);
                        const touched = isTouchedToday(row);
                        // Divider above the first done-for-today card (the sort sinks them all to the bottom).
                        const showTouchedDivider = touched && (rowIndex === 0 || !isTouchedToday(visibleRows[rowIndex - 1]));
                        const touchedCount = visibleRows.filter(isTouchedToday).length;
                        const claimActive = !!row.claimed_by && !!row.claimed_at && (Date.now() - new Date(row.claimed_at).getTime()) < RESCUE_CLAIM_MS;
                        const mine = claimActive && (row.claimed_by || '').toLowerCase() === reviewer.trim().toLowerCase();
                        const lockedByOther = claimActive && !mine;
                        const stageActions = RESCUE_ACTIONS.filter(a => !a.stages || a.stages.includes(stageKey));
                        const primary = stageActions.find(a => a.primary);
                        const cc = ccReports[row.job_id];
                        const ccEligible = !!cc?.found && (cc.complete || (cc.pct ?? 0) >= CC_CHECKOFF_PCT);
                        return <React.Fragment key={row.job_id}>
                        {showTouchedDivider && <div className="flex items-center gap-2 mt-2 mb-2">
                            <span className="h-px flex-1 bg-tag-green-border/60" />
                            <span className="text-[10px] font-bold uppercase tracking-wide text-tag-green-text">✓ Contacted today — done until tomorrow ({touchedCount})</span>
                            <span className="h-px flex-1 bg-tag-green-border/60" />
                        </div>}
                        <article onClick={() => setActiveJobId(row.job_id)}
                            className={`rounded-md border px-3.5 py-2.5 mb-2 transition-all duration-300 active:scale-[0.99] hover:shadow-sm ${activeJobId === row.job_id ? 'bg-bg-primary border-brand-primary ring-2 ring-brand-primary/40' : touched ? 'bg-tag-green-bg/30 border-tag-green-border/70 opacity-80' : lockedByOther ? 'bg-bg-secondary/60 border-border-secondary opacity-75' : 'bg-bg-primary border-border-secondary hover:border-border-primary'}`}>
                            <div className="flex items-start gap-4">
                                <div className="flex-1 min-w-0 space-y-1">
                                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                        <h2 className="text-[15px] font-semibold text-text-primary">{row.customer || row.name || 'Unknown customer'}</h2>
                                        <span className={`px-2 py-0.5 text-[9px] font-bold tracking-wide rounded border ${stageInfo?.chip || 'border-border-secondary bg-bg-tertiary text-text-secondary'}`} title="Roofr job stage">{stageKey || 'Unknown stage'}</span>
                                        <span className={`px-1.5 py-0.5 text-[9px] font-bold rounded border tabular-nums ${daysChipClass(days)}`} title="Days the job has sat in this stage">{days}d stuck</span>
                                        {touched && <span className="px-1.5 py-0.5 text-[9px] font-bold rounded border border-tag-green-border bg-tag-green-bg text-tag-green-text" title={`${RESCUE_ACTION_LABEL[row.last_action || ''] || row.last_action} by ${row.last_action_by}`}>✓ Contacted today</span>}
                                        {cc?.found && <span className={`px-1.5 py-0.5 text-[9px] font-bold rounded border tabular-nums ${ccEligible ? 'border-tag-green-border bg-tag-green-bg text-tag-green-text' : 'border-tag-amber-border bg-tag-amber-bg text-tag-amber-text'}`} title={`CompanyCam production report: ${cc.done}/${cc.total} tasks done${ccEligible ? ' — over 50%, OK to check off "Sales - Production Report" in Roofr' : ' — under 50%, keep chasing the rep'}`}>📸 Report {cc.complete ? '✓ 100' : cc.pct}%</span>}
                                        {row.value != null && <span className="text-[11.5px] font-semibold tabular-nums text-text-primary">${row.value.toLocaleString()}</span>}
                                    </div>
                                    <div className="text-[12px] font-semibold text-brand-text-light">{stageInfo?.task || 'Work this job forward'}</div>
                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]">
                                        <span className="inline-flex items-center gap-1.5 font-bold text-brand-text-light" title="CSR who booked this appointment — their deal too">
                                            <span className="grid h-5 w-5 place-items-center rounded-full bg-brand-primary text-[9px] font-bold text-brand-text-on-primary">{getInitials(csrName || '?')}</span>
                                            {csrName || 'Unknown CSR'}
                                        </span>
                                        {techName && <span className={stageInfo?.who === 'rep' ? 'font-bold text-text-primary' : 'text-text-secondary'} title={stageInfo?.who === 'rep' ? 'The rep this task chases' : 'Rep on the job'}>Rep: <b className="font-semibold">{techName}</b></span>}
                                        {row.lead_source && <span className="text-text-tertiary">{row.lead_source}</span>}
                                    </div>
                                    <div className="flex flex-wrap items-center gap-x-3 text-[11.5px] text-text-secondary">
                                        {row.address && <span>{row.address}</span>}
                                        {row.phone && (phoneDigits
                                            ? <a href={`https://app.calltrackingmetrics.com/calls#filter=${phoneDigits}`} target="_blank" rel="noreferrer" onClick={event => event.stopPropagation()} title="Open this number's calls in CTM" className="font-semibold text-brand-primary hover:underline">{row.phone}</a>
                                            : <span>{row.phone}</span>)}
                                    </div>
                                    {row.last_action && <div className="text-[10.5px] text-text-tertiary">
                                        Last: <b className="text-text-secondary">{RESCUE_ACTION_LABEL[row.last_action] || row.last_action}</b>
                                        {row.last_action_by ? ` by ${row.last_action_by}` : ''}{row.last_action_at ? ` · ${formatRelativeTime(row.last_action_at)}` : ''}
                                        {row.last_action_note ? <span className="italic"> — “{row.last_action_note}”</span> : null}
                                        {(row.action_count ?? 0) > 1 ? ` · ${row.action_count} touches` : ''}
                                    </div>}
                                </div>
                                <div className="flex-shrink-0 flex flex-col items-end gap-1" onClick={event => event.stopPropagation()}>
                                    <div className="flex flex-wrap justify-end gap-1">
                                        {row.job_id && <LinkPill href={`https://app.roofr.com/dashboard/team/239329/jobs/list-view?selectedJobId=${row.job_id}`} label="Roofr" target="ar-roofr" />}
                                        {phoneDigits && <LinkPill href={`https://app.calltrackingmetrics.com/calls/desk#filter=${phoneDigits}`} label="CTM" />}
                                        {row.address && <LinkPill href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(row.address)}`} label="Map" />}
                                    </div>
                                    {lockedByOther
                                        ? <span className="px-2 py-1 text-[10px] font-bold rounded border border-tag-amber-border bg-tag-amber-bg text-tag-amber-text" title="Someone is already working this card">📞 {row.claimed_by} · {formatRelativeTime(row.claimed_at ?? null)}</span>
                                        : mine
                                            ? <div className="flex gap-1">
                                                <span className="px-2 py-1 text-[10px] font-bold rounded border border-tag-green-border bg-tag-green-bg text-tag-green-text">✓ Yours</span>
                                                <button onClick={() => releaseRescue(row)} disabled={isBusy} className="px-2 py-1 text-[10px] font-bold rounded border border-border-secondary text-text-secondary hover:border-brand-primary disabled:opacity-50">Release</button>
                                            </div>
                                            : <button onClick={() => claimRescue(row)} disabled={isBusy} className="px-2.5 py-1 text-[10px] font-bold rounded bg-brand-primary text-brand-text-on-primary hover:opacity-90 disabled:opacity-50 transition">{isBusy ? '…' : '📞 Claim to call'}</button>}
                                    {primary && !lockedByOther && <button onClick={() => logRescue(row, primary.key, rescueNote.trim() || null)} disabled={isBusy} className="px-2.5 py-1 text-[10px] font-bold rounded bg-tag-green-text text-bg-primary hover:opacity-90 disabled:opacity-50 transition">{isBusy ? 'Saving…' : primary.label}</button>}
                                </div>
                            </div>
                            {activeJobId === row.job_id && <div className="mt-1.5 rounded border border-border-secondary/60 bg-bg-tertiary/40 p-2 space-y-1.5" onClick={event => event.stopPropagation()}>
                                <div className="flex flex-wrap items-center gap-1.5">
                                    {stageActions.map(a => <button key={a.key} onClick={() => logRescue(row, a.key, rescueNote.trim() || null)} disabled={isBusy || lockedByOther}
                                        className={`px-2 py-1 text-[10px] font-bold rounded transition disabled:opacity-50 ${a.primary ? 'bg-tag-green-text text-bg-primary hover:opacity-90' : 'border border-border-secondary bg-bg-primary text-text-secondary hover:border-brand-primary hover:text-brand-primary'}`}>{a.label}</button>)}
                                    <input value={rescueNote} onChange={event => setRescueNote(event.target.value)} placeholder="Optional note — what happened on the call?" className="flex-1 min-w-40 px-2 py-1 text-[10px] rounded border border-border-secondary bg-bg-primary text-text-primary outline-none focus:border-brand-primary" />
                                </div>
                                {cc !== undefined && <div className="border-t border-border-secondary/50 pt-1.5 space-y-1">
                                    <p className="text-[9px] font-bold uppercase tracking-wide text-text-quaternary">📸 Production report — CompanyCam (read-only)</p>
                                    {cc === null ? <p className="text-[10.5px] text-text-tertiary">Checking CompanyCam…</p>
                                        : !cc.found ? <p className="text-[10.5px] text-text-tertiary">{cc.reason === 'no_report_checklist' ? <>Project found, but no production-report checklist on it.{cc.project_url && <> <a href={cc.project_url} target="_blank" rel="noreferrer" className="font-semibold text-brand-primary hover:underline">Open project ↗</a></>}</> : 'No CompanyCam project matched this address.'}</p>
                                            : <div className="space-y-1">
                                                <div className="flex flex-wrap items-center gap-2 text-[10.5px]">
                                                    <span className="h-1.5 w-28 rounded-full bg-bg-quaternary overflow-hidden"><span className={`block h-full rounded-full ${ccEligible ? 'bg-tag-green-text' : 'bg-tag-amber-text'}`} style={{ width: `${cc.pct ?? 0}%` }} /></span>
                                                    <b className="tabular-nums text-text-primary">{cc.done}/{cc.total} tasks · {cc.pct}%</b>
                                                    {cc.last_task_at && <span className="text-text-quaternary">last activity {formatRelativeTime(cc.last_task_at)}</span>}
                                                    {cc.project_url && <a href={cc.project_url} target="_blank" rel="noreferrer" className="font-semibold text-brand-primary hover:underline">Open in CompanyCam ↗</a>}
                                                </div>
                                                {/* At 100% the chip already says it all — the check-off hint only earns
                                                    its space while the report is partial. */}
                                                {!cc.complete && (ccEligible
                                                    ? <p className="text-[10.5px] font-semibold text-tag-green-text">✓ Over {CC_CHECKOFF_PCT}% — OK to check off “Sales - Production Report” on the Roofr job card (by hand — nothing is changed automatically).</p>
                                                    : <p className="text-[10.5px] font-semibold text-tag-amber-text">Under {CC_CHECKOFF_PCT}% — keep chasing the rep before the Roofr task gets checked.</p>)}
                                                {(cc.missing?.length ?? 0) > 0 && <ul className="space-y-1 pt-0.5">
                                                    {cc.missing!.map(task => <li key={task} className="flex items-center gap-2 text-[11px] text-text-secondary">
                                                        <span className="h-3.5 w-3.5 flex-shrink-0 rounded-[3px] border-[1.5px] border-tag-amber-text/70 bg-bg-primary" aria-hidden="true" />
                                                        <span>{task}</span>
                                                    </li>)}
                                                </ul>}
                                            </div>}
                                </div>}
                                {(rescueHistory[row.job_id]?.length ?? 0) > 0 && <div className="border-t border-border-secondary/50 pt-1.5 space-y-1">
                                    <p className="text-[9px] font-bold uppercase tracking-wide text-text-quaternary">History — every touch on this job</p>
                                    {rescueHistory[row.job_id]!.map((entry, index) => <div key={index} className="flex items-start gap-2 text-[10.5px] text-text-secondary">
                                        <span className="grid h-4 w-4 flex-shrink-0 mt-px place-items-center rounded-full bg-brand-primary/80 text-[8px] font-bold text-brand-text-on-primary" title={entry.actor || 'Unknown'}>{getInitials(entry.actor || '?')}</span>
                                        <span className="leading-snug"><b className="text-text-primary">{entry.actor || 'Unknown'}</b> — {RESCUE_ACTION_LABEL[entry.action] || entry.action}
                                            <span className="text-text-quaternary"> · {formatRelativeTime(entry.created_at)}</span>
                                            {entry.note ? <span className="italic"> — “{entry.note}”</span> : null}</span>
                                    </div>)}
                                </div>}
                            </div>}
                        </article>
                        </React.Fragment>;
                    }
                    return <article key={row.job_id} onClick={() => setActiveJobId(row.job_id)} className={`rounded-md border px-3.5 py-2.5 mb-2 overflow-hidden transition-all duration-300 max-h-48 active:scale-[0.99] hover:shadow-sm ${activeJobId === row.job_id ? 'bg-bg-primary border-brand-primary ring-2 ring-brand-primary/40 !max-h-none' : urgencyCardClass || 'bg-bg-primary border-border-secondary hover:border-border-primary'} ${isRisky ? 'border-tag-amber-border' : ''} ${exitState === 'reviewed' ? 'translate-x-[110%] opacity-0 !max-h-0 !py-0 !mb-0 !bg-tag-green-bg' : exitState === 'flagged' ? '-translate-x-[110%] opacity-0 !max-h-0 !py-0 !mb-0 !bg-tag-red-bg' : ''}`}>
                        <div className="flex items-start gap-4">
                            <div className="flex-1 min-w-0 space-y-0.5">
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5"><h2 className="text-[15px] font-semibold text-text-primary">{row.customer || row.name || 'Unknown customer'}</h2>{mode === 'outcomes' ? <>
                                    {urgency === 'overdue' && <span className="px-2 py-0.5 text-[9px] font-bold tracking-wide rounded border border-tag-red-text bg-tag-red-text text-bg-primary animate-outcome-attention" title="The appointment ran but the job is still in Appointment scheduled — the rep never entered an outcome">OVERDUE · NOT DISPOSITIONED</span>}
                                    {urgency === 'unqualified' && <span className="px-2 py-0.5 text-[9px] font-bold tracking-wide rounded border border-tag-red-border bg-tag-red-bg text-tag-red-text animate-outcome-attention">UNQUALIFIED</span>}
                                    {urgency === 'lost' && <span className="px-2 py-0.5 text-[9px] font-bold tracking-wide rounded border border-tag-red-text bg-tag-red-text text-bg-primary">LOST</span>}
                                    {urgency === 'working' && <span className="px-1.5 py-0.5 text-[9px] font-semibold rounded border border-border-secondary bg-bg-tertiary text-text-secondary" title="Roofr job-card status">{row.stage || row.outcome || 'In progress'}</span>}
                                    <span className="text-[11px] tabular-nums text-text-tertiary whitespace-nowrap">Appt {row.appt_date || '—'}</span>
                                </> : <span className="text-[11px] text-text-tertiary whitespace-nowrap"><span className="font-semibold text-brand-primary">{formatRelativeTime(row.appt_booked_at)}</span>{' · '}{formatPhoenixDate(row.appt_booked_at)}</span>}{mode === 'bookings' && row.grade && (GRADE_CHIP[row.grade]
                                    ? <span className={`px-1.5 py-0.5 text-[9px] font-bold rounded border ${GRADE_CHIP[row.grade]} ${row.grade_dispatch === false ? 'ring-1 ring-tag-red-text' : ''}`} title={row.grade_coach || 'Booking grade — click the card for details'}>{row.grade}{row.grade_score != null ? ` · ${row.grade_score}` : ''}{row.grade_dispatch === false ? ' · BAD DISPATCH' : ''}</span>
                                    : <span className="px-1.5 py-0.5 text-[9px] font-semibold rounded border border-border-secondary text-text-quaternary" title="No booking call found in CTM — likely booked via LSA/text message. Exempt from grading, not counted against the CSR.">not graded · no call</span>)}{isRisky && <span className="px-1.5 py-0.5 text-[9px] font-bold rounded border border-tag-amber-border bg-tag-amber-bg text-tag-amber-text">⚠ {risks.join(', ')}</span>}</div>
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
                                <div className="flex flex-wrap justify-end gap-1">{row.job_id && <LinkPill href={`https://app.roofr.com/dashboard/team/239329/jobs/list-view?selectedJobId=${row.job_id}`} label="Roofr" target="ar-roofr" />}{phoneDigits && <LinkPill href={`https://app.calltrackingmetrics.com/calls/desk#filter=${phoneDigits}`} label="CTM" />}{row.address && <LinkPill href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(row.address)}`} label="Map" />}</div>
                                {row.review_status === 'needs_review' ? <div className="flex flex-wrap justify-end gap-1"><button onClick={() => reviewWithAnimation(row, 'reviewed')} disabled={isBusy} className="px-2.5 py-1 text-[10px] font-bold rounded bg-tag-green-text text-bg-primary hover:opacity-90 disabled:opacity-50 transition">{isBusy ? 'Saving…' : 'Mark Reviewed'}</button><button onClick={() => { setFlaggingJobId(flaggingJobId === row.job_id ? null : row.job_id); setFlagNote(''); }} disabled={isBusy} className="px-2 py-1 text-[10px] font-bold rounded border border-tag-amber-border bg-tag-amber-bg text-tag-amber-text disabled:opacity-50">Flag</button></div> : <div className="flex flex-wrap items-center justify-end gap-2 text-[10px] text-text-tertiary text-right"><span>{row.review_status === 'flagged' ? 'Flagged' : 'Reviewed'}{row.reviewed_by ? ` by ${row.reviewed_by}` : ''}{row.reviewed_at ? ` · ${formatPhoenixDate(row.reviewed_at)}` : ''}{row.flag_reason ? ` · ${row.flag_reason}` : ''}{row.review_note ? `: ${row.review_note}` : ''}</span><button onClick={() => runReviewAction(row, 'needs_review')} disabled={isBusy} className="px-2 py-1 font-bold rounded border border-border-secondary text-text-secondary hover:border-brand-primary disabled:opacity-50">Reopen</button></div>}
                            </div>
                        </div>
                        {activeJobId === row.job_id && row.grade_coach && GRADE_CHIP[row.grade || ''] && <div className="mt-1.5 rounded border border-border-secondary/60 bg-bg-tertiary/40 p-2 text-[10.5px] text-text-secondary" onClick={event => event.stopPropagation()}>
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                <b className="text-text-primary"><a href={sopUrl()} target={SOP_TARGET} title="Open the CSR Booking SOP (the grading rubric)" className="hover:underline hover:text-brand-primary">Booking grade</a> {row.grade}{row.grade_score != null ? ` (${row.grade_score})` : ''}</b>
                                {row.grade_dispatch === false && <span className="px-1.5 py-0.5 text-[9px] font-bold rounded border border-tag-red-border bg-tag-red-bg text-tag-red-text">SHOULD NOT HAVE BEEN BOOKED</span>}
                                {formatCallDuration(row.grade_call_seconds) && <span className="text-text-tertiary">call {formatCallDuration(row.grade_call_seconds)}</span>}
                                {row.grade_checklist != null && <a href={sopUrl(SOP_INTAKE_ANCHOR)} target={SOP_TARGET} title="Open the SOP intake checklist" className="text-text-tertiary hover:underline hover:text-brand-primary">intake {row.grade_checklist}/{row.grade_checklist_total ?? 15}</a>}
                            </div>
                            {row.grade_layers && <div className="mt-1.5 space-y-1">
                                {LAYER_ORDER.filter(layer => row.grade_layers && layer in row.grade_layers).map(layer => {
                                    const verdict = row.grade_layers![layer] || 'UNKNOWN';
                                    const note = row.grade_layer_notes?.[layer];
                                    const fix = verdict !== 'PASS' ? (row.grade_layer_fixes?.[layer] || '').trim() : '';
                                    return <div key={layer} className="flex items-start gap-2">
                                        <a href={sopUrl(SOP_LAYER_ANCHOR[layer])} target={SOP_TARGET} title={`Open the ${layer} section of the CSR Booking SOP`} className={`shrink-0 w-32 px-1.5 py-0.5 text-[9px] font-bold rounded border text-center hover:underline hover:opacity-80 transition ${LAYER_PILL[verdict] || LAYER_PILL.UNKNOWN}`}>{layer.toUpperCase()} {verdict === 'PASS' ? '✓' : verdict === 'FAIL' ? '✗' : verdict === 'PARTIAL' ? '~' : '?'}</a>
                                        <div className="flex-1 leading-snug">
                                            <div>{note || verdict.toLowerCase()}</div>
                                            {fix && <div className="mt-0.5 text-tag-green-text italic">Next time: {fix}</div>}
                                        </div>
                                    </div>;
                                })}
                            </div>}
                            {row.grade_checklist_missed?.length ? <div className="mt-1.5"><b className="text-text-primary"><a href={sopUrl(SOP_INTAKE_ANCHOR)} target={SOP_TARGET} title="Open the SOP intake checklist" className="hover:underline hover:text-brand-primary">Intake missed:</a></b> {row.grade_checklist_missed.join(', ')}</div> : null}
                            {row.grade_flags?.length ? <div className="mt-1"><b className="text-text-primary">Flags:</b> {row.grade_flags.join(' · ')}</div> : null}
                            <div className="mt-1.5 border-t border-border-secondary/50 pt-1.5"><b className="text-text-primary">Coach note:</b> {row.grade_coach}</div>
                        </div>}
                        {flaggingJobId === row.job_id && <div className="mt-1 flex flex-wrap gap-1.5 rounded border border-tag-amber-border bg-tag-amber-bg p-2"><select value={flagReason} onChange={event => setFlagReason(event.target.value)} className="px-1.5 py-1 text-[10px] rounded border border-tag-amber-border bg-bg-primary text-text-primary">{activeFlagReasons.map(reason => <option key={reason}>{reason}</option>)}</select><input value={flagNote} onChange={event => setFlagNote(event.target.value)} placeholder="Optional note" className="flex-1 min-w-32 px-2 py-1 text-[10px] rounded border border-tag-amber-border bg-bg-primary text-text-primary" /><button onClick={() => reviewWithAnimation(row, 'flagged', flagReason, flagNote.trim() || null)} disabled={isBusy} className="px-2 py-1 text-[10px] font-bold rounded bg-tag-amber-text text-bg-primary disabled:opacity-50">{isBusy ? 'Saving…' : 'Save flag'}</button></div>}
                    </article>;
                })}</div>}
            </section>
        </main>
    );
};

export default ReviewQueue;
