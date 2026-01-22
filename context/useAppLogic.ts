

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Rep, Job, AppState, SortConfig, SortKey, DisplayJob, RouteInfo, Settings, ScoreBreakdown, UiSettings, JobChange, LoadOptionsModalState, BackupListItem, BACKUP_CONFIG } from '../types';
import { ToastData, ToastType } from '../components/Toast';
import { TIME_SLOTS, ROOF_KEYWORDS, TYPE_KEYWORDS, MAX_REP_ROW } from '../constants';
import { fetchSheetData, fetchRoofrJobIds, fetchAnnouncementMessage } from '../services/googleSheetsService';
import { parseJobsFromText, assignJobsWithAi, fixAddressesWithAi, mapTimeframeToSlotId } from '../services/geminiService';
import { ARIZONA_CITY_ADJACENCY, GREATER_PHOENIX_CITIES, NORTHERN_AZ_CITIES, SOUTHERN_AZ_CITIES, SOUTHEAST_PHOENIX_CITIES, LOWER_VALLEY_EXTENSION_CITIES, SOUTH_OUTER_RING_CITIES, haversineDistance, EAST_TO_WEST_CITIES, WEST_VALLEY_CITIES, EAST_VALLEY_CITIES } from '../services/geography';
import { geocodeAddresses, fetchRoute, Coordinates, GeocodeResult } from '../services/osmService';
import { detectJobChanges, findMatchingJob, compareJobs, getJobIdentifier } from '../utils/changeTracking';
import { saveStateToCloud, loadStateFromCloud, saveAllStatesToCloud, loadAllStatesFromCloud } from '../services/cloudStorageServiceSheets';
import { createManualBackup, upsertAutoBackup, fetchBackupList, loadBackup } from '../services/backupService';
import { saveState, loadState } from '../services/saveLoadService';
import { doTimesOverlap } from '../utils/timeUtils';
import {
    fetchUnassignedJobs,
    fetchAppointmentsByDate,
    fetchDaySchedule,
    createAppointment,
    mapRoutingApiJobToAppJob,
    RoutingApiJob,
    DayScheduleResponse,
} from '../services/routingApiService';
import { ROUTING_API_SYNC_DEBOUNCE_MS } from '../constants';

// Helpers
const norm = (city: string | null | undefined): string => (city || '').toLowerCase().trim();
const isJoseph = (rep: Rep) => rep.name.trim().toLowerCase().startsWith('joseph simms');
const isRichard = (rep: Rep) => rep.name.trim().toLowerCase().startsWith('richard hadsall');
const isLondon = (rep: Rep) => rep.name.trim().toLowerCase().startsWith('london smith');

// Filter out reps from rows beyond MAX_REP_ROW (inactive reps at bottom of sheet)
const filterExcludedReps = (state: AppState): AppState => {
    return {
        ...state,
        reps: state.reps.filter(rep => {
            // If no sourceRow, keep the rep (legacy data or mock data)
            if (rep.sourceRow === undefined) return true;
            // Only keep reps from rows at or before MAX_REP_ROW
            return rep.sourceRow <= MAX_REP_ROW;
        })
    };
};

const formatDateToKey = (date: Date): string => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
};

const getCleanSortName = (name: string): string => {
    return name
        .replace(/"[^"]*"/g, '')
        .replace(/\([^)]*\)/g, '')
        .replace(/\s+(phoenix|tucson)$/i, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
};

// Helper to sort timeframes
const getSortableHour = (timeString: string | undefined): number => {
    if (!timeString) return 99;
    const match = timeString.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (!match) return 99;
    let hour = parseInt(match[1], 10);
    const period = match[3]?.toLowerCase();
    if (period === 'pm' && hour < 12) hour += 12;
    if (period === 'am' && hour === 12) hour = 0;
    // Heuristic: if no period and hour is 1-6, assume PM.
    if (!period && hour >= 1 && hour <= 6) {
        hour += 12;
    }
    return hour;
};


// Optimized based on user "training data" (High Volume settings)
export const DEFAULT_SETTINGS: Settings = {
    allowDoubleBooking: false,
    maxJobsPerSlot: 2,
    allowAssignOutsideAvailability: false,
    maxJobsPerRep: 4,
    minJobsPerRep: 3,
    maxCitiesPerRep: 3,
    weightSameCity: 8,
    weightAdjacentCity: 6,
    weightSkillMatch: 5,
    unavailabilityPenalty: 1.2,
    strictTimeSlotMatching: true,
    maxTravelTimeMinutes: 75,
    // NEW PRIORITY ORDER: Timeframe > Sales Rank > Skills > Distance
    scoringWeights: {
        timeframeMatch: 10.0,   // HIGHEST: Getting jobs at the right time
        performance: 8.0,       // HIGH: Best reps get priority leads (#)
        skillRoofing: 5.0,      // MEDIUM: Right skills (Tile, Shingle, etc)
        skillType: 4.0,         // MEDIUM: Specialties (Insurance, Commercial)
        distanceCluster: 2.0,   // LOW: Clustering jobs together
        distanceBase: 1.0,      // LOWEST: Distance from home
    },
    allowRegionalRepsInPhoenix: false,
};

const DEFAULT_UI_SETTINGS: UiSettings = {
    theme: 'light',
    showUnplottedJobs: true,
    showUnassignedJobsColumn: true,
    schedulesViewMode: 'list',
    dayViewCellHeight: 40,
    dayViewColumnWidth: 150,
    columnStack: {},
    collapsedColumns: [],
};

const EMPTY_STATE: AppState = { reps: [], unassignedJobs: [], settings: DEFAULT_SETTINGS };

// Type for Routing API sync queue items
interface RoutingApiSyncItem {
    jobId: string;
    repId: string;
    slotId: string;
    dateKey: string;
}

