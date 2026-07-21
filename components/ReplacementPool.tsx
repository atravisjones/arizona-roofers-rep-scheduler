import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLinkIcon, LoadingIcon, RefreshIcon, XIcon } from './icons';
import { supabase } from '../services/supabaseClient';
import type { Coordinates } from '../services/osmService';
import { haversineDistance } from '../services/geography';

export type PoolAnchor = { label: string; coordinates: Coordinates };

// Cancel Culture replacement pool: when a same-day appointment cancels, CSRs pull a
// future quality (#-rated) appointment forward. Claim locks + cooldowns live in the
// replacement_pool table (KPI Supabase) so multiple CSRs never call the same customer.

interface PoolEntry {
    jobId: string;
    title: string;
    start: string;
    quality: number;
    customerName: string | null;
    phone: string | null;
    address: string | null;
    jobOwner: string | null;
    leadSource: string | null;
    lat: string | null;
    lng: string | null;
    status: 'open' | 'claimed' | 'cooldown' | 'exhausted' | 'unqualified' | 'moved';
    claimedBy: string | null;
    attempts: number;
    lastCalledBy: string | null;
    lastCalledAt: string | null;
    nextEligibleAt: string | null;
    unqualifiedReason: string | null;
    movedBy: string | null;
    movedTo: string | null;
    notes: string | null;
}

const CSR_NAMES = ['Bronté Pisz', 'Diva Shahpur', 'Madi Meyers', 'Mariana Franco Caballos', 'Nica Javier', 'Travis Jones'];
const CSR_STORAGE_KEY = 'replacementPoolCsr';
const OPEN_REFRESH_MS = 30000;
const CLOSED_REFRESH_MS = 300000;
const MAX_ATTEMPTS = 3;
const KM_TO_MILES = 0.621371;
// When anchored (gap-fill / cancelled-slot), only recommend appointments within this
// many miles of the rep's stop — a nearby customer is realistic to move; a far one isn't.
const MAX_ANCHOR_MILES = 15;

const getEntryCoordinates = (entry: PoolEntry): Coordinates | null => {
    const lat = Number(entry.lat);
    const lon = Number(entry.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) return null;
    return { lat, lon };
};

const getCity = (title: string) => (title.split('[')[0] || '').trim();

const getTitleTail = (title: string) => {
    const idx = title.indexOf(']');
    return idx >= 0 ? title.slice(idx + 1).trim() : title;
};

const formatStart = (value: string) => {
    const date = new Date(value.replace(' ', 'T'));
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' })
        + ', ' + date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};

const formatTimestamp = (value: string | null) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })
        + ' ' + date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};

const getRoofrJobUrl = (jobId: string) => (
    jobId ? `https://app.roofr.com/dashboard/team/239329/jobs/list-view?selectedJobId=${jobId}` : ''
);

const getCtmUrl = (phone: string | null) => {
    const digits = (phone || '').replace(/\D/g, '');
    return digits ? `https://app.calltrackingmetrics.com/calls/desk#filter=${digits}` : '';
};

const getMapsUrl = (address: string | null) => (
    address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : ''
);

const formatPhone = (phone: string | null) => {
    const digits = (phone || '').replace(/\D/g, '');
    if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    if (digits.length === 11 && digits.startsWith('1')) return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
    return (phone || '').trim();
};

const QualityBadge: React.FC<{ quality: number }> = ({ quality }) => (
    <span className={`text-[10px] font-black tracking-widest px-1.5 py-0.5 rounded border flex-shrink-0 ${
        quality >= 3
            ? 'bg-tag-red-bg text-tag-red-text border-tag-red-border'
            : quality === 2
                ? 'bg-brand-bg-light text-brand-primary border-brand-primary/50'
                : 'bg-bg-tertiary text-text-secondary border-border-secondary'
    }`}>
        {'#'.repeat(Math.max(quality, 1))}
    </span>
);

const LinkPill: React.FC<{ href: string; label: string }> = ({ href, label }) => (
    <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold rounded border border-border-secondary text-text-secondary hover:border-brand-primary hover:text-brand-primary transition"
    >
        <ExternalLinkIcon className="h-3 w-3" />
        {label}
    </a>
);

