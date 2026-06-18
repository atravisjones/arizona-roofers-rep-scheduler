import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DAY_VIEW_CELL_HEIGHT, DAY_VIEW_END_HOUR, DAY_VIEW_START_HOUR } from '../constants';
import { DAY_VIEW_SLOTS, mapMinutesToSlotId } from './DayView/dayViewUtils';
import { ChevronLeftIcon, ChevronRightIcon, ErrorIcon, ExternalLinkIcon, LoadingIcon, RefreshIcon, XIcon } from './icons';
import { useAppContext } from '../context/AppContext';
import type { Rep } from '../types';
import { getEffectiveUnavailableSlots } from '../utils/repUtils';

interface RoofrAppointment {
    eventId: string;
    jobId: string;
    address: string;
    title: string;
    start: string;
    end: string;
    allDay: boolean;
    category: string;
    attendees: string;
    customerName: string;
    masterAddress: string;
    jobOwner: string;
    workflow: string;
    tags: string;
    phone?: string;
    email?: string;
    leadSource?: string;
    bookingCsr?: string;
}

type BoardAppointment = RoofrAppointment & {
    status: 'active' | 'cancelled';
    isNew?: boolean;
};

const REFRESH_MS = 120000;
const NEW_FLASH_MS = 60000;
const CANCELLED_VISIBLE_MS = 10 * 60000;
const TIME_COLUMN_WIDTH = 70;
const HEADER_HEIGHT = 44;

const todayKey = () => {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
};

const parseLocalDate = (value: string) => new Date(value.replace(' ', 'T'));

const addDays = (dateKey: string, delta: number) => {
    const d = new Date(`${dateKey}T12:00:00`);
    d.setDate(d.getDate() + delta);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
};

const getRepName = (appointment: RoofrAppointment) => {
    const attendees = (appointment.attendees || '').trim();
    if (attendees && !/^\d+(,\s*\d+)*$/.test(attendees)) return attendees;
    return (appointment.jobOwner || 'Unassigned').trim() || 'Unassigned';
};

const formatDateHeading = (dateKey: string) => {
    const date = new Date(`${dateKey}T12:00:00`);
    return date.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
    });
};

const formatTime = (value: string) => {
    if (!value) return '';
    const date = parseLocalDate(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
    });
};

const formatTimeRange = (appointment: RoofrAppointment) => {
    const start = formatTime(appointment.start);
    const end = formatTime(appointment.end);
    if (!start) return 'Time TBD';
    return end ? `${start} - ${end}` : start;
};

const getSortTime = (appointment: RoofrAppointment) => {
    const date = parseLocalDate(appointment.start);
    return Number.isNaN(date.getTime()) ? Number.MAX_SAFE_INTEGER : date.getTime();
};

