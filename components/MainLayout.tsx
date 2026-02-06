import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useAppContext } from '../context/AppContext';
import { DragHandleIcon, SummaryIcon, SaveIcon, UploadIcon, UndoIcon, RedoIcon, UserIcon, TagIcon, RepairIcon, RescheduleIcon, MegaphoneIcon, SettingsIcon, HistoryIcon, CloudUploadIcon, CloudDownloadIcon, PasteIcon, AutoAssignIcon, LoadingIcon, MapPinIcon, MinimizeIcon, MaximizeIcon, ChevronLeftIcon, ChevronRightIcon } from './icons';
import DayTabs from './DayTabs';
import SchedulesPanel from './SchedulesPanel';
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
import { Job } from '../types';
import SettingsPanel from './SettingsPanel';
import AssignmentSettingsModal from './SettingsModal';
import ThemeEditorModal from './ThemeEditorModal';
import ConfirmationModal from './ConfirmationModal';
import LoadOptionsModal from './LoadOptionsModal';
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
  const settingsRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (context.isAiAssigning || context.aiThoughts.length > 0) {
      setIsAiPopupOpen(true);
    }
  }, [context.isAiAssigning, context.aiThoughts.length]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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
      className="flex-shrink-0 w-8 bg-bg-primary border border-border-primary/50 rounded-lg flex flex-col items-center py-2 gap-2 shadow-lg"
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
          <div className="flex-shrink-0 h-10 bg-bg-primary rounded-xl border border-border-primary/50 shadow-md flex items-center px-3 gap-2 mt-3">
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
          className="flex flex-col min-h-0 overflow-hidden bg-bg-primary rounded-xl border border-border-primary/50 shadow-lg"
          style={{ flex: `0 0 ${stackHeight}%` }}
        >
          {/* Widget header */}
          <div className="flex justify-between items-center px-4 py-2.5 border-b border-border-primary/50 bg-bg-primary flex-shrink-0">
            <div className="flex items-center gap-2">
              <DragHandleIcon className="h-4 w-4 text-text-quaternary cursor-grab" />
              <span className="text-sm font-semibold text-text-primary">{getColumnLabel(id)}</span>
            </div>
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => toggleCollapse(id)}
                className="p-1.5 rounded-lg hover:bg-bg-tertiary text-text-quaternary hover:text-text-secondary transition"
                title="Collapse"
              >
                <MinimizeIcon className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setColumnStacking(id, null)}
                className="p-1.5 rounded-lg hover:bg-bg-tertiary text-text-quaternary hover:text-text-secondary transition"
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

  return (
    <div className="h-screen flex flex-col bg-bg-secondary text-text-primary font-sans overflow-hidden">
      {/* Two-Level Header */}
      <header className="bg-bg-primary border-b border-border-primary flex-shrink-0 z-30 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
        {/* Top Bar: Reports, Alerts, Data Controls */}
        <div className="h-10 px-4 flex items-center justify-between border-b border-border-secondary/50 bg-bg-secondary/30">
          {/* Left: Branding + Paste/Auto Assign */}
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold text-text-primary tracking-tight">Rep Route Planner</h1>

            {/* Paste Jobs & Auto Assign Buttons */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setIsPasteModalOpen(true)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold bg-bg-secondary/50 text-text-secondary hover:bg-bg-tertiary hover:text-brand-primary rounded-md transition-all border border-border-secondary/50"
                title="Paste Jobs"
              >
                <PasteIcon className="h-3.5 w-3.5" />
                <span>Paste</span>
              </button>

              <button
                onClick={context.handleAutoAssign}
                disabled={context.isLoadingReps || context.isAutoAssigning || context.isParsing || context.appState.unassignedJobs.length === 0}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold bg-brand-primary text-brand-text-on-primary hover:bg-brand-secondary disabled:bg-bg-quaternary disabled:text-text-tertiary disabled:cursor-not-allowed rounded-md transition-all"
                title={context.isLoadingReps ? "Waiting for rep data..." : context.appState.unassignedJobs.length === 0 ? "No unassigned jobs" : "Auto Assign Jobs"}
              >
                {context.isAutoAssigning ? <LoadingIcon /> : <AutoAssignIcon className="h-3.5 w-3.5" />}
                <span>{context.isAutoAssigning ? 'Assigning...' : 'Auto Assign'}</span>
              </button>
            </div>
          </div>

          {/* Center: Reports & Alerts */}
          <div className="flex items-center gap-3">
            {/* Alerts */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => setIsNeedsRescheduleOpen(true)}
                className={`relative flex items-center gap-1 px-2 py-1 text-[10px] font-semibold rounded transition-all ${jobsNeedingRescheduleCount > 0
                  ? 'bg-tag-blue-bg text-tag-blue-text hover:bg-tag-blue-bg/80'
                  : 'text-text-quaternary hover:bg-bg-tertiary hover:text-text-secondary'
                  }`}
                title="Review jobs with potential scheduling conflicts"
              >
                <RescheduleIcon className="h-3 w-3" />
                <span>Reschedule</span>
                {jobsNeedingRescheduleCount > 0 && (
                  <span className="ml-0.5 px-1 text-[9px] font-bold rounded-full bg-brand-blue text-white">
                    {jobsNeedingRescheduleCount}
                  </span>
                )}
              </button>

              <button
                onClick={() => setIsNeedsDetailsOpen(true)}
                className={`relative flex items-center gap-1 px-2 py-1 text-[10px] font-semibold rounded transition-all ${needsDetailsCount > 0
                  ? 'bg-tag-amber-bg text-tag-amber-text hover:bg-tag-amber-bg/80'
                  : 'text-text-quaternary hover:bg-bg-tertiary hover:text-text-secondary'
                  }`}
                title="Review jobs missing essential details"
              >
                <RepairIcon className="h-3 w-3" />
                <span>Details</span>
                {needsDetailsCount > 0 && (
                  <span className="ml-0.5 px-1 text-[9px] font-bold rounded-full bg-tag-amber-text text-white">
                    {needsDetailsCount}
                  </span>
                )}
              </button>

              <button
                onClick={() => setIsUnplottedModalOpen(true)}
                className={`relative flex items-center gap-1 px-2 py-1 text-[10px] font-semibold rounded transition-all ${unplottedJobsCount > 0
                  ? 'bg-tag-red-bg text-tag-red-text hover:bg-tag-red-bg/80'
                  : 'text-text-quaternary hover:bg-bg-tertiary hover:text-text-secondary'
                  }`}
                title="Review jobs that could not be plotted on the map"
              >
                <MapPinIcon className="h-3 w-3" />
                <span>Unplotted</span>
                {unplottedJobsCount > 0 && (
                  <span className="ml-0.5 px-1 text-[9px] font-bold rounded-full bg-tag-red-text text-white">
                    {unplottedJobsCount}
                  </span>
                )}
              </button>
            </div>

            <div className="w-px h-4 bg-border-secondary"></div>

            {/* Reports */}
            <div className="flex items-center gap-0.5">
              <button onClick={() => setIsDailySummaryOpen(true)} className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-text-tertiary hover:text-brand-primary hover:bg-bg-tertiary rounded transition-all">
                <SummaryIcon className="h-3 w-3" />
                <span>Daily</span>
              </button>
              <button onClick={() => setIsRepSummaryOpen(true)} className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-text-tertiary hover:text-brand-primary hover:bg-bg-tertiary rounded transition-all">
                <UserIcon className="h-3 w-3" />
                <span>Reps</span>
              </button>
              <button onClick={() => setIsAvailabilitySummaryOpen(true)} className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-text-tertiary hover:text-brand-primary hover:bg-bg-tertiary rounded transition-all">
                <TagIcon className="h-3 w-3" />
                <span>Slots</span>
              </button>
            </div>
          </div>

          {/* Right: Data Controls & Settings */}
          <div className="flex items-center gap-1">
            <button onClick={context.handleSaveStateToFile} className="p-1.5 rounded hover:bg-bg-tertiary transition" title="Save to File">
              <SaveIcon className="h-3.5 w-3.5 text-text-quaternary hover:text-brand-primary" />
            </button>
            <button onClick={handleLoadClick} className="p-1.5 rounded hover:bg-bg-tertiary transition" title="Load from File">
              <UploadIcon className="h-3.5 w-3.5 text-text-quaternary hover:text-brand-primary" />
            </button>
            <button onClick={() => context.handleSaveStateToCloud()} className="p-1.5 rounded hover:bg-bg-tertiary transition" title="Save to Cloud">
              <CloudUploadIcon className="h-3.5 w-3.5 text-text-quaternary hover:text-brand-primary" />
            </button>
            <button onClick={() => context.showLoadOptionsModal()} className="p-1.5 rounded hover:bg-bg-tertiary transition" title="Load from Cloud">
              <CloudDownloadIcon className="h-3.5 w-3.5 text-text-quaternary hover:text-brand-primary" />
            </button>
            <div className="w-px h-4 bg-border-secondary mx-1"></div>
            {/* Routing API Integration Toggle */}
            <button
              onClick={() => context.toggleRoutingApiMode(!context.useRoutingApi)}
              className={`flex items-center gap-1 px-2 py-1 text-[10px] font-semibold rounded transition ${
                context.useRoutingApi
                  ? 'bg-green-100 text-green-700 border border-green-300 hover:bg-green-200'
                  : 'bg-bg-secondary/50 text-text-tertiary hover:bg-bg-tertiary border border-border-secondary/50'
              }`}
              title={context.useRoutingApi ? 'Routing API enabled - Click to disable' : 'Enable Routing API to load scanner jobs'}
            >
              <span className={`w-2 h-2 rounded-full ${
                context.useRoutingApi
                  ? context.routingApiSyncStatus === 'syncing' ? 'bg-yellow-500 animate-pulse'
                    : context.routingApiSyncStatus === 'error' ? 'bg-red-500'
                    : 'bg-green-500'
                  : 'bg-gray-400'
              }`}></span>
              Routing
            </button>
            {context.useRoutingApi && (
              <button
                onClick={() => context.loadJobsFromRoutingApi()}
                disabled={context.isLoadingFromRoutingApi}
                className="px-2 py-1 text-[10px] font-semibold bg-brand-bg-light text-brand-text-light rounded hover:bg-brand-primary/20 disabled:opacity-50 transition"
                title="Refresh jobs from Routing API"
              >
                {context.isLoadingFromRoutingApi ? 'Loading...' : 'Refresh'}
              </button>
            )}
            {/* Auto-save indicator */}
            {context.isAutoSaving ? (
              <span className="text-xs text-yellow-500 ml-1 animate-pulse" title="Auto-saving...">saving...</span>
            ) : context.lastAutoSaveTime ? (
              <span className="text-xs text-text-quaternary ml-1" title={`Last auto-save: ${context.lastAutoSaveTime.toLocaleTimeString()}`}>
                auto-saved
              </span>
            ) : null}
            <div className="w-px h-4 bg-border-secondary mx-1"></div>
            <div ref={settingsRef} className="relative">
              <button onClick={() => setIsSettingsPanelOpen(prev => !prev)} className="p-1.5 rounded hover:bg-bg-tertiary transition" title="Settings">
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
          </div>
        </div>

        {/* Bottom Bar: History, Announcements, Calendar */}
        <div className="h-12 px-4 flex items-center justify-between">
          {/* Left: History Controls & Changes */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-0.5 bg-bg-secondary/50 p-0.5 rounded-md border border-border-secondary/50">
              <button onClick={context.handleUndo} disabled={!context.canUndo} className="p-1.5 rounded hover:bg-bg-primary text-text-tertiary hover:text-text-primary disabled:opacity-30 transition" title="Undo (Ctrl+Z)">
                <UndoIcon className="h-3.5 w-3.5" />
              </button>
              <button onClick={context.handleRedo} disabled={!context.canRedo} className="p-1.5 rounded hover:bg-bg-primary text-text-tertiary hover:text-text-primary disabled:opacity-30 transition" title="Redo (Ctrl+Y)">
                <RedoIcon className="h-3.5 w-3.5" />
              </button>
            </div>

            <button
              onClick={() => setIsChangeLogOpen(true)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold rounded-md transition ${context.changeLog.length > 0
                ? 'bg-brand-bg-light text-brand-text-light hover:bg-brand-primary/20'
                : 'bg-bg-secondary/50 text-text-tertiary hover:bg-bg-tertiary'
                }`}
              title="View Change Log"
            >
              <HistoryIcon className="h-3.5 w-3.5" />
              <span>Changes</span>
              {context.changeLog.length > 0 && (
                <span className="px-1.5 py-0.5 bg-brand-primary text-brand-text-on-primary rounded-full text-[9px] font-bold">
                  {context.changeLog.length}
                </span>
              )}
            </button>

            {context.announcement && (
              <div className="bg-brand-bg-light border border-brand-primary/20 text-brand-text-light text-[10px] font-semibold px-2 py-1 rounded flex items-center gap-1.5 animate-fade-in max-w-xs truncate ml-2">
                <MegaphoneIcon className="h-3 w-3 text-brand-primary flex-shrink-0" />
                <span className="truncate">{context.announcement}</span>
              </div>
            )}
          </div>

          {/* Right: Date Navigation */}
          <div className="flex items-center">
            <DayTabs />
          </div>
        </div>
        <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".json" className="hidden" />
      </header>

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
                    : 'bg-bg-primary p-4 rounded-lg shadow-lg border border-border-primary/50'
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
                    className="flex flex-col min-h-0 overflow-hidden bg-bg-primary rounded-xl border border-border-primary/50 shadow-lg"
                    style={{ flex: `1 1 ${100 - stackedUnder.reduce((sum, sid) => sum + (collapsedColumns.has(sid) ? 0 : stackHeights[sid]), 0)}%` }}
                  >
                    {/* Widget header for parent when stacked */}
                    <div className="flex justify-between items-center px-4 py-2.5 border-b border-border-primary/50 bg-bg-primary flex-shrink-0 rounded-t-xl">
                      <div className="flex items-center gap-2">
                        <DragHandleIcon className="h-4 w-4 text-text-quaternary cursor-grab" />
                        <span className="text-sm font-semibold text-text-primary">{getColumnLabel(id)}</span>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleCollapse(id); }}
                        className="p-1.5 rounded-lg hover:bg-bg-tertiary text-text-quaternary hover:text-text-secondary transition"
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

      <ToastContainer
        toasts={context.toasts}
        onDismiss={context.dismissToast}
      />

    </div>
  );
};

export default MainLayout;
