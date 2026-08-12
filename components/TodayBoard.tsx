import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { COMPANY_ROSTER_DATA_RANGE, COMPANY_ROSTER_SHEET_TITLE, COMPANY_ROSTER_SPREADSHEET_ID, DAY_VIEW_CELL_HEIGHT, DAY_VIEW_END_HOUR, DAY_VIEW_START_HOUR } from '../constants';
import { DAY_VIEW_SLOTS, mapMinutesToSlotId } from './DayView/dayViewUtils';
import { ChevronLeftIcon, ChevronRightIcon, ErrorIcon, ExternalLinkIcon, LoadingIcon, RefreshIcon, XIcon } from './icons';
import { useAppContext } from '../context/AppContext';
import { CTRL_BTN, SEG_WRAP, SEG_BTN, SEG_ON, SEG_OFF } from './ui';
import type { AppState, Rep, TimeSlot } from '../types';
import { getEffectiveUnavailableSlots, isCommercialOnlyRep, isLondon } from '../utils/repUtils';
import { normalizeName, fetchTimeSlotsForDate } from '../services/googleSheetsService';
import { geocodeAddresses, preCacheGeocodes, type Coordinates } from '../services/osmService';
import { haversineDistance, NORTHERN_AZ_CITIES, FLAGSTAFF_ZONE_CITIES, I17_CORRIDOR_CITIES, SR87_CORRIDOR_CITIES, SOUTHERN_AZ_CITIES } from '../services/geography';
import { supabase } from '../services/supabaseClient';
import ReplacementPool, { type PoolAnchor } from './ReplacementPool';
import { parseTimeSlotWindow } from '../utils/timeSlotUtils';

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
    city?: string;
    jobOwner: string;
    workflow: string;
    tags: string;
    phone?: string;
    email?: string;
    leadSource?: string;
    bookingCsr?: string;
    lat?: number | null;
    lng?: number | null;
    kind?: 'sales' | 'self_gen' | 'followup' | 'adjuster';
    eventSubtype?: string;
    pinned?: boolean;
}

type BoardAppointment = RoofrAppointment & {
    status: 'active' | 'cancelled';
    isNew?: boolean;
    // Set only on the mirrored copy shown in the CSR rail when a job is still
    // CSR-owned but a different rep is tagged on the calendar event. Holds that
    // rep's name. A mirror is a pointer to a card that already exists on the
    // rep's column — never a booking, and never counted as one.
    mirrorFor?: string;
};

type AppointmentCoordinateMap = Record<string, Coordinates | null>;
type DepartmentGroup = 'Retail' | 'D2D' | 'CSR' | 'Management' | 'Other';
type AppointmentProximity = { distanceMiles: number | null; hasCoordinate: boolean };
// A nearby-rep hit. `appointment` is the rep's closest stop today; when it's null the
// rep has nothing booked and was ranked from their home zip instead.
type ClosestRep = {
    repName: string;
    distanceMiles: number;
    appointment: BoardAppointment | null;
    homeZip?: string;
};

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
    CSR: ['Bronté Pisz', 'Diva Shahpur', 'Ervennica Mae Javier', 'Madi Meyers', 'Madison Meyers', 'Mariana Franco', 'Mariana Franco Caballos', 'Nica Javier'],
};

const todayKey = () => {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
};

// The board's date + Live/Tentative view live in the URL (?date=YYYY-MM-DD&view=live|tentative)
// so a specific day/view is linkable and survives a refresh.
type BoardView = 'live' | 'tentative';
const readBoardUrlState = (): { date: string | null; view: BoardView | null } => {
    if (typeof window === 'undefined') return { date: null, view: null };
    const params = new URLSearchParams(window.location.search);
    const rawDate = params.get('date');
    const rawView = params.get('view');
    return {
        date: rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null,
        view: rawView === 'live' || rawView === 'tentative' ? rawView : null,
    };
};

const parseLocalDate = (value: string) => new Date(value.replace(' ', 'T'));