export const useAppLogic = () => {
    const [history, setHistory] = useState<Map<string, AppState>[]>([new Map()]);
    const [historyIndex, setHistoryIndex] = useState(0);

    const [activeDayKeys, setActiveDayKeys] = useState<string[]>([]);
    const [isLoadingReps, setIsLoadingReps] = useState<boolean>(true);
    const [repsError, setRepsError] = useState<string | null>(null);
    const [isParsing, setIsParsing] = useState<boolean>(false);
    const [isAutoAssigning, setIsAutoAssigning] = useState<boolean>(false);
    const [isDistributing, setIsDistributing] = useState<boolean>(false);
    const [isAiAssigning, setIsAiAssigning] = useState<boolean>(false);
    const [isAiFixingAddresses, setIsAiFixingAddresses] = useState<boolean>(false);
    const [isTryingVariations, setIsTryingVariations] = useState<boolean>(false);
    const [parsingError, setParsingError] = useState<string | null>(null);
    const [selectedRepId, setSelectedRepId] = useState<string | null>(null);
    const [usingMockData, setUsingMockData] = useState<boolean>(false);
    const [activeSheetName, setActiveSheetName] = useState<string>('');

    // Default to Tomorrow
    const [selectedDate, _setSelectedDate] = useState<Date>(() => {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        d.setHours(12, 0, 0, 0); // Noon to avoid timezone edge cases
        return d;
    });

    const [expandedRepIds, setExpandedRepIds] = useState<Set<string>>(new Set());
    const [isOverrideActive, setIsOverrideActive] = useState<boolean>(false);
    const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'salesRank', direction: 'asc' });
    const [debugLogs, setDebugLogs] = useState<string[]>([]);
    const [aiThoughts, setAiThoughts] = useState<string[]>([]);
    const [activeRoute, setActiveRoute] = useState<{ repName: string; mappableJobs: DisplayJob[]; unmappableJobs: DisplayJob[]; routeInfo: RouteInfo | null; } | null>(null);
    const [isRouting, setIsRouting] = useState(false);
    const [draggedJob, setDraggedJob] = useState<Job | null>(null);
    const [draggedOverRepId, setDraggedOverRepId] = useState<string | null>(null);
    const [hoveredJobId, setHoveredJobId] = useState<string | null>(null);
    const [hoveredRepId, setHoveredRepId] = useState<string | null>(null);
    const [repSettingsModalRepId, setRepSettingsModalRepId] = useState<string | null>(null);
    const [placementJobId, setPlacementJobId] = useState<string | null>(null);
    const [mapRefreshTrigger, setMapRefreshTrigger] = useState(0); // Trigger to refresh map after assignments
    const [autoMapAction, setAutoMapAction] = useState<'none' | 'show-all' | string>('none'); // Trigger to show map (all or specific repId)

    const [geoCache, setGeoCache] = useState<Map<string, Coordinates>>(new Map());
    const [roofrJobIdMap, setRoofrJobIdMap] = useState<Map<string, string>>(new Map());
    const [announcement, setAnnouncement] = useState<string>('');
    const [changeLog, setChangeLog] = useState<JobChange[]>([]);

    // State to track visible jobs from filters
    const [filteredAssignedJobs, setFilteredAssignedJobs] = useState<DisplayJob[]>([]);
    const [filteredUnassignedJobs, setFilteredUnassignedJobs] = useState<Job[]>([]);

    // Init flag for map
    const [hasInitializedMap, setHasInitializedMap] = useState(false);
    // Ref to track the latest map request to prevent race conditions
    const mapRequestRef = useRef(0);
    // Ref to track days loaded from cloud (to prevent loadReps from overwriting them)
    const cloudLoadedDaysRef = useRef<Set<string>>(new Set());
    // Flag to completely block loadReps during cloud load
    const [isCloudLoading, setIsCloudLoading] = useState(false);
    // Ref to ensure cloud load only happens once on initial mount
    const hasAutoLoadedRef = useRef(false);

    // Auto-save configuration - now uses debounce + fallback timer
    // Debounce: 5 seconds after user stops making changes
    // Fallback: 60 seconds max between saves
    const lastActivityRef = useRef<number>(Date.now());
    const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
    const fallbackTimerRef = useRef<NodeJS.Timeout | null>(null);
    const [isAutoSaving, setIsAutoSaving] = useState(false);
    const [lastAutoSaveTime, setLastAutoSaveTime] = useState<Date | null>(null);

    // Routing API integration state
    const [useRoutingApi, setUseRoutingApi] = useState<boolean>(false);
    const [isLoadingFromRoutingApi, setIsLoadingFromRoutingApi] = useState(false);
    const [routingApiError, setRoutingApiError] = useState<string | null>(null);
    const [routingApiSyncStatus, setRoutingApiSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle');
    const routingApiSyncQueueRef = useRef<Map<string, RoutingApiSyncItem>>(new Map());
    const routingApiSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Toast notification state
    const [toasts, setToasts] = useState<ToastData[]>([]);

    // Toast notification functions (defined early so they can be used by other callbacks)
    const showToast = useCallback((message: string, type: ToastType = 'info', duration?: number) => {
        const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        setToasts(prev => [...prev, { id, message, type, duration }]);
    }, []);

    const dismissToast = useCallback((id: string) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    // Track if there are unsaved changes since last save
    const hasUnsavedChangesRef = useRef(false);

    // Load options modal state
    const [loadOptionsModal, setLoadOptionsModal] = useState<LoadOptionsModalState>({
        isOpen: false,
        manualBackups: [],
        autoBackup: null,
        selectedBackupId: null,
        isLoading: false,
    });

    const [uiSettings, setUiSettings] = useState<UiSettings>(() => {
        try {
            const stored = localStorage.getItem('ui-settings');
            if (stored) return { ...DEFAULT_UI_SETTINGS, ...JSON.parse(stored) };
        } catch (e) {
            console.warn("Could not load UI settings from localStorage", e);
        }
        return DEFAULT_UI_SETTINGS;
    });

    const updateUiSettings = useCallback((updates: Partial<UiSettings>) => {
        setUiSettings(prev => {
            const newSettings = { ...prev, ...updates };
            try {
                localStorage.setItem('ui-settings', JSON.stringify(newSettings));
            } catch (e) {
                console.warn("Could not save UI settings to localStorage", e);
            }
            return newSettings;
        });
    }, []);

    const updateCustomTheme = useCallback((updates: Record<string, string>) => {
        setUiSettings(prev => {
            const newCustomTheme = { ...(prev.customTheme || {}), ...updates };
            const newSettings = { ...prev, theme: 'custom' as const, customTheme: newCustomTheme };
            try {
                localStorage.setItem('ui-settings', JSON.stringify(newSettings));
            } catch (e) { console.warn("Could not save UI settings", e); }
            return newSettings;
        });
    }, []);

    const resetCustomTheme = useCallback(() => {
        setUiSettings(prev => {
            const newSettings = { ...prev, theme: 'light' as const, customTheme: undefined };
            try {
                const stored = JSON.parse(localStorage.getItem('ui-settings') || '{}');
                delete stored.customTheme;
                stored.theme = 'light';
                localStorage.setItem('ui-settings', JSON.stringify(stored));
            } catch (e) { console.warn("Could not save UI settings", e); }
            return newSettings;
        });
    }, []);

    // Theme application effect
    useEffect(() => {
        const root = document.documentElement;
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

        // Always clear any existing inline custom theme properties first
        const style = root.style;
        const toRemove = [];
        for (let i = 0; i < style.length; i++) {
            const propName = style[i];
            if (propName.startsWith('--')) {
                toRemove.push(propName);
            }
        }
        toRemove.forEach(prop => style.removeProperty(prop));

        const applySystemTheme = () => {
            const systemTheme = mediaQuery.matches ? 'dark' : 'light';
            root.setAttribute('data-theme', systemTheme);
        };

        // Remove listener before re-evaluating to prevent duplicates
        mediaQuery.removeEventListener('change', applySystemTheme);

        if (uiSettings.theme === 'system') {
            applySystemTheme();
            mediaQuery.addEventListener('change', applySystemTheme);
        } else if (uiSettings.theme === 'custom' && uiSettings.customTheme) {
            // Use a base theme for non-color properties like `color-scheme`
            root.setAttribute('data-theme', 'light');
            Object.entries(uiSettings.customTheme).forEach(([key, value]) => {
                root.style.setProperty(key, value);
            });
        } else {
            root.setAttribute('data-theme', uiSettings.theme);
        }

        return () => mediaQuery.removeEventListener('change', applySystemTheme);
    }, [uiSettings.theme, uiSettings.customTheme]);

    const updateGeoCache = useCallback(async (addresses: string[]) => {
        const unique = [...new Set(addresses)].filter(addr => !geoCache.has(addr));
        if (unique.length === 0) return;

        const results = await geocodeAddresses(unique);
        setGeoCache(prev => {
            const next = new Map(prev);
            unique.forEach((addr, i) => {
                if (results[i].coordinates) next.set(addr, results[i].coordinates!);
            });
            return next;
        });
    }, [geoCache]);

    useEffect(() => {
        const dailyState = history[historyIndex]?.get(formatDateToKey(selectedDate));
        if (dailyState) {
            const repZips = dailyState.reps.flatMap(r => (r.zipCodes || []).map(z => `${z}, Arizona, USA`));
            updateGeoCache(repZips);
        }
    }, [history, historyIndex, selectedDate, updateGeoCache]);


    const dailyStates = useMemo(() => history[historyIndex] || new Map(), [history, historyIndex]);

    const appState = useMemo(() => {
        return dailyStates.get(formatDateToKey(selectedDate)) || EMPTY_STATE;
    }, [dailyStates, selectedDate]);

    const getJobCountsForDay = (dateKey: string): { assigned: number; total: number } => {
        const dayState = dailyStates.get(dateKey);
        if (!dayState) return { assigned: 0, total: 0 };
        const assignedCount = dayState.reps.reduce((sum, rep) =>
            sum + rep.schedule.reduce((slotSum, slot) => slotSum + slot.jobs.length, 0), 0);
        const unassignedCount = dayState.unassignedJobs.length;
        return { assigned: assignedCount, total: assignedCount + unassignedCount };
    };

    const log = useCallback((message: string) => {
        const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
        setDebugLogs(prev => [...prev.slice(-10000), `[${timestamp}] ${message}`]);
    }, []);

    useEffect(() => {
        const loadAuxiliaryData = async () => {
            log('Fetching Roofr job IDs...');
            const idMap = await fetchRoofrJobIds();
            setRoofrJobIdMap(idMap);
            log(`- COMPLETE: Loaded ${idMap.size} Roofr job IDs.`);

            log('Fetching announcement message...');
            const message = await fetchAnnouncementMessage();
            if (message && !/^\d+$/.test(message.trim())) {
                setAnnouncement(message);
                log(`- ANNOUNCEMENT: "${message}"`);
            }
        };
        loadAuxiliaryData();
    }, [log]);

    const recordChange = useCallback((updater: (currentDailyStates: Map<string, AppState>) => Map<string, AppState>, actionName?: string) => {
        setHistory(prevHistory => {
            const currentDailyStates = prevHistory[historyIndex];
            const newDailyStates = updater(currentDailyStates);

            if (newDailyStates === currentDailyStates) {
                return prevHistory;
            }

            const newHistory = prevHistory.slice(0, historyIndex + 1);
            newHistory.push(newDailyStates);
            setHistoryIndex(newHistory.length - 1);
            if (actionName) log(`ACTION: ${actionName} (recorded in history)`);
            return newHistory;
        });
    }, [historyIndex, log]);

    const setAppState = useCallback((updater: AppState | ((prevState: AppState) => AppState)) => {
        const dateKey = formatDateToKey(selectedDate);
        recordChange(currentDailyStates => {
            const newDailyStates = new Map<string, AppState>(currentDailyStates);
            const currentDayState = newDailyStates.get(dateKey) || EMPTY_STATE;
            const newDayState = typeof updater === 'function' ? updater(currentDayState) : updater;
            newDailyStates.set(dateKey, newDayState);
            return newDailyStates;
        });
    }, [selectedDate, recordChange]);

    const canUndo = historyIndex > 0;
    const canRedo = historyIndex < history.length - 1;

    const handleUndo = useCallback(() => {
        if (canUndo) {
            setHistoryIndex(prev => prev - 1);
            log('ACTION: Undo');
            setActiveRoute(null);
        }
    }, [canUndo, log]);

    const handleRedo = useCallback(() => {
        if (canRedo) {
            setHistoryIndex(prev => prev - 1);
            log('ACTION: Redo');
            setActiveRoute(null);
        }
    }, [canRedo, log]);

    const updateSettings = useCallback((updatedSettings: Partial<Settings>) => {
        const dateKey = formatDateToKey(selectedDate);
        recordChange(currentDailyStates => {
            const newDailyStates = new Map<string, AppState>(currentDailyStates);
            const dayState = newDailyStates.get(dateKey) || EMPTY_STATE;
            const newSettings = {
                ...dayState.settings,
                ...updatedSettings,
                scoringWeights: { ...dayState.settings.scoringWeights, ...(updatedSettings.scoringWeights || {}) }
            };
            newDailyStates.set(dateKey, { ...dayState, settings: newSettings });
            return newDailyStates;
        }, 'Update Settings');
    }, [recordChange, selectedDate]);


    // Initialize with Tomorrow
    useEffect(() => {
        if (activeDayKeys.length === 0) {
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            tomorrow.setHours(12, 0, 0, 0);
            const tomorrowKey = formatDateToKey(tomorrow);

            setActiveDayKeys([tomorrowKey]);
            _setSelectedDate(tomorrow);
        }
    }, []);


    const addAiThought = useCallback((thought: string) => {
        setAiThoughts(prev => [...prev, thought]);
    }, []);

    const clearAiThoughts = useCallback(() => {
        setAiThoughts([]);
    }, []);

    const selectedDayString = useMemo(() => selectedDate.toLocaleString('en-us', { weekday: 'long' }), [selectedDate]);

    const getCityRegion = useCallback((city: string | undefined | null): Rep['region'] | null => {
        if (!city) return null;
        const normalizedCity = city.toLowerCase().trim();
        if (GREATER_PHOENIX_CITIES.has(normalizedCity)) return 'PHX';
        if (NORTHERN_AZ_CITIES.has(normalizedCity)) return 'NORTH';
        if (SOUTHERN_AZ_CITIES.has(normalizedCity)) return 'SOUTH';
        return null;
    }, []);

    const isJobValidForRepRegion = useCallback((job: Job, rep: Rep): boolean => {
        const jobCity = norm(job.city);
        if (!jobCity) return true;
        const jobRegion = getCityRegion(jobCity);

        // 1. London Smith: STRICT NORTH (North of Black Canyon City)
        if (isLondon(rep)) {
            if (jobRegion === 'NORTH') return true;
            // Allow in Phoenix only if explicit setting is ON
            if (jobRegion === 'PHX' && appState.settings.allowRegionalRepsInPhoenix) return true;
            return false;
        }

        // 2. Richard Hadsall & Joseph Simms: STRICT SOUTH (South of Eloy)
        if (isJoseph(rep) || isRichard(rep)) {
            if (jobRegion === 'SOUTH') return true;
            // Allow in Phoenix only if explicit setting is ON
            if (jobRegion === 'PHX' && appState.settings.allowRegionalRepsInPhoenix) return true;
            return false;
        }

        // 3. General Regional Logic
        if (jobRegion) {
            if (rep.region === 'UNKNOWN' || rep.region === jobRegion) return true;
            // Allow South Reps in PHX if setting is enabled (Only for generic South reps, not named restricted ones)
            if (appState.settings.allowRegionalRepsInPhoenix && rep.region === 'SOUTH' && jobRegion === 'PHX') {
                return true;
            }
            return false;
        }
        return true;
    }, [getCityRegion, appState.settings.allowRegionalRepsInPhoenix]);

    const checkCityRuleViolation = useCallback((rep: Rep, newJobCity: string | undefined | null): { violated: boolean; cities: Set<string> } => {
        const currentCitiesOriginalCase = new Set(rep.schedule.flatMap(s => s.jobs).map(j => j.city).filter((c): c is string => !!c));
        const currentCitiesLowercase = new Set(Array.from(currentCitiesOriginalCase).map(c => c.toLowerCase()));

        if (!newJobCity) return { violated: false, cities: currentCitiesOriginalCase };

        const newJobCityLower = newJobCity.toLowerCase();

        // If rep is already in this city, it's allowed
        if (currentCitiesLowercase.has(newJobCityLower)) {
            return { violated: false, cities: currentCitiesOriginalCase };
        }

        // 1. Check Max Cities Count
        if (currentCitiesLowercase.size >= appState.settings.maxCitiesPerRep) {
            return { violated: true, cities: currentCitiesOriginalCase };
        }

        // 2. Check Adjacency (Strict Mode)
        // If the rep already has cities, the new one MUST be adjacent to at least one of them.
        if (currentCitiesLowercase.size > 0) {
            const isAdjacent = Array.from(currentCitiesLowercase).some(existingCity => {
                const neighbors = ARIZONA_CITY_ADJACENCY[existingCity] || [];
                return neighbors.includes(newJobCityLower);
            });

            if (!isAdjacent) {
                return { violated: true, cities: currentCitiesOriginalCase };
            }
        }

        return { violated: false, cities: currentCitiesOriginalCase };
    }, [appState.settings.maxCitiesPerRep]);

    const allJobs = useMemo((): DisplayJob[] => {
        const jobs: DisplayJob[] = [];
        appState.reps.forEach(rep => rep.schedule.forEach(slot => slot.jobs.forEach(job => jobs.push({ ...job, assignedRepName: rep.name, timeSlotLabel: slot.label }))));
        appState.unassignedJobs.forEach(job => jobs.push({ ...job, assignedRepName: undefined, timeSlotLabel: job.originalTimeframe || 'Uncategorized' }));
        return jobs;
    }, [appState.reps, appState.unassignedJobs]);

    const assignedJobs = useMemo(() => allJobs.filter(job => job.assignedRepName), [allJobs]);
    const assignedJobsCount = useMemo(() => assignedJobs.length, [assignedJobs]);
    const assignedCities = useMemo(() => Array.from(new Set(assignedJobs.map(j => j.city).filter((c): c is string => !!c))).sort(), [assignedJobs]);
    const assignedRepNames = useMemo(() => Array.from(new Set(assignedJobs.map(j => j.assignedRepName).filter((name): name is string => !!name))).sort(), [assignedJobs]);

    const loadReps = useCallback(async (date: Date) => {
        const dateKey = formatDateToKey(date);

        // Block completely if cloud load is in progress
        if (isCloudLoading) {
            log(`Cloud load in progress, skipping loadReps for ${dateKey}.`);
            return;
        }

        if (dailyStates.has(dateKey)) {
            log(`State for ${dateKey} already loaded.`);
            return;
        }

        // Skip if this day was loaded from cloud (prevents overwriting cloud data)
        if (cloudLoadedDaysRef.current.has(dateKey)) {
            log(`State for ${dateKey} was loaded from cloud, skipping loadReps.`);
            return;
        }

        try {
            setIsLoadingReps(true);
            setRepsError(null);
            setUsingMockData(false);
            setActiveRoute(null);
            const { reps: repData, sheetName } = await fetchSheetData(date);
            setActiveSheetName(sheetName);
            if (repData.length > 0 && (repData[0] as Rep).isMock) setUsingMockData(true);
            const repsWithSchedule = repData.map(rep => ({
                ...rep,
                schedule: TIME_SLOTS.map(slot => ({ ...slot, jobs: [] })),
                isLocked: false,
                isOptimized: false
            }));

            const allRepZips = repsWithSchedule.flatMap(r => r.zipCodes || []).map(z => `${z}, Arizona, USA`);
            if (allRepZips.length > 0) {
                updateGeoCache(allRepZips);
            }

            const newDayState: AppState = { reps: repsWithSchedule, unassignedJobs: [], settings: DEFAULT_SETTINGS };

            // Check again if cloud loaded this day while we were fetching (race condition protection)
            if (cloudLoadedDaysRef.current.has(dateKey)) {
                log(`State for ${dateKey} was loaded from cloud during fetch, aborting loadReps.`);
                return;
            }

            const newDailyStates = new Map(dailyStates).set(dateKey, newDayState);
            setHistory([newDailyStates]);
            setHistoryIndex(0);

            if (repsWithSchedule.length > 0) {
                setSelectedRepId(currentId => currentId ? currentId : repsWithSchedule[0].id);
                setExpandedRepIds(new Set([repsWithSchedule[0].id]));
            } else {
                setExpandedRepIds(new Set());
            }

            // Attempt to load saved state from Google Sheets API
            try {
                log('Checking for saved state on server...');
                const savedState = await loadState(dateKey);
                if (savedState.success && savedState.data) {
                    log('Found saved state! Merging...');
                    const loadedData = savedState.data;

                    // Merge settings
                    if (loadedData.settings) {
                        newDayState.settings = { ...newDayState.settings, ...loadedData.settings };
                    }

                    // Merge unassigned jobs
                    if (loadedData.unassignedJobs) {
                        newDayState.unassignedJobs = loadedData.unassignedJobs;
                    }

                    // Merge rep schedules
                    // We iterate over the *loaded* reps to find their assignments,
                    // and map them to the *freshly fetched* reps (repsWithSchedule) to ensure we have latest metadata.
                    if (loadedData.reps) {
                        const savedRepsMap = new Map(loadedData.reps.map(r => [r.id, r]));

                        newDayState.reps = newDayState.reps.map(currentRep => {
                            const savedRep = savedRepsMap.get(currentRep.id);
                            if (savedRep && savedRep.schedule) {
                                return {
                                    ...currentRep,
                                    schedule: savedRep.schedule,
                                    // Preserve other dynamic properties if needed, or overwrite if saved state is source of truth
                                };
                            }
                            return currentRep;
                        });
                    }
                } else {
                    log('No saved state found (or empty). Using defaults.');
                }
            } catch (loadErr) {
                console.warn('Background load failed (non-fatal):', loadErr);
                log('Background load failed. Using fresh data.');
            }

            // Final check before committing - abort if cloud loaded this day
            if (cloudLoadedDaysRef.current.has(dateKey)) {
                log(`State for ${dateKey} was loaded from cloud, not overwriting with local data.`);
                return;
            }

            const mergedDailyStates = new Map(dailyStates).set(dateKey, newDayState);
            setHistory([mergedDailyStates]);
            setHistoryIndex(0);
        } catch (error) {
            console.error('Failed to load rep data:', error);
            setRepsError('An error occurred while fetching data. See console for details.');
        } finally {
            setIsLoadingReps(false);
        }
    }, [dailyStates, log, updateGeoCache, isCloudLoading]);

    // ============ Routing API Integration Functions ============

    /**
     * Flush the sync queue - send all pending assignments to the Routing API.
     */
    const flushRoutingApiSyncQueue = useCallback(async () => {
        const queue: RoutingApiSyncItem[] = Array.from(routingApiSyncQueueRef.current.values());
        if (queue.length === 0) return;

        log(`[RoutingAPI] Syncing ${queue.length} assignments...`);
        setRoutingApiSyncStatus('syncing');

        let successCount = 0;
        let errorCount = 0;

        for (const item of queue) {
            try {
                await createAppointment({
                    jobId: item.jobId,
                    repId: item.repId,
                    date: item.dateKey,
                    timeSlotId: item.slotId,
                });
                successCount++;
                log(`[RoutingAPI] Synced: ${item.jobId} -> rep ${item.repId}`);
            } catch (error) {
                errorCount++;
                console.error(`[RoutingAPI] Failed to sync job ${item.jobId}:`, error);
                log(`[RoutingAPI] ERROR syncing ${item.jobId}: ${error}`);
            }
        }

        routingApiSyncQueueRef.current.clear();

        if (errorCount > 0) {
            setRoutingApiSyncStatus('error');
            showToast(`Sync completed with ${errorCount} errors`, 'error');
        } else {
            setRoutingApiSyncStatus('synced');
            showToast(`Synced ${successCount} assignments to Routing API`, 'success');
        }

        log(`[RoutingAPI] Sync complete: ${successCount} success, ${errorCount} errors`);
    }, [log, showToast]);

    /**
     * Queue a job assignment for syncing to the Routing API.
     */
    const queueRoutingApiSync = useCallback((item: { jobId: string; repId: string; slotId: string; dateKey: string }) => {
        routingApiSyncQueueRef.current.set(item.jobId, item);
        log(`[RoutingAPI] Queued sync for job ${item.jobId}`);

        // Clear existing timer and set a new debounced one
        if (routingApiSyncTimerRef.current) {
            clearTimeout(routingApiSyncTimerRef.current);
        }

        routingApiSyncTimerRef.current = setTimeout(() => {
            flushRoutingApiSyncQueue();
        }, ROUTING_API_SYNC_DEBOUNCE_MS);
    }, [log, flushRoutingApiSyncQueue]);

    /**
     * Load jobs from the Routing API for all active days.
     * Uses the day schedule endpoint which returns jobs with their assignments.
     */
    const loadJobsFromRoutingApi = useCallback(async () => {
        // Note: Don't check useRoutingApi here - state may not be updated yet when called from toggle
        try {
            setIsLoadingFromRoutingApi(true);
            setRoutingApiError(null);
            log('[RoutingAPI] Fetching day schedules for active days...');

            let totalAssigned = 0;

            // Load schedule for each active day
            for (const dateKey of activeDayKeys) {
                try {
                    log(`[RoutingAPI] Fetching schedule for ${dateKey}...`);
                    const daySchedule = await fetchDaySchedule(dateKey);

                    // Count jobs
                    const assignedCount = daySchedule.reps?.reduce(
                        (sum, rep) => sum + rep.schedule?.reduce(
                            (slotSum, slot) => slotSum + (slot.jobs?.length || 0), 0
                        ) || 0, 0
                    ) || 0;

                    totalAssigned += assignedCount;

                    log(`[RoutingAPI] ${dateKey}: ${assignedCount} assigned jobs`);

                    // Update the day's state with the Routing API data
                    recordChange(currentDailyStates => {
                        const newDailyStates = new Map<string, AppState>(currentDailyStates);
                        const existingDayState = newDailyStates.get(dateKey);

                        if (!existingDayState) {
                            log(`[RoutingAPI] No existing state for ${dateKey}, skipping`);
                            return currentDailyStates;
                        }

                        // Create a new state with merged data
                        const newState: AppState = JSON.parse(JSON.stringify(existingDayState));

                        // Merge jobs from Routing API into existing reps
                        if (daySchedule.reps && daySchedule.reps.length > 0) {
                            const apiRepsMap = new Map(daySchedule.reps.map(r => [r.name.toLowerCase().trim(), r]));

                            for (const rep of newState.reps) {
                                const apiRep = apiRepsMap.get(rep.name.toLowerCase().trim());
                                if (apiRep && apiRep.schedule) {
                                    // Merge jobs from API into rep's schedule
                                    for (const apiSlot of apiRep.schedule) {
                                        const repSlot = rep.schedule.find(s => s.id === apiSlot.id);
                                        if (repSlot && apiSlot.jobs && apiSlot.jobs.length > 0) {
                                            // Add jobs that don't already exist
                                            const existingJobIds = new Set(repSlot.jobs.map(j => j.id));
                                            for (const apiJob of apiSlot.jobs) {
                                                if (!existingJobIds.has(apiJob.id)) {
                                                    const mappedJob = mapRoutingApiJobToAppJob(apiJob);
                                                    repSlot.jobs.push({
                                                        ...mappedJob,
                                                        assignedRepName: rep.name,
                                                        timeSlotLabel: repSlot.label,
                                                    } as DisplayJob);
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        // NOTE: We intentionally skip unassignedJobs from the Routing API
                        // because they aren't date-filtered (returns ALL pending jobs in database).
                        // Scanner jobs are auto-assigned, so they appear in reps' schedules above.

                        newDailyStates.set(dateKey, newState);
                        return newDailyStates;
                    }, 'Load from Routing API');

                } catch (dayError) {
                    console.error(`[RoutingAPI] Failed to load ${dateKey}:`, dayError);
                    log(`[RoutingAPI] ERROR loading ${dateKey}: ${dayError}`);
                }
            }

            if (totalAssigned > 0) {
                showToast(`Loaded ${totalAssigned} assigned jobs from Routing API`, 'success');
            } else {
                showToast('No assigned jobs found in Routing API for active days', 'info');
            }

        } catch (error) {
            console.error('[RoutingAPI] Failed to load jobs:', error);
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            setRoutingApiError(errorMsg);
            showToast(`Failed to load from Routing API: ${errorMsg}`, 'error');
            log(`[RoutingAPI] ERROR: ${errorMsg}`);
        } finally {
            setIsLoadingFromRoutingApi(false);
        }
    }, [useRoutingApi, activeDayKeys, log, showToast, recordChange]);

    /**
     * Toggle Routing API mode on/off.
     */
    const toggleRoutingApiMode = useCallback((enabled: boolean) => {
        setUseRoutingApi(enabled);
        log(`[RoutingAPI] Mode ${enabled ? 'enabled' : 'disabled'}`);

        if (enabled) {
            // Load jobs when enabling
            loadJobsFromRoutingApi();
        } else {
            // Clear sync queue when disabling
            if (routingApiSyncTimerRef.current) {
                clearTimeout(routingApiSyncTimerRef.current);
            }
            routingApiSyncQueueRef.current.clear();
            setRoutingApiSyncStatus('idle');
        }
    }, [log, loadJobsFromRoutingApi]);

    const setSelectedDate = useCallback((date: Date) => {
        const dateKey = formatDateToKey(date);
        if (!activeDayKeys.includes(dateKey)) return;

        const currentDateKey = formatDateToKey(selectedDate);
        if (dateKey !== currentDateKey) {
            _setSelectedDate(date);
            setActiveRoute(null);
            setSelectedRepId(null);
            setHasInitializedMap(false); // Reset initialization flag for new date
            log(`Switched view to date: ${dateKey}`);
        }
    }, [activeDayKeys, selectedDate, log]);

    const addActiveDay = useCallback((date: Date) => {
        const dateKey = formatDateToKey(date);
        if (!activeDayKeys.includes(dateKey)) {
            setActiveDayKeys(prev => [...prev, dateKey].sort());
        }
        _setSelectedDate(date);
        setActiveRoute(null);
        setSelectedRepId(null);
        setHasInitializedMap(false); // Reset initialization flag for new date
        log(`Added day ${dateKey} to workspace.`);
    }, [activeDayKeys, log]);

    const removeActiveDay = useCallback((dateKeyToRemove: string) => {
        const newActiveDayKeys = activeDayKeys.filter(k => k !== dateKeyToRemove);
        if (newActiveDayKeys.length === 0) return;

        setActiveDayKeys(newActiveDayKeys);

        const currentSelectedKey = formatDateToKey(selectedDate);
        if (currentSelectedKey === dateKeyToRemove) {
            _setSelectedDate(new Date(newActiveDayKeys[0] + 'T12:00:00'));
            setActiveRoute(null);
            setSelectedRepId(null);
            setHasInitializedMap(false); // Reset initialization flag
        }
        log(`Removed day ${dateKeyToRemove} from workspace.`);
    }, [activeDayKeys, selectedDate, log]);

    // Initialize next 7 days on app startup
    useEffect(() => {
        // Only run if activeDayKeys is empty (first load)
        if (activeDayKeys.length > 0) return;

        const today = new Date();
        today.setHours(12, 0, 0, 0); // Noon to avoid timezone issues

        const next7Days: string[] = [];
        for (let i = 0; i < 7; i++) {
            const date = new Date(today);
            date.setDate(today.getDate() + i);
            next7Days.push(formatDateToKey(date));
        }

        setActiveDayKeys(next7Days);
        log('Initialized next 7 days on startup');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // Run once on mount

    // Auto-save effect
    const saveTimeoutRef = useRef<any>(null);

    useEffect(() => {
        const dateKey = formatDateToKey(selectedDate);
        if (isLoadingReps || isParsing || usingMockData) return;

        const currentAppState = dailyStates.get(dateKey);
        if (!currentAppState) return;

        // Debounce save
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

        saveTimeoutRef.current = setTimeout(async () => {
            // Basic check to see if we have anything meaningful to save
            const hasData = currentAppState.reps.some(r => r.schedule.some(s => s.jobs.length > 0)) || currentAppState.unassignedJobs.length > 0;
            if (!hasData) return;

            // log('Auto-saving state...'); // Commented out to avoid log spam
            await saveState(dateKey, currentAppState);
        }, 3000);

        return () => {
            if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        };
    }, [dailyStates, selectedDate, isLoadingReps, isParsing, usingMockData]);

    useEffect(() => {
        // Don't trigger loadReps if cloud loading is in progress
        if (isCloudLoading) {
            return;
        }
        const dateKey = formatDateToKey(selectedDate);
        // Skip if this day was loaded from cloud OR if it already exists in dailyStates
        if (cloudLoadedDaysRef.current.has(dateKey)) {
            return;
        }
        if (!dailyStates.has(dateKey)) {
            loadReps(selectedDate);
        }
    }, [selectedDate, dailyStates, loadReps, isCloudLoading]);


    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Alt') setIsOverrideActive(true);
        };
        const handleKeyUp = (e: KeyboardEvent) => { if (e.key === 'Alt') setIsOverrideActive(false); };
        const handleBlur = () => setIsOverrideActive(false);
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        window.addEventListener('blur', handleBlur);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
            window.removeEventListener('blur', handleBlur);
        };
    }, []);

    const handleJobDragEnd = useCallback(() => {
        setDraggedJob(null);
        setDraggedOverRepId(null);
    }, []);

    const calculateAssignmentScore = useCallback((job: Job, rep: Rep, slotId: string, allSettings: Settings): { score: number, breakdown: ScoreBreakdown } => {
        const overrides = rep.scoringOverrides || {};
        const weights = { ...allSettings.scoringWeights, ...overrides };

        // Initialize all scores
        let timeframeMatchScore = 0;
        let performanceScore = 0;
        let skillRoofingScore = 0;
        let skillTypeScore = 0;
        let distanceClusterScore = 0;
        let distanceBaseScore = 0;
        let penalty = 0;

        const notesLower = job.notes.toLowerCase();
        const existingJobs = rep.schedule.flatMap(s => s.jobs);

        // ============================================================
        // PRIORITY 1: TIMEFRAME MATCHING (HIGHEST - weight 10)
        // The job MUST be scheduled at the customer's requested time
        // ============================================================
        const slot = rep.schedule.find(s => s.id === slotId);
        const slotLabel = slot?.label || '';

        if (job.originalTimeframe) {
            // Check if the job's requested timeframe overlaps with this slot
            const overlaps = doTimesOverlap(job.originalTimeframe, slotLabel);
            if (overlaps) {
                timeframeMatchScore = 100; // Perfect match
            } else {
                // No overlap - this is a BAD placement for timeframe
                // But we still allow it (just scored lower)
                timeframeMatchScore = 20; // Significant penalty for wrong time
            }
        } else {
            // No timeframe specified - any slot is fine
            timeframeMatchScore = 80; // Slightly lower since we prefer explicit matches
        }

        // ============================================================
        // PRIORITY 2: SALES RANK / PERFORMANCE (HIGH - weight 8)
        // Priority leads (#) should go to top-ranked reps
        // ============================================================
        const isPriority = job.notes.includes('#');
        const rank = rep.salesRank || 99;

        if (isPriority) {
            // For priority leads, rank matters a lot
            if (rank === 1) performanceScore = 100;
            else if (rank === 2) performanceScore = 95;
            else if (rank === 3) performanceScore = 90;
            else if (rank <= 5) performanceScore = 85;
            else if (rank <= 10) performanceScore = 75;
            else if (rank <= 20) performanceScore = 50;
            else performanceScore = Math.max(10, 50 - ((rank - 20) * 2));
        } else {
            // Non-priority leads - rank still matters but less
            // We want to spread work evenly, so unranked/lower reps get more regular jobs
            if (rank <= 10) performanceScore = 70; // Top reps still get slight preference
            else if (rank <= 20) performanceScore = 80; // Mid-tier reps are good for regular
            else performanceScore = 90; // Unranked reps should get regular jobs
            // Reduce weight for non-priority
            weights.performance = weights.performance * 0.3;
        }

        // ============================================================
        // PRIORITY 3: SKILL MATCHING (MEDIUM - weights 5 + 4)
        // Assign reps with the right skillset
        // ============================================================

        // 3a. Roofing Material Skills (Tile, Shingle, Flat, Metal)
        const roofTags = ROOF_KEYWORDS.filter(keyword => new RegExp(`\\b${keyword.toLowerCase()}\\b`).test(notesLower));
        if (roofTags.length > 0) {
            // Check if rep has ANY skill in the required areas
            const hasZeroSkill = roofTags.some(tag => (rep.skills?.[tag] || 0) === 0);
            if (hasZeroSkill) {
                // Rep cannot do this job type at all - disqualify
                return {
                    score: -1,
                    breakdown: { timeframeMatch: 0, performance: 0, skillRoofing: 0, skillType: 0, distanceCluster: 0, distanceBase: 0, penalty: 1000 }
                };
            }
            const totalSkill = roofTags.reduce((acc, tag) => acc + (rep.skills?.[tag] || 0), 0);
            skillRoofingScore = Math.min(100, ((totalSkill / roofTags.length) / 3) * 100);
        } else {
            // No specific roof type - everyone can do it
            skillRoofingScore = 70;
        }

        // 3b. Specialty Type Skills (Insurance, Commercial)
        const typeTags = TYPE_KEYWORDS.filter(keyword => new RegExp(`\\b${keyword.toLowerCase()}\\b`).test(notesLower));
        let isSpecialist = false;

        if (typeTags.length > 0) {
            const hasZeroSkill = typeTags.some(tag => (rep.skills?.[tag] || 0) === 0);
            if (hasZeroSkill) {
                // Rep cannot do this specialty - disqualify
                return {
                    score: -1,
                    breakdown: { timeframeMatch: 0, performance: 0, skillRoofing: 0, skillType: 0, distanceCluster: 0, distanceBase: 0, penalty: 1000 }
                };
            }
            const totalSkill = typeTags.reduce((acc, tag) => acc + (rep.skills?.[tag] || 0), 0);
            skillTypeScore = Math.min(100, ((totalSkill / typeTags.length) / 3) * 100);
            if (typeTags.some(tag => (rep.skills?.[tag] || 0) >= 3)) {
                isSpecialist = true;
            }
        } else {
            // No specialty required
            skillTypeScore = 70;
            weights.skillType = weights.skillType * 0.3; // Reduce weight when not needed
        }

        // ============================================================
        // PRIORITY 4: DISTANCE / CLUSTERING (LOWEST - weights 2 + 1)
        // Travel distance is the LAST consideration
        // ============================================================

        const jobCity = norm(job.city);
        const jobRegion = getCityRegion(jobCity);
        const maxReasonableMiles = jobRegion === 'PHX' ? 50 : 80; // More lenient - distance is low priority

        // 4a. Distance from home (LOWEST priority)
        if (!rep.zipCodes || rep.zipCodes.length === 0) {
            weights.distanceBase = 0;
            distanceBaseScore = 50; // Neutral if no home set
        } else {
            const jobCoord = geoCache.get(job.address);
            const homeZipAddress = `${rep.zipCodes[0]}, Arizona, USA`;
            const homeCoord = geoCache.get(homeZipAddress);
            if (jobCoord && homeCoord) {
                const distMiles = haversineDistance(homeCoord, jobCoord) * 0.621371;
                // Very lenient scoring - distance is lowest priority
                if (distMiles < 15) distanceBaseScore = 100;
                else if (distMiles < 30) distanceBaseScore = 80;
                else if (distMiles < 50) distanceBaseScore = 60;
                else distanceBaseScore = 40; // Even far is OK
            } else {
                distanceBaseScore = 50;
            }
        }

        // 4b. Distance to cluster (LOW priority)
        if (existingJobs.length > 0) {
            const jobCoord = geoCache.get(job.address);
            if (jobCoord) {
                let nearestDistKm = Infinity;
                existingJobs.forEach(ej => {
                    const ejCoord = geoCache.get(ej.address);
                    if (ejCoord) {
                        const d = haversineDistance(jobCoord, ejCoord);
                        if (d < nearestDistKm) nearestDistKm = d;
                    }
                });
                if (nearestDistKm !== Infinity) {
                    const distMiles = nearestDistKm * 0.621371;
                    // Lenient clustering - it's nice to have but not required
                    if (distMiles < 10) distanceClusterScore = 100;
                    else if (distMiles < 20) distanceClusterScore = 80;
                    else if (distMiles < 35) distanceClusterScore = 60;
                    else distanceClusterScore = 40;
                } else {
                    distanceClusterScore = 50;
                }
            } else {
                // Fallback to city matching
                const repCities = new Set(existingJobs.map(j => norm(j.city)));
                if (repCities.has(jobCity)) distanceClusterScore = 100;
                else {
                    const isAdjacent = Array.from(repCities).some(city => (ARIZONA_CITY_ADJACENCY[city] || []).includes(jobCity));
                    distanceClusterScore = isAdjacent ? 70 : 40;
                }
            }
        } else {
            // No existing jobs - use home distance as cluster score
            distanceClusterScore = distanceBaseScore;
        }

        // ============================================================
        // PENALTIES (only for availability - geography penalties removed)
        // ============================================================
        const isUnavailable = (rep.unavailableSlots?.[selectedDayString] || []).includes(slotId);
        if (isUnavailable) {
            penalty += (allSettings.unavailabilityPenalty * 50);
        }

        // ============================================================
        // FINAL WEIGHTED SCORE CALCULATION
        // ============================================================
        const totalWeight = weights.timeframeMatch + weights.performance + weights.skillRoofing + weights.skillType + weights.distanceCluster + weights.distanceBase;

        let weightedScore = 0;
        if (totalWeight > 0) {
            weightedScore = (
                (timeframeMatchScore * weights.timeframeMatch) +
                (performanceScore * weights.performance) +
                (skillRoofingScore * weights.skillRoofing) +
                (skillTypeScore * weights.skillType) +
                (distanceClusterScore * weights.distanceCluster) +
                (distanceBaseScore * weights.distanceBase)
            ) / totalWeight;
        }

        let finalScore = Math.max(1, Math.min(100, Math.round(weightedScore - penalty)));

        // Specialist bonus
        if (isSpecialist) {
            finalScore = Math.min(100, finalScore + 15);
        }

        return {
            score: finalScore,
            breakdown: {
                timeframeMatch: timeframeMatchScore,
                performance: isPriority ? performanceScore : 0,
                skillRoofing: skillRoofingScore,
                skillType: skillTypeScore,
                distanceCluster: distanceClusterScore,
                distanceBase: distanceBaseScore,
                penalty: penalty
            }
        };
    }, [selectedDayString, getCityRegion, geoCache]);

    const handleUnassignJob = useCallback((jobId: string) => {
        const dateKey = formatDateToKey(selectedDate);
        recordChange(currentDailyStates => {
            const newDailyStates = new Map<string, AppState>(currentDailyStates);
            const dayState = newDailyStates.get(dateKey);
            if (!dayState) return currentDailyStates;
            const newState = JSON.parse(JSON.stringify(dayState)) as AppState;
            let jobToUnassign: DisplayJob | undefined;
            for (const rep of newState.reps) {
                for (const repSlot of rep.schedule) {
                    const jobIndex = repSlot.jobs.findIndex(j => j.id === jobId);
                    if (jobIndex > -1) { [jobToUnassign] = repSlot.jobs.splice(jobIndex, 1); break; }
                }
                if (jobToUnassign) break;
            }
            if (!jobToUnassign) return currentDailyStates;
            jobToUnassign.notes = (jobToUnassign.notes || '').replace(/\(Scheduled: [^)]+\)\s*/, '').trim();
            delete jobToUnassign.assignmentScore;
            delete jobToUnassign.scoreBreakdown;
            delete jobToUnassign.timeSlotLabel;

            if (!newState.unassignedJobs.some(j => j.id === jobToUnassign!.id)) {
                newState.unassignedJobs.push(jobToUnassign);
            }
            newState.unassignedJobs.sort((a, b) => (a.city || '').localeCompare(b.city || ''));
            newDailyStates.set(dateKey, newState);
            return newDailyStates;
        }, 'Unassign Job');
        setMapRefreshTrigger(prev => prev + 1); // Refresh map to reflect change (remove pin or change color)
    }, [recordChange, selectedDate]);

    const handleJobDrop = useCallback((jobId: string, target: { repId: string; slotId: string } | 'unassigned', e?: React.DragEvent<HTMLDivElement>) => {
        if (target === 'unassigned') { handleUnassignJob(jobId); return; }

        const targetRepInfo = appState.reps.find(r => r.id === target.repId);
        if (targetRepInfo?.isOptimized) { showToast("Cannot modify an optimized schedule.", 'warning'); return; }

        const dateKey = formatDateToKey(selectedDate);
        const jobToDrop = appState.unassignedJobs.find(j => j.id === jobId) || appState.reps.flatMap(r => r.schedule.flatMap(s => s.jobs)).find(j => j.id === jobId);
        if (jobToDrop) updateGeoCache([jobToDrop.address]);

        recordChange(currentDailyStates => {
            const newDailyStates = new Map<string, AppState>(currentDailyStates);
            const dayState = newDailyStates.get(dateKey);
            if (!dayState) return currentDailyStates;
            const newState = JSON.parse(JSON.stringify(dayState)) as AppState;
            let jobToMove: DisplayJob | undefined;

            const unassignedIndex = newState.unassignedJobs.findIndex(job => job.id === jobId);
            if (unassignedIndex > -1) { [jobToMove] = newState.unassignedJobs.splice(unassignedIndex, 1); }
            else {
                for (const rep of newState.reps) {
                    for (const repSlot of rep.schedule) {
                        const jobIndex = repSlot.jobs.findIndex(job => job.id === jobId);
                        if (jobIndex > -1) { [jobToMove] = repSlot.jobs.splice(jobIndex, 1); break; }
                    }
                    if (jobToMove) break;
                }
            }
            if (!jobToMove) return currentDailyStates;

            jobToMove.notes = (jobToMove.notes || '').replace(/\(Scheduled: [^)]+\)\s*/, '').trim();
            const targetRep = newState.reps.find(r => r.id === target.repId);
            if (targetRep) {
                const targetSlot = targetRep.schedule.find(s => s.id === target.slotId);
                if (targetSlot) {
                    const { score, breakdown } = calculateAssignmentScore(jobToMove, targetRep, targetSlot.id, newState.settings);
                    targetSlot.jobs.push({ ...jobToMove, assignmentScore: score, scoreBreakdown: breakdown });
                }
            }
            newDailyStates.set(dateKey, newState);
            return newDailyStates;
        }, 'Drop Job');

        if (activeRoute) {
            setMapRefreshTrigger(prev => prev + 1);
        } else {
            setAutoMapAction(target.repId);
        }

        setSelectedRepId(target.repId);
        setExpandedRepIds(prev => new Set(prev).add(target.repId));

        // Queue sync to Routing API if enabled
        if (useRoutingApi) {
            queueRoutingApiSync({
                jobId,
                repId: target.repId,
                slotId: target.slotId,
                dateKey: formatDateToKey(selectedDate),
            });
        }
    }, [handleUnassignJob, appState.reps, appState.unassignedJobs, selectedDate, recordChange, calculateAssignmentScore, updateGeoCache, activeRoute, useRoutingApi, queueRoutingApiSync]);

    const handleShowFilteredJobsOnMap = useCallback(async (jobs: DisplayJob[], title: string) => {
        const requestId = ++mapRequestRef.current;
        log(`ACTION: Show Filtered Jobs on Map: ${title} (${jobs.length} items).`);

        setIsRouting(true);
        setSelectedRepId(null);

        try {
            if (jobs.length === 0) {
                if (mapRequestRef.current === requestId) {
                    setActiveRoute(null);
                }
                return;
            }

            const addresses = jobs.map(j => j.address);
            const coordsResults = await geocodeAddresses(addresses);

            if (mapRequestRef.current !== requestId) {
                return;
            }

            const mappableJobs: DisplayJob[] = [];
            const unmappableJobs: DisplayJob[] = [];
            const mappableCoords: Coordinates[] = [];

            jobs.forEach((job, index) => {
                const result = coordsResults[index];
                if (result.coordinates) {
                    mappableJobs.push(job);
                    mappableCoords.push(result.coordinates);
                } else {
                    unmappableJobs.push({ ...job, geocodeError: result.error || 'Unknown' });
                }
            });

            const routeInfo: RouteInfo = {
                distance: 0,
                duration: 0,
                geometry: null,
                coordinates: mappableCoords
            };

            setActiveRoute({ repName: title, mappableJobs, unmappableJobs, routeInfo });
        } catch (error) {
            console.error("Failed to show filtered jobs:", error);
        } finally {
            if (mapRequestRef.current === requestId) {
                setIsRouting(false);
            }
        }
    }, [log]);

    useEffect(() => {
        const timer = setTimeout(() => {
            // Note: "Job Map" now always shows ALL jobs - dimming is handled in RoutePanel based on selectedRepId
            // We no longer filter the map content based on filteredAssignedJobs for "Job Map" view
            if (activeRoute?.repName === 'Unassigned Jobs') {
                handleShowFilteredJobsOnMap(filteredUnassignedJobs, 'Unassigned Jobs');
            }
        }, 300);
        return () => clearTimeout(timer);
    }, [filteredUnassignedJobs, activeRoute?.repName, handleShowFilteredJobsOnMap]);


    const handleShowRoute = useCallback(async (repId: string, optimize: boolean) => {
        const requestId = ++mapRequestRef.current;
        const rep = appState.reps.find(r => r.id === repId);
        if (!rep) return;
        setSelectedRepId(repId);
        log(`ACTION: ${optimize ? 'Optimize & Show' : 'Show'} Route for ${rep.name}`);
        setIsRouting(true);

        // 1. Prepare Rep's Jobs (The "Route")
        let jobsForRoute: DisplayJob[] = rep.schedule.flatMap(slot => slot.jobs.map(job => ({ ...job, timeSlotLabel: slot.label, assignedRepName: rep.name })));

        if (!rep.isOptimized) {
            jobsForRoute.sort((a, b) => getSortableHour(a.originalTimeframe) - getSortableHour(b.originalTimeframe));
        }

        jobsForRoute.forEach((job, idx) => {
            job.markerLabel = String(idx + 1);
        });

        if (rep.zipCodes && rep.zipCodes.length > 0) {
            const homeZip = rep.zipCodes[0];
            const homeJob: DisplayJob = {
                id: `home-${rep.id}`,
                customerName: 'Start: Home Base',
                address: `${homeZip}, Arizona, USA`,
                notes: `Rep Home: ${homeZip}`,
                city: homeZip,
                zipCode: homeZip,
                assignedRepName: rep.name,
                timeSlotLabel: 'Start',
                isStartLocation: true,
                assignmentScore: 100,
                markerLabel: undefined // Ensure Home Base has no number label so it gets the icon
            };
            jobsForRoute = [homeJob, ...jobsForRoute];
        }

        // 2. Prepare ALL OTHER Jobs (Context)
        // We want to show these on the map but NOT include them in the route line
        const otherJobs: DisplayJob[] = [];

        // Add jobs from other reps
        appState.reps.forEach(r => {
            if (r.id !== repId) {
                r.schedule.forEach(slot => {
                    slot.jobs.forEach(job => {
                        otherJobs.push({ ...job, timeSlotLabel: slot.label, assignedRepName: r.name });
                    });
                });
            }
        });

        // Add unassigned jobs
        appState.unassignedJobs.forEach(job => {
            otherJobs.push({ ...job, assignedRepName: undefined, timeSlotLabel: job.originalTimeframe || 'Uncategorized' });
        });

        // Combine for geocoding: Rep's jobs FIRST, then others
        const allJobsToMap = [...jobsForRoute, ...otherJobs];

        if (allJobsToMap.length === 0) {
            if (mapRequestRef.current === requestId) {
                setActiveRoute({ repName: rep.name, mappableJobs: [], unmappableJobs: [], routeInfo: null });
                setIsRouting(false);
            }
            return;
        }

        // 3. Geocode Everything
        const addresses = allJobsToMap.map(j => j.address);
        const coordsResults = await geocodeAddresses(addresses);
        if (mapRequestRef.current !== requestId) return;

        const mappableJobs: DisplayJob[] = [];
        const unmappableJobs: DisplayJob[] = [];
        const allCoords: Coordinates[] = [];

        // Track coordinates specifically for the route calculation
        const routeCoords: Coordinates[] = [];

        allJobsToMap.forEach((job, index) => {
            const result = coordsResults[index];
            if (result.coordinates) {
                mappableJobs.push(job);
                allCoords.push(result.coordinates);

                // If this job is part of the rep's route (it was in the first N items), add to routeCoords
                if (index < jobsForRoute.length) {
                    routeCoords.push(result.coordinates);
                }
            } else {
                unmappableJobs.push({ ...job, geocodeError: result.error || 'Unknown geocoding error' });
            }
        });

        // 4. Calculate Route (ONLY for Rep's jobs)
        // We only pass the coordinates belonging to the rep's schedule
        const route = await fetchRoute(routeCoords);
        if (mapRequestRef.current !== requestId) return;

        const finalMappableJobs = [...mappableJobs];
        const finalUnmappableJobs = [...unmappableJobs];

        // We want markers for ALL mappable jobs
        // Use allCoords for the coordinates property so markers are generated for everything
        const allCoordsForMap = [...allCoords];

        const finalRouteInfo: RouteInfo | null = route ? {
            ...route,
            coordinates: allCoordsForMap // Pass ALL coordinates so markers appear
        } : routeCoords.length > 0 ? {
            distance: 0,
            duration: 0,
            geometry: null,
            coordinates: allCoordsForMap
        } : null;

        setActiveRoute({ repName: rep.name, mappableJobs: finalMappableJobs, unmappableJobs: finalUnmappableJobs, routeInfo: finalRouteInfo });
        setIsRouting(false);
    }, [appState.reps, log, allJobs]);

    const handleShowUnassignedJobsOnMap = useCallback(async (jobs?: Job[]) => {
        const requestId = ++mapRequestRef.current;
        const targetJobs = jobs || appState.unassignedJobs;
        log(`ACTION: Show Unassigned Jobs on Map (${targetJobs.length} items).`);

        if (targetJobs.length === 0) {
            if (mapRequestRef.current === requestId) {
                setActiveRoute(null);
            }
            return;
        }

        setIsRouting(true);
        setSelectedRepId(null);
        try {
            const addresses = targetJobs.map(j => j.address);
            const coordsResults = await geocodeAddresses(addresses);
            if (mapRequestRef.current !== requestId) return;

            const mappableJobs: DisplayJob[] = [];
            const unmappableJobs: DisplayJob[] = [];
            const mappableCoords: Coordinates[] = [];
            targetJobs.forEach((job, index) => {
                const result = coordsResults[index];
                if (result.coordinates) { mappableJobs.push(job); mappableCoords.push(result.coordinates); }
                else { unmappableJobs.push({ ...job, geocodeError: result.error || 'Unknown' }); }
            });

            const routeInfo: RouteInfo = {
                distance: 0,
                duration: 0,
                geometry: null,
                coordinates: mappableCoords
            };

            setActiveRoute({ repName: 'Unassigned Jobs', mappableJobs, unmappableJobs, routeInfo });
        } catch (error) { console.error("Failed to show unassigned jobs:", error); } finally {
            if (mapRequestRef.current === requestId) setIsRouting(false);
        }
    }, [appState.unassignedJobs, log]);

    const handleShowZipOnMap = useCallback(async (zip: string, rep?: Rep) => {
        const requestId = ++mapRequestRef.current;
        log(`ACTION: Show Zip ${zip} on Map.`);
        setIsRouting(true);
        try {
            const result = await geocodeAddresses([`${zip}, Arizona, USA`]);
            if (mapRequestRef.current !== requestId) return;

            if (result[0]?.coordinates) {
                const coord = result[0].coordinates;
                const dummyJob: DisplayJob = {
                    id: `zip-${zip}`,
                    customerName: `Zip Code: ${zip}`,
                    address: `${zip}, Arizona`,
                    notes: rep ? ` Territory of ${rep.name}` : '',
                    city: '',
                    zipCode: zip
                };
                setActiveRoute({
                    repName: `Zip: ${zip}`,
                    mappableJobs: [dummyJob],
                    unmappableJobs: [],
                    routeInfo: { distance: 0, duration: 0, geometry: null, coordinates: [coord] }
                });
            } else {
                log(`Could not locate zip ${zip}`);
            }
        } catch (e) { console.error(e); } finally {
            if (mapRequestRef.current === requestId) setIsRouting(false);
        }
    }, [log]);

    const handleShowAllRepLocations = useCallback(async () => {
        const requestId = ++mapRequestRef.current;
        log('ACTION: Show All Rep Locations.');
        setIsRouting(true);
        try {
            const repsWithZips = appState.reps.filter(r => r.zipCodes && r.zipCodes.length > 0);
            const displayJobs: DisplayJob[] = repsWithZips.map(r => ({
                id: `home-${r.id}`,
                customerName: r.name,
                address: `${r.zipCodes![0]}, Arizona, USA`,
                notes: 'Home Base',
                city: '',
                zipCode: r.zipCodes![0],
                isRepHome: true,
                assignedRepName: r.name
            }));

            const addresses = displayJobs.map(j => j.address);
            const results = await geocodeAddresses(addresses);
            if (mapRequestRef.current !== requestId) return;

            const mappableJobs: DisplayJob[] = [];
            const coords: Coordinates[] = [];

            displayJobs.forEach((job, i) => {
                if (results[i].coordinates) {
                    mappableJobs.push(job);
                    coords.push(results[i].coordinates!);
                }
            });

            setActiveRoute({
                repName: 'All Rep Locations',
                mappableJobs,
                unmappableJobs: [],
                routeInfo: { distance: 0, duration: 0, geometry: null, coordinates: coords }
            });
        } catch (e) { console.error(e); } finally {
            if (mapRequestRef.current === requestId) setIsRouting(false);
        }
    }, [appState.reps, log]);

    const handleShowAllJobsOnMap = useCallback(async () => {
        const requestId = ++mapRequestRef.current;
        log('ACTION: Show All Jobs on Map.');
        if (allJobs.length === 0) {
            if (mapRequestRef.current === requestId) setActiveRoute(null);
            return;
        }

        setIsRouting(true);
        setSelectedRepId(null);
        try {
            const addresses = allJobs.map(j => j.address);
            const coordsResults = await geocodeAddresses(addresses);
            if (mapRequestRef.current !== requestId) return;

            const mappableJobs: DisplayJob[] = [];
            const unmappableJobs: DisplayJob[] = [];
            const mappableCoords: Coordinates[] = [];
            allJobs.forEach((job, index) => {
                const result = coordsResults[index];
                if (result.coordinates) { mappableJobs.push(job); mappableCoords.push(result.coordinates); }
                else { unmappableJobs.push({ ...job, geocodeError: result.error || 'Unknown' }); }
            });

            const routeInfo: RouteInfo = {
                distance: 0, duration: 0, geometry: null, coordinates: mappableCoords
            };

            setActiveRoute({ repName: 'Job Map', mappableJobs, unmappableJobs, routeInfo });
        } catch (error) { console.error("Failed to show all jobs on map:", error); } finally {
            if (mapRequestRef.current === requestId) setIsRouting(false);
        }
    }, [allJobs, log]);

    const handleRefreshRoute = useCallback(async () => {
        if (!activeRoute || isRouting) return;
        const repName = activeRoute.repName;
        if (repName === 'Unassigned Jobs') await handleShowUnassignedJobsOnMap();
        else if (repName === 'Job Map') await handleShowAllJobsOnMap();
        else if (repName === 'All Rep Locations') await handleShowAllRepLocations();
        else {
            const rep = appState.reps.find(r => r.name === repName);
            if (rep) await handleShowRoute(rep.id, false);
            else await handleShowAllJobsOnMap();
        }
    }, [activeRoute, isRouting, log, handleShowUnassignedJobsOnMap, handleShowAllJobsOnMap, handleShowAllRepLocations, appState.reps, handleShowRoute]);

    const handleRefreshRouteRef = useRef(handleRefreshRoute);
    useEffect(() => { handleRefreshRouteRef.current = handleRefreshRoute; }, [handleRefreshRoute]);

    useEffect(() => {
        if (mapRefreshTrigger > 0) {
            handleRefreshRouteRef.current?.();
        }
    }, [mapRefreshTrigger]);

    const handleParseJobs = useCallback(async (pastedText: string, onComplete: () => void) => {
        log('ACTION: Process Pasted Jobs clicked.');
        if (!pastedText.trim()) { setParsingError('Pasted text cannot be empty.'); return; }
        setIsParsing(true);
        setParsingError(null);
        try {
            // Import the splitTextByDays function
            const { splitTextByDays } = await import('../services/geminiService');

            // Check if the text contains multiple days
            const daySections = splitTextByDays(pastedText);

            if (daySections.length === 0) {
                throw new Error('No date headers found in pasted text. Please include date headers like "Monday, Dec 7, 2025"');
            }

            log(`Found ${daySections.length} day(s) in pasted text`);

            // Process each day sequentially
            const newDailyStates = new Map(dailyStates);
            let allJobsCount = 0;
            const datesToAdd: Date[] = [];
            const newChanges: JobChange[] = [];

            for (const { dateString, text: dayText } of daySections) {
                const targetDate = new Date(dateString + 'T12:00:00');
                const targetDateKey = formatDateToKey(targetDate);
                log(`Processing ${targetDateKey}...`);

                // Get existing state for change tracking
                const oldState = newDailyStates.get(targetDateKey);

                // Get or create state for this day
                let baseState = oldState;
                if (!baseState) {
                    log(`Loading reps for ${targetDateKey}...`);
                    const { reps: repData, sheetName } = await fetchSheetData(targetDate);
                    setActiveSheetName(sheetName);
                    if (repData.length > 0 && (repData[0] as Rep).isMock) setUsingMockData(true);
                    const repsWithSchedule = repData.map(rep => ({ ...rep, schedule: TIME_SLOTS.map(slot => ({ ...slot, jobs: [] })), isLocked: false, isOptimized: false }));
                    baseState = { reps: repsWithSchedule, unassignedJobs: [], settings: DEFAULT_SETTINGS };
                }

                // Parse jobs for this specific day
                const { jobs: parsedJobs, assignments } = await parseJobsFromText(dayText, baseState.reps);
                allJobsCount += parsedJobs.length;
                log(`Parsed ${parsedJobs.length} jobs for ${targetDateKey}`);

                // Create a copy of the state for this day
                const newDayState = JSON.parse(JSON.stringify(baseState)) as AppState;

                // Process each parsed job - either update existing or add new
                const processedJobIds = new Set<string>();
                const jobsToAdd: Job[] = [];
                const assignmentsToProcess: typeof assignments = [];

                for (const parsedJob of parsedJobs) {
                    // Check if this job already exists in the state
                    const existingMatch = findMatchingJob(parsedJob, newDayState);

                    if (existingMatch) {
                        // Job exists - update it if there are changes
                        const differences = compareJobs(existingMatch.job, parsedJob);

                        if (differences.length > 0) {
                            // Update the existing job with new data
                            Object.assign(existingMatch.job, {
                                customerName: parsedJob.customerName,
                                address: parsedJob.address,
                                city: parsedJob.city,
                                notes: parsedJob.notes,
                                originalTimeframe: parsedJob.originalTimeframe,
                                zipCode: parsedJob.zipCode
                            });
                            log(`Updated existing job at ${parsedJob.address}`);
                        }

                        // Keep the existing job's ID for assignment processing
                        const assignment = assignments.find(a => a.jobId === parsedJob.id);
                        if (assignment) {
                            assignmentsToProcess.push({
                                ...assignment,
                                jobId: existingMatch.job.id // Use existing job ID
                            });
                        }
                        processedJobIds.add(existingMatch.job.id);
                    } else {
                        // New job - add it
                        jobsToAdd.push(parsedJob);
                        const assignment = assignments.find(a => a.jobId === parsedJob.id);
                        if (assignment) {
                            assignmentsToProcess.push(assignment);
                        }
                    }
                }

                // Add new jobs to unassigned (only those not in assignments)
                const assignedJobIds = new Set(assignmentsToProcess.map(a => a.jobId));
                const jobsToLeaveUnassigned = jobsToAdd.filter(j => !assignedJobIds.has(j.id));
                newDayState.unassignedJobs.push(...jobsToLeaveUnassigned);

                // Process assignments (for new jobs only, existing jobs stay where they are)
                for (const assignment of assignmentsToProcess) {
                    const jobToMove = jobsToAdd.find(j => j.id === assignment.jobId);
                    if (!jobToMove) continue; // Skip if it's an existing job

                    const rep = newDayState.reps.find(r => r.id === assignment.repId);
                    if (!rep) { newDayState.unassignedJobs.push(jobToMove); continue; };
                    const slot = rep.schedule.find(s => s.id === assignment.slotId);
                    if (!slot) { newDayState.unassignedJobs.push(jobToMove); continue; }
                    slot.jobs.push(jobToMove);
                }

                // Detect changes between old and new state
                const changes = detectJobChanges(targetDateKey, oldState, newDayState, new Date().toISOString());
                newChanges.push(...changes);
                if (changes.length > 0) {
                    log(`Detected ${changes.length} changes for ${targetDateKey}`);
                }

                // Save the state for this day
                newDailyStates.set(targetDateKey, newDayState);

                // Track dates to add
                if (!activeDayKeys.includes(targetDateKey)) {
                    datesToAdd.push(targetDate);
                }

                // Update geo cache for this day's jobs
                if (parsedJobs.length > 0) updateGeoCache(parsedJobs.map(j => j.address));
            }

            // Update history with all new states at once
            setHistory([newDailyStates]);
            setHistoryIndex(0);

            // Add changes to changelog
            if (newChanges.length > 0) {
                setChangeLog(prev => [...prev, ...newChanges]);
                log(`Added ${newChanges.length} changes to changelog`);
            }

            // Add all new day tabs
            for (const date of datesToAdd) {
                addActiveDay(date);
            }

            // Switch to the first day that was pasted
            if (daySections.length > 0) {
                const firstDate = new Date(daySections[0].dateString + 'T12:00:00');
                _setSelectedDate(firstDate);
            }

            onComplete();
            log(`COMPLETE: Processed ${daySections.length} day(s) with ${allJobsCount} total jobs.`);

            setAutoMapAction('show-all');

        } catch (error) {
            console.error('Failed to parse jobs:', error);
            setParsingError('Job parsing failed.');
        } finally {
            setIsParsing(false);
        }
    }, [log, appState.reps, selectedDate, dailyStates, activeDayKeys, addActiveDay, updateGeoCache, _setSelectedDate, fetchSheetData, setActiveSheetName, setUsingMockData]);

    const handleClearAllSchedules = useCallback(() => {
        const dateKey = formatDateToKey(selectedDate);
        recordChange(currentDailyStates => {
            const newDailyStates = new Map<string, AppState>(currentDailyStates);
            const dayState = newDailyStates.get(dateKey);
            if (!dayState) return currentDailyStates;
            const unlockedReps = dayState.reps.filter(rep => !rep.isLocked);

            const jobsToUnassign: DisplayJob[] = [];
            const preservedReps = unlockedReps.map(rep => {
                const newSchedule = rep.schedule.map(slot => {
                    const preservedJobs = [];
                    const removedJobs = [];
                    for (const job of slot.jobs) {
                        const repNamePattern = new RegExp(`\\(Rep:\\s*${rep.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`, 'i');
                        if (repNamePattern.test(job.notes)) {
                            preservedJobs.push(job);
                        } else {
                            removedJobs.push(job);
                        }
                    }
                    jobsToUnassign.push(...removedJobs);
                    return { ...slot, jobs: preservedJobs };
                });
                return { ...rep, schedule: newSchedule, isOptimized: false };
            });

            if (jobsToUnassign.length === 0) return currentDailyStates;

            const cleanedJobs = jobsToUnassign.map(job => {
                const cleaned = { ...job, notes: (job.notes || '').replace(/\(Scheduled: [^)]+\)\s*/, '').trim() };
                delete cleaned.assignmentScore;
                delete cleaned.scoreBreakdown;
                return cleaned;
            });

            const combined = [...dayState.unassignedJobs, ...cleanedJobs];
            const newUnassignedJobs = combined.filter((job, index, self) => index === self.findIndex((j) => (j.id === job.id))).sort((a, b) => (a.city || '').localeCompare(b.city || ''));

            const finalReps = dayState.reps.map(originalRep => {
                if (originalRep.isLocked) return originalRep;
                const updatedRep = preservedReps.find(pr => pr.id === originalRep.id);
                return updatedRep || originalRep;
            });

            newDailyStates.set(dateKey, { ...dayState, reps: finalReps, unassignedJobs: newUnassignedJobs });
            return newDailyStates;
        }, 'Clear All Schedules');
        setAutoMapAction('show-all');
    }, [recordChange, selectedDate]);

    const handleToggleRepLock = useCallback((repId: string) => {
        const dateKey = formatDateToKey(selectedDate);
        recordChange(currentDailyStates => {
            const newDailyStates = new Map<string, AppState>(currentDailyStates);
            const dayState = newDailyStates.get(dateKey);
            if (!dayState) return currentDailyStates;
            const newReps = dayState.reps.map(rep => rep.id === repId ? { ...rep, isLocked: !rep.isLocked } : rep);
            newDailyStates.set(dateKey, { ...dayState, reps: newReps });
            return newDailyStates;
        }, 'Toggle Rep Lock');
    }, [recordChange, selectedDate]);

    const handleUpdateJob = useCallback((jobId: string, updatedDetails: Partial<Pick<Job, 'customerName' | 'address' | 'notes' | 'originalTimeframe'>>) => {
        const dateKey = formatDateToKey(selectedDate);
        recordChange(currentDailyStates => {
            const newDailyStates = new Map<string, AppState>(currentDailyStates);
            const dayState = newDailyStates.get(dateKey);
            if (!dayState) return currentDailyStates;
            const newState = JSON.parse(JSON.stringify(dayState)) as AppState;

            let wasUpdated = false;
            const findAndUpdate = (job: Job) => {
                if (job.id === jobId) {
                    Object.assign(job, updatedDetails);
                    wasUpdated = true;
                    return true;
                }
                return false;
            };

            if (newState.unassignedJobs.some(findAndUpdate)) { }
            else {
                for (const rep of newState.reps) {
                    for (const slot of rep.schedule) {
                        if (slot.jobs.some(findAndUpdate)) { break; }
                    }
                    if (wasUpdated) break;
                }
            }

            if (wasUpdated) {
                newDailyStates.set(dateKey, newState);
                return newDailyStates;
            }
            return currentDailyStates;
        }, 'Update Job Details');
        setMapRefreshTrigger(prev => prev + 1);
    }, [recordChange, selectedDate]);

    const handleUpdateRep = useCallback((repId: string, updates: Partial<Rep>) => {
        const dateKey = formatDateToKey(selectedDate);
        recordChange(currentDailyStates => {
            const newDailyStates = new Map<string, AppState>(currentDailyStates);
            const dayState = newDailyStates.get(dateKey);
            if (!dayState) return currentDailyStates;
            const newState = JSON.parse(JSON.stringify(dayState)) as AppState;
            const rep = newState.reps.find(r => r.id === repId);
            if (rep) { Object.assign(rep, updates); }
            newDailyStates.set(dateKey, newState);
            return newDailyStates;
        }, 'Update Rep Settings');
    }, [recordChange, selectedDate]);

    const handlePlaceJobOnMap = useCallback((jobId: string, lat: number, lon: number) => {
        // Update the job's address to the coordinate format
        // The originalAddress field preserves the original pasted address
        handleUpdateJob(jobId, { address: `${lat},${lon}` });
        setPlacementJobId(null);
        setMapRefreshTrigger(prev => prev + 1);
        log(`Manually placed job at coordinates: ${lat},${lon}`);
    }, [handleUpdateJob, log]);

    const handleRemoveJob = useCallback((jobId: string) => {
        const dateKey = formatDateToKey(selectedDate);
        let jobRemoved = false;
        let jobName = '';
        recordChange(currentDailyStates => {
            const newDailyStates = new Map<string, AppState>(currentDailyStates);
            const dayState = newDailyStates.get(dateKey);
            if (!dayState) return currentDailyStates;
            const newState = JSON.parse(JSON.stringify(dayState)) as AppState;
            const unassignedIndex = newState.unassignedJobs.findIndex(j => j.id === jobId);
            if (unassignedIndex > -1) {
                jobName = newState.unassignedJobs[unassignedIndex].address;
                newState.unassignedJobs.splice(unassignedIndex, 1);
                jobRemoved = true;
            } else {
                for (const rep of newState.reps) {
                    for (const slot of rep.schedule) {
                        const jobIndex = slot.jobs.findIndex(j => j.id === jobId);
                        if (jobIndex > -1) {
                            jobName = slot.jobs[jobIndex].address;
                            slot.jobs.splice(jobIndex, 1);
                            jobRemoved = true;
                            break;
                        }
                    }
                    if (jobRemoved) break;
                }
            }
            if (jobRemoved) { newDailyStates.set(dateKey, newState); return newDailyStates; }
            return currentDailyStates;
        }, 'Remove Job');
        if (jobRemoved) {
            log(`ACTION: Removed job "${jobName}"`);
            setMapRefreshTrigger(prev => prev + 1);
        }
    }, [recordChange, selectedDate, log]);

    const handleAiFixAddresses = useCallback(async () => {
        const unmappable = activeRoute?.unmappableJobs;
        if (!unmappable || unmappable.length === 0) { log('AI FIX: No unmappable jobs to fix.'); return; }
        log(`ACTION: AI Fix Addresses clicked for ${unmappable.length} jobs.`);
        setIsAiFixingAddresses(true);
        try {
            const results = await fixAddressesWithAi(unmappable);
            let correctedCount = 0;
            for (const result of results) {
                const originalJob = unmappable.find(j => j.id === result.jobId);
                if (!originalJob) continue;
                if (!result.correctedAddress.startsWith('Unverified: ')) {
                    const originalAddress = originalJob.address;
                    const updatedNotes = `(Address corrected from: ${originalAddress}) ${originalJob.notes || ''}`.trim();
                    handleUpdateJob(result.jobId, { address: result.correctedAddress, notes: updatedNotes });
                    log(`- AI FIX: Corrected "${originalAddress}" to "${result.correctedAddress}".`);
                    correctedCount++;
                } else {
                    log(`- AI FIX: Could not verify address for job "${originalJob.customerName}". AI response: ${result.correctedAddress}`);
                }
            }
            log(`- AI FIX COMPLETE: Successfully corrected ${correctedCount} of ${unmappable.length} addresses.`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown AI error";
            log(`- ERROR (AI Fix): ${errorMessage}`);
            console.error("AI address fix failed:", error);
        } finally {
            setIsAiFixingAddresses(false);
        }
    }, [activeRoute, handleUpdateJob, log]);

    const [swapSourceRepId, setSwapSourceRepId] = useState<string | null>(null);

    const handleTryAddressVariations = useCallback(async () => {
        const unmappable = activeRoute?.unmappableJobs;
        if (!unmappable || unmappable.length === 0) { log('VARIATIONS: No unmappable jobs to try.'); return; }
        log(`ACTION: Try Address Variations clicked for ${unmappable.length} jobs.`);
        setIsTryingVariations(true);
        try {
            const variationsMap = new Map<string, { jobId: string, originalAddress: string }>();
            const allVariations: string[] = [];

            const generateAddressVariations = (address: string): string[] => {
                const variations = new Set<string>();
                variations.add(address);

                const expand = (addr: string) => {
                    return addr
                        .replace(/\bN[\.]?\b/g, 'North')
                        .replace(/\bS[\.]?\b/g, 'South')
                        .replace(/\bE[\.]?\b/g, 'East')
                        .replace(/\bW[\.]?\b/g, 'West')
                        .replace(/\bSt[\.]?\b/gi, 'Street')
                        .replace(/\bRd[\.]?\b/gi, 'Road')
                        .replace(/\bDr[\.]?\b/gi, 'Drive')
                        .replace(/\bAve[\.]?\b/gi, 'Avenue')
                        .replace(/\bBlvd[\.]?\b/gi, 'Boulevard')
                        .replace(/\bLn[\.]?\b/gi, 'Lane')
                        .replace(/\bCt[\.]?\b/gi, 'Court')
                        .replace(/\bPl[\.]?\b/gi, 'Place');
                };

                const expanded = expand(address);
                if (expanded !== address) variations.add(expanded);
                const noCountry = address.replace(/,?\s*(united states|usa)\b/gi, '').trim();
                if (noCountry !== address) variations.add(noCountry);
                const noZip = address.replace(/\b\d{5}(?:-\d{4})?\b/g, '').trim().replace(/,$/, '').replace(/,\s*$/, '');
                if (noZip !== address && noZip.length > 5) {
                    variations.add(noZip);
                    const expandedNoZip = expand(noZip);
                    if (expandedNoZip !== noZip) variations.add(expandedNoZip);
                }
                const streetMatch = address.match(/^(\d+\s+[a-zA-Z0-9\s\.]+?)(?:,|$)/);
                if (streetMatch) {
                    const streetOnly = streetMatch[1].trim();
                    if (streetOnly !== address && streetOnly.length > 5) {
                        variations.add(streetOnly);
                        variations.add(`${streetOnly}, AZ`);
                        const expandedStreet = expand(streetOnly);
                        if (expandedStreet !== streetOnly) {
                            variations.add(expandedStreet);
                            variations.add(`${expandedStreet}, AZ`);
                        }
                    }
                }
                return Array.from(variations);
            };

            unmappable.forEach(job => {
                const variations = generateAddressVariations(job.address);
                variations.forEach(v => {
                    if (!variationsMap.has(v)) {
                        variationsMap.set(v, { jobId: job.id, originalAddress: job.address });
                        allVariations.push(v);
                    }
                });
            });

            log(`- VARIATIONS: Generated ${allVariations.length} unique variations to test.`);
            const results = await geocodeAddresses(allVariations);
            const successfulJobs = new Map<string, { address: string, result: GeocodeResult }>();
            results.forEach((result, index) => {
                if (result.coordinates) {
                    const variation = allVariations[index];
                    const { jobId } = variationsMap.get(variation)!;
                    if (!successfulJobs.has(jobId)) { successfulJobs.set(jobId, { address: variation, result }); }
                }
            });
            if (successfulJobs.size > 0) {
                log(`- VARIATIONS: Found valid locations for ${successfulJobs.size} jobs.`);
                successfulJobs.forEach(({ address }, jobId) => {
                    const originalJob = unmappable.find(j => j.id === jobId);
                    if (originalJob) {
                        const updatedNotes = `(Address corrected from: ${originalJob.address}) ${originalJob.notes || ''}`.trim();
                        handleUpdateJob(jobId, { address: address, notes: updatedNotes });
                    }
                });
            } else { log('- VARIATIONS: No successful variations found.'); }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            log(`- ERROR (Variations): ${errorMessage}`);
            console.error("Address variation check failed:", error);
        } finally {
            setIsTryingVariations(false);
        }
    }, [activeRoute, handleUpdateJob, log]);

    const handleUnoptimizeRepRoute = useCallback((repId: string) => {
        const dateKey = formatDateToKey(selectedDate);
        recordChange(currentDailyStates => {
            const newDailyStates = new Map<string, AppState>(currentDailyStates);
            const dayState = newDailyStates.get(dateKey);
            if (!dayState) return currentDailyStates;
            const newState = JSON.parse(JSON.stringify(dayState)) as AppState;
            const targetRep = newState.reps.find(r => r.id === repId);
            if (!targetRep || !targetRep.isOptimized) return currentDailyStates;

            // Gather all jobs
            const allJobs = targetRep.schedule.flatMap(s => s.jobs);

            // Reset schedule buckets
            targetRep.schedule.forEach(s => s.jobs = []);

            // Redistribute
            allJobs.forEach(job => {
                delete job.timeSlotLabel; // Remove calculated label
                let targetSlotId = 'ts-1'; // Default
                if (job.originalTimeframe) {
                    const mapped = mapTimeframeToSlotId(job.originalTimeframe);
                    if (mapped) targetSlotId = mapped;
                }
                const slot = targetRep.schedule.find(s => s.id === targetSlotId) || targetRep.schedule[0];
                slot.jobs.push(job);
            });

            targetRep.isOptimized = false;
            newDailyStates.set(dateKey, newState);
            return newDailyStates;
        }, 'Un-Optimize Route');
        setMapRefreshTrigger(prev => prev + 1);
    }, [recordChange, selectedDate]);

    const handleOptimizeRepRoute = useCallback(async (repId: string) => {
        const rep = appState.reps.find(r => r.id === repId);
        if (!rep || rep.schedule.flatMap(s => s.jobs).length < 1) return;

        const dateKey = formatDateToKey(selectedDate);
        let allJobs = rep.schedule.flatMap(s => s.jobs);
        const addresses = allJobs.map(j => j.address);

        // Ensure all addresses are geocoded before we sort
        if (rep.zipCodes && rep.zipCodes.length > 0) {
            addresses.push(`${rep.zipCodes[0]}, Arizona, USA`);
        }
        const geoResults = await geocodeAddresses(addresses); // Populates internal cache

        // Manually build a quick lookup map for this operation to avoid relying on stale state
        const tempCoordMap = new Map<string, Coordinates>();
        addresses.forEach((addr, i) => {
            if (geoResults[i].coordinates) {
                tempCoordMap.set(addr, geoResults[i].coordinates!);
            }
        });

        recordChange(currentDailyStates => {
            const newDailyStates = new Map<string, AppState>(currentDailyStates);
            const dayState = newDailyStates.get(dateKey);
            if (!dayState) return currentDailyStates;
            const newState = JSON.parse(JSON.stringify(dayState)) as AppState;
            const targetRep = newState.reps.find(r => r.id === repId);
            if (!targetRep) return currentDailyStates;

            let jobsToOptimize = targetRep.schedule.flatMap(s => s.jobs);
            const jobCount = jobsToOptimize.length;

            // 1. Determine Drive Time Buffer based on job count
            let driveBufferMinutes = 30;
            if (jobCount === 4) driveBufferMinutes = 60;
            if (jobCount <= 3) driveBufferMinutes = 90;

            // 2. Bucket jobs by Original Timeframe
            const buckets: Record<number, DisplayJob[]> = {};
            jobsToOptimize.forEach(job => {
                const h = getSortableHour(job.originalTimeframe);
                if (!buckets[h]) buckets[h] = [];
                buckets[h].push(job);
            });

            const sortedHours = Object.keys(buckets).map(Number).sort((a, b) => a - b);
            const finalSortedJobs: DisplayJob[] = [];

            // Set initial reference point (Home Base)
            let currentReferenceCoord: Coordinates | undefined;
            if (targetRep.zipCodes?.[0]) {
                const homeKey = `${targetRep.zipCodes[0]}, Arizona, USA`;
                currentReferenceCoord = tempCoordMap.get(homeKey);
            }

            // 3. Nearest Neighbor Sort within each time bucket
            for (const h of sortedHours) {
                let unvisited = [...buckets[h]];

                while (unvisited.length > 0) {
                    let nearestIndex = 0; // Default to first if no coordinates available
                    let minDist = Infinity;

                    if (currentReferenceCoord) {
                        // Find nearest job in this bucket to the current reference
                        unvisited.forEach((job, idx) => {
                            const coord = tempCoordMap.get(job.address);
                            if (coord) {
                                const dist = haversineDistance(currentReferenceCoord!, coord);
                                if (dist < minDist) {
                                    minDist = dist;
                                    nearestIndex = idx;
                                }
                            }
                        });
                    }

                    const [nextJob] = unvisited.splice(nearestIndex, 1);
                    finalSortedJobs.push(nextJob);

                    // Update reference for next iteration
                    const nextCoord = tempCoordMap.get(nextJob.address);
                    if (nextCoord) currentReferenceCoord = nextCoord;
                }
            }

            // 4. Assign Times using dynamic buffer
            let currentTime = new Date();
            currentTime.setHours(7, 30, 0, 0);
            // Lunch logic REMOVED

            finalSortedJobs.forEach((job, idx) => {
                // Job Start
                const startStr = currentTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(/\s/g, '');

                // Job Duration (90 mins)
                currentTime.setMinutes(currentTime.getMinutes() + 90);
                const endStr = currentTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(/\s/g, '');

                job.timeSlotLabel = `${startStr}-${endStr}`;

                // Add Drive Time Buffer (Dynamic)
                currentTime.setMinutes(currentTime.getMinutes() + driveBufferMinutes);
            });

            targetRep.schedule.forEach(s => s.jobs = []);
            targetRep.schedule[0].jobs = finalSortedJobs;
            targetRep.isOptimized = true;

            newDailyStates.set(dateKey, newState);
            return newDailyStates;
        }, 'Optimize Route');

        setAutoMapAction(repId);
    }, [appState.reps, selectedDate, recordChange, updateGeoCache]);

    const handleDistributeJobs = useCallback(() => {
        log('ACTION: Distribute Jobs clicked.');
        setIsDistributing(true);
        setTimeout(() => {
            const dateKey = formatDateToKey(selectedDate);
            recordChange(currentDailyStates => {
                const newDailyStates = new Map<string, AppState>(currentDailyStates);
                const dayState = newDailyStates.get(dateKey);
                if (!dayState || dayState.unassignedJobs.length === 0) { return currentDailyStates; }
                const newState = JSON.parse(JSON.stringify(dayState)) as AppState;
                const jobsToAssign = [...newState.unassignedJobs];
                const repsWithNoJobs = newState.reps.filter(rep => !rep.isLocked && !rep.isOptimized && rep.schedule.flatMap(s => s.jobs).length === 0);
                if (repsWithNoJobs.length === 0) { return currentDailyStates; }
                let assignedCount = 0;
                for (const rep of repsWithNoJobs) {
                    if (jobsToAssign.length === 0) break;
                    const jobIndex = jobsToAssign.findIndex(job => isJobValidForRepRegion(job, rep));
                    if (jobIndex === -1) continue;
                    const [job] = jobsToAssign.splice(jobIndex, 1);
                    let targetSlotId: string | null = null;
                    if (job.originalTimeframe) { targetSlotId = mapTimeframeToSlotId(job.originalTimeframe); }
                    let assigned = false;
                    const availableSlots = rep.schedule.filter(s => !(rep.unavailableSlots?.[selectedDayString] || []).includes(s.id));
                    const dummyBreakdown: ScoreBreakdown = { distanceBase: 0, distanceCluster: 0, skillRoofing: 0, skillType: 0, performance: 0, penalty: 0 };
                    // Set original rep info if not already set (first assignment)
                    const jobWithOriginal = {
                        ...job,
                        assignmentScore: 50,
                        scoreBreakdown: dummyBreakdown,
                        originalRepId: job.originalRepId || rep.id,
                        originalRepName: job.originalRepName || rep.name,
                    };
                    if (targetSlotId) {
                        const targetSlot = availableSlots.find(s => s.id === targetSlotId);
                        if (targetSlot) { targetSlot.jobs.push(jobWithOriginal); assigned = true; }
                    }
                    if (!assigned && availableSlots.length > 0) { availableSlots[0].jobs.push(jobWithOriginal); assigned = true; }
                    if (assigned) { assignedCount++; } else { jobsToAssign.unshift(job); }
                }
                newState.unassignedJobs = jobsToAssign;
                log(`- DISTRIBUTE: Assigned ${assignedCount} jobs to reps with empty schedules.`);
                newDailyStates.set(dateKey, newState);
                return newDailyStates;
            }, 'Distribute Jobs');
            setAutoMapAction('show-all');
            setIsDistributing(false);
        }, 10);
    }, [recordChange, selectedDate, log, selectedDayString, isJobValidForRepRegion]);

    const handleAutoAssign = useCallback(() => {
        log('ACTION: Auto-Assign All (Balanced) clicked.');
        setIsAutoAssigning(true);
        setTimeout(async () => {
            const dateKey = formatDateToKey(selectedDate);
            const currentDayState = history[historyIndex]?.get(dateKey);

            if (currentDayState && currentDayState.unassignedJobs.length > 0) {
                const allAddresses = currentDayState.unassignedJobs.map(j => j.address);
                await updateGeoCache(allAddresses);
            }

            recordChange(currentDailyStates => {
                const newDailyStates = new Map<string, AppState>(currentDailyStates);
                const dayState = newDailyStates.get(dateKey);
                if (!dayState || dayState.unassignedJobs.length === 0) {
                    log('- INFO: No unassigned jobs to assign.');
                    return currentDailyStates;
                }

                const newState = JSON.parse(JSON.stringify(dayState)) as AppState;
                const jobsToAssign = [...newState.unassignedJobs];
                newState.unassignedJobs = [];
                let assignedCount = 0;

                const cityOrder = EAST_TO_WEST_CITIES.reduce((acc, city, index) => {
                    acc[city.toLowerCase()] = index;
                    return acc;
                }, {} as Record<string, number>);

                // Sort by job value first (high-value jobs assigned first to top reps)
                // Then by city order for geographic efficiency
                jobsToAssign.sort((a, b) => {
                    const valueA = a.jobValue ?? 50;
                    const valueB = b.jobValue ?? 50;
                    if (valueB !== valueA) return valueB - valueA; // Descending by value
                    const orderA = cityOrder[norm(a.city)] ?? 999;
                    const orderB = cityOrder[norm(b.city)] ?? 999;
                    return orderA - orderB;
                });

                const availableReps = newState.reps.filter(r => !r.isLocked && !r.isOptimized);

                for (const job of jobsToAssign) {
                    let bestAssignment: { repId: string; slotId: string; score: number; breakdown: ScoreBreakdown } | null = null;

                    const eligibleReps = availableReps.filter(rep => rep.schedule.flatMap(s => s.jobs).length < newState.settings.maxJobsPerRep);

                    for (const rep of eligibleReps) {
                        if (!isJobValidForRepRegion(job, rep)) continue;

                        const { violated } = checkCityRuleViolation(rep, job.city);
                        if (violated) continue;

                        const currentJobCount = rep.schedule.flatMap(s => s.jobs).length;
                        const isUnderMinTarget = currentJobCount < newState.settings.minJobsPerRep;

                        // Check if rep has at least one available slot today (for override logic)
                        const unavailableSlotsToday = rep.unavailableSlots?.[selectedDayString] || [];
                        const hasAnyAvailability = rep.schedule.some(s => !unavailableSlotsToday.includes(s.id));

                        for (const slot of rep.schedule) {
                            const maxJobsInSlot = newState.settings.allowDoubleBooking ? newState.settings.maxJobsPerSlot : 1;
                            if (slot.jobs.length >= maxJobsInSlot) continue;

                            const isUnavailable = unavailableSlotsToday.includes(slot.id);
                            // Only allow override if rep has at least one available slot today
                            const canOverride = newState.settings.allowAssignOutsideAvailability && hasAnyAvailability;
                            if (isUnavailable && !canOverride) continue;

                            if (newState.settings.strictTimeSlotMatching) {
                                const requiredSlotId = mapTimeframeToSlotId(job.originalTimeframe || '');
                                if (requiredSlotId && requiredSlotId !== slot.id) continue;
                            }

                            const { score, breakdown } = calculateAssignmentScore(job, rep, slot.id, newState.settings);

                            // STRICT SKILL CHECK: Score of -1 means ineligible.
                            if (score <= 0) continue;

                            let finalScore = score;
                            if (isUnderMinTarget) {
                                finalScore += 10000;
                            }

                            if (!bestAssignment || finalScore > bestAssignment.score) {
                                bestAssignment = { repId: rep.id, slotId: slot.id, score: finalScore, breakdown };
                            }
                        }
                    }

                    if (bestAssignment) {
                        const targetRep = newState.reps.find(r => r.id === bestAssignment!.repId)!;
                        const targetSlot = targetRep.schedule.find(s => s.id === bestAssignment!.slotId)!;

                        const displayScore = bestAssignment.score > 1000 ? bestAssignment.score - 10000 : bestAssignment.score;

                        // Set original rep info if not already set (first assignment)
                        const jobWithScore: DisplayJob = {
                            ...job,
                            assignmentScore: displayScore,
                            scoreBreakdown: bestAssignment.breakdown,
                            originalRepId: job.originalRepId || targetRep.id,
                            originalRepName: job.originalRepName || targetRep.name,
                        };
                        targetSlot.jobs.push(jobWithScore);
                        assignedCount++;
                    } else {
                        newState.unassignedJobs.push(job);
                    }
                }

                log(`- AUTO-ASSIGN: Assigned ${assignedCount} jobs.`);
                newDailyStates.set(dateKey, newState);
                return newDailyStates;

            }, 'Auto-Assign All');
            setAutoMapAction('show-all');
            setIsAutoAssigning(false);
        }, 100);
    }, [recordChange, selectedDate, log, selectedDayString, checkCityRuleViolation, calculateAssignmentScore, history, historyIndex, updateGeoCache, isJobValidForRepRegion]);

    const handleAutoAssignForRep = useCallback((repId: string) => {
        log(`ACTION: Auto-Assign for Rep ID ${repId} clicked.`);
        setIsAutoAssigning(true);
        setTimeout(async () => {
            const dateKey = formatDateToKey(selectedDate);
            const currentDayState = history[historyIndex]?.get(dateKey);
            if (currentDayState && currentDayState.unassignedJobs.length > 0) {
                const allAddresses = currentDayState.unassignedJobs.map(j => j.address);
                await updateGeoCache(allAddresses);
            }

            recordChange(currentDailyStates => {
                const newDailyStates = new Map<string, AppState>(currentDailyStates);
                const dayState = newDailyStates.get(dateKey);
                if (!dayState || dayState.unassignedJobs.length === 0) {
                    return currentDailyStates;
                }

                const newState = JSON.parse(JSON.stringify(dayState)) as AppState;
                const targetRep = newState.reps.find(r => r.id === repId);

                if (!targetRep || targetRep.isLocked || targetRep.isOptimized) {
                    return currentDailyStates;
                }

                const jobsToAssign = [...newState.unassignedJobs];
                newState.unassignedJobs = [];
                let assignedCount = 0;

                const cityOrder = EAST_TO_WEST_CITIES.reduce((acc, city, index) => {
                    acc[city.toLowerCase()] = index;
                    return acc;
                }, {} as Record<string, number>);

                // Sort by job value first (high-value jobs assigned first)
                // Then by city order for geographic efficiency
                jobsToAssign.sort((a, b) => {
                    const valueA = a.jobValue ?? 50;
                    const valueB = b.jobValue ?? 50;
                    if (valueB !== valueA) return valueB - valueA; // Descending by value
                    const orderA = cityOrder[norm(a.city)] ?? 999;
                    const orderB = cityOrder[norm(b.city)] ?? 999;
                    return orderA - orderB;
                });

                for (const job of jobsToAssign) {
                    let bestSlot: { slotId: string; score: number; breakdown: ScoreBreakdown } | null = null;

                    const totalJobsForRep = targetRep.schedule.flatMap(s => s.jobs).length;
                    if (totalJobsForRep >= newState.settings.maxJobsPerRep) {
                        newState.unassignedJobs.push(job);
                        continue;
                    }

                    if (!isJobValidForRepRegion(job, targetRep)) {
                        newState.unassignedJobs.push(job);
                        continue;
                    }

                    const cityViolation = checkCityRuleViolation(targetRep, job.city);
                    if (cityViolation.violated) {
                        newState.unassignedJobs.push(job);
                        continue;
                    }

                    // Check if rep has at least one available slot today (for override logic)
                    const unavailableSlotsToday = targetRep.unavailableSlots?.[selectedDayString] || [];
                    const hasAnyAvailability = targetRep.schedule.some(s => !unavailableSlotsToday.includes(s.id));

                    for (const slot of targetRep.schedule) {
                        const maxJobsInSlot = newState.settings.allowDoubleBooking ? newState.settings.maxJobsPerSlot : 1;
                        if (slot.jobs.length >= maxJobsInSlot) continue;

                        const isUnavailable = unavailableSlotsToday.includes(slot.id);
                        // Only allow override if rep has at least one available slot today
                        const canOverride = newState.settings.allowAssignOutsideAvailability && hasAnyAvailability;
                        if (isUnavailable && !canOverride) continue;

                        if (newState.settings.strictTimeSlotMatching) {
                            const requiredSlotId = mapTimeframeToSlotId(job.originalTimeframe || '');
                            if (requiredSlotId && requiredSlotId !== slot.id) continue;
                        }

                        const { score, breakdown } = calculateAssignmentScore(job, targetRep, slot.id, newState.settings);

                        // STRICT SKILL CHECK: Score of -1 means ineligible.
                        if (score <= 0) continue;

                        if (!bestSlot || score > bestSlot.score) {
                            bestSlot = { slotId: slot.id, score, breakdown };
                        }
                    }

                    if (bestSlot) {
                        const targetSlot = targetRep.schedule.find(s => s.id === bestSlot!.slotId)!;
                        // Set original rep info if not already set (first assignment)
                        targetSlot.jobs.push({
                            ...job,
                            assignmentScore: bestSlot.score,
                            scoreBreakdown: bestSlot.breakdown,
                            originalRepId: job.originalRepId || targetRep.id,
                            originalRepName: job.originalRepName || targetRep.name,
                        });
                        assignedCount++;
                    } else {
                        newState.unassignedJobs.push(job);
                    }
                }

                newState.unassignedJobs.sort((a, b) => (a.city || '').localeCompare(b.city || ''));
                newDailyStates.set(dateKey, newState);
                return newDailyStates;

            }, `Auto-Assign for Rep ${repId}`);
            setMapRefreshTrigger(prev => prev + 1);
            setIsAutoAssigning(false);
        }, 100);
    }, [recordChange, selectedDate, log, selectedDayString, checkCityRuleViolation, calculateAssignmentScore, history, historyIndex, updateGeoCache, isJobValidForRepRegion]);

    const handleAiAssign = useCallback(async () => {
        log('ACTION: Assign with AI clicked.');
        if (appState.unassignedJobs.length === 0) { log('- INFO: No jobs to assign. Aborting.'); return; }
        setIsAiAssigning(true);
        clearAiThoughts();
        try {
            const result = await assignJobsWithAi(appState.reps, appState.unassignedJobs, selectedDayString, appState.settings, addAiThought);
            addAiThought("Applying assignments...");
            const dateKey = formatDateToKey(selectedDate);
            recordChange(currentDailyStates => {
                const newDailyStates = new Map<string, AppState>(currentDailyStates);
                const dayState = newDailyStates.get(dateKey);
                if (!dayState) return currentDailyStates;
                const newState = JSON.parse(JSON.stringify(dayState)) as AppState;
                let assignedCount = 0;
                for (const assignment of result.assignments) {
                    const jobIndex = newState.unassignedJobs.findIndex(j => j.id === assignment.jobId);
                    if (jobIndex === -1) continue;
                    const [jobToMove] = newState.unassignedJobs.splice(jobIndex, 1);
                    const rep = newState.reps.find(r => r.id === assignment.repId);
                    if (!rep) continue;
                    const slot = rep.schedule.find(s => s.id === assignment.slotId);
                    if (!slot) continue;
                    slot.jobs.push({
                        ...jobToMove,
                        assignmentScore: 85,
                        scoreBreakdown: { distanceBase: 0, distanceCluster: 0, skillRoofing: 0, skillType: 0, performance: 0, penalty: 0 }
                    });
                    assignedCount++;
                }
                log(`- AI RESULT: ${assignedCount} jobs assigned by AI.`);
                newDailyStates.set(dateKey, newState);
                return newDailyStates;
            }, 'AI Assign');
            addAiThought(`Assignment complete! ${result.assignments.length} jobs were assigned.`);
            setAutoMapAction('show-all');
        } catch (error) {
            console.error("AI assignment failed:", error);
            log(`- ERROR: AI assignment failed. Details in console.`);
            addAiThought(`An error occurred: ${error instanceof Error ? error.message : 'Unknown error'}`);
        } finally {
            setIsAiAssigning(false);
        }
    }, [log, appState, selectedDayString, addAiThought, clearAiThoughts, recordChange, selectedDate]);

    const handleSwapSchedules = useCallback((repId1: string, repId2: string) => {
        const dateKey = formatDateToKey(selectedDate);
        recordChange(currentDailyStates => {
            const newDailyStates = new Map<string, AppState>(currentDailyStates);
            const dayState = newDailyStates.get(dateKey);
            if (!dayState) return currentDailyStates;
            const newState = JSON.parse(JSON.stringify(dayState)) as AppState;
            const rep1Index = newState.reps.findIndex(r => r.id === repId1);
            const rep2Index = newState.reps.findIndex(r => r.id === repId2);
            if (rep1Index === -1 || rep2Index === -1) return currentDailyStates;
            const tempSchedule = newState.reps[rep1Index].schedule;
            newState.reps[rep1Index].schedule = newState.reps[rep2Index].schedule;
            newState.reps[rep2Index].schedule = tempSchedule;
            newState.reps[rep1Index].isOptimized = false;
            newState.reps[rep2Index].isOptimized = false;
            newDailyStates.set(dateKey, newState);
            return newDailyStates;
        }, 'Swap Schedules');
        setMapRefreshTrigger(prev => prev + 1);
    }, [recordChange, selectedDate]);

    const handleToggleRepExpansion = (repId: string) => {
        setExpandedRepIds(prev => { const newSet = new Set(prev); newSet.has(repId) ? newSet.delete(repId) : newSet.add(repId); return newSet; });
    };
    const handleToggleAllReps = (filteredReps: Rep[]) => {
        if (expandedRepIds.size < filteredReps.length) setExpandedRepIds(new Set(filteredReps.map(r => r.id)));
        else setExpandedRepIds(new Set());
    };
    const handleSaveStateToFile = useCallback(() => {
        log('ACTION: Save state to file.');
        try {
            const stateToSave = {
                dailyStates: Array.from(dailyStates.entries()),
                activeDayKeys,
                changeLog,
                savedAt: new Date().toISOString()
            };
            const jsonString = JSON.stringify(stateToSave, null, 2);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            const date = new Date();
            const timestamp = `${date.getFullYear()}${(date.getMonth() + 1).toString().padStart(2, '0')}${date.getDate().toString().padStart(2, '0')}`;
            link.download = `rep-route-planner-save-${timestamp}.json`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
            log('- SUCCESS: State saved to file with changelog.');
        } catch (error) { console.error("Save state error:", error); showToast("Error saving file.", 'error'); }
    }, [dailyStates, activeDayKeys, changeLog, log]);

    const handleLoadStateFromFile = useCallback((loadedState: any) => {
        log('ACTION: Load state from file.');
        try {
            if (!loadedState || !Array.isArray(loadedState.dailyStates) || !Array.isArray(loadedState.activeDayKeys)) throw new Error("Invalid file format.");
            const isAppState = (v: any): v is { reps: Rep[], unassignedJobs: Job[], settings?: Partial<Settings> } => v && Array.isArray(v.reps) && Array.isArray(v.unassignedJobs);

            const validEntries = loadedState.dailyStates.map((e: any): [string, AppState] => {
                if (Array.isArray(e) && typeof e[0] === 'string' && isAppState(e[1])) {
                    const stateCandidate = e[1];
                    const finalState: AppState = {
                        reps: stateCandidate.reps,
                        unassignedJobs: stateCandidate.unassignedJobs,
                        settings: { ...DEFAULT_SETTINGS, ...(stateCandidate.settings || {}) }
                    };
                    return [e[0], finalState];
                } throw new Error("Invalid entry.");
            });

            // Merge loaded states with existing states
            const mergedDailyStates = new Map(dailyStates);
            const allChanges: JobChange[] = [];

            for (const [dateKey, loadedDayState] of validEntries) {
                const existingState = mergedDailyStates.get(dateKey);

                if (existingState) {
                    // Merge the loaded state with existing state
                    log(`Merging loaded data for ${dateKey}...`);

                    // Start with a copy of existing state
                    const mergedState = JSON.parse(JSON.stringify(existingState)) as AppState;

                    // Update rep properties (locked, optimized) from loaded state
                    for (const loadedRep of loadedDayState.reps) {
                        const mergedRep = mergedState.reps.find(r => r.id === loadedRep.id);
                        if (mergedRep) {
                            if (loadedRep.isLocked !== undefined) mergedRep.isLocked = loadedRep.isLocked;
                            if (loadedRep.isOptimized !== undefined) mergedRep.isOptimized = loadedRep.isOptimized;
                        }
                    }

                    // Process each job from loaded state
                    const loadedJobs: Job[] = [
                        ...loadedDayState.unassignedJobs,
                        ...loadedDayState.reps.flatMap(rep => rep.schedule.flatMap(slot => slot.jobs))
                    ];

                    for (const loadedJob of loadedJobs) {
                        const existingMatch = findMatchingJob(loadedJob, mergedState);

                        if (existingMatch) {
                            // Update existing job
                            const differences = compareJobs(existingMatch.job, loadedJob);
                            if (differences.length > 0) {
                                Object.assign(existingMatch.job, {
                                    customerName: loadedJob.customerName,
                                    address: loadedJob.address,
                                    city: loadedJob.city,
                                    notes: loadedJob.notes,
                                    originalTimeframe: loadedJob.originalTimeframe,
                                    zipCode: loadedJob.zipCode
                                });
                                log(`Updated job from save file: ${loadedJob.address}`);
                            }
                        } else {
                            // Add new job - check where it was in loaded state
                            let jobAdded = false;
                            for (const loadedRep of loadedDayState.reps) {
                                for (const loadedSlot of loadedRep.schedule) {
                                    if (loadedSlot.jobs.find(j => getJobIdentifier(j) === getJobIdentifier(loadedJob))) {
                                        // Find corresponding rep and slot in merged state
                                        const mergedRep = mergedState.reps.find(r => r.name === loadedRep.name);
                                        if (mergedRep) {
                                            const mergedSlot = mergedRep.schedule.find(s => s.id === loadedSlot.id);
                                            if (mergedSlot) {
                                                mergedSlot.jobs.push(loadedJob);
                                                log(`Added new job from save file: ${loadedJob.address} to ${mergedRep.name}`);
                                                jobAdded = true;
                                                break;
                                            }
                                        }
                                    }
                                }
                                if (jobAdded) break;
                            }

                            if (!jobAdded) {
                                // Add to unassigned if not found in any rep's schedule
                                mergedState.unassignedJobs.push(loadedJob);
                                log(`Added new unassigned job from save file: ${loadedJob.address}`);
                            }
                        }
                    }

                    // Detect changes
                    const changes = detectJobChanges(dateKey, existingState, mergedState, new Date().toISOString());
                    allChanges.push(...changes);

                    mergedDailyStates.set(dateKey, mergedState);
                } else {
                    // No existing state for this date, just add it
                    log(`Adding new day from save file: ${dateKey}`);
                    mergedDailyStates.set(dateKey, loadedDayState);
                }
            }

            // Merge active day keys
            const loadedDayKeys = loadedState.activeDayKeys.filter((k: any) => typeof k === 'string');
            const mergedActiveDayKeys = Array.from(new Set([...activeDayKeys, ...loadedDayKeys])).sort();

            // Load changelog if present and merge
            const loadedChangeLog = Array.isArray(loadedState.changeLog) ? loadedState.changeLog : [];
            if (loadedChangeLog.length > 0 || allChanges.length > 0) {
                setChangeLog(prev => [...prev, ...loadedChangeLog, ...allChanges]);
                log(`- Loaded ${loadedChangeLog.length} changelog entries from file + ${allChanges.length} merge changes`);
            }

            setHistory([mergedDailyStates]);
            setHistoryIndex(0);
            setActiveDayKeys(mergedActiveDayKeys);

            // Stay on current date if it exists, otherwise go to first loaded date
            const currentDateKey = formatDateToKey(selectedDate);
            if (mergedDailyStates.has(currentDateKey)) {
                _setSelectedDate(selectedDate);
            } else if (loadedDayKeys.length > 0) {
                _setSelectedDate(new Date(loadedDayKeys[0] + 'T12:00:00'));
            }

            setActiveRoute(null);
            setSelectedRepId(null);
            log(`- SUCCESS: Merged loaded state with existing data.`);
            showToast("Schedule loaded and merged successfully!", 'success');
        } catch (error) { const msg = error instanceof Error ? error.message : "Unknown error"; log(`- ERROR: ${msg}`); showToast(`Error loading file: ${msg}`, 'error'); }
    }, [log, dailyStates, activeDayKeys, selectedDate]);

    const filteredReps = useCallback((repSearchTerm: string, cityFilters: Set<string>, lockFilter: 'all' | 'locked' | 'unlocked') => {
        const repsToSort = appState.reps.filter(rep => {
            // Filter out reps who are completely unavailable for the selected day
            const unavailableSlotsToday = rep.unavailableSlots?.[selectedDayString] || [];
            const isFullyUnavailable = Array.isArray(unavailableSlotsToday) && unavailableSlotsToday.length === TIME_SLOTS.length;
            if (isFullyUnavailable) return false;

            if (cityFilters.size > 0 && !rep.schedule.some(slot => slot.jobs.some(job => job.city && cityFilters.has(job.city)))) return false;
            if (!rep.name.toLowerCase().includes(repSearchTerm.toLowerCase())) return false;
            if (lockFilter === 'locked' && !rep.isLocked) return false;
            if (lockFilter === 'unlocked' && rep.isLocked) return false;
            return true;
        });
        repsToSort.sort((a, b) => {
            const aUnavailableSlots = a.unavailableSlots?.[selectedDayString];
            const bUnavailableSlots = b.unavailableSlots?.[selectedDayString];
            const aIsUnavailable = Array.isArray(aUnavailableSlots) && aUnavailableSlots.length === TIME_SLOTS.length;
            const bIsUnavailable = Array.isArray(bUnavailableSlots) && bUnavailableSlots.length === TIME_SLOTS.length;
            if (aIsUnavailable && !bIsUnavailable) return 1;
            if (!aIsUnavailable && bIsUnavailable) return -1;
            let aValue: string | number, bValue: string | number;
            switch (sortConfig.key) {
                case 'name': aValue = getCleanSortName(a.name); bValue = getCleanSortName(b.name); break;
                case 'jobCount': aValue = a.schedule.flatMap(s => s.jobs).length; bValue = b.schedule.flatMap(s => s.jobs).length; break;
                case 'cityCount': aValue = new Set(a.schedule.flatMap(s => s.jobs).map(j => j.city).filter(Boolean)).size; bValue = new Set(b.schedule.flatMap(s => s.jobs).map(j => j.city).filter(Boolean)).size; break;
                case 'availability': aValue = a.availability.split(',').length; bValue = b.availability.split(',').length; break;
                case 'skillCount': aValue = (a.skills ? Object.values(a.skills) : []).reduce<number>((sum, level) => sum + (level as number), 0); bValue = (b.skills ? Object.values(b.skills) : []).reduce<number>((sum, level) => sum + (level as number), 0); break;
                case 'Tile': case 'Shingle': case 'Flat': case 'Metal': case 'Insurance': case 'Commercial': aValue = (a.skills as any)?.[sortConfig.key] || 0; bValue = (b.skills as any)?.[sortConfig.key] || 0; break;
                case 'salesRank': aValue = a.salesRank === undefined ? 999 : a.salesRank; bValue = b.salesRank === undefined ? 999 : b.salesRank; break;
                default: return a.name.localeCompare(b.name);
            }
            if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
            if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
            return a.name.localeCompare(b.name);
        });
        return repsToSort;
    }, [appState.reps, sortConfig, selectedDayString]);

    useEffect(() => {
        if (!hasInitializedMap && allJobs.length > 0) {
            handleShowAllJobsOnMap();
            setHasInitializedMap(true);
        }
    }, [allJobs.length, hasInitializedMap, handleShowAllJobsOnMap]);

    useEffect(() => {
        if (autoMapAction === 'none') return;

        if (autoMapAction === 'show-all') {
            handleShowAllJobsOnMap();
        } else {
            handleShowRoute(autoMapAction, false);
        }
        setAutoMapAction('none');
    }, [autoMapAction, handleShowAllJobsOnMap, handleShowRoute]);

    const handleSaveStateToCloud = useCallback(async (dateKey?: string) => {
        log('ACTION: Manual save to cloud (versioned backup).');
        try {
            const keysToSave = dateKey ? [dateKey] : activeDayKeys;

            if (keysToSave.length === 0) {
                showToast('No data to save', 'info');
                return;
            }

            let successCount = 0;
            let failedCount = 0;
            let lastVersion = 0;

            for (const key of keysToSave) {
                const state = dailyStates.get(key);
                if (!state) continue;

                const result = await createManualBackup(key, state);
                if (result.success && result.version) {
                    log(`- SUCCESS: Created backup v${result.version.versionNumber} for ${key}`);
                    successCount++;
                    lastVersion = result.version.versionNumber;
                } else {
                    log(`- ERROR saving ${key}: ${result.error}`);
                    failedCount++;
                }
            }

            if (successCount > 0) {
                hasUnsavedChangesRef.current = false;
                setLastAutoSaveTime(new Date());
                if (keysToSave.length === 1) {
                    showToast(`Saved ${keysToSave[0]} (version ${lastVersion})`, 'success');
                } else if (failedCount > 0) {
                    showToast(`Saved ${successCount} day(s). ${failedCount} failed.`, 'warning');
                } else {
                    showToast(`Saved ${successCount} day(s) successfully!`, 'success');
                }
            } else {
                showToast('Failed to save any days', 'error');
            }
        } catch (error) {
            const msg = error instanceof Error ? error.message : 'Unknown error';
            log(`- ERROR: ${msg}`);
            showToast(`Error saving to cloud: ${msg}`, 'error');
        }
    }, [dailyStates, activeDayKeys, log, showToast]);

    const handleLoadStateFromCloud = useCallback(async (dateKey?: string) => {
        log('ACTION: Load state from cloud.');

        // Block loadReps from running during cloud load
        setIsCloudLoading(true);

        try {
            // Generate rolling 7-day window: yesterday through 5 days from now
            // This matches the ROLLING_DAYS_CONFIG in cloudStorageServiceSheets.ts
            const today = new Date();
            const rollingDays: string[] = [];
            for (let i = -1; i <= 5; i++) {  // -1 = yesterday, 0 = today, 1-5 = next 5 days
                const date = new Date(today);
                date.setDate(today.getDate() + i);
                const dateKey = date.toISOString().split('T')[0];
                rollingDays.push(dateKey);
            }

            log(`Loading rolling 7-day window: ${rollingDays.join(', ')}`);

            // Load all 7 days
            const result = await loadAllStatesFromCloud(rollingDays);
            if (result.success && result.results) {
                // Start fresh - don't merge with existing state, replace it entirely
                // This ensures cloud data takes precedence over any locally initialized data
                const newDailyStates = new Map<string, AppState>();
                let loadedCount = 0;
                const loadedDays: string[] = [];

                for (const item of result.results) {
                    if (item.success && item.data) {
                        // Filter out excluded reps from loaded state
                        newDailyStates.set(item.dateKey, filterExcludedReps(item.data));
                        loadedCount++;
                        loadedDays.push(item.dateKey);
                    }
                }

                if (loadedCount === 0) {
                    log('- No data found in cloud for the rolling 7-day window (this is normal for first use)');
                    showToast('No saved data found in cloud. Data will auto-save after 2 minutes of use.', 'info');
                    return;
                }

                // Only include days that were successfully loaded from cloud
                const sortedActiveDays = loadedDays.sort((a, b) => a.localeCompare(b));

                // Mark these days as cloud-loaded to prevent loadReps from overwriting them
                cloudLoadedDaysRef.current = new Set(loadedDays);

                setHistory([newDailyStates]);
                setHistoryIndex(0);
                setActiveDayKeys(sortedActiveDays);

                // Set selected date to the first loaded day
                if (sortedActiveDays.length > 0) {
                    const firstDayDate = new Date(sortedActiveDays[0] + 'T12:00:00');
                    _setSelectedDate(firstDayDate);
                }

                log(`- SUCCESS: Loaded ${loadedCount}/7 days from cloud`);
                showToast(`Loaded ${loadedCount} day(s) from cloud successfully!`, 'success');
            } else {
                log(`- ERROR: ${result.error}`);
                showToast(`Error loading from cloud: ${result.error}`, 'error');
            }
        } catch (error) {
            const msg = error instanceof Error ? error.message : 'Unknown error';
            log(`- ERROR: ${msg}`);
            showToast(`Error loading from cloud: ${msg}`, 'error');
        } finally {
            // Re-enable loadReps after cloud load completes
            setIsCloudLoading(false);
        }
    }, [log]);

    // Function to mark activity (call this when user interacts)
    const markActivity = useCallback(() => {
        lastActivityRef.current = Date.now();
        hasUnsavedChangesRef.current = true;
    }, []);

    // Auto-save function - saves to single auto-save slot per day (debounced)
    const performAutoSave = useCallback(async () => {
        // Clear timers
        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
            debounceTimerRef.current = null;
        }
        if (fallbackTimerRef.current) {
            clearTimeout(fallbackTimerRef.current);
            fallbackTimerRef.current = null;
        }

        // Don't auto-save if:
        // 1. No unsaved changes
        // 2. Currently loading from cloud
        // 3. No active days to save
        if (!hasUnsavedChangesRef.current || isCloudLoading || activeDayKeys.length === 0) {
            return;
        }

        setIsAutoSaving(true);
        log('[AutoSave] Starting debounced auto-save...');

        try {
            let successCount = 0;
            for (const dateKey of activeDayKeys) {
                const state = dailyStates.get(dateKey);
                if (state) {
                    const result = await upsertAutoBackup(dateKey, state);
                    if (result.success) {
                        successCount++;
                    } else {
                        log(`[AutoSave] Error saving ${dateKey}: ${result.error}`);
                    }
                }
            }

            if (successCount > 0) {
                log(`[AutoSave] Saved ${successCount}/${activeDayKeys.length} days`);
                hasUnsavedChangesRef.current = false;
                setLastAutoSaveTime(new Date());
            }
        } catch (error) {
            const msg = error instanceof Error ? error.message : 'Unknown error';
            log(`[AutoSave] Error: ${msg}`);
        } finally {
            setIsAutoSaving(false);
        }
    }, [dailyStates, activeDayKeys, isCloudLoading, log]);

    // Trigger debounced auto-save (called on state changes)
    const triggerDebouncedAutoSave = useCallback(() => {
        // Clear existing debounce timer
        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
        }

        // Set new debounce timer (5 seconds after activity stops)
        debounceTimerRef.current = setTimeout(() => {
            performAutoSave();
        }, BACKUP_CONFIG.AUTO_DEBOUNCE_MS);

        // Set fallback timer if not already set (60 seconds max between saves)
        if (!fallbackTimerRef.current) {
            fallbackTimerRef.current = setTimeout(() => {
                performAutoSave();
                fallbackTimerRef.current = null;
            }, BACKUP_CONFIG.AUTO_FALLBACK_MS);
        }
    }, [performAutoSave]);

    // Cleanup timers on unmount
    useEffect(() => {
        return () => {
            if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current);
            }
            if (fallbackTimerRef.current) {
                clearTimeout(fallbackTimerRef.current);
            }
        };
    }, []);

    // Mark activity and trigger debounced auto-save on state changes
    useEffect(() => {
        // When dailyStates changes (jobs assigned, moved, etc.), mark as activity and trigger save
        if (historyIndex > 0 || history.length > 1) {
            markActivity();
            triggerDebouncedAutoSave();
        }
    }, [dailyStates, markActivity, triggerDebouncedAutoSave, historyIndex, history.length]);

    const handleSync = useCallback(async () => {
        log('ACTION: Sync started.');
        try {
            // 1. Load from Cloud (Merge)
            log('Sync: Loading remote changes...');
            const loadResult = await loadAllStatesFromCloud(activeDayKeys);

            if (!loadResult.success) {
                throw new Error(loadResult.error || 'Failed to load from cloud');
            }

            let loadedCount = 0;
            const mergedDailyStates = new Map(dailyStates);

            if (loadResult.results) {
                for (const item of loadResult.results) {
                    if (item.success && item.data) {
                        const dateKey = item.dateKey;
                        const existingState = mergedDailyStates.get(dateKey);
                        // Filter out excluded reps from loaded data
                        const filteredData = filterExcludedReps(item.data);

                        if (existingState) {
                            // Merge logic
                            const mergedState = JSON.parse(JSON.stringify(existingState)) as AppState;
                            const loadedJobs = [
                                ...filteredData.unassignedJobs,
                                ...filteredData.reps.flatMap(rep => rep.schedule.flatMap(slot => slot.jobs))
                            ];

                            for (const loadedJob of loadedJobs) {
                                const existingMatch = findMatchingJob(loadedJob, mergedState);
                                if (existingMatch) {
                                    Object.assign(existingMatch.job, loadedJob);
                                } else {
                                    mergedState.unassignedJobs.push(loadedJob);
                                }
                            }
                            mergedDailyStates.set(dateKey, filterExcludedReps(mergedState));
                        } else {
                            mergedDailyStates.set(dateKey, filteredData);
                        }
                        loadedCount++;
                    }
                }
            }

            // Update local state with merged data
            setHistory([mergedDailyStates]);
            setHistoryIndex(0);
            log(`Sync: Merged ${loadedCount} days from cloud.`);

            // 2. Save Merged State back to Cloud
            log('Sync: Saving merged state to cloud...');
            const statesToSave = activeDayKeys.map(key => ({
                dateKey: key,
                data: mergedDailyStates.get(key)!
            })).filter(s => s.data);

            if (statesToSave.length > 0) {
                const saveResult = await saveAllStatesToCloud(statesToSave);
                if (!saveResult.success) {
                    throw new Error(saveResult.error || 'Failed to save to cloud');
                }
                const successCount = saveResult.results?.filter(r => r.success).length || 0;
                log(`Sync: Saved ${successCount} days to cloud.`);
            }

            log('- SUCCESS: Sync complete.');
            showToast('Sync complete! Content is up to date.', 'success');

        } catch (error) {
            const msg = error instanceof Error ? error.message : 'Unknown error';
            log(`- ERROR (Sync): ${msg}`);
            showToast(`Sync failed: ${msg}`, 'error');
        }
    }, [dailyStates, activeDayKeys, log]);

    const clearChangeLog = useCallback(() => {
        setChangeLog([]);
        log('Change log cleared');
    }, [log]);


    // --- Confirmation Modal Logic ---
    const [confirmationState, setConfirmationState] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        onConfirm: () => void;
        confirmLabel?: string;
        cancelLabel?: string;
        isDangerous?: boolean;
    }>({
        isOpen: false,
        title: '',
        message: '',
        onConfirm: () => { },
    });

    const requestConfirmation = useCallback((options: { title: string, message: string, onConfirm: () => void, confirmLabel?: string, cancelLabel?: string, isDangerous?: boolean }) => {
        setConfirmationState({
            isOpen: true,
            ...options
        });
    }, []);

    const closeConfirmation = useCallback(() => {
        setConfirmationState(prev => ({ ...prev, isOpen: false }));
    }, []);

    // Load options modal handlers
    const showLoadOptionsModal = useCallback(async () => {
        setLoadOptionsModal(prev => ({ ...prev, isOpen: true, isLoading: true }));

        try {
            const result = await fetchBackupList();
            if (result.success && result.backups) {
                const manual = result.backups
                    .filter(b => b.saveType === 'manual')
                    .sort((a, b) => b.versionNumber - a.versionNumber); // Newest version first
                const auto = result.backups.find(b => b.saveType === 'auto') || null;

                setLoadOptionsModal({
                    isOpen: true,
                    manualBackups: manual,
                    autoBackup: auto,
                    selectedBackupId: null,
                    isLoading: false,
                });
            } else {
                setLoadOptionsModal({
                    isOpen: true,
                    manualBackups: [],
                    autoBackup: null,
                    selectedBackupId: null,
                    isLoading: false,
                });
            }
        } catch (error) {
            console.error('Error fetching backups:', error);
            setLoadOptionsModal({
                isOpen: true,
                manualBackups: [],
                autoBackup: null,
                selectedBackupId: null,
                isLoading: false,
            });
        }
    }, []);

    const closeLoadOptionsModal = useCallback(() => {
        setLoadOptionsModal(prev => ({ ...prev, isOpen: false }));
    }, []);

    const loadSelectedBackup = useCallback(async (backupId: string) => {
        setIsCloudLoading(true);
        log('ACTION: Loading selected backup...');

        try {
            const result = await loadBackup(backupId);
            if (result.success && result.data) {
                const { dateKey } = result.data.version;
                const loadedState = filterExcludedReps(result.data.data);

                // Update the daily states with the loaded data
                const newDailyStates = new Map(dailyStates);
                newDailyStates.set(dateKey, loadedState);

                // Add to active days if not already there
                const newActiveDays = activeDayKeys.includes(dateKey)
                    ? activeDayKeys
                    : [...activeDayKeys, dateKey].sort();

                // Mark this day as cloud-loaded
                cloudLoadedDaysRef.current.add(dateKey);

                setHistory([newDailyStates]);
                setHistoryIndex(0);
                setActiveDayKeys(newActiveDays);

                // Set selected date to the loaded day
                const loadedDate = new Date(dateKey + 'T12:00:00');
                _setSelectedDate(loadedDate);

                const timestamp = new Date(result.data.version.createdAt).toLocaleString();
                const typeLabel = result.data.version.saveType === 'manual'
                    ? `v${result.data.version.versionNumber}`
                    : 'auto-save';
                log(`- SUCCESS: Loaded ${dateKey} (${typeLabel}) from ${timestamp}`);
                showToast(`Loaded ${dateKey} (${typeLabel})`, 'success');
            } else {
                log(`- ERROR: ${result.error}`);
                showToast(`Error loading backup: ${result.error}`, 'error');
            }
        } catch (error) {
            const msg = error instanceof Error ? error.message : 'Unknown error';
            log(`- ERROR: ${msg}`);
            showToast(`Error loading backup: ${msg}`, 'error');
        } finally {
            setIsCloudLoading(false);
            closeLoadOptionsModal();
        }
    }, [dailyStates, activeDayKeys, log, showToast, closeLoadOptionsModal]);

    // Show load options modal on initial mount
    useEffect(() => {
        if (!hasAutoLoadedRef.current) {
            hasAutoLoadedRef.current = true;
            // Use setTimeout to ensure the UI has rendered before showing the modal
            setTimeout(() => {
                showLoadOptionsModal();
            }, 500);
        }
    }, [showLoadOptionsModal]);

    // Wrapped Handlers
    const _handleSaveStateToFile = handleSaveStateToFile;
    const confirmSaveStateToFile = useCallback(() => {
        requestConfirmation({
            title: "Save to Desktop",
            message: "Are you sure you want to save the current schedule to your desktop?",
            confirmLabel: "Yes, Save",
            cancelLabel: "No",
            onConfirm: () => {
                _handleSaveStateToFile();
                closeConfirmation();
            }
        });
    }, [_handleSaveStateToFile, requestConfirmation, closeConfirmation]);

    const _handleLoadStateFromFile = handleLoadStateFromFile;
    const confirmLoadStateFromFile = useCallback((loadedState: any) => {
        requestConfirmation({
            title: "Load from Desktop",
            message: "Are you sure you want to load this file? It will be merged with your current schedule.",
            confirmLabel: "Yes, Load",
            cancelLabel: "No",
            onConfirm: () => {
                _handleLoadStateFromFile(loadedState);
                closeConfirmation();
            }
        });
    }, [_handleLoadStateFromFile, requestConfirmation, closeConfirmation]);

    const _handleSaveStateToCloud = handleSaveStateToCloud;
    const confirmSaveStateToCloud = useCallback(() => {
        requestConfirmation({
            title: "Upload to Cloud",
            message: "Are you sure you want to upload the current schedule to the cloud? This will overwrite the date on the server.",
            confirmLabel: "Yes, Upload",
            cancelLabel: "No",
            isDangerous: true,
            onConfirm: () => {
                _handleSaveStateToCloud();
                closeConfirmation();
            }
        });
    }, [_handleSaveStateToCloud, requestConfirmation, closeConfirmation]);

    const _handleLoadStateFromCloud = handleLoadStateFromCloud;
    const confirmLoadStateFromCloud = useCallback(() => {
        requestConfirmation({
            title: "Load from Cloud",
            message: "Are you sure you want to load the schedule from the cloud? This will merge with your local data.",
            confirmLabel: "Yes, Load",
            cancelLabel: "No",
            onConfirm: () => {
                _handleLoadStateFromCloud();
                closeConfirmation();
            }
        });
    }, [_handleLoadStateFromCloud, requestConfirmation, closeConfirmation]);

    const _handleSync = handleSync;
    const confirmSync = useCallback(() => {
        requestConfirmation({
            title: "Sync with Cloud",
            message: "Are you sure you want to sync? This will merge local changes with the cloud.",
            confirmLabel: "Yes, Sync",
            cancelLabel: "No",
            onConfirm: () => {
                _handleSync();
                closeConfirmation();
            }
        });
    }, [_handleSync, requestConfirmation, closeConfirmation]);


    return {
        appState, setAppState, isLoadingReps, repsError, isParsing, isAutoAssigning, isDistributing, isAiAssigning, isAiFixingAddresses, isTryingVariations, parsingError,
        selectedRepId, usingMockData, activeSheetName, selectedDate, activeDayKeys, addActiveDay, removeActiveDay, setSelectedDate, expandedRepIds, getJobCountsForDay,
        isOverrideActive, sortConfig, setSortConfig, debugLogs, log, aiThoughts, activeRoute, isRouting,
        draggedJob, setDraggedJob, draggedOverRepId, setDraggedOverRepId, handleJobDragEnd,
        handleRefreshRoute, settings: appState.settings, updateSettings,
        uiSettings, updateUiSettings, updateCustomTheme, resetCustomTheme,
        loadReps, handleShowRoute, handleParseJobs, handleAutoAssign, handleDistributeJobs, handleAutoAssignForRep, handleAiAssign, handleAiFixAddresses, handleTryAddressVariations, clearAiThoughts, handleUnassignJob,
        handleClearAllSchedules, handleJobDrop, handleToggleRepLock,
        handleToggleRepExpansion, handleToggleAllReps, handleUpdateJob, handleRemoveJob, handleUpdateRep, allJobs, assignedJobs, assignedJobsCount,
        assignedCities, assignedRepNames, filteredReps, handleShowUnassignedJobsOnMap, handleShowAllJobsOnMap, handleShowZipOnMap, handleShowAllRepLocations, handleShowFilteredJobsOnMap,
        isJobValidForRepRegion, checkCityRuleViolation,
        handleOptimizeRepRoute, handleUnoptimizeRepRoute, handleSwapSchedules,
        handleSaveStateToFile: confirmSaveStateToFile,
        handleLoadStateFromFile: confirmLoadStateFromFile,
        handleSaveStateToCloud: confirmSaveStateToCloud,
        handleLoadStateFromCloud: confirmLoadStateFromCloud,
        handleUndo, handleRedo, canUndo, canRedo,
        hoveredJobId, setHoveredJobId,
        hoveredRepId, setHoveredRepId,
        repSettingsModalRepId, setRepSettingsModalRepId,
        roofrJobIdMap,
        announcement,
        setFilteredAssignedJobs,
        setFilteredUnassignedJobs,
        filteredAssignedJobs,
        filteredUnassignedJobs,
        swapSourceRepId,
        setSwapSourceRepId,
        changeLog,
        clearChangeLog,
        handleSync: confirmSync,
        placementJobId,
        setPlacementJobId,
        handlePlaceJobOnMap,
        setSelectedRepId,
        // Auto-save state
        isAutoSaving,
        lastAutoSaveTime,
        markActivity,

        confirmationState,
        requestConfirmation,
        closeConfirmation,

        // Toast notifications
        toasts,
        showToast,
        dismissToast,

        // Load Options Modal
        loadOptionsModal,
        showLoadOptionsModal,
        loadSelectedBackup,
        closeLoadOptionsModal,

        // Routing API Integration
        useRoutingApi,
        toggleRoutingApiMode,
        isLoadingFromRoutingApi,
        routingApiError,
        routingApiSyncStatus,
        loadJobsFromRoutingApi,
    };
};