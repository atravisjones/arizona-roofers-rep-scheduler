import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useAppContext } from '../context/AppContext';
import { DragHandleIcon, SummaryIcon, SaveIcon, UploadIcon, UndoIcon, RedoIcon, UserIcon, TagIcon, RepairIcon, RescheduleIcon, SettingsIcon, HistoryIcon, CloudUploadIcon, CloudDownloadIcon, PasteIcon, AutoAssignIcon, LoadingIcon, MapPinIcon, MinimizeIcon, MaximizeIcon, ChevronLeftIcon, ChevronRightIcon, RefreshIcon, CalendarIcon, GridIcon } from './icons';
import { BOARD_KIND_PATHS } from '../context/useAppLogic';
import DayTabs from './DayTabs';
import SchedulesPanel from './SchedulesPanel';
import TodayBoard from './TodayBoard';
import RotationPage from './RotationPage';
import ReviewQueue from './ReviewQueue';
import AvailabilityPage from './AvailabilityPage';
import JobsPanel from './JobsPanel';
import RouteMapPanel from './RoutePanel';
import DebugLogModal from './DebugLog';
import DailySummaryModal from './DailySummary';
import RepSummaryModal from './RepSummary';
import PasteJobsModal from './PasteJobsModal';
import AvailabilitySummaryModal from './AvailabilitySummary';
import AiAssistantPopup from './AiAssistantPopup';
import RepSettingsModal from './RepSettingsModal';
import TrainingDataModal from './TrainingDataModal';
import NeedsDetailsModal from './NeedsDetailsModal';
import NeedsRescheduleModal from './NeedsRescheduleModal';
import UnplottedJobsModal from './UnplottedJobsModal';
import ChangeLogModal from './ChangeLogModal';
import { TAG_KEYWORDS } from '../constants';
import { Job, BackupListItem } from '../types';
import SettingsPanel from './SettingsPanel';
import AssignmentSettingsModal from './SettingsModal';
import ThemeEditorModal from './ThemeEditorModal';
import ConfirmationModal from './ConfirmationModal';
import LoadOptionsModal from './LoadOptionsModal';
import StartupModal from './StartupModal';
import { ToastContainer } from './Toast';
import { parseTimeRange, doTimesOverlap } from '../utils/timeUtils';

type ColumnId = 'schedules' | 'jobs' | 'routes';

type DropPosition = 'left' | 'right' | 'stack';
type DropTarget = {
  targetId: ColumnId;
  position: DropPosition;
} | null;

const getColumnLabel = (id: ColumnId): string => {
  const labels: Record<ColumnId, string> = {
    schedules: 'Schedules',
    jobs: 'Jobs',
    routes: 'Map',
  };
  return labels[id];
};

// Column configuration for dynamic flex-based layout (no limits - user can resize freely)
const COLUMN_CONFIG: Record<ColumnId, { minWidth: number; maxWidth: number; flexGrow: number; flexBasis: string }> = {
  schedules: { minWidth: 100, maxWidth: 9999, flexGrow: 1, flexBasis: '300px' },
  jobs: { minWidth: 100, maxWidth: 9999, flexGrow: 1, flexBasis: '280px' },
  routes: { minWidth: 100, maxWidth: 9999, flexGrow: 2, flexBasis: '400px' }, // Map is primary flex-grow
};

const TODAY_BOARD_PATH = '/today-board';
const ROTATION_PATH = '/rotation';
const AVAILABILITY_PATH = '/availability';
const REVIEW_PATH = '/review';
const REVIEW_BOOKINGS_PATH = `${REVIEW_PATH}/bookings`;
const REVIEW_OUTCOMES_PATH = `${REVIEW_PATH}/outcomes`;
const REVIEW_RESCUE_PATH = `${REVIEW_PATH}/rescue`;
// Review has a per-mode URL (/review/bookings, /review/outcomes), so match the
// prefix — a bare /review still counts and ReviewQueue normalizes it on mount.
const isReviewPath = (path: string) => path === REVIEW_PATH || path.startsWith(`${REVIEW_PATH}/`);
const isOutcomesPath = (path: string) => path.toLowerCase().startsWith(REVIEW_OUTCOMES_PATH);
const isRescuePath = (path: string) => path.toLowerCase().startsWith(REVIEW_RESCUE_PATH);

