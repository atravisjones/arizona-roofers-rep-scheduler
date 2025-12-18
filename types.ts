import React from 'react';
import { Coordinates } from './services/osmService';

export interface ParsedJobsResult {
  date: string | null;
  jobs: Job[];
}

export type ChangeType = 'added' | 'removed' | 'updated' | 'moved';

export interface JobChange {
  type: ChangeType;
  jobId: string;
  timestamp: string;
  dateKey: string;
  before?: {
    customerName?: string;
    address?: string;
    city?: string;
    notes?: string;
    originalTimeframe?: string;
    repId?: string;
    repName?: string;
    slotId?: string;
    slotLabel?: string;
  };
  after?: {
    customerName?: string;
    address?: string;
    city?: string;
    notes?: string;
    originalTimeframe?: string;
    repId?: string;
    repName?: string;
    slotId?: string;
    slotLabel?: string;
  };
  details?: string;
}

export interface ChangeLog {
  changes: JobChange[];
  sessionId: string;
  createdAt: string;
}

// Create a literal type from the array of keywords
// To avoid circular dependency with constants.ts, we define this explicitly.
type SkillName = 'Tile' | 'Shingle' | 'Flat' | 'Metal' | 'Insurance' | 'Commercial';

export type SortKey = 'name' | 'availability' | 'jobCount' | 'cityCount' | 'skillCount' | 'score' | 'salesRank' | SkillName;

export interface SortConfig {
  key: SortKey;
  direction: 'asc' | 'desc';
}

export interface ScoringWeights {
  timeframeMatch: number;  // HIGHEST: Job timeframe matches slot (default 10)
  performance: number;     // HIGH: Sales Rank for priority leads (default 8)
  skillRoofing: number;    // MEDIUM: Tile, Shingle, etc. (default 5)
  skillType: number;       // MEDIUM: Insurance, Commercial (default 4)
  distanceCluster: number; // LOW: Proximity to other jobs (default 2)
  distanceBase: number;    // LOWEST: Proximity to Home/Region (default 1)
}

export interface ScoreBreakdown {
  timeframeMatch: number;
  performance: number;
  skillRoofing: number;
  skillType: number;
  distanceCluster: number;
  distanceBase: number;
  penalty: number;
}

export interface Settings {
  // General Rules
  allowDoubleBooking: boolean;
  maxJobsPerSlot: number;
  allowAssignOutsideAvailability: boolean;
  maxJobsPerRep: number;
  minJobsPerRep: number; // Added minimum target
  maxCitiesPerRep: number;

  // Auto-Assign & AI Weights (0-10 scale)
  // Deprecated in favor of ScoringWeights but kept for backward compat if needed logic remains
  weightSameCity: number;
  weightAdjacentCity: number;
  weightSkillMatch: number;

  unavailabilityPenalty: number; // A value from 0-10, applied as a negative.
  strictTimeSlotMatching: boolean;

  maxTravelTimeMinutes: number; // In minutes

  // Gamification / Scoring Logic
  scoringWeights: ScoringWeights;

  // Regional Rules
  allowRegionalRepsInPhoenix: boolean;
}

export interface UiSettings {
  theme: 'light' | 'dark' | 'system' | 'midnight' | 'gruvbox' | 'custom';
  showUnplottedJobs: boolean;
  showUnassignedJobsColumn: boolean;
  customTheme?: Record<string, string>;
}


export interface Rep {
  id: string;
  name: string;
  availability: string;
  schedule: ScheduledTimeSlot[];
  isMock?: boolean; // Flag to indicate if this is sample data
  unavailableSlots?: Record<string, string[]>; // e.g. { "Monday": ["ts-3", "ts-4"] }
  skills?: Record<string, number>; // e.g. { "Tile": 3, "Shingle": 2 }
  region?: 'PHX' | 'NORTH' | 'SOUTH' | 'UNKNOWN';
  zipCodes?: string[];
  isLocked?: boolean;
  isOptimized?: boolean;
  sourceRow?: number; // Row number in the source spreadsheet (for filtering inactive reps)