const getTentativeSlotStart = (label: string, slotIndex: number) => {
    const match = label.match(/^\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
    if (match) {
        let hour = Number(match[1]);
        const minute = Number(match[2] || 0);
        const period = match[3].toLowerCase();
        if (hour >= 1 && hour <= 12 && minute < 60) {
            if (period === 'pm' && hour < 12) hour += 12;
            if (period === 'am' && hour === 12) hour = 0;
            return { hour, minute };
        }
    }
    return { hour: 8 + slotIndex * 3, minute: 0 };
};

const buildTentativeAppointments = (dateKey: string, appState: AppState | undefined): BoardAppointment[] => (
    appState?.reps.flatMap(rep => rep.schedule.flatMap((slot, slotIndex) => {
        const { hour, minute } = getTentativeSlotStart(slot.label, slotIndex);
        const startDate = new Date(`${dateKey}T00:00:00`);
        startDate.setHours(hour, minute, 0, 0);
        const endDate = new Date(startDate);
        endDate.setHours(endDate.getHours() + 2);
        const toLocalDateTime = (date: Date) => `${dateKey} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

        return slot.jobs.map(job => ({
            eventId: `tentative-${rep.id}-${slot.id}-${job.id}`,
            jobId: job.id,
            address: job.address,
            title: job.customerName || job.address || '',
            start: toLocalDateTime(startDate),
            end: toLocalDateTime(endDate),
            allDay: false,
            category: '',
            attendees: rep.name,
            customerName: job.customerName,
            masterAddress: job.address,
            city: job.city,
            jobOwner: rep.name,
            workflow: '',
            tags: '',
            lat: job.lat ?? null,
            lng: job.lng ?? null,
            kind: job.pinnedKind ?? 'sales',
            eventSubtype: job.eventSubtype,
            pinned: !!job.pinnedKind,
            status: 'active',
            isNew: false,
        }));
    })) || []
);

const dateToKey = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
};

const countAssignedJobs = (appState: AppState | undefined): number =>
    appState?.reps.reduce((sum, rep) => sum + rep.schedule.reduce((slotSum, slot) => slotSum + slot.jobs.length, 0), 0) ?? 0;

// ── Region sectioning ────────────────────────────────────────────────────────
// Reps are grouped left→right: Phoenix (main) | Tucson | Up North, by where their
// appointments actually are that day (city match against the geography sets).
type BoardRegion = 'PHX' | 'SOUTH' | 'NORTH';
const REGION_ORDER: Record<BoardRegion, number> = { PHX: 0, SOUTH: 1, NORTH: 2 };
const REGION_LABEL: Record<BoardRegion, string> = { PHX: '', SOUTH: 'Tucson', NORTH: 'Up North' };
const REGION_TINT: Record<BoardRegion, string> = { PHX: '', SOUTH: 'rgba(245, 158, 11, 0.08)', NORTH: 'rgba(59, 130, 246, 0.09)' };
const REGION_BADGE: Record<BoardRegion, string> = {
    PHX: '',
    SOUTH: 'bg-amber-500/15 text-amber-600 border border-amber-500/40',
    NORTH: 'bg-blue-500/15 text-blue-500 border border-blue-500/40',
};
const REGION_LABEL_COLOR: Record<BoardRegion, string> = { PHX: '', SOUTH: 'rgb(217, 119, 6)', NORTH: 'rgb(37, 99, 235)' };

// Left rail: CSR (unassigned bookings) and Management/owners aren't bookable sales
// columns, so they pull to the far left, region-neutral, each with its own label bar.
// Ordered CSR then Management, ahead of the geographic (Phoenix/Tucson/Up North) sections.
type LeftSection = 'CSR' | 'MGMT';
const leftSectionOf = (group: DepartmentGroup): LeftSection | null => (
    group === 'CSR' ? 'CSR' : group === 'Management' ? 'MGMT' : null
);
const LEFT_SECTION_ORDER: Record<LeftSection, number> = { CSR: 0, MGMT: 1 };
const LEFT_SECTION_LABEL: Record<LeftSection, string> = { CSR: 'CSR', MGMT: 'MGMT' };
const LEFT_SECTION_BAR_BG: Record<LeftSection, string> = { CSR: 'rgba(239, 68, 68, 0.10)', MGMT: 'rgba(100, 116, 139, 0.14)' };
const LEFT_SECTION_BAR_COLOR: Record<LeftSection, string> = { CSR: 'rgb(220, 38, 38)', MGMT: 'rgb(71, 85, 105)' };
const LEFT_SECTION_TINT: Record<LeftSection, string> = { CSR: 'rgba(239, 68, 68, 0.05)', MGMT: 'rgba(100, 116, 139, 0.07)' };
const LEFT_SECTION_TITLE: Record<LeftSection, string> = {
    CSR: 'Jobs still owned by a CSR — pending assignment to a rep',
    MGMT: 'Management / owners — shown for visibility, not offered for gap-fill',
};

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const buildCityRegex = (cities: Iterable<string>) => {
    const list = Array.from(new Set(Array.from(cities)))
        .sort((a, b) => b.length - a.length) // longest first so "south tucson" wins over "tucson"
        .map(escapeRegExp);
    return new RegExp(`(^|[\\s,])(${list.join('|')})([\\s,.]|$)`, 'i');
};
const NORTH_CITY_RE = buildCityRegex([...NORTHERN_AZ_CITIES, ...FLAGSTAFF_ZONE_CITIES, ...I17_CORRIDOR_CITIES, ...SR87_CORRIDOR_CITIES]);
const SOUTH_CITY_RE = buildCityRegex(SOUTHERN_AZ_CITIES);

// Classify one appointment. Matches only the address tail (city/state/zip), never
// the street part, so a street named e.g. "Globe Ave" doesn't read as Tucson.
const getAppointmentRegion = (appt: RoofrAppointment): BoardRegion => {
    const parts = (appt.address || appt.masterAddress || '').split(',').map(s => s.trim()).filter(Boolean);
    const tail = parts.length > 1 ? parts.slice(1).join(', ') : '';
    const text = `${appt.city || ''}, ${tail}`;
    if (NORTH_CITY_RE.test(text)) return 'NORTH';
    if (SOUTH_CITY_RE.test(text)) return 'SOUTH';
    return 'PHX';
};

// A rep's column region: any North stop wins, else any Tucson stop, else Phoenix.
const getRepColumnRegion = (appts: RoofrAppointment[]): BoardRegion => {
    let hasSouth = false;
    for (const appt of appts) {
        const region = getAppointmentRegion(appt);
        if (region === 'NORTH') return 'NORTH';
        if (region === 'SOUTH') hasSouth = true;
    }
    return hasSouth ? 'SOUTH' : 'PHX';
};

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

// ── Gap filling ────────────────────────────────────────────────────────────────
// The 4 standard booking windows. A rep "hole" = a window they have no appointment
// in and aren't marked off for. Clicking the green OPEN block opens the Replacement
// Pool anchored on the rep's nearest existing stop, so the closest future
// appointments to that route surface first to pull forward. Window ids align 1:1
// with the sheet's availability slots (ts-1..ts-4 = TIME_SLOTS), so availability is
// checked directly by id.
type FillWindow = { id: string; label: string; startMin: number; endMin: number };
const REGULAR_FILL_WINDOWS: FillWindow[] = [
    { id: 'ts-1', label: '8–11', startMin: 8 * 60, endMin: 11 * 60 },
    { id: 'ts-2', label: '11–1', startMin: 11 * 60, endMin: 13 * 60 },
    { id: 'ts-3', label: '2–5', startMin: 14 * 60, endMin: 17 * 60 },
    { id: 'ts-4', label: '5–8', startMin: 17 * 60, endMin: 20 * 60 },
];

const getFillWindows = (timeSlots: TimeSlot[]): FillWindow[] => {
    if (timeSlots.length === 4) return REGULAR_FILL_WINDOWS;
    return timeSlots.flatMap(slot => {
        const window = parseTimeSlotWindow(slot.label);
        return window ? [{ id: slot.id, label: slot.label, startMin: window.start, endMin: window.end }] : [];
    });
};

const appointmentOverlapsWindow = (appointment: BoardAppointment, win: FillWindow) => {
    const start = getAppointmentMinutes(appointment.start);
    if (start === null) return false;
    const end = getAppointmentMinutes(appointment.end) ?? start + 120;
    return start < win.endMin && end > win.startMin;
};

// The stop to route the gap search from: the active appointment ending just before
// the window, else the one starting just after (appointments arrive sorted by start).
const getGapAnchorAppointment = (appointments: BoardAppointment[], win: FillWindow): BoardAppointment | null => {
    const actives = appointments.filter(appt => appt.status === 'active');
    let before: BoardAppointment | null = null;
    let after: BoardAppointment | null = null;
    for (const appt of actives) {
        const start = getAppointmentMinutes(appt.start);
        if (start === null) continue;
        const end = getAppointmentMinutes(appt.end) ?? start + 120;
        if (end <= win.startMin) before = appt;                 // sorted → last match = closest before
        else if (start >= win.endMin && !after) after = appt;   // first match after = closest after
    }
    return before || after || actives[0] || null;
};

// Lay out a column's appointments in side-by-side lanes when they overlap in
// time, so double-booked cards don't stack invisibly on top of each other.
const layoutAppointments = (appointments: BoardAppointment[]) => {
    type Laid = { appointment: BoardAppointment; lane: number; lanes: number };
    const sorted = [...appointments].sort((a, b) => getSortTime(a) - getSortTime(b));
    const results: Laid[] = [];
    let cluster: { appointment: BoardAppointment; lane: number; end: number }[] = [];
    let clusterMaxEnd = -1;

    const flush = () => {
        if (!cluster.length) return;
        const lanes = Math.max(...cluster.map(c => c.lane)) + 1;
        cluster.forEach(c => results.push({ appointment: c.appointment, lane: c.lane, lanes }));
        cluster = [];
        clusterMaxEnd = -1;
    };

    sorted.forEach(appointment => {
        const start = getAppointmentMinutes(appointment.start) ?? DAY_VIEW_START_HOUR * 60;
        const end = Math.max(getAppointmentMinutes(appointment.end) ?? start + 60, start + 30);
        if (cluster.length && start >= clusterMaxEnd) flush();
        const usedLanes = new Set(cluster.filter(c => c.end > start).map(c => c.lane));
        let lane = 0;
        while (usedLanes.has(lane)) lane++;
        cluster.push({ appointment, lane, end });
        clusterMaxEnd = Math.max(clusterMaxEnd, end);
    });
    flush();
    return results;
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

// Roles that shouldn't be offered gap-fill even when their department is a sales dept
// (e.g. "Retail Sales Manager" — a manager who occasionally runs appts but isn't a
// bookable rep). Detected by title so it generalizes; no hardcoded names.
const MANAGER_ROLE_RE = /\b(manager|owner|ceo|cfo|coo|president|director|vp)\b/i;

// Pull department classification straight from the Company Team Roster (Active
// Roster tab) so the board's rep/CSR grouping stays current without code edits.
// Department column maps to a group via DEPT_TO_GROUP; 'Lead Center' = CSR. Also
// collects manager/owner names (by role title) to exclude from gap-fill.
// Falls back to the STATIC_GROUPS lists above if the sheet is unreachable.
const fetchRosterInfo = async (): Promise<{ groups: Record<string, DepartmentGroup>; managers: string[] }> => {
    const range = `'${COMPANY_ROSTER_SHEET_TITLE}'!${COMPANY_ROSTER_DATA_RANGE}`;
    const url = `/api/sheets?spreadsheetId=${COMPANY_ROSTER_SPREADSHEET_ID}&range=${encodeURIComponent(range)}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Roster sheet returned ${response.status}`);
    const data = await response.json();
    const rows: string[][] = Array.isArray(data.values) ? data.values : [];
    const groups: Record<string, DepartmentGroup> = {};
    const managers: string[] = [];
    rows.forEach(row => {
        const dept = String(row?.[0] || '').trim();   // col B: Department
        const role = String(row?.[1] || '').trim();   // col C: Role / Title
        const name = String(row?.[2] || '').trim();   // col D: Name
        // A "CSR" in the role title sits with the CSRs regardless of department — e.g.
        // the CSR/Lead Manager, who runs bookings like a CSR rather than a sales rep.
        const group = /\bcsr\b/i.test(role) ? 'CSR' : DEPT_TO_GROUP[dept];
        if (name && group) groups[normalizeRepName(name)] = group;
        if (name && MANAGER_ROLE_RE.test(role)) managers.push(normalizeRepName(name));
    });
    return { groups, managers };
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
    onFindReplacements: (appointment: BoardAppointment) => void;
}> = ({ appointment, repName, onClose, onFindReplacements }) => {
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
                    <button
                        onClick={() => onFindReplacements(appointment)}
                        title="Open the replacement pool sorted by distance from this appointment"
                        className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-bold rounded-md border bg-brand-primary text-brand-text-on-primary border-brand-primary hover:bg-brand-secondary shadow-sm transition-all mr-auto"
                    >
                        🔥 Find Replacements
                    </button>
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
    const { appState, getAppStateForDay, selectedDate, activeDayKeys } = useAppContext();
    const [dateKey, setDateKey] = useState(() => readBoardUrlState().date || todayKey());
    const [dataSource, setDataSource] = useState<BoardView>(() => readBoardUrlState().view || 'live');
    // Days (in the workspace) that actually have tentative assignments — used to
    // auto-jump to the planned day on toggle and to guide the empty state.
    const tentativeDaysWithPlans = useMemo(
        () => (activeDayKeys || []).filter(k => countAssignedJobs(getAppStateForDay(k)) > 0),
        [activeDayKeys, getAppStateForDay],
    );
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
    const [repHomeCoordinates, setRepHomeCoordinates] = useState<Record<string, Coordinates | null>>({});
    const [showPool, setShowPool] = useState(false);
    const [poolCount, setPoolCount] = useState(0);
    const [poolAnchor, setPoolAnchor] = useState<PoolAnchor | null>(null);
    const [rosterGroups, setRosterGroups] = useState<Record<string, DepartmentGroup>>({});
    const [rosterManagers, setRosterManagers] = useState<Set<string>>(new Set());

    // Load the live department roster once so CSR/rep classification + manager
    // (non-bookable) detection stay current without code edits.
    useEffect(() => {
        let cancelled = false;
        fetchRosterInfo()
            .then(({ groups, managers }) => {
                if (cancelled) return;
                if (Object.keys(groups).length) setRosterGroups(groups);
                if (managers.length) setRosterManagers(new Set(managers));
            })
            .catch(err => console.warn('Failed to load company roster info', err));
        return () => { cancelled = true; };
    }, []);

    // Open-slot reservations: who I am (for reserving/releasing) + active holds keyed
    // by `${normalizedRep}__${windowId}`, polled fast so a 2nd booker sees it quickly.
    const [reserverName, setReserverName] = useState<string>(() => localStorage.getItem('todayBoardReserver') || '');
    const [slotHolds, setSlotHolds] = useState<Record<string, { reservedBy: string; reservedAt: string }>>({});
    const holdKey = (repName: string, windowId: string) => `${normalizeRepName(repName)}__${windowId}`;

    const setReserverPersisted = useCallback((name: string) => {
        setReserverName(name);
        localStorage.setItem('todayBoardReserver', name);
    }, []);

    const fetchSlotHolds = useCallback(async () => {
        try {
            const { data, error } = await supabase.rpc('get_open_slot_holds', { p_date: dateKey });
            if (error) return;
            const map: Record<string, { reservedBy: string; reservedAt: string }> = {};
            (data || []).forEach((h: { rep_name: string; window_id: string; reserved_by: string; reserved_at: string }) => {
                map[holdKey(h.rep_name, h.window_id)] = { reservedBy: h.reserved_by, reservedAt: h.reserved_at };
            });
            setSlotHolds(map);
        } catch { /* transient — keep last-good holds */ }
    }, [dateKey]);

    useEffect(() => {
        fetchSlotHolds();
        const id = window.setInterval(() => { if (!document.hidden) fetchSlotHolds(); }, 5000);
        const onVis = () => { if (!document.hidden) fetchSlotHolds(); };
        document.addEventListener('visibilitychange', onVis);
        return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
    }, [fetchSlotHolds]);

    const handleReserveSlot = useCallback(async (repName: string, windowId: string) => {
        let who = reserverName;
        if (!who) {
            who = (window.prompt('Your name (so the reservation shows who has it):') || '').trim();
            if (!who) return;
            setReserverPersisted(who);
        }
        const key = holdKey(repName, windowId);
        setSlotHolds(prev => ({ ...prev, [key]: { reservedBy: who, reservedAt: new Date().toISOString() } })); // optimistic
        try {
            const { data, error } = await supabase.rpc('reserve_open_slot', {
                p_rep_name: repName, p_date: dateKey, p_window_id: windowId, p_reserved_by: who,
            });
            if (error) throw new Error(error.message);
            // Lost the race -> reflect whoever actually holds it.
            if (data && !data.ok && data.reserved_by) {
                setSlotHolds(prev => ({ ...prev, [key]: { reservedBy: data.reserved_by, reservedAt: data.reserved_at || new Date().toISOString() } }));
            }
        } catch (err) {
            console.warn('reserve failed', err);
        } finally {
            fetchSlotHolds();
        }
    }, [reserverName, dateKey, setReserverPersisted, fetchSlotHolds]);

    const handleReleaseSlot = useCallback(async (repName: string, windowId: string) => {
        const key = holdKey(repName, windowId);
        setSlotHolds(prev => { const next = { ...prev }; delete next[key]; return next; }); // optimistic
        try {
            await supabase.rpc('release_open_slot', {
                p_rep_name: repName, p_date: dateKey, p_window_id: windowId, p_reserved_by: reserverName || null,
            });
        } catch (err) {
            console.warn('release failed', err);
        } finally {
            fetchSlotHolds();
        }
    }, [dateKey, reserverName, fetchSlotHolds]);

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
        if (dataSource !== 'live') {
            setAppointments(buildTentativeAppointments(dateKey, getAppStateForDay(dateKey)));
            setCancelledAppointments({});
            setNewEventIds({});
            setIsLoading(false);
            setIsRefreshing(false);
            setError(null);
            setSource('');
            return;
        }
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
    }, [dataSource, dateKey, fetchAppointments, getAppStateForDay]);

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

    // The board's date can be a different WEEK than the day loaded in the planner
    // (storm weeks run 5 slots while today runs 4). Resolve the slot layout for the
    // board's own date: from that day's workspace state if it's loaded, else a
    // lightweight sheet lookup. Falls back to the planner's layout meanwhile.
    const [boardDateTimeSlots, setBoardDateTimeSlots] = useState<TimeSlot[] | null>(null);
    useEffect(() => {
        let cancelled = false;
        const dayState = getAppStateForDay(dateKey);
        if (dayState?.timeSlots?.length) {
            setBoardDateTimeSlots(dayState.timeSlots);
            return;
        }
        setBoardDateTimeSlots(null);
        fetchTimeSlotsForDate(new Date(`${dateKey}T12:00:00`))
            .then(slots => { if (!cancelled) setBoardDateTimeSlots(slots); })
            .catch(() => { /* keep planner layout */ });
        return () => { cancelled = true; };
    }, [dateKey, getAppStateForDay]);
    const boardSlots = boardDateTimeSlots || appState.timeSlots;

    const fillWindows = useMemo(() => getFillWindows(boardSlots), [boardSlots]);

    const repsByName = useMemo(() => {
        const byName = new Map<string, Rep>();
        appState.reps.forEach(rep => {
            byName.set(normalizeRepName(rep.name), rep);
        });
        return byName;
    }, [appState.reps]);

    // Nickname-tolerant fallback index (Will↔William, Chris↔Christopher, …): the Roofr
    // feed and the availability sheet often spell the same rep differently, so a rep
    // matched loosely here still gets their real availability applied. normalizeName
    // maps nicknames and keys by first+last.
    const repsByLooseName = useMemo(() => {
        const byLoose = new Map<string, Rep>();
        appState.reps.forEach(rep => {
            const key = normalizeName(rep.name);
            if (key && !byLoose.has(key)) byLoose.set(key, rep);
        });
        return byLoose;
    }, [appState.reps]);

    const repGroupsByName = useMemo(() => {
        const byName = new Map<string, DepartmentGroup>(Object.entries(STATIC_NAME_GROUPS));
        // Live roster overrides the static fallback so classification stays current.
        Object.entries(rosterGroups).forEach(([name, group]) => byName.set(name, group));
        appState.reps.forEach(rep => {
            const runtimeGroup = getRuntimeRepGroup(rep);
            if (runtimeGroup) byName.set(normalizeRepName(rep.name), runtimeGroup);
        });
        return byName;
    }, [appState.reps, rosterGroups]);

    const getRepGroup = useCallback((repName: string): DepartmentGroup => (
        repGroupsByName.get(normalizeRepName(repName)) || 'Other'
    ), [repGroupsByName]);

    const groupedAppointments = useMemo(() => {
        const now = Date.now();
        const byRep = new Map<string, { departmentGroup: DepartmentGroup; appointments: BoardAppointment[] }>();

        appointments.forEach(appointment => {
            const repName = getRepName(appointment);
            const departmentGroup = getRepGroup(repName);
            // Live board hides D2D reps (door-knock events clutter it). Tentative view
            // is the user's own deliberate plan, so show every rep they assigned to.
            if (dataSource !== 'tentative' && departmentGroup === 'D2D') return;

            const group = byRep.get(repName) || { departmentGroup, appointments: [] };
            group.appointments.push({
                ...appointment,
                status: 'active',
                isNew: (newEventIds[appointment.eventId] || 0) > now,
            });
            byRep.set(repName, group);

            // Mismatch: a rep is tagged on the event, but the job is still owned by a
            // CSR. The booking belongs on the rep's column (that's who is driving out,
            // and hiding it there would leave their slot advertised as open). Mirror a
            // pointer into the CSR's column so the pending reassignment stays on their
            // worklist instead of disappearing.
            const ownerName = (appointment.jobOwner || '').trim();
            if (!ownerName) return;
            if (getRepGroup(ownerName) !== 'CSR') return;
            if (normalizeRepName(ownerName) === normalizeRepName(repName)) return;

            const ownerGroup = byRep.get(ownerName) || { departmentGroup: 'CSR' as DepartmentGroup, appointments: [] };
            ownerGroup.appointments.push({
                ...appointment,
                status: 'active',
                isNew: false,
                mirrorFor: repName,
            });
            byRep.set(ownerName, ownerGroup);
        });

        Object.values(cancelledAppointments).forEach(({ appointment, expiresAt }) => {
            if (expiresAt <= now) return;
            const repName = getRepName(appointment);
            const departmentGroup = getRepGroup(repName);
            // Live board hides D2D reps (door-knock events clutter it). Tentative view
            // is the user's own deliberate plan, so show every rep they assigned to.
            if (dataSource !== 'tentative' && departmentGroup === 'D2D') return;

            const group = byRep.get(repName) || { departmentGroup, appointments: [] };
            group.appointments.push({ ...appointment, status: 'cancelled' });
            byRep.set(repName, group);
        });

        const feedGroups = Array.from(byRep.entries())
            .map(([repName, group]) => {
                const appointments = group.appointments.sort((a, b) => getSortTime(a) - getSortTime(b));
                const leftSection = leftSectionOf(group.departmentGroup);
                return {
                    repName,
                    departmentGroup: group.departmentGroup,
                    leftSection,
                    // CSR + Management columns aren't region-bound sales routes — keep them
                    // region-neutral so the Tucson/Up North sections stay clean, and pull
                    // them to the far left instead.
                    region: (leftSection ? 'PHX' : getRepColumnRegion(appointments)) as BoardRegion,
                    appointments,
                };
            })
            .filter(group => group.appointments.length > 0);

        // Live board: also surface available sales reps who have NO bookings today
        // (e.g. Orlando) as empty columns, so their open slots show and can be
        // reserved/filled. Skip anyone already a column (nickname-aware), off all day,
        // or not a bookable rep (CSR/Management/D2D/manager-by-role).
        const present = new Set<string>();
        feedGroups.forEach(g => { present.add(normalizeRepName(g.repName)); present.add(normalizeName(g.repName)); });
        const emptyRepGroups = dataSource === 'live'
            ? appState.reps
                .filter(rep => {
                    const norm = normalizeRepName(rep.name);
                    if (present.has(norm) || present.has(normalizeName(rep.name))) return false;
                    const grp = getRepGroup(rep.name);
                    if (grp === 'CSR' || grp === 'Management' || grp === 'D2D') return false;
                    if (rosterManagers.has(norm)) return false;
                    // Commercial reps aren't gap-fill candidates — their open time
                    // is not bookable residential capacity.
                    if (rep.region === 'COMMERCIAL' || isLondon(rep)) return false;
                    if (getEffectiveUnavailableSlots(rep, dayName).length >= fillWindows.length) return false;
                    return true;
                })
                .map(rep => ({
                    repName: rep.name,
                    departmentGroup: getRepGroup(rep.name),
                    leftSection: null as LeftSection | null,
                    region: (rep.region === 'NORTH' || rep.region === 'SOUTH' ? rep.region : 'PHX') as BoardRegion,
                    appointments: [] as BoardAppointment[],
                }))
            : [];

        return [...feedGroups, ...emptyRepGroups]
            // Left rail (CSR, then Management), then Phoenix (main), Tucson, Up North;
            // alphabetical within each section.
            .sort((a, b) => {
                const aLeft = a.leftSection ? LEFT_SECTION_ORDER[a.leftSection] : 99;
                const bLeft = b.leftSection ? LEFT_SECTION_ORDER[b.leftSection] : 99;
                return (aLeft - bLeft)
                    || (REGION_ORDER[a.region] - REGION_ORDER[b.region])
                    || a.repName.localeCompare(b.repName);
            });
    }, [appointments, cancelledAppointments, getRepGroup, newEventIds, dataSource, appState.reps, dayName, rosterManagers, fillWindows.length]);

    // The day's real bookings, one row each. Mirrors are deliberately excluded: they
    // point at a card that already appears on the rep's column, so counting them again
    // would inflate the active total, flag the job as double-booked against itself, and
    // re-geocode the same address. Rendering still reads groupedAppointments, so the
    // mirrored card is drawn — it just isn't counted anywhere.
    const boardAppointments = useMemo(() => (
        groupedAppointments.flatMap(group => (
            group.appointments
                .filter(appointment => !appointment.mirrorFor)
                .map(appointment => ({ appointment, repName: group.repName }))
        ))
    ), [groupedAppointments]);

    // Bookable reps with NOTHING on the board today. They have no stop to measure from,
    // so a proximity search would never surface them even when they're the closest option
    // available — rank them off their home zip instead. Same eligibility rule as the
    // empty-column list above (no CSR/Management/D2D, no managers, no commercial, not off).
    const freeRepCandidates = useMemo(() => {
        // A day that's already over has no bookable capacity, so nobody is "open" on it.
        // fillWindows keeps the day's configured slots regardless of date — only the
        // render-time nowCutoffMinutes hides passed windows — so gate on the date here.
        if (dateKey < todayKey()) return [];

        const booked = new Set<string>();
        boardAppointments.forEach(({ repName }) => {
            booked.add(normalizeRepName(repName));
            booked.add(normalizeName(repName));
        });
        return appState.reps.filter(rep => {
            const norm = normalizeRepName(rep.name);
            if (booked.has(norm) || booked.has(normalizeName(rep.name))) return false;
            const grp = getRepGroup(rep.name);
            if (grp === 'CSR' || grp === 'Management' || grp === 'D2D') return false;
            if (rosterManagers.has(norm)) return false;
            if (isCommercialOnlyRep(rep)) return false;
            if (getEffectiveUnavailableSlots(rep, dayName).length >= fillWindows.length) return false;
            return !!rep.zipCodes?.[0];
        });
    }, [appState.reps, boardAppointments, getRepGroup, rosterManagers, dayName, dateKey, fillWindows.length]);

    // Double bookings: same rep with overlapping active appointments, or the same
    // job carrying two active events today (e.g. moved up without deleting the old one).
    const doubleBookedIds = useMemo(() => {
        const ids = new Set<string>();
        groupedAppointments.forEach(group => {
            // Mirrors sit in the CSR column purely for visibility — several unrelated
            // ones can overlap there without anyone being double-booked.
            const active = group.appointments.filter(a => a.status === 'active' && !a.mirrorFor);
            for (let i = 0; i < active.length; i++) {
                for (let j = i + 1; j < active.length; j++) {
                    const aStart = getAppointmentMinutes(active[i].start);
                    const bStart = getAppointmentMinutes(active[j].start);
                    if (aStart === null || bStart === null) continue;
                    const aEnd = getAppointmentMinutes(active[i].end) ?? aStart + 60;
                    const bEnd = getAppointmentMinutes(active[j].end) ?? bStart + 60;
                    if (aStart < bEnd && bStart < aEnd) {
                        ids.add(active[i].eventId);
                        ids.add(active[j].eventId);
                    }
                }
            }
        });
        const eventsByJob = new Map<string, Set<string>>();
        boardAppointments.forEach(({ appointment }) => {
            if (appointment.status !== 'active' || !appointment.jobId) return;
            const key = String(appointment.jobId);
            const set = eventsByJob.get(key) || new Set<string>();
            set.add(appointment.eventId);
            eventsByJob.set(key, set);
        });
        eventsByJob.forEach(set => {
            if (set.size > 1) set.forEach(eventId => ids.add(eventId));
        });
        return ids;
    }, [groupedAppointments, boardAppointments]);

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

    // Keep the URL in step with the day + view being shown so the address bar is
    // always a shareable link to exactly this board (replace, not push, so the
    // arrows/toggle don't bury the Back button under one entry per click).
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        params.set('date', dateKey);
        params.set('view', dataSource);
        const url = `${window.location.pathname}?${params.toString()}`;
        if (url !== `${window.location.pathname}${window.location.search}`) {
            window.history.replaceState(window.history.state, '', url);
        }
    }, [dateKey, dataSource]);

    // Back/forward into a board URL (e.g. from the planner) should re-read it.
    useEffect(() => {
        const syncFromUrl = () => {
            const { date, view } = readBoardUrlState();
            if (date && date !== dateKey) goToDate(date);
            if (view && view !== dataSource) setDataSource(view);
        };
        window.addEventListener('popstate', syncFromUrl);
        return () => window.removeEventListener('popstate', syncFromUrl);
    }, [dateKey, dataSource, goToDate]);

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

    // Geocode home zips for the free reps, same convention the planner uses ("<zip>, Arizona, USA").
    const ensureRepHomeCoordinates = useCallback(async () => {
        const missing = freeRepCandidates.filter(rep => !(rep.name in repHomeCoordinates));
        if (missing.length === 0) return;

        const results = await geocodeAddresses(missing.map(rep => `${rep.zipCodes![0]}, Arizona, USA`));
        setRepHomeCoordinates(prev => {
            const next = { ...prev };
            missing.forEach((rep, index) => {
                next[rep.name] = results[index]?.coordinates || null;
            });
            return next;
        });
    }, [freeRepCandidates, repHomeCoordinates]);

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
        Promise.all([
            ensureMissingAppointmentCoordinates()
                .catch(err => console.warn('Failed to resolve appointment coordinates', err)),
            ensureRepHomeCoordinates()
                .catch(err => console.warn('Failed to resolve rep home coordinates', err)),
        ])
            .finally(() => {
                if (!isCancelled) setIsLocating(false);
            });

        return () => {
            isCancelled = true;
        };
    }, [activeSearch, ensureMissingAppointmentCoordinates, ensureRepHomeCoordinates]);

    const handleFindReplacements = useCallback(async (appointment: BoardAppointment) => {
        setSelectedAppointment(null);
        setShowPool(true);
        const address = getAppointmentAddress(appointment);
        let coords = getAppointmentCoordinates(appointment, appointmentCoordinates);
        if (!coords && address) {
            try {
                const [result] = await geocodeAddresses([address]);
                coords = result?.coordinates || null;
            } catch (err) {
                console.warn('Failed to geocode replacement anchor', err);
                coords = null;
            }
        }
        // No coordinates -> pool still opens, just in default quality order.
        setPoolAnchor(coords ? { label: getShortAddress(appointment), coordinates: coords } : null);
    }, [appointmentCoordinates]);

    // Click an empty green window -> open the Replacement Pool anchored on the rep's
    // nearest existing stop, so the closest future appointments to fill the hole win.
    const handleFillGap = useCallback(async (anchorAppointment: BoardAppointment | null, windowLabel: string) => {
        setSelectedAppointment(null);
        setShowPool(true);
        if (!anchorAppointment) { setPoolAnchor(null); return; }
        const address = getAppointmentAddress(anchorAppointment);
        let coords = getAppointmentCoordinates(anchorAppointment, appointmentCoordinates);
        if (!coords && address) {
            try {
                const [result] = await geocodeAddresses([address]);
                coords = result?.coordinates || null;
            } catch (err) {
                console.warn('Failed to geocode gap anchor', err);
                coords = null;
            }
        }
        // No coordinates -> pool still opens in quality order (no nearby stop to route from).
        setPoolAnchor(coords ? { label: `${windowLabel} · near ${getShortAddress(anchorAppointment)}`, coordinates: coords } : null);
    }, [appointmentCoordinates]);

    const clearSearch = useCallback(() => {
        setSearchInput('');
        setActiveSearch(null);
        setSearchError(null);
        setIsLocating(false);
    }, []);

    const proximityResults = useMemo(() => {
        const byAppointmentKey: Record<string, AppointmentProximity> = {};
        const closestByRep = new Map<string, ClosestRep>();

        if (!activeSearch) return { byAppointmentKey, closestRepNames: new Set<string>(), closestAppointmentEventIds: new Set<string>(), closestReps: [] as ClosestRep[] };

        boardAppointments.forEach(({ appointment, repName }) => {
            const key = `${appointment.status}-${appointment.eventId}`;
            const coordinates = getAppointmentCoordinates(appointment, appointmentCoordinates);

            if (!coordinates) {
                byAppointmentKey[key] = { distanceMiles: null, hasCoordinate: false };
                return;
            }

            const distanceMiles = getDistanceMiles(activeSearch.coordinates, coordinates);
            byAppointmentKey[key] = { distanceMiles, hasCoordinate: true };

            // CSRs book from the office — an appointment on their column says nothing about
            // where they physically are, so they never rank as a nearby rep. The distance
            // chip on the card still shows.
            if (getRepGroup(repName) === 'CSR') return;

            const currentClosest = closestByRep.get(repName);
            if (!currentClosest || distanceMiles < currentClosest.distanceMiles) {
                closestByRep.set(repName, { appointment, repName, distanceMiles });
            }
        });

        // Reps who are available but have an empty day rank off their home zip, so an open
        // rep living nearby isn't invisible just because they have no stop to measure from.
        freeRepCandidates.forEach(rep => {
            const homeCoordinates = repHomeCoordinates[rep.name];
            if (!homeCoordinates) return;
            closestByRep.set(rep.name, {
                repName: rep.name,
                distanceMiles: getDistanceMiles(activeSearch.coordinates, homeCoordinates),
                appointment: null,
                homeZip: rep.zipCodes?.[0],
            });
        });

        const closestReps = Array.from(closestByRep.values())
            .sort((a, b) => a.distanceMiles - b.distanceMiles)
            .slice(0, 3);
        return {
            byAppointmentKey,
            closestRepNames: new Set(closestReps.map(result => result.repName)),
            closestAppointmentEventIds: new Set(
                closestReps.map(result => result.appointment?.eventId).filter((id): id is string => !!id)
            ),
            closestReps,
        };
    }, [activeSearch, appointmentCoordinates, boardAppointments, freeRepCandidates, getRepGroup, repHomeCoordinates]);

    const activeCount = boardAppointments.filter(({ appointment }) => appointment.status === 'active').length;
    const cancelledCount = boardAppointments.filter(({ appointment }) => appointment.status === 'cancelled').length;

    // Open-slot cutoff: on TODAY, hide windows whose time has already passed (keep the
    // one we're currently in). Future days show every window; past days show none.
    // Plain const (not memoized) so it re-evaluates on each render — the 30s cleanup
    // tick re-renders the board, so slots drop within ~30s of their end time.
    const nowCutoffMinutes = (() => {
        const t = todayKey();
        if (dateKey < t) return Infinity;   // whole day already passed
        if (dateKey > t) return -Infinity;  // nothing has passed yet
        const now = new Date();
        return now.getHours() * 60 + now.getMinutes();
    })();

    return (
        <div className="flex flex-col h-full min-h-0 overflow-hidden bg-bg-primary">
            <div className="flex-shrink-0 px-3 py-2 bg-bg-secondary border-b border-border-primary flex items-center justify-between gap-3">
                <div className="min-w-0">
                    <h2 className="text-[15px] font-semibold text-text-primary truncate">
                        {relativeLabel ? `${relativeLabel} Appointments` : 'Appointments'} - {formatDateHeading(dateKey)}
                    </h2>
                    <div className="flex items-center gap-x-3 gap-y-1 flex-wrap">
                        <span className="text-[11.5px] text-text-tertiary">
                            {activeCount} active{cancelledCount > 0 ? `, ${cancelledCount} cancelled` : ''}{source ? ` · ${source}` : ''}
                        </span>
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-text-tertiary"><span className="h-1.5 w-1.5 rounded-full bg-tag-blue-text" />Adjuster</span>
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-text-tertiary"><span className="h-1.5 w-1.5 rounded-full bg-tag-green-text" />Self-gen</span>
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-text-tertiary"><span className="h-1.5 w-1.5 rounded-full bg-tag-amber-text" />Follow-up</span>
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-text-tertiary"><span className="h-1.5 w-1.5 rounded-full border border-tag-red-border" />Double-booked</span>
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-text-tertiary"><span className="h-1.5 w-1.5 rounded-full bg-tag-green-bg border border-tag-green-border" />Open slot</span>
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-text-tertiary"><span className="h-1.5 w-1.5 rounded-full bg-tag-amber-bg border border-tag-amber-border" />Reserved</span>
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-text-tertiary"><span className="h-1.5 w-1.5 rounded-full bg-tag-red-bg border border-tag-red-border" />CSR-owned</span>
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-text-tertiary" title="Shown in both places: the rep runs it, the CSR still owns the job"><span className="h-1.5 w-2.5 rounded-sm border border-dashed border-tag-red-border" />Assigned, owner pending</span>
                        {error && <span className="text-[10px] font-bold uppercase tracking-wider text-tag-red-text" title={error}>⚠ refresh failed · showing last update</span>}
                    </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                        onClick={() => goToDate(addDays(dateKey, -1))}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border-secondary bg-bg-primary text-text-secondary hover:border-brand-primary hover:text-brand-primary transition-colors duration-150"
                        title="Previous day"
                    >
                        <ChevronLeftIcon className="h-4 w-4" />
                    </button>
                    <button
                        onClick={() => goToDate(todayKey())}
                        disabled={dateKey === todayKey()}
                        className="inline-flex h-7 items-center rounded-md border border-border-secondary bg-bg-primary px-2.5 text-[11px] font-semibold text-text-secondary hover:border-brand-primary hover:text-brand-primary disabled:opacity-40 transition-colors duration-150"
                        title="Jump to today"
                    >
                        Today
                    </button>
                    <button
                        onClick={() => goToDate(addDays(dateKey, 1))}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border-secondary bg-bg-primary text-text-secondary hover:border-brand-primary hover:text-brand-primary transition-colors duration-150"
                        title="Next day"
                    >
                        <ChevronRightIcon className="h-4 w-4" />
                    </button>
                    <div className={`${SEG_WRAP} ml-1`}>
                        {(['live', 'tentative'] as const).map(value => (
                            <button
                                key={value}
                                onClick={() => {
                                    // Switching to Tentative on a day with no plan? Jump to the
                                    // day being planned (planner's selected date, else first day
                                    // that has assignments) so the plan is visible immediately.
                                    if (value === 'tentative' && countAssignedJobs(getAppStateForDay(dateKey)) === 0) {
                                        const planKey = dateToKey(selectedDate);
                                        if (countAssignedJobs(getAppStateForDay(planKey)) > 0) {
                                            goToDate(planKey);
                                        } else if (tentativeDaysWithPlans.length > 0) {
                                            goToDate(tentativeDaysWithPlans[0]);
                                        }
                                    }
                                    setDataSource(value);
                                }}
                                className={`${SEG_BTN} ${dataSource === value ? SEG_ON : SEG_OFF}`}
                            >
                                {value === 'live' ? 'Live' : 'Tentative'}
                            </button>
                        ))}
                    </div>
                    <button
                        onClick={fetchAppointments}
                        disabled={isRefreshing || dataSource !== 'live'}
                        className="ml-1 inline-flex h-7 w-7 items-center justify-center rounded-md text-text-tertiary hover:bg-bg-tertiary hover:text-brand-primary disabled:opacity-40 transition-colors duration-150"
                        title="Refresh appointments"
                    >
                        {isRefreshing ? <LoadingIcon className="h-3.5 w-3.5 text-brand-primary" /> : <RefreshIcon className="h-3.5 w-3.5" />}
                    </button>
                    <button
                        onClick={() => { const n = (window.prompt('Your name — used when you reserve open slots:', reserverName) || '').trim(); if (n) setReserverPersisted(n); }}
                        className={`${CTRL_BTN} ml-1 truncate max-w-[130px]`}
                        title="Set your name — shown on slots you reserve so others don't double-book"
                    >
                        {reserverName ? `You: ${reserverName}` : 'Set name'}
                    </button>
                    <button
                        onClick={() => setShowPool(v => !v)}
                        className={`ml-1 inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[11px] font-semibold transition-colors duration-150 tabular-nums ${
                            showPool
                                ? 'border-brand-primary bg-brand-primary text-brand-text-on-primary'
                                : 'border-border-secondary bg-bg-primary text-text-secondary hover:border-brand-primary hover:text-brand-primary'
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
                    className="h-8 min-w-[220px] flex-1 rounded-md border border-border-secondary bg-bg-primary px-2.5 text-[11px] text-text-primary outline-none transition-colors duration-150 placeholder:text-text-tertiary focus:border-brand-primary"
                />
                <button
                    type="submit"
                    disabled={isLocating || !searchInput.trim()}
                    className="h-8 rounded-md border border-brand-primary bg-brand-primary px-3 text-[11px] font-semibold text-brand-text-on-primary transition-colors duration-150 hover:bg-brand-secondary disabled:cursor-not-allowed disabled:opacity-50"
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
                    <p className="text-sm italic max-w-md text-center px-4">{dataSource === 'tentative'
                        ? (tentativeDaysWithPlans.length > 0
                            ? `No tentative assignments for ${dateKey}. Your plan has assignments for ${tentativeDaysWithPlans.join(', ')} — use the ◀ ▶ arrows to jump there.`
                            : 'No tentative plan is loaded in this browser session. Build it in the planner (or Load from Cloud), then switch to Tentative.')
                        : 'No sales appointments found for today.'}</p>
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

                            {groupedAppointments.map((group, groupIndex) => (
                                (() => {
                                    const matchedRep = repsByName.get(normalizeRepName(group.repName)) || repsByLooseName.get(normalizeName(group.repName));
                                    const unavailableSlotIds = matchedRep ? getEffectiveUnavailableSlots(matchedRep, dayName) : [];
                                    const isFullyUnavailable = unavailableSlotIds.length >= boardSlots.length;
                                    const isTimeUnavailable = (startMinutes: number) => unavailableSlotIds.includes(mapMinutesToSlotId(startMinutes, boardSlots));
                                    const isClosestRep = !activeSearch || proximityResults.closestRepNames.has(group.repName);
                                    const leftSection = group.leftSection;
                                    const isCsrColumn = group.departmentGroup === 'CSR';
                                    const isRosterManager = rosterManagers.has(normalizeRepName(group.repName));
                                    const isCommercialRep = !!matchedRep && (matchedRep.region === 'COMMERCIAL' || isLondon(matchedRep));
                                    // Open booking windows → clickable green OPEN blocks. Excluded: CSR/Management
                                    // columns, managers/owners (by role), and commercial reps (their open time is
                                    // not bookable residential capacity). For everyone else, show empty windows
                                    // that haven't passed; when we HAVE the rep's sheet availability, also skip the
                                    // windows they're off for (reps not on the sheet are assumed available so they
                                    // still get blocks — e.g. William Ludewig, who isn't on the SRA rota).
                                    const openWindows = (leftSection || isRosterManager || isCommercialRep) ? [] : fillWindows.filter(win => (
                                        win.endMin > nowCutoffMinutes &&
                                        (!matchedRep || !unavailableSlotIds.includes(win.id)) &&
                                        !group.appointments.some(appt => appointmentOverlapsWindow(appt, win))
                                    ));
                                    const prevGroup = groupIndex > 0 ? groupedAppointments[groupIndex - 1] : null;
                                    const isLeftSectionStart = !!leftSection && leftSection !== (prevGroup?.leftSection ?? null);
                                    const prevRegion = prevGroup ? prevGroup.region : null;
                                    // Left-rail columns are region-neutral, so region dividers only fire on sales reps.
                                    const isSectionStart = !leftSection && group.region !== 'PHX' && group.region !== prevRegion;

                                    return (
                                        <React.Fragment key={group.repName}>
                                            {isLeftSectionStart && leftSection && (
                                                <div
                                                    className="flex items-center justify-center flex-shrink-0 border-r border-border-primary"
                                                    style={{ width: 26, backgroundColor: LEFT_SECTION_BAR_BG[leftSection] }}
                                                    title={LEFT_SECTION_TITLE[leftSection]}
                                                >
                                                    <span
                                                        className="text-[10px] font-extrabold uppercase tracking-widest whitespace-nowrap"
                                                        style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', color: LEFT_SECTION_BAR_COLOR[leftSection] }}
                                                    >
                                                        {LEFT_SECTION_LABEL[leftSection]}
                                                    </span>
                                                </div>
                                            )}
                                            {isSectionStart && (
                                                <div
                                                    className="flex items-center justify-center flex-shrink-0 border-r border-border-primary"
                                                    style={{ width: 26, backgroundColor: REGION_TINT[group.region] }}
                                                    title={`${REGION_LABEL[group.region]} appointments`}
                                                >
                                                    <span
                                                        className="text-[10px] font-extrabold uppercase tracking-widest whitespace-nowrap"
                                                        style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', color: REGION_LABEL_COLOR[group.region] }}
                                                    >
                                                        {REGION_LABEL[group.region]}
                                                    </span>
                                                </div>
                                            )}
                                        <div
                                            className={`flex flex-col border-r border-border-primary min-w-0 ${!leftSection && group.region === 'PHX' ? 'bg-bg-primary' : ''} transition-opacity ${isFullyUnavailable ? 'opacity-60 grayscale' : ''} ${activeSearch && !isClosestRep ? 'opacity-50' : ''}`}
                                            style={{ flex: '1 1 0', backgroundColor: leftSection ? LEFT_SECTION_TINT[leftSection] : (group.region !== 'PHX' ? REGION_TINT[group.region] : undefined) }}
                                        >
                                            <div
                                                className="sticky top-0 z-20 px-2 bg-bg-secondary border-b border-border-primary flex items-center"
                                                style={{ height: HEADER_HEIGHT }}
                                            >
                                                <div className="flex items-center justify-between gap-1 w-full min-w-0">
                                                    <div className="text-[10px] font-bold uppercase tracking-wide text-text-primary leading-[1.1] break-words line-clamp-2 min-w-0" title={group.repName}>{group.repName}</div>
                                                    <div className="flex items-center gap-1 flex-shrink-0">
                                                        {isFullyUnavailable && (
                                                            <span className="text-[9px] font-bold uppercase text-text-tertiary bg-bg-tertiary px-1.5 py-0.5 rounded-full">
                                                                Off
                                                            </span>
                                                        )}
                                                        {leftSection === 'CSR' && (
                                                            <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-tag-red-bg text-tag-red-text border border-tag-red-border">
                                                                CSR
                                                            </span>
                                                        )}
                                                        {leftSection === 'MGMT' && (
                                                            <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-600 border border-slate-400">
                                                                MGMT
                                                            </span>
                                                        )}
                                                        {!leftSection && isRosterManager && (
                                                            <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-600 border border-slate-400" title="Manager — not offered for gap-fill">
                                                                MGR
                                                            </span>
                                                        )}
                                                        <span className="tabular-nums rounded-md border border-border-secondary bg-bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-text-secondary">
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

                                                {layoutAppointments(group.appointments).map(({ appointment, lane, lanes }) => {
                                                    const isCancelled = appointment.status === 'cancelled';
                                                    const isNew = appointment.isNew;
                                                    const isCsr = group.departmentGroup === 'CSR';
                                                    // A pointer to the rep actually running this one — the job just hasn't
                                                    // been handed off yet. Not a booking, so it never warns about conflicts.
                                                    const isMirror = !!appointment.mirrorFor;
                                                    const isDouble = doubleBookedIds.has(appointment.eventId) && !isCancelled && !isMirror;
                                                    const kind = appointment.kind || 'sales';
                                                    // Job still owned by a CSR in Roofr (not yet transferred to the rep) -> light red.
                                                    const isCsrOwnedJob = getRepGroup((appointment.jobOwner || '').trim()) === 'CSR';
                                                    const position = getAppointmentPosition(appointment);
                                                    const cardClass = isCancelled
                                                        ? 'bg-tag-red-bg text-tag-red-text border-tag-red-border opacity-90'
                                                        : isMirror
                                                        ? 'bg-bg-secondary text-text-secondary border-dashed border-tag-red-border/70 hover:border-tag-red-border hover:shadow-sm'
                                                        : isNew
                                                            ? 'bg-tag-green-bg text-tag-green-text border-tag-green-border ring-2 ring-tag-green-border/60'
                                                            : isCsrOwnedJob
                                                                ? 'bg-red-50 text-red-950 border-red-300 hover:border-red-500 hover:shadow-md'
                                                                : kind === 'adjuster'
                                                                    ? 'bg-indigo-100 text-indigo-950 border-indigo-400 hover:border-indigo-600 hover:shadow-md'
                                                                    : kind === 'self_gen'
                                                                        ? 'bg-emerald-100 text-emerald-950 border-emerald-400 hover:border-emerald-600 hover:shadow-md'
                                                                        : kind === 'followup'
                                                                            ? 'bg-amber-100 text-amber-950 border-amber-400 hover:border-amber-600 hover:shadow-md'
                                                                            : 'bg-brand-bg-light text-text-primary border-brand-primary/30 hover:border-brand-primary hover:shadow-md';
                                                    // Double-booking warning outranks the CSR ring (outline composes with rings).
                                                    // A mirror skips the ring — the dashed border already reads as "not a booking",
                                                    // and the solid ring would make it look like real CSR-held time.
                                                    const csrClass = isDouble ? 'outline outline-2 outline-orange-500' : (isCsr && !isMirror) ? 'ring-2 ring-tag-red-border' : '';
                                                    const proximity = proximityResults.byAppointmentKey[`${appointment.status}-${appointment.eventId}`];
                                                    const isDimmedBySearch = activeSearch && !isClosestRep;
                                                    const isClosestAppointment = !!activeSearch && proximityResults.closestAppointmentEventIds.has(appointment.eventId);
                                                    const closestAppointmentClass = isClosestAppointment ? 'ring-2 ring-brand-primary shadow-md' : '';

                                                    return (
                                                        <button
                                                            key={`${appointment.status}-${isMirror ? 'mirror-' : ''}${appointment.eventId}`}
                                                            // Details for a mirror name the rep who is actually running it,
                                                            // not the CSR whose column it is being shown in.
                                                            onClick={() => setSelectedAppointment({ appointment, repName: appointment.mirrorFor || group.repName })}
                                                            className={`absolute z-10 text-left rounded-md border overflow-hidden transition-all ${cardClass} ${csrClass} ${closestAppointmentClass} cursor-pointer active:scale-[0.99] ${isDimmedBySearch ? 'opacity-[0.35] grayscale' : ''}`}
                                                            style={{
                                                                top: position.top,
                                                                height: Math.max(position.height - 2, 30),
                                                                left: `calc(${(lane / lanes) * 100}% + 4px)`,
                                                                width: `calc(${100 / lanes}% - 8px)`,
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
                                                                    {isDouble && (
                                                                        <span className="text-[8px] font-bold uppercase tracking-wide flex-shrink-0 px-1 rounded border border-orange-500 bg-orange-100 text-orange-800">Double</span>
                                                                    )}
                                                                    {kind === 'adjuster' && !isCancelled && (
                                                                        <span className="text-[8px] font-bold uppercase tracking-wide flex-shrink-0 px-1 rounded border border-indigo-400 bg-indigo-200 text-indigo-900">Adjuster</span>
                                                                    )}
                                                                    {kind === 'self_gen' && !isCancelled && (
                                                                        <span className="text-[8px] font-bold uppercase tracking-wide flex-shrink-0 px-1 rounded border border-emerald-400 bg-emerald-200 text-emerald-900">Self-gen</span>
                                                                    )}
                                                                    {kind === 'followup' && !isCancelled && (
                                                                        <span className="text-[8px] font-bold uppercase tracking-wide flex-shrink-0 px-1 rounded border border-amber-400 bg-amber-200 text-amber-900">Follow-up</span>
                                                                    )}
                                                                    {isMirror && (
                                                                        <span className="text-[8px] font-bold uppercase tracking-wide flex-shrink-0 px-1 rounded border border-dashed border-tag-red-border bg-bg-primary text-tag-red-text">Assigned</span>
                                                                    )}
                                                                    {(isCsr || isCsrOwnedJob) && !isCancelled && !isMirror && (
                                                                        <span className="text-[8px] font-bold uppercase tracking-wide flex-shrink-0 px-1 rounded border border-tag-red-border bg-tag-red-bg text-tag-red-text">CSR</span>
                                                                    )}
                                                                    {isClosestAppointment && (
                                                                        <span className="text-[8px] font-bold uppercase tracking-wide flex-shrink-0 px-1 rounded border border-brand-primary bg-bg-primary text-brand-primary shadow-sm">Closest</span>
                                                                    )}
                                                                </div>
                                                                <div className={`text-[10px] font-bold truncate ${isMirror ? 'text-text-secondary' : 'text-text-primary'}`}>
                                                                    {appointment.customerName || 'Unknown customer'}
                                                                </div>
                                                                {isMirror && (
                                                                    <div className="text-[9px] font-semibold text-tag-red-text truncate flex-shrink-0">
                                                                        → {appointment.mirrorFor}
                                                                    </div>
                                                                )}
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

                                                {openWindows.map(win => {
                                                    const top = ((win.startMin - DAY_VIEW_START_HOUR * 60) / 30) * DAY_VIEW_CELL_HEIGHT;
                                                    const height = ((win.endMin - win.startMin) / 30) * DAY_VIEW_CELL_HEIGHT;
                                                    const anchorAppt = getGapAnchorAppointment(group.appointments, win);
                                                    const hold = slotHolds[holdKey(group.repName, win.id)];
                                                    const mine = !!hold && !!reserverName && normalizeRepName(hold.reservedBy) === normalizeRepName(reserverName);
                                                    const blockStyle = { top: top + 2, height: Math.max(height - 4, 36), left: 4, right: 4 };

                                                    if (hold) {
                                                        return (
                                                            <div
                                                                key={`gap-${win.id}`}
                                                                className={`absolute z-[7] rounded-md border-2 flex flex-col items-center justify-center gap-0.5 px-1 text-center ${
                                                                    mine ? 'border-amber-400 bg-amber-50 text-amber-800' : 'border-slate-300 bg-slate-100 text-slate-500'
                                                                }`}
                                                                style={blockStyle}
                                                                title={`${win.label} reserved by ${hold.reservedBy}${mine ? ' (you)' : ''} — holds until the appointment shows here`}
                                                            >
                                                                <span className="text-[10px] font-extrabold uppercase tracking-wide">🔒 Reserved</span>
                                                                <span className="text-[9px] font-semibold truncate max-w-full">{mine ? 'by you' : hold.reservedBy}</span>
                                                                {mine && (
                                                                    <button
                                                                        onClick={() => handleReleaseSlot(group.repName, win.id)}
                                                                        className="mt-0.5 px-1.5 py-0.5 text-[9px] font-bold rounded border border-amber-500 text-amber-700 hover:bg-amber-100 transition"
                                                                    >
                                                                        Release
                                                                    </button>
                                                                )}
                                                            </div>
                                                        );
                                                    }

                                                    return (
                                                        <div
                                                            key={`gap-${win.id}`}
                                                            className="absolute z-[6] rounded-md border-2 border-dashed border-emerald-400/80 bg-emerald-50/70 flex flex-col items-center justify-center gap-1 px-1"
                                                            style={blockStyle}
                                                        >
                                                            <span className="text-[10px] font-extrabold uppercase tracking-wide text-emerald-700">Open · {win.label}</span>
                                                            <div className="flex flex-col items-stretch gap-1 w-full px-1">
                                                                <button
                                                                    onClick={() => handleReserveSlot(group.repName, win.id)}
                                                                    className="px-1.5 py-0.5 text-[9px] font-bold rounded border border-tag-green-text bg-tag-green-text text-bg-primary hover:opacity-90 transition-colors duration-150"
                                                                    title="Reserve this slot so no one else books it"
                                                                >
                                                                    🔒 Reserve
                                                                </button>
                                                                <button
                                                                    onClick={() => handleFillGap(anchorAppt, `${group.repName}'s open ${win.label}`)}
                                                                    className="px-1.5 py-0.5 text-[9px] font-semibold rounded border border-tag-green-border text-tag-green-text hover:bg-tag-green-bg transition-colors duration-150"
                                                                    title="Find the closest future appointments to pull in"
                                                                >
                                                                    🔥 Fill nearby
                                                                </button>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                        </React.Fragment>
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
                                        No reps with a geocodable stop or home zip for this day.
                                    </div>
                                ) : proximityResults.closestReps.map(({ appointment, repName, distanceMiles, homeZip }) => (
                                    <button
                                        key={`nearest-${appointment?.eventId || repName}`}
                                        onClick={() => appointment && setSelectedAppointment({ appointment, repName })}
                                        disabled={!appointment}
                                        className={`w-full text-left rounded-md border bg-bg-primary transition p-2 ${appointment ? 'border-brand-primary/60 hover:border-brand-primary hover:shadow-sm' : 'border-dashed border-tag-green-border cursor-default'}`}
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="text-[11px] font-bold text-text-primary truncate">{repName}</span>
                                            <span className="text-[11px] font-bold text-brand-primary flex-shrink-0">{distanceMiles.toFixed(1)} mi</span>
                                        </div>
                                        {appointment ? (
                                            <>
                                                <div className="flex items-center gap-1 min-w-0">
                                                    <div className="text-[10px] text-text-tertiary truncate">{formatTimeRange(appointment)}</div>
                                                    <span className="text-[8px] font-bold uppercase tracking-wide flex-shrink-0 px-1 rounded border border-brand-primary bg-bg-primary text-brand-primary">Closest</span>
                                                </div>
                                                <div className="text-xs text-text-secondary truncate">{appointment.customerName || 'Unknown customer'}</div>
                                                <div className="text-[10px] text-text-tertiary truncate">{getShortAddress(appointment)}</div>
                                            </>
                                        ) : (
                                            <>
                                                <div className="flex items-center gap-1 min-w-0">
                                                    <span className="text-[8px] font-bold uppercase tracking-wide flex-shrink-0 px-1 rounded border border-tag-green-border bg-tag-green-bg text-tag-green-text">Open day</span>
                                                </div>
                                                <div className="text-xs text-text-secondary truncate">No jobs booked today</div>
                                                <div className="text-[10px] text-text-tertiary truncate">Distance from home zip {homeZip}</div>
                                            </>
                                        )}
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
                onFindReplacements={handleFindReplacements}
            />

            <ReplacementPool
                open={showPool}
                onClose={() => setShowPool(false)}
                onCountChange={setPoolCount}
                anchor={poolAnchor}
                onClearAnchor={() => setPoolAnchor(null)}
            />
        </div>
    );
};

export default TodayBoard;
