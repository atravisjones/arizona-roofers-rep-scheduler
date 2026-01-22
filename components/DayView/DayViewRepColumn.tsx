import React, { useMemo } from 'react';
import { Rep, DisplayJob } from '../../types';
import DayViewTimeCell from './DayViewTimeCell';
import DayViewJobBlock from './DayViewJobBlock';
import { DAY_VIEW_SLOTS, mapMinutesToSlotId } from './dayViewUtils';
import { LockIcon } from '../icons';

interface DayViewRepColumnProps {
  rep: Rep;
  dayName: string;
  onJobDrop: (jobId: string, repId: string, startMinutes: number) => void;
  onJobDragStart?: (job: DisplayJob) => void;
  onJobDragEnd?: () => void;
  onJobClick?: (job: DisplayJob, repId: string) => void;
  cellHeight: number;
  columnWidth: number;
  onRepHover?: (repId: string | null) => void;
}

const DayViewRepColumn: React.FC<DayViewRepColumnProps> = ({
  rep,
  dayName,
  onJobDrop,
  onJobDragStart,
  onJobDragEnd,
  onJobClick,
  cellHeight,
  columnWidth,
  onRepHover,
}) => {
  // Get unavailable slots for this rep on this day
  const unavailableSlotIds = useMemo(() => {
    return rep.unavailableSlots?.[dayName] || [];
  }, [rep.unavailableSlots, dayName]);

  // Check if a time slot is unavailable based on the rep's unavailable slots
  const isTimeUnavailable = (startMinutes: number): boolean => {
    const slotId = mapMinutesToSlotId(startMinutes);
    return unavailableSlotIds.includes(slotId);
  };

  // Check if rep is fully unavailable (all 4 slots marked unavailable)
  const isFullyUnavailable = useMemo(() => {
    return unavailableSlotIds.length >= 4;
  }, [unavailableSlotIds]);

  // Get all jobs for this rep across all time slots
  const allJobs = useMemo(() => {
    return rep.schedule.flatMap(slot =>
      slot.jobs.map(job => ({ job, slotId: slot.id }))
    );
  }, [rep.schedule]);

  // Calculate total job count
  const jobCount = allJobs.length;

  // Format rep name (first name + last initial)
  const displayName = useMemo(() => {
    const parts = rep.name.replace(/"/g, '').trim().split(' ').filter(Boolean);
    if (parts.length === 0) return rep.name;
    if (parts.length === 1) return parts[0];
    // Handle region suffix like "PHOENIX" or "TUCSON"
    const regions = ['PHOENIX', 'TUCSON'];
    let lastName = parts[parts.length - 1];
    if (regions.includes(lastName.toUpperCase()) && parts.length > 2) {
      lastName = parts[parts.length - 2];
    } else if (regions.includes(lastName.toUpperCase())) {
      return parts[0];
    }
    return `${parts[0]} ${lastName.charAt(0).toUpperCase()}.`;
  }, [rep.name]);

  const handleMouseEnter = () => {
    onRepHover?.(rep.id);
  };

  const handleMouseLeave = () => {
    onRepHover?.(null);
  };

  return (
    <div
      className={`flex flex-col border-r border-border-primary ${
        isFullyUnavailable ? 'opacity-60 grayscale' : ''
      }`}
      style={{
        // flex: grow shrink basis - columns grow equally but don't shrink below min-width
        flex: `1 1 ${columnWidth}px`,
        minWidth: 5,
      }}
    >
      {/* Rep Header - Sticky, height matches time column header (44px) */}
      <div
        className="sticky top-0 z-20 bg-bg-secondary border-b border-border-primary px-2 cursor-pointer hover:bg-bg-tertiary transition-colors flex items-center"
        style={{ height: 44 }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <div className="flex items-center justify-between gap-1 w-full">
          <div className="flex items-center gap-1 min-w-0">
            {rep.isLocked && (
              <span className="text-tag-amber-text flex-shrink-0">
                <LockIcon className="w-3 h-3" />
              </span>
            )}
            <span className="font-medium text-xs text-primary truncate" title={rep.name}>
              {displayName}
            </span>
          </div>
          <span className="text-[10px] text-secondary bg-bg-tertiary px-1.5 py-0.5 rounded-full flex-shrink-0">
            {jobCount}
          </span>
        </div>
      </div>

      {/* Time Cells Container - Relative for absolute positioning of job blocks */}
      <div className="relative">
        {/* Time Cells */}
        {DAY_VIEW_SLOTS.map((slot) => (
          <DayViewTimeCell
            key={slot.id}
            repId={rep.id}
            startMinutes={slot.startMinutes}
            isUnavailable={isTimeUnavailable(slot.startMinutes)}
            isHourMark={slot.startMinutes % 60 === 0}
            onDrop={onJobDrop}
            cellHeight={cellHeight}
          />
        ))}

        {/* Job Blocks - Positioned absolutely over the cells */}
        {allJobs.map(({ job, slotId }) => (
          <DayViewJobBlock
            key={job.id}
            job={job}
            slotId={slotId}
            onDragStart={onJobDragStart}
            onDragEnd={onJobDragEnd}
            onClick={onJobClick ? (j) => onJobClick(j, rep.id) : undefined}
            cellHeight={cellHeight}
            columnWidth={columnWidth}
          />
        ))}
      </div>
    </div>
  );
};

export default DayViewRepColumn;