const MainLayout: React.FC = () => {
  const context = useAppContext();
  const { uiSettings, updateUiSettings } = context;

  // Column order for drag-drop reordering
  const [columnOrder, setColumnOrder] = useState<ColumnId[]>(['schedules', 'jobs', 'routes']);
  // Column widths as pixel values for flex-basis (user-adjustable)
  const [columnWidths, setColumnWidths] = useState<Record<ColumnId, number>>({ schedules: 350, jobs: 320, routes: 450 });
  // Stack heights as percentages (parent column gets remaining space)
  const [stackHeights, setStackHeights] = useState<Record<ColumnId, number>>({ schedules: 50, jobs: 50, routes: 50 });

  // Get collapsed columns and stacking from uiSettings
  const collapsedColumns = useMemo(() =>
    new Set<ColumnId>(uiSettings.collapsedColumns as ColumnId[] || []),
    [uiSettings.collapsedColumns]
  );

  const columnStack = useMemo(() =>
    (uiSettings.columnStack || {}) as Record<ColumnId, ColumnId | null>,
    [uiSettings.columnStack]
  );

  // Toggle column collapse
  const toggleCollapse = useCallback((colId: ColumnId) => {
    const currentCollapsed = uiSettings.collapsedColumns || [];
    let newCollapsed: string[];
    if (currentCollapsed.includes(colId)) {
      newCollapsed = currentCollapsed.filter(c => c !== colId);
    } else {
      newCollapsed = [...currentCollapsed, colId];
    }
    updateUiSettings({ collapsedColumns: newCollapsed });
  }, [uiSettings.collapsedColumns, updateUiSettings]);

  // Set column stack (stack colId under parentId)
  const setColumnStacking = useCallback((colId: ColumnId, parentId: ColumnId | null) => {
    const newStack = { ...(uiSettings.columnStack || {}), [colId]: parentId };
    // Remove null values for cleaner state
    Object.keys(newStack).forEach(key => {
      if (newStack[key] === null) delete newStack[key];
    });
    updateUiSettings({ columnStack: newStack });
  }, [uiSettings.columnStack, updateUiSettings]);

  // Drag and drop state for column reordering/stacking
  const [draggedColumnId, setDraggedColumnId] = useState<ColumnId | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget>(null);
  const columnRefs = useRef<Map<ColumnId, HTMLDivElement>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDailySummaryOpen, setIsDailySummaryOpen] = useState(false);
  const [isRepSummaryOpen, setIsRepSummaryOpen] = useState(false);
  const [isAvailabilitySummaryOpen, setIsAvailabilitySummaryOpen] = useState(false);
  const [isTrainingDataOpen, setIsTrainingDataOpen] = useState(false);
  const [isNeedsDetailsOpen, setIsNeedsDetailsOpen] = useState(false);
  const [isNeedsRescheduleOpen, setIsNeedsRescheduleOpen] = useState(false);
  const [isAiPopupOpen, setIsAiPopupOpen] = useState(false);
  const [isSettingsPanelOpen, setIsSettingsPanelOpen] = useState(false);
  const [isThemeEditorOpen, setIsThemeEditorOpen] = useState(false);
  const [isChangeLogOpen, setIsChangeLogOpen] = useState(false);
  const [isPasteModalOpen, setIsPasteModalOpen] = useState(false);
  const [isUnplottedModalOpen, setIsUnplottedModalOpen] = useState(false);
  const [isDebugLogOpen, setIsDebugLogOpen] = useState(false);
  const [isAssignmentSettingsOpen, setIsAssignmentSettingsOpen] = useState(false);
  const [showRotation, setShowRotation] = useState(
    () => typeof window !== 'undefined' && window.location.pathname === ROTATION_PATH
  );
  const [showAvailability, setShowAvailability] = useState(
    () => typeof window !== 'undefined' && window.location.pathname === AVAILABILITY_PATH
  );
  const [showTodayBoard, setShowTodayBoard] = useState(
    () => typeof window !== 'undefined' && window.location.pathname === TODAY_BOARD_PATH
  );
  const [showReviewQueue, setShowReviewQueue] = useState(
    () => typeof window !== 'undefined' && isReviewPath(window.location.pathname)
  );
  // Which review-family top tab is lit: Review (bookings) vs Outcomes vs Rescue.
  const [showReviewOutcomes, setShowReviewOutcomes] = useState(
    () => typeof window !== 'undefined' && isOutcomesPath(window.location.pathname)
  );
  const [showReviewRescue, setShowReviewRescue] = useState(
    () => typeof window !== 'undefined' && isRescuePath(window.location.pathname)
  );
  const showPlanner = !showTodayBoard && !showReviewQueue && !showRotation && !showAvailability;
  const [reviewNeedsCount, setReviewNeedsCount] = useState(0);
  const settingsRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Startup prompt: on a fresh page load, offer to load the most recent saved
  // schedule (in-memory state is empty on load) or start fresh.
  // PLANNER ONLY — the Today Board and Review read their own live data and have no
  // use for a saved planner schedule, so prompting there was pure noise on refresh.
  // Keyed off showPlanner rather than mount, so arriving at the planner from another
  // tab still offers the load; startupCheckedRef keeps it to once per session.
  const [showStartupModal, setShowStartupModal] = useState(false);
  const [startupBackupInfo, setStartupBackupInfo] = useState<BackupListItem | null>(null);
  const [isLoadingMostRecent, setIsLoadingMostRecent] = useState(false);
  const startupCheckedRef = useRef(false);

  useEffect(() => {
    if (!showPlanner || startupCheckedRef.current) return;
    startupCheckedRef.current = true;
    (async () => {
      const info = await context.getMostRecentBackupInfo();
      if (info) {
        setStartupBackupInfo(info);
        setShowStartupModal(true); // only prompt when there is actually something to load
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPlanner]);

  const handleStartupStartFresh = useCallback(() => setShowStartupModal(false), []);
  const handleStartupLoadMostRecent = useCallback(async () => {
    if (!startupBackupInfo) { setShowStartupModal(false); return; }
    setIsLoadingMostRecent(true);
    try {
      // Load the exact backup the modal identified (same Supabase backup table +
      // proven path the "Load from Cloud" modal uses), not the separate
      // daily-schedules table that handleLoadStateFromCloud reads.
      await context.loadSelectedBackup(startupBackupInfo.id);
    } finally {
      setIsLoadingMostRecent(false);
      setShowStartupModal(false);
    }
  }, [context, startupBackupInfo]);

  // Planner / Today Board / Review are separate tabs, each with its own URL, so
  // they're linkable and browser back/forward works. Clicking a tab goes to it —
  // it never toggles back to the planner.
  const navigateTo = useCallback((path: string) => {
    if (window.location.pathname !== path) {
      window.history.pushState({}, '', path);
      // pushState fires no popstate, but a mounted ReviewQueue reads its
      // Bookings/Outcomes mode from the URL via popstate — nudge it so
      // Review ⇄ Outcomes top-tab clicks actually switch the view.
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
    setShowTodayBoard(path === TODAY_BOARD_PATH);
    setShowRotation(path === ROTATION_PATH);
    setShowAvailability(path === AVAILABILITY_PATH);
    setShowReviewQueue(isReviewPath(path));
    setShowReviewOutcomes(isOutcomesPath(path));
    setShowReviewRescue(isRescuePath(path));
  }, []);

  useEffect(() => {
    const syncFromUrl = () => {
      setShowTodayBoard(window.location.pathname === TODAY_BOARD_PATH);
      setShowRotation(window.location.pathname === ROTATION_PATH);
      setShowAvailability(window.location.pathname === AVAILABILITY_PATH);
      setShowReviewQueue(isReviewPath(window.location.pathname));
      setShowReviewOutcomes(isOutcomesPath(window.location.pathname));
      setShowReviewRescue(isRescuePath(window.location.pathname));
    };
    window.addEventListener('popstate', syncFromUrl);
    return () => window.removeEventListener('popstate', syncFromUrl);
  }, []);

  useEffect(() => {
    if (context.isAiAssigning || context.aiThoughts.length > 0) {
      setIsAiPopupOpen(true);
    }
  }, [context.isAiAssigning, context.aiThoughts.length]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (showReviewQueue) return; // Review tab has its own undo/redo (Ctrl+Z/Y)
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const isUndo = (isMac ? e.metaKey : e.ctrlKey) && !e.shiftKey && e.key === 'z';
      const isRedo = (isMac ? e.metaKey && e.shiftKey : e.ctrlKey) && e.key === 'y' || (isMac && e.metaKey && e.shiftKey && e.key === 'z');

      if (isUndo) {
        e.preventDefault();
        context.handleUndo();
      } else if (isRedo) {
        e.preventDefault();
        context.handleRedo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [context]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(event.target as Node)) {
        setIsSettingsPanelOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);


  const handleCloseAiPopup = () => {
    setIsAiPopupOpen(false);
    if (!context.isAiAssigning) {
      context.clearAiThoughts();
    }
  };

  // Column drag handlers
  const handleColumnDragStart = useCallback((e: React.DragEvent, id: ColumnId) => {
    setDraggedColumnId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
    // Add a slight delay to prevent immediate visual glitch
    requestAnimationFrame(() => {
      const el = columnRefs.current.get(id);
      if (el) el.style.opacity = '0.5';
    });
  }, []);

  const handleColumnDragOver = useCallback((e: React.DragEvent, targetId: ColumnId) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    if (!draggedColumnId || draggedColumnId === targetId) {
      setDropTarget(null);
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const width = rect.width;
    const relativeX = x / width;

    // Determine drop position based on mouse position
    // Left 25% = insert before, Right 25% = insert after, Middle 50% = stack
    let position: DropPosition;
    if (relativeX < 0.25) {
      position = 'left';
    } else if (relativeX > 0.75) {
      position = 'right';
    } else {
      position = 'stack';
    }

    setDropTarget({ targetId, position });
  }, [draggedColumnId]);

  const handleColumnDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear if leaving the container entirely
    const relatedTarget = e.relatedTarget as Node | null;
    if (!e.currentTarget.contains(relatedTarget)) {
      setDropTarget(null);
    }
  }, []);

  const handleColumnDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();

    if (!draggedColumnId || !dropTarget) {
      setDraggedColumnId(null);
      setDropTarget(null);
      return;
    }

    const { targetId, position } = dropTarget;

    if (position === 'stack') {
      // Stack the dragged column under the target
      setColumnStacking(draggedColumnId, targetId);
    } else {
      // Reorder columns
      const newOrder = [...columnOrder];
      const draggedIndex = newOrder.indexOf(draggedColumnId);
      const targetIndex = newOrder.indexOf(targetId);

      if (draggedIndex > -1) {
        // Remove from current position
        newOrder.splice(draggedIndex, 1);

        // Calculate new index
        let insertIndex = newOrder.indexOf(targetId);
        if (insertIndex === -1) insertIndex = 0;

        if (position === 'right') {
          insertIndex += 1;
        }

        newOrder.splice(insertIndex, 0, draggedColumnId);
        setColumnOrder(newOrder);

        // If the column was previously stacked, unstack it
        if (columnStack[draggedColumnId]) {
          setColumnStacking(draggedColumnId, null);
        }
      }
    }

    setDraggedColumnId(null);
    setDropTarget(null);
  }, [draggedColumnId, dropTarget, columnOrder, columnStack, setColumnStacking]);

  const handleColumnDragEnd = useCallback(() => {
    // Reset opacity on all columns
    columnRefs.current.forEach((el) => {
      if (el) el.style.opacity = '1';
    });
    setDraggedColumnId(null);
    setDropTarget(null);
  }, []);

  // Horizontal resize handler for columns (pixel-based)
  const handleResizeStart = useCallback((e: React.MouseEvent, leftColId: ColumnId, rightColId: ColumnId) => {
    e.preventDefault();
    const startX = e.clientX;
    const initialLeftWidth = columnWidths[leftColId];
    const initialRightWidth = columnWidths[rightColId];

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startX;
      let newLeftWidth = initialLeftWidth + dx;
      let newRightWidth = initialRightWidth - dx;

      // Apply min/max constraints
      const leftConfig = COLUMN_CONFIG[leftColId];
      const rightConfig = COLUMN_CONFIG[rightColId];

      if (newLeftWidth < leftConfig.minWidth) {
        newRightWidth += newLeftWidth - leftConfig.minWidth;
        newLeftWidth = leftConfig.minWidth;
      }
      if (newRightWidth < rightConfig.minWidth) {
        newLeftWidth += newRightWidth - rightConfig.minWidth;
        newRightWidth = rightConfig.minWidth;
      }
      if (newLeftWidth > leftConfig.maxWidth) {
        newRightWidth += newLeftWidth - leftConfig.maxWidth;
        newLeftWidth = leftConfig.maxWidth;
      }
      if (newRightWidth > rightConfig.maxWidth) {
        newLeftWidth += newRightWidth - rightConfig.maxWidth;
        newRightWidth = rightConfig.maxWidth;
      }

      setColumnWidths(prev => ({ ...prev, [leftColId]: newLeftWidth, [rightColId]: newRightWidth }));
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
  }, [columnWidths]);

  // Vertical resize handler for stacked columns
  const handleStackResizeStart = useCallback((e: React.MouseEvent, parentId: ColumnId, stackedId: ColumnId) => {
    e.preventDefault();
    const startY = e.clientY;
    const parentElement = columnRefs.current.get(parentId);
    if (!parentElement) return;
    const containerHeight = parentElement.getBoundingClientRect().height;
    const initialStackHeight = stackHeights[stackedId];

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const dy = moveEvent.clientY - startY;
      if (!containerHeight) return;
      // Moving down = more space for parent (less for stacked), moving up = less for parent
      const dyPercent = (dy / containerHeight) * 100;
      let newStackHeight = initialStackHeight - dyPercent;
      // Clamp between 15% and 85%
      newStackHeight = Math.max(15, Math.min(85, newStackHeight));
      setStackHeights(prev => ({ ...prev, [stackedId]: newStackHeight }));
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'row-resize';
  }, [stackHeights]);

  const handleLoadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result;
        if (typeof text !== 'string') {
          throw new Error("File content is not readable text.");
        }
        const loadedState = JSON.parse(text);
        context.handleLoadStateFromFile(loadedState);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Failed to read or parse file.";
        context.log(`- ERROR (File Read): ${errorMessage}`);
        alert(`Error reading file: ${errorMessage}`);
      }
    };
    reader.onerror = () => {
      context.log(`- ERROR (File Read): FileReader error.`);
      alert("An error occurred while reading the file.");
    };
    reader.readAsText(file);

    event.target.value = '';
  };

  // Logic to count jobs needing details for badge
  const needsDetailsCount = useMemo(() => {
    const countTags = (job: Job) => {
      const notes = (job.notes || '').toLowerCase();
      let count = 0;
      TAG_KEYWORDS.forEach(tag => {
        if (new RegExp(`\\b${tag.toLowerCase()}\\b`).test(notes)) count++;
      });
      if (/\b\d+\s*sq/i.test(notes)) count++;
      if (/\b\d+\s*yrs\b/i.test(notes)) count++;
      if (/\b\d+S\b/i.test(notes)) count++;
      return count;
    };
    return context.appState.unassignedJobs.filter(job => countTags(job) <= 1).length;
  }, [context.appState.unassignedJobs]);

  const jobsNeedingRescheduleCount = useMemo(() => {
    let count = 0;
    const seenJobIds = new Set<string>();

    context.appState.reps.forEach(rep => {
      rep.schedule.forEach(slot => {
        slot.jobs.forEach(job => {
          // For optimized jobs, `job.timeSlotLabel` has the new time. For manual, `slot.label` is the time.
          const scheduledTimeLabel = job.timeSlotLabel || slot.label;

          if (job.originalTimeframe && scheduledTimeLabel) {
            const overlaps = doTimesOverlap(job.originalTimeframe, scheduledTimeLabel);
            if (!overlaps && !seenJobIds.has(job.id)) {
              count++;
              seenJobIds.add(job.id);
            }
          }
        });
      });
    });
    return count;
  }, [context.appState.reps]);

  const unplottedJobsCount = context.activeRoute?.unmappableJobs?.length ?? 0;

  // Get columns that are stacked under a parent (not shown as primary columns)
  const stackedColumns = useMemo(() =>
    new Set(Object.keys(columnStack).filter(id => columnStack[id as ColumnId])),
    [columnStack]
  );

  // Get columns stacked under a specific parent
  const getStackedUnder = useCallback((parentId: ColumnId): ColumnId[] => {
    return columnOrder.filter(id => columnStack[id] === parentId);
  }, [columnOrder, columnStack]);

  const visibleColumnOrder = useMemo(() => {
    const filtered = columnOrder.filter(id => {
      // Hide jobs column if setting is off
      if (id === 'jobs' && !context.uiSettings.showUnassignedJobsColumn) return false;
      // Hide stacked columns from primary display
      if (stackedColumns.has(id)) return false;
      return true;
    });
    return filtered;
  }, [columnOrder, context.uiSettings.showUnassignedJobsColumn, stackedColumns]);

  // Check if layout is broken (no visible non-collapsed columns)
  const isLayoutBroken = useMemo(() => {
    const visibleNonCollapsed = visibleColumnOrder.filter(id => !collapsedColumns.has(id));
    return visibleNonCollapsed.length === 0;
  }, [visibleColumnOrder, collapsedColumns]);

  // Reset column layout to defaults
  const handleResetLayout = useCallback(() => {
    updateUiSettings({
      collapsedColumns: [],
      columnStack: {}
    });
  }, [updateUiSettings]);

  // Render column header with controls
  const renderColumnHeader = (id: ColumnId, title: string, showControls: boolean = true) => {
    return (
      <div
        className="flex justify-between items-center mb-2 border-b pb-1 gap-2 cursor-move select-none"
        draggable
        onDragStart={(e) => handleColumnDragStart(e, id)}
        onDragEnd={handleColumnDragEnd}
      >
        <div className="flex items-center gap-2">
          <DragHandleIcon className="h-4 w-4 text-text-quaternary" />
          <h2 className="text-lg font-semibold truncate">{title}</h2>
        </div>
        <div className="flex items-center gap-1">
          {/* Collapse button */}
          {showControls && (
            <button
              onClick={(e) => { e.stopPropagation(); toggleCollapse(id); }}
              onMouseDown={(e) => e.stopPropagation()}
              className="p-1 rounded hover:bg-bg-tertiary text-text-quaternary hover:text-text-secondary transition"
              title="Collapse column"
            >
              <MinimizeIcon className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderPanelContent = (id: ColumnId, isStacked: boolean = false) => {
    switch (id) {
      case 'schedules':
        return (
          <>
            {!isStacked && renderColumnHeader('schedules', 'Schedules')}
            <div className={isStacked ? "flex-1 min-h-0" : "flex-grow min-h-0"}>
              <SchedulesPanel />
            </div>
          </>
        );
      case 'jobs':
        return (
          <>
            {!isStacked && renderColumnHeader('jobs', 'Jobs')}
            <div className={isStacked ? "flex flex-col flex-1 min-h-0" : "flex flex-col flex-grow min-h-0"}>
              <JobsPanel />
            </div>
          </>
        );
      case 'routes':
        return (
          <>
            {!isStacked && renderColumnHeader('routes', getColumnLabel('routes'))}
            <div className={isStacked ? "flex-1 min-h-0" : "flex-grow min-h-0"}>
              <RouteMapPanel routeData={context.activeRoute} isLoading={context.isRouting} />
            </div>
          </>
        );
      default:
        return null;
    }
  };

  // Render a collapsed column bar
  const renderCollapsedColumn = (id: ColumnId) => (
    <div
      key={id}
      className="flex-shrink-0 w-8 rounded-md border border-border-secondary bg-bg-primary py-2 shadow-sm flex flex-col items-center gap-2"
    >
      <button
        onClick={() => toggleCollapse(id)}
        className="p-1 hover:bg-bg-tertiary rounded transition"
        title={`Expand ${getColumnLabel(id)}`}
      >
        <ChevronRightIcon className="h-4 w-4 text-text-secondary" />
      </button>
      <div className="flex-1 flex items-center justify-center">
        <span
          className="text-xs font-semibold text-text-secondary transform -rotate-90 whitespace-nowrap origin-center"
          style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
        >
          {getColumnLabel(id)}
        </span>
      </div>
    </div>
  );

  // Render stacked column within parent
  const renderStackedColumn = (id: ColumnId, parentId: ColumnId) => {
    const stackHeight = stackHeights[id];

    if (collapsedColumns.has(id)) {
      return (
        <React.Fragment key={id}>
          {/* Collapsed stacked panel */}
          <div className="mt-3 flex h-10 flex-shrink-0 items-center gap-2 rounded-md border border-border-secondary bg-bg-primary px-3 shadow-sm">
            <button
              onClick={() => toggleCollapse(id)}
              className="p-1 hover:bg-bg-tertiary rounded transition"
              title={`Expand ${getColumnLabel(id)}`}
            >
              <ChevronRightIcon className="h-3.5 w-3.5 text-text-secondary" />
            </button>
            <span className="text-sm font-semibold text-text-secondary">{getColumnLabel(id)}</span>
            <button
              onClick={() => setColumnStacking(id, null)}
              className="ml-auto p-1 hover:bg-bg-tertiary rounded text-text-tertiary hover:text-text-secondary transition"
              title="Unstack"
            >
              <MaximizeIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        </React.Fragment>
      );
    }

    return (
      <React.Fragment key={id}>
        {/* Resize handle between stacked panels */}
        <div
          className="h-3 flex items-center justify-center cursor-row-resize group flex-shrink-0"
          onMouseDown={e => handleStackResizeStart(e, parentId, id)}
        >
          <div className="w-12 h-1 bg-border-secondary/50 group-hover:bg-brand-primary rounded-full transition-colors" />
        </div>

        {/* Stacked panel - dashboard widget style */}
        <div
          className="flex flex-col min-h-0 overflow-hidden rounded-md border border-border-secondary bg-bg-primary shadow-sm"
          style={{ flex: `0 0 ${stackHeight}%` }}
        >
          {/* Widget header */}
          <div className="flex flex-shrink-0 items-center justify-between border-b border-border-secondary bg-bg-primary px-4 py-2.5">
            <div className="flex items-center gap-2">
              <DragHandleIcon className="h-4 w-4 text-text-quaternary cursor-grab" />
              <span className="text-sm font-semibold text-text-primary">{getColumnLabel(id)}</span>
            </div>
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => toggleCollapse(id)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-quaternary transition-colors duration-150 hover:bg-bg-tertiary hover:text-text-secondary"
                title="Collapse"
              >
                <MinimizeIcon className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setColumnStacking(id, null)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-quaternary transition-colors duration-150 hover:bg-bg-tertiary hover:text-text-secondary"
                title="Unstack - restore as separate column"
              >
                <MaximizeIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          {/* Widget content */}
          <div className="flex-1 min-h-0 overflow-auto p-3">
            {renderPanelContent(id, true)}
          </div>
        </div>
      </React.Fragment>
    );
  };

  // Rendered in the compact top bar, which is identical on every view.
  const navTabs = (
    <div className="flex items-center gap-1">
      <button
        onClick={() => navigateTo(BOARD_KIND_PATHS[context.boardKind])}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold rounded-md transition ${showPlanner
          ? 'bg-brand-primary text-brand-text-on-primary'
          : 'bg-bg-secondary/50 text-text-tertiary hover:bg-bg-tertiary hover:text-brand-primary'
          }`}
        title="Scheduling planner"
      >
        <GridIcon className="h-3.5 w-3.5" />
        <span>Planner</span>
      </button>

      <button
        onClick={() => navigateTo(TODAY_BOARD_PATH)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold rounded-md transition ${showTodayBoard
          ? 'bg-brand-primary text-brand-text-on-primary'
          : 'bg-bg-secondary/50 text-text-tertiary hover:bg-bg-tertiary hover:text-brand-primary'
          }`}
        title="Today's Appointments board"
      >
        <CalendarIcon className="h-3.5 w-3.5" />
        <span>Today Board</span>
      </button>

      <button
        onClick={() => navigateTo(ROTATION_PATH)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold rounded-md transition ${showRotation
          ? 'bg-brand-primary text-brand-text-on-primary'
          : 'bg-bg-secondary/50 text-text-tertiary hover:bg-bg-tertiary hover:text-brand-primary'
          }`}
        title="Travel rotation — whose turn it is for the Limited corridor, Tucson and up north"
      >
        <span>Rotation</span>
      </button>

      <button
        onClick={() => navigateTo(AVAILABILITY_PATH)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold rounded-md transition ${showAvailability
          ? 'bg-brand-primary text-brand-text-on-primary'
          : 'bg-bg-secondary/50 text-text-tertiary hover:bg-bg-tertiary hover:text-brand-primary'
          }`}
        title="Live rep availability and capacity"
      >
        <span>Availability</span>
      </button>

      <button
        onClick={() => navigateTo(REVIEW_BOOKINGS_PATH)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold rounded-md transition ${showReviewQueue && !showReviewOutcomes && !showReviewRescue
          ? 'bg-brand-primary text-brand-text-on-primary'
          : 'bg-bg-secondary/50 text-text-tertiary hover:bg-bg-tertiary hover:text-brand-primary'
          }`}
        title="Booking review queue"
      >
        <span>Review</span>
        {!showReviewOutcomes && !showReviewRescue && reviewNeedsCount > 0 && <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold ${showReviewQueue ? 'bg-bg-primary text-brand-primary' : 'bg-tag-red-bg text-tag-red-text'}`}>{reviewNeedsCount}</span>}
      </button>

      <button
        onClick={() => navigateTo(REVIEW_OUTCOMES_PATH)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold rounded-md transition ${showReviewOutcomes
          ? 'bg-brand-primary text-brand-text-on-primary'
          : 'bg-bg-secondary/50 text-text-tertiary hover:bg-bg-tertiary hover:text-brand-primary'
          }`}
        title="Appointment outcomes QA — appointments that never reached Proposal signed"
      >
        <span>Outcomes</span>
        {showReviewOutcomes && reviewNeedsCount > 0 && <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-bg-primary text-brand-primary">{reviewNeedsCount}</span>}
      </button>

      <button
        onClick={() => navigateTo(REVIEW_RESCUE_PATH)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold rounded-md transition ${showReviewRescue
          ? 'bg-brand-primary text-brand-text-on-primary'
          : 'bg-bg-secondary/50 text-text-tertiary hover:bg-bg-tertiary hover:text-brand-primary'
          }`}
        title="Stuck-deal work queue — signed jobs needing deposits, colors, or a rep chase before production"
      >
        <span>Rescue</span>
        {showReviewRescue && reviewNeedsCount > 0 && <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-bg-primary text-brand-primary">{reviewNeedsCount}</span>}
      </button>
    </div>
  );

  const settingsControl = (
    <div ref={settingsRef} className="relative">
      <button onClick={() => setIsSettingsPanelOpen(prev => !prev)} className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border-secondary bg-bg-primary text-text-quaternary transition-colors duration-150 hover:border-brand-primary hover:bg-bg-tertiary hover:text-brand-primary" title="Settings">
        <SettingsIcon className="h-3.5 w-3.5 text-text-quaternary hover:text-brand-primary" />
      </button>
      {isSettingsPanelOpen && (
        <SettingsPanel
          onOpenThemeEditor={() => { setIsThemeEditorOpen(true); setIsSettingsPanelOpen(false); }}
          onOpenTrainingData={() => { setIsTrainingDataOpen(true); setIsSettingsPanelOpen(false); }}
          onOpenDebugLog={() => { setIsDebugLogOpen(true); setIsSettingsPanelOpen(false); }}
          onOpenAssignmentSettings={() => { setIsAssignmentSettingsOpen(true); setIsSettingsPanelOpen(false); }}
        />
      )}
    </div>
  );

  return (
    <div className="h-screen flex flex-col bg-bg-secondary text-text-primary font-sans overflow-hidden">
      {/* Two-Level Header */}
      <header className="bg-bg-primary border-b border-border-primary flex-shrink-0 z-30 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
        {/* Compact top bar — identical on every view: brand, tabs, settings. */}
        <div className="h-12 px-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-sm font-bold text-text-primary tracking-tight">Rep Route Planner</h1>
            {navTabs}
          </div>
          {settingsControl}
        </div>

        {showPlanner && (
        /* Planner-only utility bar: paste/load/auto-assign, history, alerts,
           reports, file/cloud state, day tabs. flex-wrap so narrow windows
           wrap instead of overflowing. */
        <div className="min-h-10 px-4 py-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border-secondary/50 bg-bg-secondary/30">
          {/* Left: Paste/Load/Auto Assign + History */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setIsPasteModalOpen(true)}
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border-secondary bg-bg-primary px-2.5 text-[11px] font-semibold text-text-secondary transition-colors duration-150 hover:border-brand-primary hover:bg-bg-tertiary hover:text-brand-primary"
                title="Paste Jobs"
              >
                <PasteIcon className="h-3.5 w-3.5" />
                <span>Paste</span>
              </button>

              <button
                onClick={context.handleLoadFromSheet}
                disabled={context.isLoadingFromSheet || context.isLoadingReps}
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border-secondary bg-bg-primary px-2.5 text-[11px] font-semibold text-text-secondary transition-colors duration-150 hover:border-brand-primary hover:bg-bg-tertiary hover:text-brand-primary disabled:cursor-not-allowed disabled:opacity-50"
                title="Load sales appointments from Calendar Events sheet"
              >
                {context.isLoadingFromSheet ? <LoadingIcon /> : <CloudDownloadIcon className="h-3.5 w-3.5" />}
                <span>{context.isLoadingFromSheet ? 'Loading...' : 'Load'}</span>
              </button>

              {context.boardKind !== 'insurance' && <button
                onClick={context.handleAutoAssign}
                disabled={context.isLoadingReps || context.isAutoAssigning || context.isParsing || context.appState.unassignedJobs.length === 0}
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-brand-primary bg-brand-primary px-2.5 text-[11px] font-semibold text-brand-text-on-primary transition-colors duration-150 hover:bg-brand-secondary disabled:cursor-not-allowed disabled:border-border-secondary disabled:bg-bg-quaternary disabled:text-text-tertiary"
                title={context.isLoadingReps ? "Waiting for rep data..." : context.appState.unassignedJobs.length === 0 ? "No unassigned jobs" : "Auto Assign Jobs"}
              >
                {context.isAutoAssigning ? <LoadingIcon /> : <AutoAssignIcon className="h-3.5 w-3.5" />}
                <span>{context.isAutoAssigning ? 'Assigning...' : 'Auto Assign'}</span>
              </button>}
            </div>

            <div className="flex items-center gap-0.5 rounded-md border border-border-secondary bg-bg-secondary p-0.5">
              <button onClick={context.handleUndo} disabled={!context.canUndo} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-tertiary transition-colors duration-150 hover:bg-bg-primary hover:text-text-primary disabled:opacity-30" title="Undo (Ctrl+Z)">
                <UndoIcon className="h-3.5 w-3.5" />
              </button>
              <button onClick={context.handleRedo} disabled={!context.canRedo} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-tertiary transition-colors duration-150 hover:bg-bg-primary hover:text-text-primary disabled:opacity-30" title="Redo (Ctrl+Y)">
                <RedoIcon className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={context.handleRefreshAvailability}
                disabled={context.isLoadingReps}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-tertiary transition-colors duration-150 hover:bg-bg-primary hover:text-brand-primary disabled:opacity-30"
                title="Resync availability from Google Sheet"
              >
                {context.isLoadingReps ? <LoadingIcon /> : <RefreshIcon className="h-3.5 w-3.5" />}
              </button>
            </div>

            <button
              onClick={() => setIsChangeLogOpen(true)}
              className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[11px] font-semibold transition-colors duration-150 ${context.changeLog.length > 0
                ? 'border-brand-primary bg-brand-bg-light text-brand-text-light hover:bg-brand-primary/20'
                : 'border-border-secondary bg-bg-primary text-text-tertiary hover:bg-bg-tertiary'
                }`}
              title="View Change Log"
            >
              <HistoryIcon className="h-3.5 w-3.5" />
              <span>Changes</span>
              {context.changeLog.length > 0 && (
                <span className="rounded-full bg-brand-primary px-1.5 py-0.5 text-[9px] font-bold tabular-nums text-brand-text-on-primary">
                  {context.changeLog.length}
                </span>
              )}
            </button>
          </div>

          {/* Center: Reports & Alerts */}
          <div className="flex items-center gap-3">
            {/* Alerts */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => setIsNeedsRescheduleOpen(true)}
                className={`relative inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[10px] font-bold uppercase tracking-wider transition-colors duration-150 ${jobsNeedingRescheduleCount > 0
                  ? 'border-tag-blue-border bg-tag-blue-bg text-tag-blue-text hover:bg-tag-blue-bg/80'
                  : 'border-border-secondary bg-bg-primary text-text-quaternary hover:bg-bg-tertiary hover:text-text-secondary'
                  }`}
                title="Review jobs with potential scheduling conflicts"
              >
                <RescheduleIcon className="h-3 w-3" />
                <span>Reschedule</span>
                {jobsNeedingRescheduleCount > 0 && (
                  <span className="ml-0.5 rounded-full bg-tag-blue-text px-1 text-[9px] font-bold tabular-nums text-bg-primary">
                    {jobsNeedingRescheduleCount}
                  </span>
                )}
              </button>

              <button
                onClick={() => setIsNeedsDetailsOpen(true)}
                className={`relative inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[10px] font-bold uppercase tracking-wider transition-colors duration-150 ${needsDetailsCount > 0
                  ? 'border-tag-amber-border bg-tag-amber-bg text-tag-amber-text hover:bg-tag-amber-bg/80'
                  : 'border-border-secondary bg-bg-primary text-text-quaternary hover:bg-bg-tertiary hover:text-text-secondary'
                  }`}
                title="Review jobs missing essential details"
              >
                <RepairIcon className="h-3 w-3" />
                <span>Details</span>
                {needsDetailsCount > 0 && (
                  <span className="ml-0.5 rounded-full bg-tag-amber-text px-1 text-[9px] font-bold tabular-nums text-bg-primary">
                    {needsDetailsCount}
                  </span>
                )}
              </button>

              <button
                onClick={() => setIsUnplottedModalOpen(true)}
                className={`relative inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[10px] font-bold uppercase tracking-wider transition-colors duration-150 ${unplottedJobsCount > 0
                  ? 'border-tag-red-border bg-tag-red-bg text-tag-red-text hover:bg-tag-red-bg/80'
                  : 'border-border-secondary bg-bg-primary text-text-quaternary hover:bg-bg-tertiary hover:text-text-secondary'
                  }`}
                title="Review jobs that could not be plotted on the map"
              >
                <MapPinIcon className="h-3 w-3" />
                <span>Unplotted</span>
                {unplottedJobsCount > 0 && (
                  <span className="ml-0.5 rounded-full bg-tag-red-text px-1 text-[9px] font-bold tabular-nums text-bg-primary">
                    {unplottedJobsCount}
                  </span>
                )}
              </button>
            </div>

            <div className="w-px h-4 bg-border-secondary"></div>

            {/* Reports */}
            <div className="flex items-center gap-0.5">
              <button onClick={() => setIsDailySummaryOpen(true)} className="inline-flex h-7 items-center gap-1 rounded-md border border-border-secondary bg-bg-primary px-2 text-[10px] font-bold uppercase tracking-wider text-text-tertiary transition-colors duration-150 hover:border-brand-primary hover:bg-bg-tertiary hover:text-brand-primary">
                <SummaryIcon className="h-3 w-3" />
                <span>Daily</span>
              </button>
              <button onClick={() => setIsRepSummaryOpen(true)} className="inline-flex h-7 items-center gap-1 rounded-md border border-border-secondary bg-bg-primary px-2 text-[10px] font-bold uppercase tracking-wider text-text-tertiary transition-colors duration-150 hover:border-brand-primary hover:bg-bg-tertiary hover:text-brand-primary">
                <UserIcon className="h-3 w-3" />
                <span>Reps</span>
              </button>
              <button onClick={() => setIsAvailabilitySummaryOpen(true)} className="inline-flex h-7 items-center gap-1 rounded-md border border-border-secondary bg-bg-primary px-2 text-[10px] font-bold uppercase tracking-wider text-text-tertiary transition-colors duration-150 hover:border-brand-primary hover:bg-bg-tertiary hover:text-brand-primary">
                <TagIcon className="h-3 w-3" />
                <span>Slots</span>
              </button>
            </div>
          </div>

          {/* Right: Data Controls & Date Navigation */}
          <div className="flex items-center gap-1">
            <button onClick={context.handleSaveStateToFile} className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border-secondary bg-bg-primary text-text-quaternary transition-colors duration-150 hover:border-brand-primary hover:bg-bg-tertiary hover:text-brand-primary" title="Save to File">
              <SaveIcon className="h-3.5 w-3.5 text-text-quaternary hover:text-brand-primary" />
            </button>
            <button onClick={handleLoadClick} className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border-secondary bg-bg-primary text-text-quaternary transition-colors duration-150 hover:border-brand-primary hover:bg-bg-tertiary hover:text-brand-primary" title="Load from File">
              <UploadIcon className="h-3.5 w-3.5 text-text-quaternary hover:text-brand-primary" />
            </button>
            <button onClick={() => context.handleSaveStateToCloud()} className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border-secondary bg-bg-primary text-text-quaternary transition-colors duration-150 hover:border-brand-primary hover:bg-bg-tertiary hover:text-brand-primary" title="Save to Cloud">
              <CloudUploadIcon className="h-3.5 w-3.5 text-text-quaternary hover:text-brand-primary" />
            </button>
            <button onClick={() => context.showLoadOptionsModal()} className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border-secondary bg-bg-primary text-text-quaternary transition-colors duration-150 hover:border-brand-primary hover:bg-bg-tertiary hover:text-brand-primary" title="Load from Cloud">
              <CloudDownloadIcon className="h-3.5 w-3.5 text-text-quaternary hover:text-brand-primary" />
            </button>
            {/* Auto-save indicator */}
            {context.isAutoSaving ? (
              <span className="text-xs text-yellow-500 ml-1 animate-pulse" title="Auto-saving...">saving...</span>
            ) : context.lastAutoSaveTime ? (
              <span className="text-xs text-text-quaternary ml-1" title={`Last auto-save: ${context.lastAutoSaveTime.toLocaleTimeString()}`}>
                auto-saved
              </span>
            ) : null}
            <div className="w-px h-4 bg-border-secondary mx-1"></div>
            <DayTabs />
          </div>
        </div>
        )}
        <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".json" className="hidden" />
      </header>

      {showReviewQueue ? (
        <div className="flex-grow min-h-0 p-4 overflow-hidden">
          <ReviewQueue onCountChange={setReviewNeedsCount} />
        </div>
      ) : showRotation ? (
        <div className="flex-grow min-h-0 p-4 overflow-hidden">
          <RotationPage />
        </div>
      ) : showAvailability ? (
        <div className="flex-grow min-h-0 overflow-hidden">
          <AvailabilityPage />
        </div>
      ) : showTodayBoard ? (
        <div className="flex-grow min-h-0 p-4 overflow-hidden">
          <TodayBoard />
        </div>
      ) : (
      <div ref={containerRef} className="flex w-full flex-grow min-h-0 relative z-10 p-4 gap-4 overflow-hidden">
        {/* Recovery UI when all columns are hidden */}
        {isLayoutBroken && (
          <div className="flex-1 flex items-center justify-center">
            <div className="bg-bg-primary border border-border-primary rounded-lg shadow-lg p-6 text-center max-w-md">
              <h3 className="text-lg font-semibold text-text-primary mb-2">Layout Reset Required</h3>
              <p className="text-sm text-text-secondary mb-4">
                All columns are currently hidden or stacked in a way that makes them invisible.
              </p>
              <button
                onClick={handleResetLayout}
                className="px-4 py-2 bg-brand-primary text-brand-text-on-primary rounded-md font-semibold hover:bg-brand-secondary transition"
              >
                Reset Column Layout
              </button>
            </div>
          </div>
        )}

        {/* Render collapsed columns first as thin bars */}
        {!isLayoutBroken && columnOrder.filter(id => collapsedColumns.has(id) && !stackedColumns.has(id)).map(id =>
          renderCollapsedColumn(id)
        )}

        {/* Render visible (non-collapsed, non-stacked) columns */}
        {!isLayoutBroken && visibleColumnOrder.filter(id => !collapsedColumns.has(id)).map((id, idx, arr) => {
          const stackedUnder = getStackedUnder(id);
          const isDropTarget = dropTarget?.targetId === id;
          const showLeftIndicator = isDropTarget && dropTarget.position === 'left';
          const showRightIndicator = isDropTarget && dropTarget.position === 'right';
          const showStackIndicator = isDropTarget && dropTarget.position === 'stack';
          const nextColId = idx < arr.length - 1 ? arr[idx + 1] : null;

          return (
            <React.Fragment key={id}>
              {/* Left drop indicator */}
              {showLeftIndicator && (
                <div className="w-1 bg-brand-primary rounded-full flex-shrink-0 animate-pulse" />
              )}

              <div
                ref={(el) => { if (el) columnRefs.current.set(id, el); }}
                data-col-id={id}
                className={`
                  relative flex flex-col min-w-0 h-full overflow-hidden
                  transition-all duration-300 ease-in-out
                  ${stackedUnder.length > 0
                    ? 'bg-bg-secondary/50 p-2 rounded-xl gap-0'
                    : 'rounded-md border border-border-secondary bg-bg-primary p-4 shadow-sm'
                  }
                  ${showStackIndicator
                    ? 'border-brand-primary border-2 ring-4 ring-brand-primary/20'
                    : ''
                  }
                  ${draggedColumnId === id ? 'opacity-50' : ''}
                `}
                style={{
                  flex: `${COLUMN_CONFIG[id].flexGrow} 1 ${columnWidths[id]}px`,
                  minWidth: COLUMN_CONFIG[id].minWidth,
                  maxWidth: COLUMN_CONFIG[id].maxWidth,
                }}
                onDragOver={(e) => handleColumnDragOver(e, id)}
                onDragLeave={handleColumnDragLeave}
                onDrop={handleColumnDrop}
              >
                {/* Stack indicator overlay */}
                {showStackIndicator && (
                  <div className="absolute inset-0 bg-brand-primary/10 rounded-lg pointer-events-none z-10 flex items-center justify-center">
                    <div className="bg-brand-primary text-brand-text-on-primary px-3 py-1.5 rounded-md text-sm font-semibold shadow-lg">
                      Stack below {getColumnLabel(id)}
                    </div>
                  </div>
                )}

                {/* Parent column content - sized based on whether there are stacked children */}
                {stackedUnder.length > 0 ? (
                  <div
                    className="flex flex-col min-h-0 overflow-hidden rounded-md border border-border-secondary bg-bg-primary shadow-sm"
                    style={{ flex: `1 1 ${100 - stackedUnder.reduce((sum, sid) => sum + (collapsedColumns.has(sid) ? 0 : stackHeights[sid]), 0)}%` }}
                  >
                    {/* Widget header for parent when stacked */}
                    <div className="flex flex-shrink-0 items-center justify-between rounded-t-md border-b border-border-secondary bg-bg-primary px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <DragHandleIcon className="h-4 w-4 text-text-quaternary cursor-grab" />
                        <span className="text-sm font-semibold text-text-primary">{getColumnLabel(id)}</span>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleCollapse(id); }}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-quaternary transition-colors duration-150 hover:bg-bg-tertiary hover:text-text-secondary"
                        title="Collapse column"
                      >
                        <MinimizeIcon className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {/* Widget content */}
                    <div className="flex-1 min-h-0 overflow-auto p-3">
                      {renderPanelContent(id, true)}
                    </div>
                  </div>
                ) : (
                  renderPanelContent(id)
                )}

                {/* Render stacked columns under this one */}
                {stackedUnder.map(stackedId => renderStackedColumn(stackedId, id))}
              </div>

              {/* Right drop indicator */}
              {showRightIndicator && (
                <div className="w-1 bg-brand-primary rounded-full flex-shrink-0 animate-pulse" />
              )}

              {/* Resize bar between columns */}
              {nextColId && !showRightIndicator && (
                <div
                  className="w-4 flex items-center justify-center cursor-col-resize group flex-shrink-0"
                  onMouseDown={e => handleResizeStart(e, id, nextColId)}
                >
                  <div className="w-1 h-16 bg-border-secondary group-hover:bg-brand-primary rounded-full transition-colors" />
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
      )}

      <DailySummaryModal isOpen={isDailySummaryOpen} onClose={() => setIsDailySummaryOpen(false)} />
      <RepSummaryModal isOpen={isRepSummaryOpen} onClose={() => setIsRepSummaryOpen(false)} />
      <AvailabilitySummaryModal isOpen={isAvailabilitySummaryOpen} onClose={() => setIsAvailabilitySummaryOpen(false)} />
      <TrainingDataModal isOpen={isTrainingDataOpen} onClose={() => setIsTrainingDataOpen(false)} />
      <NeedsDetailsModal isOpen={isNeedsDetailsOpen} onClose={() => setIsNeedsDetailsOpen(false)} />
      <NeedsRescheduleModal isOpen={isNeedsRescheduleOpen} onClose={() => setIsNeedsRescheduleOpen(false)} />
      <UnplottedJobsModal isOpen={isUnplottedModalOpen} onClose={() => setIsUnplottedModalOpen(false)} />
      <PasteJobsModal
        isOpen={isPasteModalOpen}
        onClose={() => setIsPasteModalOpen(false)}
        onParse={context.handleParseJobs}
        isParsing={context.isParsing}
      />
      <ChangeLogModal isOpen={isChangeLogOpen} onClose={() => setIsChangeLogOpen(false)} changes={context.changeLog} />

      <DebugLogModal
        isOpen={isDebugLogOpen}
        onClose={() => setIsDebugLogOpen(false)}
        logs={context.debugLogs}
        onClear={() => { context.log('Log cleared.'); }}
      />

      <AiAssistantPopup
        isOpen={isAiPopupOpen}
        onClose={handleCloseAiPopup}
        thoughts={context.aiThoughts}
        isThinking={context.isAiAssigning}
        title="AI Assignment Assistant"
      />

      <RepSettingsModal
        isOpen={!!context.repSettingsModalRepId}
        onClose={() => context.setRepSettingsModalRepId(null)}
        repId={context.repSettingsModalRepId}
      />

      <ThemeEditorModal
        isOpen={isThemeEditorOpen}
        onClose={() => setIsThemeEditorOpen(false)}
      />

      <AssignmentSettingsModal
        isOpen={isAssignmentSettingsOpen}
        onClose={() => setIsAssignmentSettingsOpen(false)}
      />

      <ConfirmationModal
        isOpen={context.confirmationState.isOpen}
        title={context.confirmationState.title}
        message={context.confirmationState.message}
        onConfirm={context.confirmationState.onConfirm}
        onCancel={context.closeConfirmation}
        confirmLabel={context.confirmationState.confirmLabel}
        cancelLabel={context.confirmationState.cancelLabel}
        isDangerous={context.confirmationState.isDangerous}
      />

      <LoadOptionsModal
        isOpen={context.loadOptionsModal.isOpen}
        isLoading={context.loadOptionsModal.isLoading}
        manualBackups={context.loadOptionsModal.manualBackups}
        autoBackup={context.loadOptionsModal.autoBackup}
        onLoadBackup={context.loadSelectedBackup}
        onStartFresh={context.closeLoadOptionsModal}
        onClose={context.closeLoadOptionsModal}
      />

      <StartupModal
        isOpen={showStartupModal && showPlanner}
        backupInfo={startupBackupInfo}
        isLoading={isLoadingMostRecent}
        onStartFresh={handleStartupStartFresh}
        onLoadMostRecent={handleStartupLoadMostRecent}
      />

      <ToastContainer
        toasts={context.toasts}
        onDismiss={context.dismissToast}
      />

    </div>
  );
};

export default MainLayout;
