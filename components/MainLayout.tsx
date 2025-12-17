import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useAppContext } from '../context/AppContext';
import { DragHandleIcon, SummaryIcon, SaveIcon, UploadIcon, UndoIcon, RedoIcon, UserIcon, TagIcon, RepairIcon, RescheduleIcon, MegaphoneIcon, SettingsIcon, HistoryIcon, CloudUploadIcon, CloudDownloadIcon, PasteIcon, AutoAssignIcon, LoadingIcon, MapPinIcon } from './icons';
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
import { parseTimeRange, doTimesOverlap } from '../utils/timeUtils';

const MIN_COLUMN_PERCENTAGE = 10;
type ColumnId = 'schedules' | 'jobs' | 'routes';


const MainLayout: React.FC = () => {
  const context = useAppContext();
  // Removed 'details' from default order
  const [columnOrder, setColumnOrder] = useState<ColumnId[]>(['schedules', 'jobs', 'routes']);
  // Adjusted widths for 3 columns
  const [columnWidths, setColumnWidths] = useState<Record<ColumnId, number>>({ schedules: 35, jobs: 30, routes: 35 });
  const draggedItem = useRef<ColumnId | null>(null);
  const dragOverItem = useRef<ColumnId | null>(null);
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

  const handleDragStart = (id: ColumnId) => { draggedItem.current = id; };
  const handleDragEnter = (id: ColumnId) => { dragOverItem.current = id; };
  const handleDragEnd = () => {
    if (draggedItem.current && dragOverItem.current && draggedItem.current !== dragOverItem.current) {
      const newColumnOrder = [...columnOrder];
      const draggedIndex = newColumnOrder.indexOf(draggedItem.current);
      const targetIndex = newColumnOrder.indexOf(dragOverItem.current);
      if (draggedIndex > -1 && targetIndex > -1) {
        const [removed] = newColumnOrder.splice(draggedIndex, 1);
        newColumnOrder.splice(targetIndex, 0, removed);
        setColumnOrder(newColumnOrder);
      }
    }
    draggedItem.current = null;
    dragOverItem.current = null;
  };

  const handleResizeStart = useCallback((e: React.MouseEvent, leftColId: ColumnId, rightColId: ColumnId) => {
    e.preventDefault();
    const startX = e.clientX;
    const containerNode = containerRef.current;
    if (!containerNode) return;
    const initialLeftPercent = columnWidths[leftColId];
    const initialRightPercent = columnWidths[rightColId];

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startX;
      const containerWidth = containerNode.getBoundingClientRect().width;
      if (!containerWidth) return;
      const dxPercent = (dx / containerWidth) * 100;
      let newLeftPercent = initialLeftPercent + dxPercent;
      let newRightPercent = initialRightPercent - dxPercent;
      if (newLeftPercent < MIN_COLUMN_PERCENTAGE) {
        newRightPercent += newLeftPercent - MIN_COLUMN_PERCENTAGE;
        newLeftPercent = MIN_COLUMN_PERCENTAGE;
      }
      if (newRightPercent < MIN_COLUMN_PERCENTAGE) {
        newLeftPercent += newRightPercent - MIN_COLUMN_PERCENTAGE;
        newRightPercent = MIN_COLUMN_PERCENTAGE;
      }
      setColumnWidths(prev => ({ ...prev, [leftColId]: newLeftPercent, [rightColId]: newRightPercent }));
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

  const visibleColumnOrder = useMemo(() => {
    return columnOrder.filter(id => id !== 'jobs' || context.uiSettings.showUnassignedJobsColumn);
  }, [columnOrder, context.uiSettings.showUnassignedJobsColumn]);

  const visibleColumnWidths = useMemo(() => {
    if (context.uiSettings.showUnassignedJobsColumn) {
      return columnWidths;
    }
    const hiddenWidth = columnWidths.jobs;
    const remainingCols = visibleColumnOrder;
    const remainingTotalWidth = remainingCols.reduce((acc, id) => acc + columnWidths[id], 0);

    const newWidths: Record<string, number> = {};
    remainingCols.forEach(id => {
      newWidths[id] = columnWidths[id] + hiddenWidth * (columnWidths[id] / remainingTotalWidth);
    });
    return newWidths;
  }, [columnWidths, context.uiSettings.showUnassignedJobsColumn, visibleColumnOrder]);


  const renderPanelContent = (id: ColumnId) => {
    switch (id) {
      case 'schedules':
        return <SchedulesPanel onDragStart={() => handleDragStart('schedules')} onDragEnd={handleDragEnd} />;
      case 'jobs':
        return <JobsPanel onDragStart={() => handleDragStart('jobs')} onDragEnd={handleDragEnd} />;
      case 'routes':
        return (
          <>
            <div className="flex justify-between items-center mb-2 border-b pb-1">
              <h2 className="text-lg font-semibold">3. Route Map</h2>
              <div
                draggable
                onDragStart={() => handleDragStart('routes')}
                onDragEnd={handleDragEnd}
                className="cursor-move text-text-quaternary hover:text-text-secondary" title="Drag to reorder column">
                <DragHandleIcon />
              </div>
            </div>
            <div className="flex-grow min-h-0">
              <RouteMapPanel routeData={context.activeRoute} isLoading={context.isRouting} />
            </div>
          </>
        );
      default:
        return null;
    }
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
            <button onClick={() => context.handleLoadStateFromCloud()} className="p-1.5 rounded hover:bg-bg-tertiary transition" title="Load from Cloud">
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
        {visibleColumnOrder.map((id, i) => {
          const rightColId = i < visibleColumnOrder.length - 1 ? visibleColumnOrder[i + 1] : null;
          return (
            <React.Fragment key={id}>
              <div
                data-col-id={id}
                className="bg-bg-primary p-4 rounded-lg shadow-lg border border-border-primary/50 flex flex-col min-w-0 h-full"
                style={{ flexBasis: `${visibleColumnWidths[id]}%` }}
                onDragEnter={() => handleDragEnter(id)}
                onDragOver={(e) => e.preventDefault()}
              >
                {renderPanelContent(id)}
              </div>
              {rightColId && (<div className="w-4 flex items-center justify-center cursor-col-resize group flex-shrink-0" onMouseDown={e => handleResizeStart(e, id, rightColId)}> <div className="w-1 h-16 bg-border-secondary group-hover:bg-brand-primary rounded-full transition-colors" /> </div>)}
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

    </div>
  );
};

export default MainLayout;