  // Gamification Properties
  salesRank?: number; // 1 = Top performer.
  scoringOverrides?: Partial<ScoringWeights>; // Individual overrides
}

export interface Job {
  id: string;
  customerName: string;
  address: string;
  notes: string;
  city?: string; // Added city to the job type
  originalTimeframe?: string; // Added original timeframe from pasted text
  zipCode?: string;
}

export interface DisplayJob extends Job {
  assignedRepName?: string;
  timeSlotLabel?: string;
  geocodeError?: string;
  isEstimatedLocation?: boolean;
  isDimmed?: boolean;
  isStartLocation?: boolean;
  isRepHome?: boolean;
  assignmentScore?: number; // The score (0-100) of this specific assignment
  scoreBreakdown?: ScoreBreakdown;
  markerLabel?: string; // Optional custom label for map marker (e.g., "1", "2")
}

export interface TimeSlot {
  id: string;
  label: string;
}

export interface ScheduledTimeSlot extends TimeSlot {
  jobs: DisplayJob[]; // Updated to use DisplayJob to support assignmentScore
}

export interface AppState {
  reps: Rep[];
  unassignedJobs: Job[];
  settings: Settings;
}

export interface RouteInfo {
  distance: number; // in miles
  duration: number; // in minutes
  geometry: any; // GeoJSON geometry
  coordinates: Coordinates[]; // for markers
}

export interface ItineraryItem {
  type: 'job' | 'lunch' | 'travel';
  timeRange: string;
  job?: DisplayJob;
  duration: string;
}

