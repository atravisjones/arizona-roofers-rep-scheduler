import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLinkIcon, LoadingIcon, RefreshIcon } from './icons';
import { supabase } from '../services/supabaseClient';

const REVIEWER_STORAGE_KEY = 'reviewQueue.reviewer';
const POLL_MS = 60000;
const FLAG_REASONS = ['One legger', 'No legger', 'Roof age unknown', 'Bad address', 'Wrong appt window', 'Missing info', 'Out of area', 'Low intent', 'Other'] as const;

type ReviewStatus = 'needs_review' | 'reviewed' | 'flagged';
type ReviewTab = 'needs_review' | 'reviewed' | 'flagged' | 'all';

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
    review_status: ReviewStatus;
    flag_reason: string | null;
    review_note: string | null;
    reviewed_by: string | null;
    reviewed_at: string | null;
}

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

const LinkPill: React.FC<{ href: string; label: string }> = ({ href, label }) => (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border border-border-secondary text-text-secondary hover:border-brand-primary hover:text-brand-primary hover:bg-bg-tertiary transition">
        <ExternalLinkIcon className="h-3.5 w-3.5" />{label}
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
    const [flaggingJobId, setFlaggingJobId] = useState<string | null>(null);
    const [flagReason, setFlagReason] = useState<string>(FLAG_REASONS[0]);
    const [flagNote, setFlagNote] = useState('');
    const priorNeedsIdsRef = useRef<Set<string> | null>(null);
    const noticeTimerRef = useRef<number | null>(null);

    const flashNotice = useCallback((message: string) => {
        setNotice(message);
        if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
        noticeTimerRef.current = window.setTimeout(() => setNotice(null), 6000);
    }, []);

    const fetchQueue = useCallback(async (checkForNewBooking = false) => {
        setIsRefreshing(true);
        try {
            const { data, error: rpcError } = await supabase.rpc('get_review_queue', { p_days: 7 });
            if (rpcError) throw new Error(rpcError.message);
            const next = (Array.isArray(data) ? data : []) as ReviewRow[];
            const nextNeedsIds = new Set(next.filter(row => row.review_status === 'needs_review').map(row => row.job_id));
            if (checkForNewBooking && priorNeedsIdsRef.current) {
                const hasNewBooking = [...nextNeedsIds].some(jobId => !priorNeedsIdsRef.current!.has(jobId));
                if (hasNewBooking) {
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
            const { data: statsData } = await supabase.rpc('get_review_stats');
            if (statsData) setStats(statsData as ReviewStats);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load review queue');
        } finally {
            setIsLoading(false);
            setIsRefreshing(false);
        }
    }, []);

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

    const visibleRows = useMemo(() => rows
        .filter(row => tab === 'all' || row.review_status === tab)
        .sort((a, b) => {
            if (tab === 'needs_review') {
                const riskDifference = Number(getRiskReasons(b).length > 0) - Number(getRiskReasons(a).length > 0);
                if (riskDifference) return riskDifference;
            }
            return new Date(b.appt_booked_at || 0).getTime() - new Date(a.appt_booked_at || 0).getTime();
        }), [rows, tab]);

    const sortedReps = useMemo(() => stats ? [...stats.by_rep].sort((a, b) => (Number(b[statsSort]) - Number(a[statsSort])) || a.rep.localeCompare(b.rep)) : [], [stats, statsSort]);

    const setReviewerPersisted = (name: string) => {
        setReviewer(name);
        localStorage.setItem(REVIEWER_STORAGE_KEY, name);
    };

    const runReviewAction = async (row: ReviewRow, status: ReviewStatus, reason: string | null = null, note: string | null = null) => {
        setBusyJobId(row.job_id);
        try {
            const { data, error: rpcError } = await supabase.rpc('set_job_review', {
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
            const { error: rpcError } = await supabase.rpc('set_job_review', { p_job_id: jobId, p_status: snap.status, p_flag_reason: snap.reason, p_note: snap.note, p_reviewer: snap.reviewer });
            if (rpcError) throw new Error(rpcError.message);
        } catch (err) {
            flashNotice(err instanceof Error ? err.message : 'Undo failed');
        } finally {
            fetchQueue();
        }
    }, [fetchQueue, flashNotice]);

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
        <main className="h-full min-h-0 flex flex-col rounded-lg border border-border-primary bg-bg-primary shadow-lg overflow-hidden">
            <header className="flex-shrink-0 px-4 py-3 bg-bg-secondary border-b border-border-primary space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div><h1 className="text-base font-bold text-text-primary">Review Queue</h1><p className="text-[11px] text-text-tertiary">Bookings from the last 7 days</p></div>
                    <div className="flex items-center gap-2">
                        <label className="text-[10px] font-semibold uppercase text-text-tertiary" htmlFor="reviewer-name">Reviewer</label>
                        <input id="reviewer-name" value={reviewer} onChange={event => setReviewerPersisted(event.target.value)} placeholder="Your name" className="w-32 px-2 py-1 text-xs rounded-md border border-border-primary bg-bg-primary text-text-primary outline-none focus:border-brand-primary" />
                        <button onClick={undo} disabled={undoStack.length === 0} title="Undo last review (Ctrl+Z)" className="px-2 py-1 text-[11px] font-semibold rounded border border-border-secondary text-text-secondary hover:border-brand-primary hover:text-brand-primary disabled:opacity-40 transition">◀ Back{undoStack.length > 0 ? ` (${undoStack.length})` : ''}</button>
                        <button onClick={redo} disabled={redoStack.length === 0} title="Redo (Ctrl+Y)" className="px-2 py-1 text-[11px] font-semibold rounded border border-border-secondary text-text-secondary hover:border-brand-primary hover:text-brand-primary disabled:opacity-40 transition">Forward ▶</button>
                        <button onClick={() => fetchQueue()} disabled={isRefreshing} title="Refresh review queue" className="p-1.5 rounded text-text-tertiary hover:bg-bg-tertiary hover:text-brand-primary disabled:opacity-40 transition">{isRefreshing ? <LoadingIcon className="h-3.5 w-3.5 text-brand-primary" /> : <RefreshIcon className="h-3.5 w-3.5" />}</button>
                    </div>
                </div>
                <nav className="flex flex-wrap gap-1" aria-label="Review status">
                    {tabs.map(item => <button key={item.key} onClick={() => setTab(item.key)} className={`px-2 py-1 text-[11px] font-semibold rounded border transition ${tab === item.key ? 'bg-brand-primary border-brand-primary text-brand-text-on-primary' : 'border-border-secondary text-text-secondary hover:border-brand-primary hover:text-brand-primary'}`}>{item.label}{item.count != null ? ` (${item.count})` : ''}</button>)}
                </nav>
                {stats && <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    <span className="px-2 py-0.5 rounded bg-bg-tertiary text-text-secondary">Today · <b className="text-text-primary">{stats.today.booked}</b> booked</span>
                    <span className="px-2 py-0.5 rounded bg-tag-green-bg text-tag-green-text"><b>{stats.today.reviewed}</b> reviewed</span>
                    <span className="px-2 py-0.5 rounded bg-tag-red-bg text-tag-red-text"><b>{stats.today.flagged}</b> flagged</span>
                    <button onClick={() => setShowStats(value => !value)} className="ml-auto px-2 py-0.5 rounded border border-border-secondary text-text-secondary hover:border-brand-primary hover:text-brand-primary transition">{showStats ? 'Hide' : 'Show'} CSR scorecard</button>
                </div>}
                {showStats && stats && <div className="overflow-x-auto rounded border border-border-secondary/60 max-h-48 overflow-y-auto"><div className="px-2 py-1 text-[9px] text-text-quaternary bg-bg-tertiary/30">Click a column to sort. Flagged / Reviewed = # of that CSR's bookings you flagged / reviewed in each window.</div><table className="w-full text-[11px]"><thead className="sticky top-0 bg-bg-secondary text-text-tertiary"><tr><th rowSpan={2} onClick={() => setStatsSort('rep')} className={`py-1 px-2 text-left cursor-pointer ${statsSort === 'rep' ? 'text-brand-primary' : 'hover:text-brand-primary'}`}>CSR{statsSort === 'rep' ? ' ▾' : ''}</th><th colSpan={3} className="px-1.5 py-0.5 text-center font-bold text-tag-red-text border-l border-border-secondary/40">Flagged</th><th colSpan={3} className="px-1.5 py-0.5 text-center font-bold text-tag-green-text border-l border-border-secondary/40">Reviewed</th></tr><tr>{FLAG_COLS.map((col, i) => <th key={col.key} onClick={() => setStatsSort(col.key)} className={`px-1.5 pb-1 text-center cursor-pointer hover:text-brand-primary ${i === 0 ? 'border-l border-border-secondary/40' : ''} ${statsSort === col.key ? 'text-brand-primary font-bold' : ''}`}>{col.w}{statsSort === col.key ? ' ▾' : ''}</th>)}{REV_COLS.map((col, i) => <th key={col.key} onClick={() => setStatsSort(col.key)} className={`px-1.5 pb-1 text-center cursor-pointer hover:text-brand-primary ${i === 0 ? 'border-l border-border-secondary/40' : ''} ${statsSort === col.key ? 'text-brand-primary font-bold' : ''}`}>{col.w}{statsSort === col.key ? ' ▾' : ''}</th>)}</tr></thead><tbody>{sortedReps.length === 0 ? <tr><td colSpan={7} className="py-2 px-2 text-text-tertiary italic">No reviews in the last 30 days.</td></tr> : sortedReps.map(rep => <tr key={rep.rep} className="border-t border-border-secondary/40"><td className="py-1 px-2 font-semibold text-text-primary whitespace-nowrap">{rep.rep}</td><td className={`px-1.5 text-center border-l border-border-secondary/40 ${rep.flagged_day > 0 ? 'font-bold text-tag-red-text' : 'text-text-tertiary'}`}>{rep.flagged_day}</td><td className={`px-1.5 text-center ${rep.flagged_week > 0 ? 'text-tag-red-text' : 'text-text-tertiary'}`}>{rep.flagged_week}</td><td className={`px-1.5 text-center ${rep.flagged_month > 0 ? 'font-semibold text-tag-red-text' : 'text-text-tertiary'}`}>{rep.flagged_month}</td><td className="px-1.5 text-center border-l border-border-secondary/40 text-text-secondary">{rep.reviewed_day}</td><td className="px-1.5 text-center text-text-secondary">{rep.reviewed_week}</td><td className="px-1.5 text-center pr-2 text-text-secondary">{rep.reviewed_month}</td></tr>)}</tbody></table></div>}
            </header>
            {notice && <div className="mx-4 mt-3 px-2 py-1.5 text-[11px] rounded border border-tag-amber-border bg-tag-amber-bg text-tag-amber-text">{notice}</div>}
            {error && <div className="mx-4 mt-3 px-2 py-1.5 text-[11px] rounded border border-tag-red-border bg-tag-red-bg text-tag-red-text">{error}</div>}
            <section className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-4">
                {isLoading ? <div className="text-sm text-text-tertiary">Loading review queue…</div> : rows.length === 0 ? <div className="text-sm text-text-tertiary">No bookings in the last 7 days.</div> : visibleRows.length === 0 ? <div className="text-sm text-text-tertiary">{tab === 'needs_review' ? 'Nothing needs review.' : 'No bookings in this view.'}</div> : <div className="flex flex-col">{visibleRows.map(row => {
                    const risks = getRiskReasons(row);
                    const isRisky = row.review_status === 'needs_review' && risks.length > 0;
                    const isBusy = busyJobId === row.job_id;
                    const exitState = exiting[row.job_id];
                    const phoneDigits = (row.phone || '').replace(/\D/g, '').slice(-10);
                    const propertyFields = [['Roof age', row.roof_age], ['Sq ft', row.prop_sqft], ['Built', row.year_built], ['Stories', row.stories], ['Type', row.property_type]].filter(([, value]) => value != null && String(value).trim() !== '');
                    return <article key={row.job_id} onClick={() => setActiveJobId(row.job_id)} className={`rounded-md border bg-bg-primary px-3 py-2 mb-2 overflow-hidden transition-all duration-300 max-h-48 active:scale-[0.99] ${activeJobId === row.job_id ? 'border-brand-primary ring-2 ring-brand-primary/40' : 'border-border-primary hover:border-border-secondary'} ${isRisky ? 'border-l-4 border-l-tag-amber-border' : ''} ${exitState === 'reviewed' ? 'translate-x-[110%] opacity-0 !max-h-0 !py-0 !mb-0 !bg-tag-green-bg' : exitState === 'flagged' ? '-translate-x-[110%] opacity-0 !max-h-0 !py-0 !mb-0 !bg-tag-red-bg' : ''}`}>
                        <div className="flex items-start gap-4">
                            <div className="flex-1 min-w-0 space-y-0.5">
                                <div className="flex flex-wrap items-baseline gap-x-2"><h2 className="text-sm font-bold text-text-primary">{row.customer || row.name || 'Unknown customer'}</h2><span className="text-[10px] text-text-tertiary whitespace-nowrap"><span className="font-semibold text-brand-primary">{formatRelativeTime(row.appt_booked_at)}</span>{' · '}{formatPhoenixDate(row.appt_booked_at)}</span>{isRisky && <span className="px-1.5 py-0.5 text-[9px] font-bold rounded border border-tag-amber-border bg-tag-amber-bg text-tag-amber-text">⚠ {risks.join(', ')}</span>}</div>
                                <div className="flex flex-wrap items-center gap-1 text-[10px]"><span className="text-text-secondary">Booked by <span className="font-semibold">{row.appt_booker || 'Unknown'}</span></span>{row.lead_source && <span className="px-1.5 py-0.5 rounded bg-bg-tertiary text-text-secondary">{row.lead_source}</span>}{row.workflow && <span className="px-1.5 py-0.5 rounded bg-bg-tertiary text-text-secondary">{row.workflow}</span>}{(row.tags || '').split(',').map(tag => tag.trim()).filter(Boolean).map(tag => <span key={tag} className="px-1.5 py-0.5 rounded border border-border-secondary text-text-tertiary">{tag}</span>)}</div>
                                <div className="flex flex-wrap items-center gap-x-3 text-[11px] text-text-secondary">{row.address && <span>{row.address}</span>}{row.phone && <span>{row.phone}</span>}{row.value != null && <span className="font-semibold text-text-primary">${row.value.toLocaleString()}</span>}{propertyFields.map(([label, value]) => <span key={label} className="text-[10px] text-text-tertiary">{label}: <span className="font-semibold text-text-secondary">{String(value)}</span></span>)}</div>
                            </div>
                            <div className="flex-shrink-0 flex flex-col items-end gap-1">
                                <div className="flex flex-wrap justify-end gap-1">{row.job_id && <LinkPill href={`https://app.roofr.com/dashboard/team/239329/jobs/list-view?selectedJobId=${row.job_id}`} label="Roofr" />}{phoneDigits && <LinkPill href={`https://app.calltrackingmetrics.com/calls/desk#filter=${phoneDigits}`} label="CTM" />}{row.address && <LinkPill href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(row.address)}`} label="Map" />}</div>
                                {row.review_status === 'needs_review' ? <div className="flex flex-wrap justify-end gap-1"><button onClick={() => reviewWithAnimation(row, 'reviewed')} disabled={isBusy} className="px-2 py-1 text-[10px] font-bold rounded border border-tag-green-border bg-tag-green-bg text-tag-green-text disabled:opacity-50">{isBusy ? 'Saving…' : 'Mark Reviewed'}</button><button onClick={() => { setFlaggingJobId(flaggingJobId === row.job_id ? null : row.job_id); setFlagNote(''); }} disabled={isBusy} className="px-2 py-1 text-[10px] font-bold rounded border border-tag-amber-border bg-tag-amber-bg text-tag-amber-text disabled:opacity-50">Flag</button></div> : <div className="flex flex-wrap items-center justify-end gap-2 text-[10px] text-text-tertiary text-right"><span>{row.review_status === 'flagged' ? 'Flagged' : 'Reviewed'}{row.reviewed_by ? ` by ${row.reviewed_by}` : ''}{row.reviewed_at ? ` · ${formatPhoenixDate(row.reviewed_at)}` : ''}{row.flag_reason ? ` · ${row.flag_reason}` : ''}{row.review_note ? `: ${row.review_note}` : ''}</span><button onClick={() => runReviewAction(row, 'needs_review')} disabled={isBusy} className="px-2 py-1 font-bold rounded border border-border-secondary text-text-secondary hover:border-brand-primary disabled:opacity-50">Reopen</button></div>}
                            </div>
                        </div>
                        {flaggingJobId === row.job_id && <div className="mt-1 flex flex-wrap gap-1.5 rounded border border-tag-amber-border bg-tag-amber-bg p-2"><select value={flagReason} onChange={event => setFlagReason(event.target.value)} className="px-1.5 py-1 text-[10px] rounded border border-tag-amber-border bg-bg-primary text-text-primary">{FLAG_REASONS.map(reason => <option key={reason}>{reason}</option>)}</select><input value={flagNote} onChange={event => setFlagNote(event.target.value)} placeholder="Optional note" className="flex-1 min-w-32 px-2 py-1 text-[10px] rounded border border-tag-amber-border bg-bg-primary text-text-primary" /><button onClick={() => reviewWithAnimation(row, 'flagged', flagReason, flagNote.trim() || null)} disabled={isBusy} className="px-2 py-1 text-[10px] font-bold rounded bg-tag-amber-text text-bg-primary disabled:opacity-50">{isBusy ? 'Saving…' : 'Save flag'}</button></div>}
                    </article>;
                })}</div>}
            </section>
        </main>
    );
};

export default ReviewQueue;
