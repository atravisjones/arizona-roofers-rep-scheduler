import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DAY_VIEW_CELL_HEIGHT, DAY_VIEW_END_HOUR, DAY_VIEW_START_HOUR } from '../constants';
import { DAY_VIEW_SLOTS, mapMinutesToSlotId } from './DayView/dayViewUtils';
import { ChevronLeftIcon, ChevronRightIcon, ErrorIcon, ExternalLinkIcon, LoadingIcon, RefreshIcon, XIcon } from './icons';
import { useAppContext } from '../context/AppContext';
import type { Rep } from '../types';
import { getEffectiveUnavailableSlots } from '../utils/repUtils';
import { geocodeAddresses, preCacheGeocodes, type Coordinates } from '../services/osmService';
import { haversineDistance } from '../services/geography';
import { supabase } from '../services/supabaseClient';
import ReplacementPool from './ReplacementPool';

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
    lat?: number | null;
    lng?: number | null;
}

type BoardAppointment = RoofrAppointment & {
    status: 'active' | 'cancelled';
    isNew?: boolean;
};

type AppointmentCoordinateMap = Record<string, Coordinates | null>;
type DepartmentGroup = 'Retail' | 'D2D' | 'CSR' | 'Management' | 'Other';
type AppointmentProximity = { distanceMiles: number | null; hasCoordinate: boolean };

const REFRESH_MS = 120000;
const NEW_FLASH_MS = 60000;
const CANCELLED_VISIBLE_MS = 10 * 60000;
const TIME_COLUMN_WIDTH = 70;
const HEADER_HEIGHT = 44;
const KM_TO_MILES = 0.621371;
const DEPT_TO_GROUP: Record<string, DepartmentGroup> = {
    'Retail Sales': 'Retail',
    'D2D Sales': 'D2D',
    'Administration': 'Management',
    'Manager': 'Management',
    'Lead Center': 'CSR',
};
const STATIC_GROUPS: Record<Exclude<DepartmentGroup, 'Other'>, string[]> = {
    Retail: ['Alex Tillotson', 'Bradley Crohurst', 'Christian Noren', 'Connor Hamby', 'Jonathan Marino', 'Josh Jewett', 'Justin Parker', 'London Smith', 'Niko Pagoulatos', 'Nikolas Pagoulatos', 'Orlando Chavarria', 'Richard Hadsall', 'Stephen Chaidez', 'Tanner Broadbent'],
    D2D: ['Brandon Cook', 'Brenda Ochoa', 'Carson Anderson', 'Dylan Lopez', 'Israel Silva', 'James Chernek', 'James DeCoursey', 'Jordan Depue', 'Josiah Vasquez', 'Kory Dumone', 'Michael Hurff', 'Nahum Sandoval', 'Tanner Stephens', 'Vincent Echeveste'],
    Management: ['Andrew Clark', 'Anthony Bonomo', 'John Risi', 'Travis Jones', 'Yousef Ayad'],
    CSR: ['Bronté Pisz', 'Diva Shahpur', 'Ervennica Mae Javier', 'Madi Meyers', 'Madison Meyers', 'Mariana Franco Caballos', 'Nica Javier'],
};

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

const getAppointmentAddress = (appointment: RoofrAppointment) => (appointment.masterAddress || appointment.address || '').trim();

const getShortTitle = (title: string) => {
    const trimmed = (title || '').trim();
    return trimmed.length > 70 ? `${trimmed.slice(0, 67)}...` : trimmed;
};

const getRoofrJobUrl = (jobId: string) => (
    jobId ? `https://app.roofr.com/dashboard/team/239329/jobs/list-view?selectedJobId=${jobId}` : ''
);

const normalizeRepName = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

const STATIC_NAME_GROUPS = Object.entries(STATIC_GROUPS).reduce<Record<string, DepartmentGroup>>((acc, [group, names]) => {
    names.forEach(name => {
        acc[normalizeRepName(name)] = group as DepartmentGroup;
    });
    return acc;
}, {});