export interface AppContextType {
  appState: AppState;
  setAppState: React.Dispatch<React.SetStateAction<AppState>>;
  isLoadingReps: boolean;
  repsError: string | null;
  isParsing: boolean;
  isAutoAssigning: boolean;
  isDistributing: boolean;
  isAiAssigning: boolean;
  isAiFixingAddresses: boolean;
  isTryingVariations: boolean;
  parsingError: string | null;
  selectedRepId: string | null;
  setSelectedRepId: (id: string | null) => void;
  swapSourceRepId: string | null; // ID of the rep selected for swapping schedule (source)
  setSwapSourceRepId: (id: string | null) => void;
  usingMockData: boolean;
  activeSheetName: string;
  selectedDate: Date;
  activeDayKeys: string[];
  addActiveDay: (date: Date) => void;
  removeActiveDay: (dateKey: string) => void;
  setSelectedDate: (date: Date) => void;
  getJobCountsForDay: (dateKey: string) => { assigned: number; total: number };
  expandedRepIds: Set<string>;
  isOverrideActive: boolean;
  sortConfig: SortConfig;
  setSortConfig: (config: SortConfig) => void;
  debugLogs: string[];
  log: (message: string) => void;
  aiThoughts: string[];
  changeLog: JobChange[];
  clearChangeLog: () => void;
  activeRoute: {
    repName: string;
    mappableJobs: DisplayJob[];
    unmappableJobs: DisplayJob[];
    routeInfo: RouteInfo | null;
  } | null;
  isRouting: boolean;
  draggedJob: Job | null;
  setDraggedJob: (job: Job | null) => void;
  draggedOverRepId: string | null;
  setDraggedOverRepId: (id: string | null) => void;
  handleJobDragEnd: () => void;
  handleRefreshRoute: () => void;
  settings: Settings;
  updateSettings: (updatedSettings: Partial<Settings>) => void;
  uiSettings: UiSettings;
  updateUiSettings: (updatedSettings: Partial<UiSettings>) => void;
  updateCustomTheme: (updates: Record<string, string>) => void;
  resetCustomTheme: () => void;
  loadReps: (date: Date) => Promise<void>;
  handleShowRoute: (repId: string, optimize: boolean) => Promise<void>;
  handleShowUnassignedJobsOnMap: (jobs?: Job[]) => Promise<void>;
  handleShowFilteredJobsOnMap: (jobs: DisplayJob[], title: string) => Promise<void>; // New function
  handleShowAllJobsOnMap: () => Promise<void>;
  handleShowZipOnMap: (zip: string, rep?: Rep) => Promise<void>;
  handleShowAllRepLocations: () => Promise<void>;
  handleParseJobs: (pastedText: string, onComplete: () => void) => Promise<void>;
  handleAutoAssign: () => void;
  handleDistributeJobs: () => void;
  handleAutoAssignForRep: (repId: string) => void;
  handleAiAssign: () => void;
  handleAiFixAddresses: () => Promise<void>;
  handleTryAddressVariations: () => Promise<void>;
  clearAiThoughts: () => void;
  handleUnassignJob: (jobId: string) => void;
  handleClearAllSchedules: () => void;
  handleJobDrop: (jobId: string, target: { repId: string; slotId: string } | 'unassigned', e?: React.DragEvent<HTMLDivElement>) => void;
  handleToggleRepLock: (repId: string) => void;
  handleToggleRepExpansion: (repId: string) => void;
  handleToggleAllReps: (filteredReps: Rep[]) => void;
  handleUpdateJob: (jobId: string, updatedDetails: Partial<Pick<Job, 'customerName' | 'address' | 'notes' | 'originalTimeframe'>>) => void;
  handleUpdateRep: (repId: string, updates: Partial<Rep>) => void; // New function
  handleRemoveJob: (jobId: string) => void;
  handleOptimizeRepRoute: (repId: string) => Promise<void>;
  handleUnoptimizeRepRoute: (repId: string) => void; // New function
  handleSwapSchedules: (repId1: string, repId2: string) => void;
  handleSaveStateToFile: () => void;
  handleLoadStateFromFile: (loadedState: any) => void;
  handleSaveStateToCloud: () => void;
  handleLoadStateFromCloud: () => void;
  handleSync: () => void;
  handleUndo: () => void;
  handleRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  allJobs: DisplayJob[];
  assignedJobs: DisplayJob[];
  assignedJobsCount: number;
  assignedCities: string[];
  assignedRepNames: string[];
  filteredReps: (repSearchTerm: string, cityFilters: Set<string>, lockFilter: 'all' | 'locked' | 'unlocked') => Rep[];
  isJobValidForRepRegion: (job: Job, rep: Rep) => boolean;
  checkCityRuleViolation: (rep: Rep, newJobCity: string | null | undefined) => { violated: boolean, cities: Set<string> };
  hoveredJobId: string | null;
  setHoveredJobId: (id: string | null) => void;

  // UI State for modals
  repSettingsModalRepId: string | null;
  setRepSettingsModalRepId: (id: string | null) => void;

  // Roofr Job ID map
  roofrJobIdMap: Map<string, string>;

  // Announcement message
  announcement: string;

  // Map Filter State Pushing
  setFilteredAssignedJobs: (jobs: DisplayJob[]) => void;
  setFilteredUnassignedJobs: (jobs: Job[]) => void;

  placementJobId: string | null;
  setPlacementJobId: (id: string | null) => void;
  handlePlaceJobOnMap: (jobId: string, lat: number, lon: number) => void;

  // Auto-save state
  isAutoSaving: boolean;
  lastAutoSaveTime: Date | null;
  markActivity: () => void;

  // Confirmation Modal State
  confirmationState: {
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    confirmLabel?: string;
    cancelLabel?: string;
    isDangerous?: boolean;
  };
  requestConfirmation: (options: { title: string, message: string, onConfirm: () => void, confirmLabel?: string, cancelLabel?: string, isDangerous?: boolean }) => void;
  closeConfirmation: () => void;
}
