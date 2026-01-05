import React, { useCallback, useMemo, useState } from 'react';
import { Rep, DisplayJob } from '../../types';
import { useAppContext } from '../../context/AppContext';
import { DAY_VIEW_CELL_HEIGHT, DAY_VIEW_REP_COLUMN_WIDTH } from '../../constants';
import DayViewGrid from './DayViewGrid';
import JobEditModal from './JobEditModal';
import { mapMinutesToSlotId } from './dayViewUtils';

interface DayViewPanelProps {
  reps: Rep[];
  hideEmptyReps?: boolean;
}

const DayViewPanel: React.FC<DayViewPanelProps> = ({ reps, hideEmptyReps = true }) => {
  const {
    selectedDate,
    handleJobDrop,
    setDraggedJob,
    handleJobDragEnd,
    uiSettings,
    updateUiSettings,
    setHoveredRepId,
  } = useAppContext();

  // State for job edit modal
  const [editingJob, setEditingJob] = useState<{ job: DisplayJob; repId: string } | null>(null);

  // Get cell dimensions from settings with defaults
  const cellHeight = uiSettings.dayViewCellHeight ?? DAY_VIEW_CELL_HEIGHT;
  const columnWidth = uiSettings.dayViewColumnWidth ?? DAY_VIEW_REP_COLUMN_WIDTH;

  // Get day name for availability checking
  const dayName = useMemo(() =>
    selectedDate.toLocaleDateString('en-US', { weekday: 'long' }),
    [selectedDate]
  );

  // Filter reps: only show reps with jobs OR who are available for this day
  const filteredReps = useMemo(() => {
    if (!hideEmptyReps) return reps;

    return reps.filter(rep => {
      // Always show if they have jobs assigned
      const jobCount = rep.schedule.flatMap(s => s.jobs).length;
      if (jobCount > 0) return true;

      // Show if they have at least one available slot today
      const unavailableSlots = rep.unavailableSlots?.[dayName] || [];
      const isFullyUnavailable = unavailableSlots.length >= 4; // All 4 slots unavailable
      return !isFullyUnavailable;
    });
  }, [reps, hideEmptyReps, dayName]);

  // Handle rep hover for map highlighting
  const handleRepHover = useCallback((repId: string | null) => {
    setHoveredRepId(repId);
  }, [setHoveredRepId]);

  // Handle height change
  const handleHeightChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    updateUiSettings({ dayViewCellHeight: Number(e.target.value) });
  }, [updateUiSettings]);

  // Handle width change
  const handleWidthChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    updateUiSettings({ dayViewColumnWidth: Number(e.target.value) });
  }, [updateUiSettings]);

  // Handle job drop from the grid
  const handleGridJobDrop = useCallback((jobId: string, repId: string, startMinutes: number) => {
    // Map the drop time to a traditional slot ID for the data model
    const slotId = mapMinutesToSlotId(startMinutes);
    handleJobDrop(jobId, { repId, slotId }, undefined);
  }, [handleJobDrop]);

  // Handle drag start
  const handleDragStart = useCallback((job: DisplayJob) => {
    setDraggedJob(job);
  }, [setDraggedJob]);

  // Handle drag end
  const handleDragEnd = useCallback(() => {
    handleJobDragEnd();
  }, [handleJobDragEnd]);

  // Handle job click - open edit modal
  const handleJobClick = useCallback((job: DisplayJob, repId: string) => {
    setEditingJob({ job, repId });
  }, []);

  if (filteredReps.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-secondary">
        <div className="text-center">
          <p className="text-sm">No reps to display</p>
          <p className="text-xs mt-1">Try adjusting your filters</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Controls Header */}
      <div className="flex-shrink-0 px-3 py-2 bg-bg-secondary border-b border-border-primary flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-xs text-secondary whitespace-nowrap">Row Height:</label>
          <input
            type="range"
            min="30"
            max="80"
            value={cellHeight}
            onChange={handleHeightChange}
            className="w-20 h-1 accent-brand-primary"
          />
          <span className="text-xs text-tertiary w-6">{cellHeight}</span>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-secondary whitespace-nowrap">Col Width:</label>
          <input
            type="range"
            min="5"
            max="250"
            value={columnWidth}
            onChange={handleWidthChange}
            className="w-20 h-1 accent-brand-primary"
          />
          <span className="text-xs text-tertiary w-6">{columnWidth}</span>
        </div>
        <div className="text-xs text-tertiary">
          {filteredReps.length} rep{filteredReps.length !== 1 ? 's' : ''}
          {hideEmptyReps && reps.length > filteredReps.length && (
            <span className="ml-1">({reps.length - filteredReps.length} hidden)</span>
          )}
        </div>
      </div>

      {/* Grid - Scrollable container with forced scrollbars */}
      <div
        className="bg-bg-primary"
        style={{
          flex: '1 1 0',
          minHeight: 0,
          overflow: 'scroll',
        }}
      >
        <DayViewGrid
          reps={filteredReps}
          dayName={dayName}
          onJobDrop={handleGridJobDrop}
          onJobDragStart={handleDragStart}
          onJobDragEnd={handleDragEnd}
          onJobClick={handleJobClick}
          cellHeight={cellHeight}
          columnWidth={columnWidth}
          onRepHover={handleRepHover}
        />
      </div>

      {/* Job Edit Modal */}
      <JobEditModal
        job={editingJob?.job || null}
        isOpen={!!editingJob}
        onClose={() => setEditingJob(null)}
        currentRepId={editingJob?.repId}
      />
    </div>
  );
};

export default DayViewPanel;
