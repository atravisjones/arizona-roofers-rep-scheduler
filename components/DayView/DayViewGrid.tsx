import React from 'react';
import { Rep, DisplayJob } from '../../types';
import DayViewRepColumn from './DayViewRepColumn';
import { DAY_VIEW_SLOTS } from './dayViewUtils';

interface DayViewGridProps {
  reps: Rep[];
  dayName: string;
  onJobDrop: (jobId: string, repId: string, startMinutes: number) => void;
  onJobDragStart?: (job: DisplayJob) => void;
  onJobDragEnd?: () => void;
  onJobClick?: (job: DisplayJob, repId: string) => void;
  cellHeight: number;
  columnWidth: number; // This now acts as the min-width for columns
  onRepHover?: (repId: string | null) => void;
}

const DayViewGrid: React.FC<DayViewGridProps> = ({
  reps,
  dayName,
  onJobDrop,
  onJobDragStart,
  onJobDragEnd,
  onJobClick,
  cellHeight,
  columnWidth,
  onRepHover,
}) => {
  // Calculate dimensions
  const timeColumnWidth = 70;
  const headerHeight = 44;
  const totalMinWidth = timeColumnWidth + reps.length * columnWidth;
  // Total height = header + all time slots
  const totalHeight = headerHeight + DAY_VIEW_SLOTS.length * cellHeight;

  return (
    <div
      className="flex"
      style={{
        // Use max of 100% or totalMinWidth to enable both stretching and scrolling
        width: `max(100%, ${totalMinWidth}px)`,
        minWidth: '100%',
        // Explicit height ensures scrollbar appears when content exceeds container
        height: totalHeight,
        minHeight: totalHeight,
      }}
    >
      {/* Time Column - Sticky left */}
      <div className="sticky left-0 z-30 bg-bg-primary border-r border-border-primary flex flex-col flex-shrink-0" style={{ width: timeColumnWidth }}>
        {/* Empty corner cell to align with rep headers */}
        <div
          className="sticky top-0 z-40 bg-bg-secondary border-b border-border-primary flex items-center justify-center"
          style={{ height: 44 }} // Match rep header height
        >
          <span className="text-[10px] text-tertiary font-medium">TIME</span>
        </div>

        {/* Time Labels */}
        {DAY_VIEW_SLOTS.map((slot) => (
          <div
            key={slot.id}
            className={`
              flex items-start justify-end pr-2 pt-0.5
              border-b
              ${slot.startMinutes % 60 === 0 ? 'border-border-primary' : 'border-border-secondary/50'}
            `}
            style={{ height: cellHeight }}
          >
            {/* Only show label on hour marks */}
            {slot.startMinutes % 60 === 0 && (
              <span className="text-[10px] text-secondary font-medium">
                {slot.label}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Rep Columns Container - Stretches to fill remaining space */}
      <div className="flex flex-1">
        {reps.map(rep => (
          <DayViewRepColumn
            key={rep.id}
            rep={rep}
            dayName={dayName}
            onJobDrop={onJobDrop}
            onJobDragStart={onJobDragStart}
            onJobDragEnd={onJobDragEnd}
            onJobClick={onJobClick}
            cellHeight={cellHeight}
            columnWidth={columnWidth}
            onRepHover={onRepHover}
          />
        ))}
      </div>
    </div>
  );
};

export default DayViewGrid;