const getRuntimeRepGroup = (rep: Rep): DepartmentGroup | null => {
    const runtimeRep = rep as Rep & {
        department?: string;
        dept?: string;
        departmentGroup?: string;
        group?: string;
    };
    const rawGroup = (runtimeRep.departmentGroup || runtimeRep.group || '').trim();
    if (rawGroup === 'Retail' || rawGroup === 'D2D' || rawGroup === 'CSR' || rawGroup === 'Management') return rawGroup;
    if (DEPT_TO_GROUP[rawGroup]) return DEPT_TO_GROUP[rawGroup];

    const rawDepartment = (runtimeRep.department || runtimeRep.dept || '').trim();
    return DEPT_TO_GROUP[rawDepartment] || null;
};

const getDayName = (dateKey: string) => new Date(`${dateKey}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long' });

const getFeedCoordinates = (appointment: RoofrAppointment): Coordinates | null => {
    const lat = typeof appointment.lat === 'number' ? appointment.lat : Number(appointment.lat);
    const lon = typeof appointment.lng === 'number' ? appointment.lng : Number(appointment.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lon };
};

const getAppointmentCoordinates = (appointment: RoofrAppointment, fallbackCoordinates: AppointmentCoordinateMap) => (
    getFeedCoordinates(appointment) || fallbackCoordinates[appointment.eventId] || null
);

const getDistanceMiles = (from: Coordinates, to: Coordinates) => haversineDistance(from, to) * KM_TO_MILES;

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
    const [searchInput, setSearchInput] = useState('');
    const [activeSearch, setActiveSearch] = useState<{ label: string; coordinates: Coordinates } | null>(null);
    const [searchError, setSearchError] = useState<string | null>(null);
    const [isLocating, setIsLocating] = useState(false);
    const [appointmentCoordinates, setAppointmentCoordinates] = useState<AppointmentCoordinateMap>({});
    const [showPool, setShowPool] = useState(false);
    const [poolCount, setPoolCount] = useState(0);

    const fetchAppointments = useCallback(async () => {
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

        const intervalId = window.setInterval(() => { if (!document.hidden) fetchAppointments(); }, REFRESH_MS);
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

    useEffect(() => {
        const addresses = appointments
            .filter(appointment => !getFeedCoordinates(appointment))
            .map(getAppointmentAddress)
            .filter(Boolean);

        if (addresses.length > 0) {
            void preCacheGeocodes(addresses).catch(err => console.warn('Failed to warm appointment geocodes', err));
        }
    }, [appointments]);

    const repsByName = useMemo(() => {
        const byName = new Map<string, Rep>();
        appState.reps.forEach(rep => {
            byName.set(normalizeRepName(rep.name), rep);
        });
        return byName;
    }, [appState.reps]);

    const repGroupsByName = useMemo(() => {
        const byName = new Map<string, DepartmentGroup>(Object.entries(STATIC_NAME_GROUPS));
        appState.reps.forEach(rep => {
            const runtimeGroup = getRuntimeRepGroup(rep);
            if (runtimeGroup) byName.set(normalizeRepName(rep.name), runtimeGroup);
        });
        return byName;
    }, [appState.reps]);

    const getRepGroup = useCallback((repName: string): DepartmentGroup => (
        repGroupsByName.get(normalizeRepName(repName)) || 'Other'
    ), [repGroupsByName]);

    const groupedAppointments = useMemo(() => {
        const now = Date.now();
        const byRep = new Map<string, { departmentGroup: DepartmentGroup; appointments: BoardAppointment[] }>();

        appointments.forEach(appointment => {
            const repName = getRepName(appointment);
            const departmentGroup = getRepGroup(repName);
            if (departmentGroup === 'D2D') return;

            const group = byRep.get(repName) || { departmentGroup, appointments: [] };
            group.appointments.push({
                ...appointment,
                status: 'active',
                isNew: (newEventIds[appointment.eventId] || 0) > now,
            });
            byRep.set(repName, group);
        });

        Object.values(cancelledAppointments).forEach(({ appointment, expiresAt }) => {
            if (expiresAt <= now) return;
            const repName = getRepName(appointment);
            const departmentGroup = getRepGroup(repName);
            if (departmentGroup === 'D2D') return;

            const group = byRep.get(repName) || { departmentGroup, appointments: [] };
            group.appointments.push({ ...appointment, status: 'cancelled' });
            byRep.set(repName, group);
        });

        return Array.from(byRep.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([repName, group]) => ({
                repName,
                departmentGroup: group.departmentGroup,
                appointments: group.appointments.sort((a, b) => getSortTime(a) - getSortTime(b)),
            }))
            .filter(group => group.appointments.length > 0);
    }, [appointments, cancelledAppointments, getRepGroup, newEventIds]);

    const boardAppointments = useMemo(() => (
        groupedAppointments.flatMap(group => (
            group.appointments.map(appointment => ({ appointment, repName: group.repName }))
        ))
    ), [groupedAppointments]);

    const goToDate = useCallback((newKey: string) => {
        // Reset the red/green baseline so switching days doesn't flag the new
        // day's appointments as cancelled/new on the first fetch.
        isFirstLoadRef.current = true;
        previousAppointmentsRef.current = {};
        setCancelledAppointments({});
        setNewEventIds({});
        setAppointments([]);
        setSelectedAppointment(null);
        setSearchInput('');
        setActiveSearch(null);
        setSearchError(null);
        setAppointmentCoordinates({});
        setIsLocating(false);
        setError(null);
        setIsLoading(true);
        setDateKey(newKey);
    }, []);

    const ensureMissingAppointmentCoordinates = useCallback(async () => {
        const missingAppointments = boardAppointments.filter(({ appointment }) => (
            !getFeedCoordinates(appointment) &&
            getAppointmentAddress(appointment) &&
            !(appointment.eventId in appointmentCoordinates)
        ));

        if (missingAppointments.length === 0) return;

        const results = await geocodeAddresses(missingAppointments.map(({ appointment }) => getAppointmentAddress(appointment)));
        setAppointmentCoordinates(prev => {
            const next = { ...prev };
            missingAppointments.forEach(({ appointment }, index) => {
                next[appointment.eventId] = results[index]?.coordinates || null;
            });
            return next;
        });
        // Persist freshly-geocoded coords back to the jobs table (fill_job_coords fills blanks
        // only, never overwrites) so the feed carries them next load and every consumer benefits.
        missingAppointments.forEach(({ appointment }, index) => {
            const coords = results[index]?.coordinates;
            if (coords && appointment.jobId) {
                supabase.rpc('fill_job_coords', {
                    p_job_id: String(appointment.jobId),
                    p_lat: String(coords.lat),
                    p_lng: String(coords.lon),
                }).then(({ error }) => { if (error) console.warn('fill_job_coords failed', appointment.jobId, error.message); });
            }
        });
    }, [appointmentCoordinates, boardAppointments]);

    const handleSearch = useCallback(async (event?: React.FormEvent) => {
        event?.preventDefault();
        const query = searchInput.trim();
        if (!query) return;

        setIsLocating(true);
        setSearchError(null);

        try {
            const [result] = await geocodeAddresses([query]);
            if (!result?.coordinates) {
                setActiveSearch(null);
                setSearchError("Couldn't locate that location.");
                return;
            }

            await ensureMissingAppointmentCoordinates();
            setActiveSearch({ label: query, coordinates: result.coordinates });
        } catch (err) {
            console.warn('Proximity search failed', err);
            setActiveSearch(null);
            setSearchError("Couldn't locate that location.");
        } finally {
            setIsLocating(false);
        }
    }, [ensureMissingAppointmentCoordinates, searchInput]);

    useEffect(() => {
        if (!activeSearch) return;

        let isCancelled = false;
        setIsLocating(true);
        ensureMissingAppointmentCoordinates()
            .catch(err => console.warn('Failed to resolve appointment coordinates', err))
            .finally(() => {
                if (!isCancelled) setIsLocating(false);
            });

        return () => {
            isCancelled = true;
        };
    }, [activeSearch, ensureMissingAppointmentCoordinates]);

    const clearSearch = useCallback(() => {
        setSearchInput('');
        setActiveSearch(null);
        setSearchError(null);
        setIsLocating(false);
    }, []);

    const proximityResults = useMemo(() => {
        const byAppointmentKey: Record<string, AppointmentProximity> = {};
        const closestByRep = new Map<string, { appointment: BoardAppointment; repName: string; distanceMiles: number }>();

        if (!activeSearch) return { byAppointmentKey, closestRepNames: new Set<string>(), closestAppointmentEventIds: new Set<string>(), closestReps: [] };

        boardAppointments.forEach(({ appointment, repName }) => {
            const key = `${appointment.status}-${appointment.eventId}`;
            const coordinates = getAppointmentCoordinates(appointment, appointmentCoordinates);

            if (!coordinates) {
                byAppointmentKey[key] = { distanceMiles: null, hasCoordinate: false };
                return;
            }

            const distanceMiles = getDistanceMiles(activeSearch.coordinates, coordinates);
            byAppointmentKey[key] = { distanceMiles, hasCoordinate: true };

            const currentClosest = closestByRep.get(repName);
            if (!currentClosest || distanceMiles < currentClosest.distanceMiles) {
                closestByRep.set(repName, { appointment, repName, distanceMiles });
            }
        });

        const closestReps = Array.from(closestByRep.values())
            .sort((a, b) => a.distanceMiles - b.distanceMiles)
            .slice(0, 3);
        return {
            byAppointmentKey,
            closestRepNames: new Set(closestReps.map(result => result.repName)),
            closestAppointmentEventIds: new Set(closestReps.map(result => result.appointment.eventId)),
            closestReps,
        };
    }, [activeSearch, appointmentCoordinates, boardAppointments]);

    const activeCount = boardAppointments.filter(({ appointment }) => appointment.status === 'active').length;
    const cancelledCount = boardAppointments.filter(({ appointment }) => appointment.status === 'cancelled').length;

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
                    <button
                        onClick={() => setShowPool(v => !v)}
                        className={`ml-1 px-2 py-1 text-[11px] font-bold rounded-md border transition ${
                            showPool
                                ? 'bg-brand-primary text-brand-text-on-primary border-brand-primary'
                                : 'bg-bg-primary text-text-secondary border-border-primary hover:border-brand-primary hover:text-brand-primary'
                        }`}
                        title="Future quality appointments available to pull into cancelled slots"
                    >
                        🔥 Replacements{poolCount > 0 ? ` (${poolCount})` : ''}
                    </button>
                </div>
            </div>

            <form onSubmit={handleSearch} className="flex-shrink-0 px-3 py-2 bg-bg-primary border-b border-border-secondary flex flex-wrap items-center gap-2">
                <input
                    value={searchInput}
                    onChange={event => setSearchInput(event.target.value)}
                    placeholder="Search address, city, or lat,lon"
                    className="min-w-[220px] flex-1 px-2.5 py-1.5 text-xs text-text-primary bg-bg-secondary border border-border-primary rounded-md outline-none focus:border-brand-primary"
                />
                <button
                    type="submit"
                    disabled={isLocating || !searchInput.trim()}
                    className="px-3 py-1.5 text-xs font-bold rounded-md bg-brand-primary text-brand-text-on-primary border border-brand-primary disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    Search
                </button>
                {(activeSearch || searchError) && (
                    <button
                        type="button"
                        onClick={clearSearch}
                        className="px-2.5 py-1.5 text-xs font-semibold rounded-md text-text-secondary border border-border-secondary hover:bg-bg-tertiary transition"
                    >
                        Clear
                    </button>
                )}
                {isLocating && <span className="text-[11px] text-text-tertiary">locating...</span>}
                {searchError && <span className="text-[11px] text-tag-red-text">{searchError}</span>}
                {activeSearch && !searchError && (
                    <span className="text-[11px] text-text-tertiary truncate">
                        Showing 3 closest reps to {activeSearch.label}
                    </span>
                )}
            </form>

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
                <div className="flex-1 min-h-0 flex overflow-hidden">
                    <div className="flex-1 min-w-0 overflow-auto custom-scrollbar">
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
                                    const isClosestRep = !activeSearch || proximityResults.closestRepNames.has(group.repName);

                                    return (
                                        <div
                                            key={group.repName}
                                            className={`flex flex-col border-r border-border-primary bg-bg-primary min-w-0 transition-opacity ${isFullyUnavailable ? 'opacity-60 grayscale' : ''} ${activeSearch && !isClosestRep ? 'opacity-50' : ''}`}
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
                                                    const isCsr = group.departmentGroup === 'CSR';
                                                    const position = getAppointmentPosition(appointment);
                                                    const cardClass = isCancelled
                                                        ? 'bg-tag-red-bg text-tag-red-text border-tag-red-border opacity-90'
                                                        : isNew
                                                            ? 'bg-tag-green-bg text-tag-green-text border-tag-green-border ring-2 ring-tag-green-border/60'
                                                            : 'bg-brand-bg-light text-text-primary border-brand-primary/30 hover:border-brand-primary hover:shadow-md';
                                                    const csrClass = isCsr ? 'ring-2 ring-tag-red-border' : '';
                                                    const proximity = proximityResults.byAppointmentKey[`${appointment.status}-${appointment.eventId}`];
                                                    const isDimmedBySearch = activeSearch && !isClosestRep;
                                                    const isClosestAppointment = !!activeSearch && proximityResults.closestAppointmentEventIds.has(appointment.eventId);
                                                    const closestAppointmentClass = isClosestAppointment ? 'ring-2 ring-brand-primary shadow-md' : '';

                                                    return (
                                                        <button
                                                            key={`${appointment.status}-${appointment.eventId}`}
                                                            onClick={() => !isCancelled && setSelectedAppointment({ appointment, repName: group.repName })}
                                                            disabled={isCancelled}
                                                            className={`absolute left-1 right-1 z-10 text-left rounded-md border overflow-hidden transition-all ${cardClass} ${csrClass} ${closestAppointmentClass} ${isCancelled ? 'cursor-default' : 'cursor-pointer active:scale-[0.99]'} ${isDimmedBySearch ? 'opacity-[0.35] grayscale' : ''}`}
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
                                                                    {isCsr && (
                                                                        <span className="text-[8px] font-bold uppercase tracking-wide flex-shrink-0 px-1 rounded border border-tag-red-border bg-tag-red-bg text-tag-red-text">CSR</span>
                                                                    )}
                                                                    {isClosestAppointment && (
                                                                        <span className="text-[8px] font-bold uppercase tracking-wide flex-shrink-0 px-1 rounded border border-brand-primary bg-bg-primary text-brand-primary shadow-sm">Closest</span>
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
                                                                {activeSearch && proximity && !proximity.hasCoordinate && (
                                                                    <div className="text-[8px] text-text-tertiary truncate flex-shrink-0">
                                                                        location unknown
                                                                    </div>
                                                                )}
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
                    {activeSearch && (
                        <aside className="w-72 flex-shrink-0 border-l border-border-primary bg-bg-secondary flex flex-col min-h-0">
                            <div className="px-3 py-2 border-b border-border-primary">
                                <div className="text-xs font-bold text-text-primary">3 Closest Reps</div>
                                <div className="text-[11px] text-text-tertiary truncate">
                                    {proximityResults.closestReps.length} ranked from {activeSearch.label}
                                </div>
                            </div>
                            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-2 space-y-1.5">
                                {proximityResults.closestReps.length === 0 ? (
                                    <div className="text-xs text-text-tertiary italic px-2 py-3">
                                        No reps have geocodable appointments for this day.
                                    </div>
                                ) : proximityResults.closestReps.map(({ appointment, repName, distanceMiles }) => (
                                    <button
                                        key={`nearest-${appointment.eventId}`}
                                        onClick={() => setSelectedAppointment({ appointment, repName })}
                                        className="w-full text-left rounded-md border border-brand-primary/60 bg-bg-primary hover:border-brand-primary hover:shadow-sm transition p-2"
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="text-[11px] font-bold text-text-primary truncate">{repName}</span>
                                            <span className="text-[11px] font-bold text-brand-primary flex-shrink-0">{distanceMiles.toFixed(1)} mi</span>
                                        </div>
                                        <div className="flex items-center gap-1 min-w-0">
                                            <div className="text-[10px] text-text-tertiary truncate">{formatTimeRange(appointment)}</div>
                                            <span className="text-[8px] font-bold uppercase tracking-wide flex-shrink-0 px-1 rounded border border-brand-primary bg-bg-primary text-brand-primary">Closest</span>
                                        </div>
                                        <div className="text-xs text-text-secondary truncate">{appointment.customerName || 'Unknown customer'}</div>
                                        <div className="text-[10px] text-text-tertiary truncate">{getShortAddress(appointment)}</div>
                                    </button>
                                ))}
                            </div>
                        </aside>
                    )}
                </div>
            )}

            <AppointmentDetailModal
                appointment={selectedAppointment?.appointment || null}
                repName={selectedAppointment?.repName || ''}
                onClose={() => setSelectedAppointment(null)}
            />

            <ReplacementPool
                open={showPool}
                onClose={() => setShowPool(false)}
                onCountChange={setPoolCount}
            />
        </div>
    );
};

export default TodayBoard;