const ActionButton: React.FC<{
    onClick: () => void;
    disabled?: boolean;
    tone?: 'primary' | 'danger' | 'neutral';
    children: React.ReactNode;
    title?: string;
}> = ({ onClick, disabled, tone = 'neutral', children, title }) => (
    <button
        onClick={onClick}
        disabled={disabled}
        title={title}
        className={`px-2 py-1 text-[10px] font-bold rounded border transition ${
            disabled
                ? 'bg-bg-tertiary text-text-quaternary border-border-secondary cursor-not-allowed opacity-60'
                : tone === 'primary'
                    ? 'bg-brand-primary text-brand-text-on-primary border-brand-primary hover:bg-brand-secondary'
                    : tone === 'danger'
                        ? 'bg-tag-red-bg text-tag-red-text border-tag-red-border hover:shadow-sm'
                        : 'bg-bg-secondary text-text-secondary border-border-secondary hover:border-brand-primary hover:text-brand-primary'
        }`}
    >
        {children}
    </button>
);

const ReplacementPool: React.FC<{
    open: boolean;
    onClose: () => void;
    onCountChange: (count: number) => void;
    anchor?: PoolAnchor | null;
    onClearAnchor?: () => void;
}> = ({ open, onClose, onCountChange, anchor = null, onClearAnchor }) => {
    const [entries, setEntries] = useState<PoolEntry[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [showRemoved, setShowRemoved] = useState(false);
    const [busyJobId, setBusyJobId] = useState<string | null>(null);
    const [csr, setCsr] = useState(() => localStorage.getItem(CSR_STORAGE_KEY) || '');
    const noticeTimerRef = useRef<number | null>(null);

    const setCsrPersisted = useCallback((name: string) => {
        setCsr(name);
        localStorage.setItem(CSR_STORAGE_KEY, name);
    }, []);

    const flashNotice = useCallback((message: string) => {
        setNotice(message);
        if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
        noticeTimerRef.current = window.setTimeout(() => setNotice(null), 6000);
    }, []);

    const fetchPool = useCallback(async () => {
        setIsRefreshing(true);
        try {
            const { data, error: rpcError } = await supabase.rpc('get_replacement_pool');
            if (rpcError) throw new Error(rpcError.message);
            const next: PoolEntry[] = Array.isArray(data) ? data : [];
            setEntries(next);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load replacement pool');
        } finally {
            setIsLoading(false);
            setIsRefreshing(false);
        }
    }, []);

    useEffect(() => {
        fetchPool();
        const intervalId = window.setInterval(() => {
            if (!document.hidden) fetchPool();
        }, open ? OPEN_REFRESH_MS : CLOSED_REFRESH_MS);
        return () => window.clearInterval(intervalId);
    }, [fetchPool, open]);

    const availableCount = useMemo(() => entries.filter(e => e.status === 'open').length, [entries]);

    useEffect(() => {
        onCountChange(availableCount);
    }, [availableCount, onCountChange]);

    const runAction = useCallback(async (jobId: string, action: () => Promise<{ ok: boolean; reason?: string; claimedBy?: string | null }>) => {
        if (!csr) {
            flashNotice('Pick your name first so calls get tracked to you.');
            return;
        }
        setBusyJobId(jobId);
        try {
            const result = await action();
            if (!result.ok) {
                const holder = result.claimedBy ? ` — ${result.claimedBy} has it` : '';
                flashNotice(`Not available (${result.reason || 'unknown'})${holder}. List refreshed.`);
            }
        } catch (err) {
            flashNotice(err instanceof Error ? err.message : 'Action failed');
        } finally {
            setBusyJobId(null);
            fetchPool();
        }
    }, [csr, fetchPool, flashNotice]);

    const rpcResult = async (fn: string, args: Record<string, string | null>) => {
        const { data, error: rpcError } = await supabase.rpc(fn, args);
        if (rpcError) throw new Error(rpcError.message);
        return (data || { ok: false, reason: 'no response' }) as { ok: boolean; reason?: string; claimedBy?: string | null };
    };

    const handleClaim = (entry: PoolEntry) => runAction(entry.jobId, () => (
        rpcResult('claim_replacement', { p_job_id: entry.jobId, p_csr: csr })
    ));

    const handleOutcome = (entry: PoolEntry, outcome: string, detail: string | null = null) => runAction(entry.jobId, () => (
        rpcResult('replacement_outcome', { p_job_id: entry.jobId, p_csr: csr, p_outcome: outcome, p_detail: detail })
    ));

    const handleUnqualified = (entry: PoolEntry) => {
        const reason = window.prompt('Why can\'t they move earlier? (optional)') ?? '';
        handleOutcome(entry, 'unqualified', reason.trim() || null);
    };

    const handleMoved = (entry: PoolEntry) => {
        const movedTo = window.prompt('Moved to when? e.g. "today 2-5" (optional)') ?? '';
        handleOutcome(entry, 'moved', movedTo.trim() || null);
    };

    const distanceByJobId = useMemo(() => {
        const byId: Record<string, number | null> = {};
        if (!anchor) return byId;
        entries.forEach(entry => {
            const coords = getEntryCoordinates(entry);
            byId[entry.jobId] = coords ? haversineDistance(anchor.coordinates, coords) * KM_TO_MILES : null;
        });
        return byId;
    }, [anchor, entries]);

    const sections = useMemo(() => {
        // Server order = quality desc, date asc; with an anchor set, closest wins instead
        // and the actionable list is trimmed to the 5 nearest.
        const byProximity = (list: PoolEntry[]) => (
            anchor
                ? [...list].sort((a, b) => (distanceByJobId[a.jobId] ?? Infinity) - (distanceByJobId[b.jobId] ?? Infinity))
                : list
        );
        const available = byProximity(entries.filter(e => e.status === 'open' || e.status === 'claimed'));
        // Anchored: only appointments within MAX_ANCHOR_MILES (a distance we can measure),
        // then the 5 closest. Entries without coordinates can't be confirmed in-range → dropped.
        const availableWithinRange = anchor
            ? available.filter(e => { const d = distanceByJobId[e.jobId]; return d != null && d <= MAX_ANCHOR_MILES; }).slice(0, 5)
            : available;
        return {
            available: availableWithinRange,
            cooldown: byProximity(entries.filter(e => e.status === 'cooldown')),
            removed: entries.filter(e => e.status === 'unqualified' || e.status === 'moved' || e.status === 'exhausted'),
        };
    }, [anchor, distanceByJobId, entries]);

    if (!open) return null;

    const renderEntry = (entry: PoolEntry) => {
        const isMine = entry.status === 'claimed' && entry.claimedBy === csr;
        const isBusy = busyJobId === entry.jobId;
        const ctmUrl = getCtmUrl(entry.phone);
        const roofrUrl = getRoofrJobUrl(entry.jobId);
        const mapsUrl = getMapsUrl(entry.address);

        return (
            <div
                key={entry.jobId}
                className={`rounded-md border p-2 space-y-1.5 ${
                    isMine
                        ? 'border-brand-primary ring-1 ring-brand-primary/40 bg-brand-bg-light'
                        : entry.status === 'claimed'
                            ? 'border-border-primary bg-bg-tertiary/60'
                            : 'border-border-primary bg-bg-primary'
                }`}
            >
                <div className="flex items-center gap-1.5 min-w-0">
                    <QualityBadge quality={entry.quality} />
                    <span className="text-[11px] font-bold text-text-primary truncate">{getCity(entry.title)}</span>
                    {anchor && (
                        <span className="text-[10px] font-black text-brand-primary flex-shrink-0 px-1 rounded border border-brand-primary/50 bg-brand-bg-light">
                            {distanceByJobId[entry.jobId] != null ? `${distanceByJobId[entry.jobId]!.toFixed(1)} mi` : '? mi'}
                        </span>
                    )}
                    <span className="text-[10px] font-semibold text-brand-primary flex-shrink-0 ml-auto">{formatStart(entry.start)}</span>
                </div>

                <div className="flex items-baseline gap-2 min-w-0">
                    <span className="text-xs font-bold text-text-primary truncate">{entry.customerName || 'Unknown customer'}</span>
                    {entry.phone && <span className="text-[10px] text-text-secondary flex-shrink-0">{formatPhone(entry.phone)}</span>}
                </div>

                <div className="text-[10px] text-text-tertiary line-clamp-2" title={entry.title}>{getTitleTail(entry.title)}</div>
                {entry.jobOwner && <div className="text-[10px] text-text-tertiary">Rep: <span className="text-text-secondary font-semibold">{entry.jobOwner}</span></div>}
                {entry.notes && <div className="text-[10px] text-text-tertiary whitespace-pre-wrap">{entry.notes}</div>}

                <div className="flex flex-wrap items-center gap-1">
                    {ctmUrl && <LinkPill href={ctmUrl} label="CTM" />}
                    {roofrUrl && <LinkPill href={roofrUrl} label="Job" />}
                    {mapsUrl && <LinkPill href={mapsUrl} label="Map" />}
                    <span className="text-[9px] text-text-quaternary ml-auto">{entry.attempts}/{MAX_ATTEMPTS} calls</span>
                </div>

                {entry.status === 'open' && (
                    <ActionButton onClick={() => handleClaim(entry)} disabled={isBusy} tone="primary" title="Locks this customer to you for 15 minutes">
                        {isBusy ? 'Claiming…' : '📞 Claim & call'}
                    </ActionButton>
                )}

                {entry.status === 'claimed' && !isMine && (
                    <div className="text-[10px] font-bold text-tag-red-text">🔒 {entry.claimedBy} is calling</div>
                )}

                {isMine && (
                    <div className="flex flex-wrap gap-1">
                        <ActionButton onClick={() => handleMoved(entry)} disabled={isBusy} tone="primary">✅ Moved up</ActionButton>
                        <ActionButton onClick={() => handleUnqualified(entry)} disabled={isBusy} tone="danger">❌ Can't go earlier</ActionButton>
                        <ActionButton onClick={() => handleOutcome(entry, 'no_answer')} disabled={isBusy}>📵 No answer</ActionButton>
                        <ActionButton onClick={() => handleOutcome(entry, 'release')} disabled={isBusy}>Release</ActionButton>
                    </div>
                )}

                {entry.status === 'cooldown' && (
                    <div className="text-[10px] text-text-tertiary">
                        ⏱ No answer{entry.lastCalledBy ? ` (${entry.lastCalledBy}, ${formatTimestamp(entry.lastCalledAt)})` : ''} — retry after {formatTimestamp(entry.nextEligibleAt)}
                    </div>
                )}

                {entry.status === 'exhausted' && (
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] text-text-tertiary">📵 {MAX_ATTEMPTS} attempts, no contact — resting</span>
                        <ActionButton onClick={() => handleOutcome(entry, 'restore')} disabled={isBusy}>Restore</ActionButton>
                    </div>
                )}

                {entry.status === 'unqualified' && (
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] text-tag-red-text">❌ Can't move earlier{entry.unqualifiedReason ? `: ${entry.unqualifiedReason}` : ''}</span>
                        <ActionButton onClick={() => handleOutcome(entry, 'restore')} disabled={isBusy}>Restore</ActionButton>
                    </div>
                )}

                {entry.status === 'moved' && (
                    <div className="text-[10px] font-bold text-tag-green-text">✅ Moved up by {entry.movedBy}{entry.movedTo ? ` → ${entry.movedTo}` : ''}</div>
                )}
            </div>
        );
    };

    return (
        <aside className="fixed inset-y-0 right-0 z-50 w-[26rem] max-w-full bg-bg-primary border-l border-border-primary shadow-2xl flex flex-col">
            <div className="flex-shrink-0 px-3 py-2 bg-bg-secondary border-b border-border-primary flex items-center justify-between gap-2">
                <div className="min-w-0">
                    <h2 className="text-sm font-bold text-text-primary">🔥 Replacement Pool</h2>
                    <div className="text-[10px] text-text-tertiary">
                        Quality appointments to pull into cancelled slots · tomorrow → 2 weeks out
                    </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                        onClick={fetchPool}
                        disabled={isRefreshing}
                        className="p-1.5 rounded hover:bg-bg-tertiary text-text-tertiary hover:text-brand-primary disabled:opacity-40 transition"
                        title="Refresh pool"
                    >
                        {isRefreshing ? <LoadingIcon className="h-3.5 w-3.5 text-brand-primary" /> : <RefreshIcon className="h-3.5 w-3.5" />}
                    </button>
                    <button onClick={onClose} className="p-1.5 rounded hover:bg-bg-tertiary text-text-tertiary hover:text-text-primary transition" title="Close">
                        <XIcon className="h-4 w-4" />
                    </button>
                </div>
            </div>

            <div className="flex-shrink-0 px-3 py-2 border-b border-border-secondary flex items-center gap-2">
                <label className="text-[10px] font-semibold text-text-tertiary uppercase flex-shrink-0">I am</label>
                <select
                    value={csr}
                    onChange={event => setCsrPersisted(event.target.value)}
                    className={`flex-1 px-2 py-1 text-xs rounded-md border outline-none bg-bg-secondary text-text-primary ${csr ? 'border-border-primary' : 'border-tag-red-border'}`}
                >
                    <option value="">Select your name…</option>
                    {CSR_NAMES.map(name => <option key={name} value={name}>{name}</option>)}
                </select>
            </div>

            {anchor && (
                <div className="flex-shrink-0 mx-3 mt-2 px-2 py-1.5 text-[11px] rounded border border-brand-primary/50 bg-brand-bg-light text-brand-primary flex items-center gap-2">
                    <span className="truncate font-semibold">📍 Within {MAX_ANCHOR_MILES} mi of {anchor.label}</span>
                    <button
                        onClick={onClearAnchor}
                        className="ml-auto flex-shrink-0 font-bold hover:opacity-70 transition"
                        title="Show the full pool in quality order"
                    >
                        ✕ show all
                    </button>
                </div>
            )}

            {notice && (
                <div className="flex-shrink-0 mx-3 mt-2 px-2 py-1.5 text-[11px] rounded border border-tag-red-border bg-tag-red-bg text-tag-red-text">
                    {notice}
                </div>
            )}

            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-3 space-y-2">
                {isLoading ? (
                    <div className="flex flex-col items-center justify-center py-10 text-text-tertiary">
                        <LoadingIcon className="h-6 w-6 text-brand-primary mb-2" />
                        <p className="text-xs">Loading pool…</p>
                    </div>
                ) : error ? (
                    <div className="text-xs text-tag-red-text bg-tag-red-bg rounded-md p-2 border border-tag-red-border">{error}</div>
                ) : (
                    <>
                        {sections.available.length === 0 && (
                            <p className="text-xs italic text-text-quaternary py-4 text-center">
                                {anchor ? `No quality appointments within ${MAX_ANCHOR_MILES} miles.` : 'No quality appointments available right now.'}
                            </p>
                        )}
                        {sections.available.map(renderEntry)}

                        {sections.cooldown.length > 0 && (
                            <>
                                <div className="text-[10px] font-bold uppercase tracking-wide text-text-tertiary pt-2">Cooling down ({sections.cooldown.length})</div>
                                {sections.cooldown.map(renderEntry)}
                            </>
                        )}

                        {sections.removed.length > 0 && (
                            <>
                                <button
                                    onClick={() => setShowRemoved(v => !v)}
                                    className="w-full text-left text-[10px] font-bold uppercase tracking-wide text-text-tertiary hover:text-text-secondary pt-2 transition"
                                >
                                    {showRemoved ? '▾' : '▸'} Off the board ({sections.removed.length})
                                </button>
                                {showRemoved && sections.removed.map(renderEntry)}
                            </>
                        )}
                    </>
                )}
            </div>
        </aside>
    );
};

export default ReplacementPool;