const getAppointmentMinutes = (value: string) => {
    const date = parseLocalDate(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.getHours() * 60 + date.getMinutes();
};

const getAppointmentPosition = (appointment: RoofrAppointment) => {
    const gridStartMinutes = DAY_VIEW_START_HOUR * 60;
    const gridEndMinutes = DAY_VIEW_END_HOUR * 60;
    const startMinutes = getAppointmentMinutes(appointment.start) ?? gridStartMinutes;
    const parsedEndMinutes = getAppointmentMinutes(appointment.end);
    const endMinutes = parsedEndMinutes && parsedEndMinutes > startMinutes ? parsedEndMinutes : startMinutes + 60;
    const visibleStart = Math.max(gridStartMinutes, Math.min(startMinutes, gridEndMinutes - 30));
    const visibleEnd = Math.max(visibleStart + 30, Math.min(endMinutes, gridEndMinutes));

    return {
        top: ((visibleStart - gridStartMinutes) / 30) * DAY_VIEW_CELL_HEIGHT,
        height: Math.max(((visibleEnd - visibleStart) / 30) * DAY_VIEW_CELL_HEIGHT, 30),
    };
};

const getShortAddress = (appointment: RoofrAppointment) => {
    const address = appointment.masterAddress || appointment.address || '';
    return address.split(',')[0] || 'No address';
};

const getShortTitle = (title: string) => {
    const trimmed = (title || '').trim();
    return trimmed.length > 70 ? `${trimmed.slice(0, 67)}...` : trimmed;
};

const getRoofrJobUrl = (jobId: string) => (
    jobId ? `https://app.roofr.com/dashboard/team/239329/jobs/list-view?selectedJobId=${jobId}` : ''
);

const normalizeRepName = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

const getDayName = (dateKey: string) => new Date(`${dateKey}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long' });

const formatPhone = (phone: string) => {
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    if (digits.length === 11 && digits.startsWith('1')) return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
    return phone.trim();
};

const DetailRow: React.FC<{ label: string; value?: string }> = ({ label, value }) => {
    const trimmed = (value || '').trim();
    if (!trimmed) return null;

    return (
        <div className="grid grid-cols-[100px_1fr] gap-3 py-2 border-b border-border-secondary/60 last:border-b-0">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">{label}</div>
            <div className="text-sm text-text-primary whitespace-pre-wrap break-words">{trimmed}</div>
        </div>
    );
};

const DetailActionButton: React.FC<{
    children: React.ReactNode;
    onClick: () => void;
    disabled: boolean;
    title: string;
    isCaution?: boolean;
}> = ({ children, onClick, disabled, title, isCaution = false }) => (
    <button
        onClick={onClick}
        disabled={disabled}
        title={title}
        className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-bold rounded-md border transition-all ${
            disabled
                ? 'bg-bg-tertiary text-text-quaternary border-border-secondary cursor-not-allowed opacity-60'
                : isCaution
                    ? 'bg-tag-red-bg text-tag-red-text border-tag-red-border hover:shadow-sm'
                    : 'bg-brand-primary text-brand-text-on-primary border-brand-primary hover:bg-brand-secondary shadow-sm'
        }`}
    >
        <ExternalLinkIcon className="h-3.5 w-3.5" />
        <span>{children}</span>
    </button>
);

const AppointmentDetailModal: React.FC<{
    appointment: BoardAppointment | null;
    repName: string;
    onClose: () => void;
}> = ({ appointment, repName, onClose }) => {
    useEffect(() => {
        if (!appointment) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [appointment, onClose]);

    if (!appointment) return null;

    const address = (appointment.masterAddress || appointment.address || '').trim();
    const phone = (appointment.phone || '').trim();
    const phoneDigits = phone.replace(/\D/g, '');
    const roofrUrl = getRoofrJobUrl(appointment.jobId);
    const mapsUrl = address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : '';
    const ctmUrl = phoneDigits ? `https://app.calltrackingmetrics.com/calls/desk#filter=${phoneDigits}` : '';

    return (
        <div className="fixed inset-0 bg-bg-secondary/60 backdrop-blur-sm flex items-center justify-center p-4 z-[60]" onClick={onClose}>
            <div className="popup-surface w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden animate-fade-in shadow-2xl rounded-xl ring-1 ring-border-primary" onClick={e => e.stopPropagation()}>
                <header className="px-5 py-4 border-b border-border-primary flex items-start justify-between gap-4 bg-bg-secondary/50">
                    <div className="min-w-0">
                        <h2 className="text-lg font-bold text-text-primary truncate">
                            {appointment.customerName || 'Unknown customer'}
                        </h2>
                        <p className="text-xs text-text-tertiary">{formatTimeRange(appointment)}</p>
                    </div>
                    <button onClick={onClose} className="text-text-quaternary hover:text-text-secondary p-1 rounded-full hover:bg-bg-tertiary transition" title="Close">
                        <XIcon className="h-5 w-5" />
                    </button>
                </header>

                <div className="p-5 overflow-y-auto custom-scrollbar">
                    <div className="rounded-lg border border-border-primary bg-bg-primary overflow-hidden">
                        <div className="px-4 py-2">
                            <DetailRow label="Rep" value={repName} />
                            <DetailRow label="Address" value={address} />
                            <DetailRow label="Lead Source" value={appointment.leadSource} />
                            <DetailRow label="Booking CSR" value={appointment.bookingCsr} />
                            <DetailRow label="Phone" value={phone ? formatPhone(phone) : ''} />
                            <DetailRow label="Details" value={appointment.title} />
                        </div>
                    </div>
                </div>

                <footer className="px-5 py-4 bg-bg-secondary/30 border-t border-border-primary flex flex-wrap justify-end gap-2 rounded-b-xl">
                    <DetailActionButton
                        onClick={() => window.open(roofrUrl, '_blank')}
                        disabled={!roofrUrl}
                        title={roofrUrl ? 'Open Job Card' : 'No Roofr job ID'}
                    >
                        Open Job Card
                    </DetailActionButton>
                    <DetailActionButton
                        onClick={() => window.open(mapsUrl, '_blank')}
                        disabled={!mapsUrl}
                        title={mapsUrl ? 'Open in Google Maps' : 'No address'}
                    >
                        Google Maps
                    </DetailActionButton>
                    <DetailActionButton
                        onClick={() => window.open(ctmUrl, '_blank')}
                        disabled={!ctmUrl}
                        title={ctmUrl ? 'Call in CTM' : 'No phone number'}
                    >
                        Call (CTM)
                    </DetailActionButton>
                    <DetailActionButton
                        onClick={() => window.open(roofrUrl, '_blank')}
                        disabled={!roofrUrl}
                        title="Opens the appointment in Roofr to cancel it."
                        isCaution
                    >
                        Cancel in Roofr
                    </DetailActionButton>
                </footer>
            </div>
        </div>
    );
};

const TodayBoard: React.FC = () => {
    const { appState } = useAppContext();
    const [dateKey, setDateKey] = useState(() => todayKey());
    const dayName = useMemo(() => getDayName(dateKey), [dateKey]);
    const relativeLabel = useMemo(() => {
        const t = todayKey();
        if (dateKey === t) return "Today's";
        if (dateKey === addDays(t, 1)) return "Tomorrow's";
        if (dateKey === addDays(t, -1)) return "Yesterday's";
        return '';
    }, [dateKey]);
    const [appointments, setAppointments] = useState<RoofrAppointment[]>([]);
    const [previousAppointments, setPreviousAppointments] = useState<Record<string, RoofrAppointment>>({});
    const [cancelledAppointments, setCancelledAppointments] = useState<Record<string, { appointment: RoofrAppointment; expiresAt: number }>>({});
    const [newEventIds, setNewEventIds] = useState<Record<string, number>>({});
    const [selectedAppointment, setSelectedAppointment] = useState<{ appointment: BoardAppointment; repName: string } | null>(null);
    const previousAppointmentsRef = useRef<Record<string, RoofrAppointment>>({});
    const isFirstLoadRef = useRef(true);
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [source, setSource] = useState<string>('');

    const fetchAppointments = useCallback(async () => {
        if (document.hidden) return;

        setIsRefreshing(true);
        setError(null);

        try {
            const response = await fetch(`/api/roofr-appointments?date=${dateKey}`);
            if (!response.ok) throw new Error(`Appointments feed returned ${response.status}`);
            const data = await response.json();
            const nextAppointments: RoofrAppointment[] = Array.isArray(data.appointments) ? data.appointments : [];
            const now = Date.now();
            const nextById = Object.fromEntries(nextAppointments.map(appointment => [appointment.eventId, appointment]));
            const wasFirstLoad = isFirstLoadRef.current;
            const previousById = previousAppointmentsRef.current;

            // Storm-day guard: a 200 with an empty list while we already have
            // appointments is almost certainly a transient feed blip, not the
            // whole day cancelling at once. Keep last-good data rather than
            // blanking the board or flipping every card to red.
            if (!wasFirstLoad && nextAppointments.length === 0 && Object.keys(previousById).length > 0) {
                return;
            }

            setCancelledAppointments(prev => {
                const next = Object.fromEntries(
                    Object.entries(prev).filter(([, item]) => item.expiresAt > now)
                );

                if (!wasFirstLoad) {
                    Object.entries(previousById).forEach(([eventId, appointment]) => {
                        if (!nextById[eventId]) {
                            next[eventId] = { appointment, expiresAt: now + CANCELLED_VISIBLE_MS };
                        }
                    });
                }

                return next;
            });

            setNewEventIds(prev => {
                const next = Object.fromEntries(
                    Object.entries(prev).filter(([, expiresAt]) => expiresAt > now)
                );

                if (!wasFirstLoad) {
                    nextAppointments.forEach(appointment => {
                        if (!previousById[appointment.eventId]) {
                            next[appointment.eventId] = now + NEW_FLASH_MS;
                        }
                    });
                }

                return next;
            });

            setAppointments(nextAppointments);
            previousAppointmentsRef.current = nextById;
            isFirstLoadRef.current = false;
            setPreviousAppointments(nextById);
            setSource(data.source || '');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load appointments');
        } finally {
            setIsLoading(false);
            setIsRefreshing(false);
        }
    }, [dateKey]);

    useEffect(() => {
        fetchAppointments();

        const intervalId = window.setInterval(fetchAppointments, REFRESH_MS);
        const handleVisibilityChange = () => {
            if (!document.hidden) fetchAppointments();
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => {
            window.clearInterval(intervalId);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [fetchAppointments]);

    useEffect(() => {
        const cleanupId = window.setInterval(() => {
            const now = Date.now();
            setNewEventIds(prev => Object.fromEntries(Object.entries(prev).filter(([, expiresAt]) => expiresAt > now)));
            setCancelledAppointments(prev => Object.fromEntries(Object.entries(prev).filter(([, item]) => item.expiresAt > now)));
        }, 30000);

        return () => window.clearInterval(cleanupId);
    }, []);

    const groupedAppointments = useMemo(() => {
        const now = Date.now();
        const byRep = new Map<string, BoardAppointment[]>();

        appointments.forEach(appointment => {
            const repName = getRepName(appointment);
            const items = byRep.get(repName) || [];
            items.push({
                ...appointment,
                status: 'active',
                isNew: (newEventIds[appointment.eventId] || 0) > now,
            });
            byRep.set(repName, items);
        });

        Object.values(cancelledAppointments).forEach(({ appointment, expiresAt }) => {
            if (expiresAt <= now) return;
            const repName = getRepName(appointment);
            const items = byRep.get(repName) || [];
            items.push({ ...appointment, status: 'cancelled' });
            byRep.set(repName, items);
        });

        return Array.from(byRep.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([repName, items]) => ({
                repName,
                appointments: items.sort((a, b) => getSortTime(a) - getSortTime(b)),
            }));
    }, [appointments, cancelledAppointments, newEventIds]);

    const repsByName = useMemo(() => {
        const byName = new Map<string, Rep>();
        appState.reps.forEach(rep => {
            byName.set(normalizeRepName(rep.name), rep);
        });
        return byName;
    }, [appState.reps]);

    const goToDate = useCallback((newKey: string) => {
        // Reset the red/green baseline so switching days doesn't flag the new
        // day's appointments as cancelled/new on the first fetch.
        isFirstLoadRef.current = true;
        previousAppointmentsRef.current = {};
        setCancelledAppointments({});
        setNewEventIds({});
        setAppointments([]);
        setSelectedAppointment(null);
        setError(null);
        setIsLoading(true);
        setDateKey(newKey);
    }, []);

    const activeCount = appointments.length;
    const cancelledCount = Object.values(cancelledAppointments).filter(item => item.expiresAt > Date.now()).length;

    return (
        <div className="flex flex-col h-full min-h-0 overflow-hidden bg-bg-primary">
            <div className="flex-shrink-0 px-3 py-2 bg-bg-secondary border-b border-border-primary flex items-center justify-between gap-3">
                <div className="min-w-0">
                    <h2 className="text-sm font-bold text-text-primary truncate">
                        {relativeLabel ? `${relativeLabel} Appointments` : 'Appointments'} - {formatDateHeading(dateKey)}
                    </h2>
                    <div className="text-[11px] text-text-tertiary">
                        {activeCount} active{cancelledCount > 0 ? `, ${cancelledCount} cancelled` : ''}{source ? ` - ${source}` : ''}
                        {error && <span className="ml-2 text-tag-red-text" title={error}>⚠ refresh failed — showing last update</span>}
                    </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                        onClick={() => goToDate(addDays(dateKey, -1))}
                        className="p-1.5 rounded hover:bg-bg-tertiary text-text-tertiary hover:text-brand-primary transition"
                        title="Previous day"
                    >
                        <ChevronLeftIcon className="h-4 w-4" />
                    </button>
                    <button
                        onClick={() => goToDate(todayKey())}
                        disabled={dateKey === todayKey()}
                        className="px-2 py-1 text-[11px] font-semibold rounded hover:bg-bg-tertiary text-text-tertiary hover:text-brand-primary disabled:opacity-40 transition"
                        title="Jump to today"
                    >
                        Today
                    </button>
                    <button
                        onClick={() => goToDate(addDays(dateKey, 1))}
                        className="p-1.5 rounded hover:bg-bg-tertiary text-text-tertiary hover:text-brand-primary transition"
                        title="Next day"
                    >
                        <ChevronRightIcon className="h-4 w-4" />
                    </button>
                    <button
                        onClick={fetchAppointments}
                        disabled={isRefreshing}
                        className="p-1.5 rounded hover:bg-bg-tertiary text-text-tertiary hover:text-brand-primary disabled:opacity-40 transition ml-1"
                        title="Refresh appointments"
                    >
                        {isRefreshing ? <LoadingIcon className="h-3.5 w-3.5 text-brand-primary" /> : <RefreshIcon className="h-3.5 w-3.5" />}
                    </button>
                </div>
            </div>

            {isLoading ? (
                <div className="flex-1 flex flex-col items-center justify-center text-text-tertiary">
                    <LoadingIcon className="h-8 w-8 text-brand-primary mb-2" />
                    <p className="text-sm font-medium">Loading appointments...</p>
                </div>
            ) : error && groupedAppointments.length === 0 ? (
                <div className="m-3 flex items-center gap-2 text-tag-red-text bg-tag-red-bg rounded-lg p-3 border border-tag-red-border">
                    <ErrorIcon className="h-5 w-5" />
                    <p className="text-sm">{error}</p>
                </div>
            ) : groupedAppointments.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-text-quaternary">
                    <p className="text-sm italic">No sales appointments found for today.</p>
                </div>
            ) : (
                <div className="flex-1 min-h-0 overflow-auto custom-scrollbar">
                    <div
                        className="flex w-full min-w-0"
                        style={{
                            height: HEADER_HEIGHT + DAY_VIEW_SLOTS.length * DAY_VIEW_CELL_HEIGHT,
                            minHeight: HEADER_HEIGHT + DAY_VIEW_SLOTS.length * DAY_VIEW_CELL_HEIGHT,
                        }}
                    >
                        <div
                            className="sticky left-0 z-30 bg-bg-primary border-r border-border-primary flex flex-col flex-shrink-0"
                            style={{ width: TIME_COLUMN_WIDTH }}
                        >
                            <div
                                className="sticky top-0 z-40 bg-bg-secondary border-b border-border-primary flex items-center justify-center"
                                style={{ height: HEADER_HEIGHT }}
                            >
                                <span className="text-[10px] text-text-tertiary font-medium">TIME</span>
                            </div>
                            {DAY_VIEW_SLOTS.map(slot => (
                                <div
                                    key={slot.id}
                                    className={`flex items-start justify-end pr-2 pt-0.5 border-b ${
                                        slot.startMinutes % 60 === 0 ? 'border-border-primary' : 'border-border-secondary/50'
                                    }`}
                                    style={{ height: DAY_VIEW_CELL_HEIGHT }}
                                >
                                    {slot.startMinutes % 60 === 0 && (
                                        <span className="text-[10px] text-text-secondary font-medium">{slot.label}</span>
                                    )}
                                </div>
                            ))}
                        </div>

                        {groupedAppointments.map(group => (
                            (() => {
                                const matchedRep = repsByName.get(normalizeRepName(group.repName));
                                const unavailableSlotIds = matchedRep ? getEffectiveUnavailableSlots(matchedRep, dayName) : [];
                                const isFullyUnavailable = unavailableSlotIds.length >= 4;
                                const isTimeUnavailable = (startMinutes: number) => unavailableSlotIds.includes(mapMinutesToSlotId(startMinutes));

                                return (
                                    <div
                                        key={group.repName}
                                        className={`flex flex-col border-r border-border-primary bg-bg-primary min-w-0 ${isFullyUnavailable ? 'opacity-60 grayscale' : ''}`}
                                        style={{ flex: '1 1 0' }}
                                    >
                                        <div
                                            className="sticky top-0 z-20 px-2 bg-bg-secondary border-b border-border-primary flex items-center"
                                            style={{ height: HEADER_HEIGHT }}
                                        >
                                            <div className="flex items-center justify-between gap-1 w-full min-w-0">
                                                <div className="text-xs font-bold text-text-primary truncate min-w-0" title={group.repName}>{group.repName}</div>
                                                <div className="flex items-center gap-1 flex-shrink-0">
                                                    {isFullyUnavailable && (
                                                        <span className="text-[9px] font-bold uppercase text-text-tertiary bg-bg-tertiary px-1.5 py-0.5 rounded-full">
                                                            Off
                                                        </span>
                                                    )}
                                                    <span className="text-[10px] text-text-secondary bg-bg-tertiary px-1.5 py-0.5 rounded-full">
                                                        {group.appointments.length}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="relative">
                                            {DAY_VIEW_SLOTS.map(slot => {
                                                const unavailable = isTimeUnavailable(slot.startMinutes);
                                                return (
                                                    <div
                                                        key={slot.id}
                                                        className={`relative border-b ${
                                                            slot.startMinutes % 60 === 0 ? 'border-border-primary' : 'border-border-secondary/50'
                                                        } ${unavailable ? 'bg-bg-tertiary day-view-unavailable' : ''}`}
                                                        style={{ height: DAY_VIEW_CELL_HEIGHT }}
                                                    />
                                                );
                                            })}

                                            {group.appointments.map(appointment => {
                                                const isCancelled = appointment.status === 'cancelled';
                                                const isNew = appointment.isNew;
                                                const position = getAppointmentPosition(appointment);
                                                const cardClass = isCancelled
                                                    ? 'bg-tag-red-bg text-tag-red-text border-tag-red-border opacity-90'
                                                    : isNew
                                                        ? 'bg-tag-green-bg text-tag-green-text border-tag-green-border ring-2 ring-tag-green-border/60'
                                                        : 'bg-brand-bg-light text-text-primary border-brand-primary/30 hover:border-brand-primary hover:shadow-md';

                                                return (
                                                    <button
                                                        key={`${appointment.status}-${appointment.eventId}`}
                                                        onClick={() => !isCancelled && setSelectedAppointment({ appointment, repName: group.repName })}
                                                        disabled={isCancelled}
                                                        className={`absolute left-1 right-1 z-10 text-left rounded-md border overflow-hidden transition-all ${cardClass} ${isCancelled ? 'cursor-default' : 'cursor-pointer active:scale-[0.99]'}`}
                                                        style={{
                                                            top: position.top,
                                                            height: Math.max(position.height - 2, 30),
                                                        }}
                                                        title={appointment.title}
                                                    >
                                                        <div className="p-1.5 h-full flex flex-col overflow-hidden">
                                                            <div className="flex items-center justify-between gap-1 flex-shrink-0">
                                                                <span className="text-[9px] font-semibold text-brand-primary truncate">
                                                                    {formatTimeRange(appointment)}
                                                                </span>
                                                                {isCancelled && (
                                                                    <span className="text-[8px] font-bold uppercase tracking-wide flex-shrink-0">Cancelled</span>
                                                                )}
                                                                {isNew && !isCancelled && (
                                                                    <span className="text-[8px] font-bold uppercase tracking-wide flex-shrink-0">New</span>
                                                                )}
                                                            </div>
                                                            <div className="text-[10px] font-bold text-text-primary truncate">
                                                                {appointment.customerName || 'Unknown customer'}
                                                            </div>
                                                            <div className="text-[9px] text-text-secondary truncate flex-shrink-0">
                                                                {getShortAddress(appointment)}
                                                            </div>
                                                            <div className="text-[9px] opacity-70 line-clamp-2 min-h-0">
                                                                {getShortTitle(appointment.title)}
                                                            </div>
                                                        </div>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })()
                        ))}
                    </div>
                </div>
            )}

            <AppointmentDetailModal
                appointment={selectedAppointment?.appointment || null}
                repName={selectedAppointment?.repName || ''}
                onClose={() => setSelectedAppointment(null)}
            />
        </div>
    );
};

export default TodayBoard;
