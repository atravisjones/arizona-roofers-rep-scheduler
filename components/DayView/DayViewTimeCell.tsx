import React, { useState } from 'react';

interface DayViewTimeCellProps {
  repId: string;
  startMinutes: number;
  isUnavailable: boolean;
  isHourMark: boolean;
  onDrop: (jobId: string, repId: string, startMinutes: number) => void;
  cellHeight: number;
}

const DayViewTimeCell: React.FC<DayViewTimeCellProps> = ({
  repId,
  startMinutes,
  isUnavailable,
  isHourMark,
  onDrop,
  cellHeight,
}) => {
  const [isOver, setIsOver] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!isUnavailable) {
      e.dataTransfer.dropEffect = 'move';
      setIsOver(true);
    }
  };

  const handleDragLeave = () => {
    setIsOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const jobId = e.dataTransfer.getData('jobId');
    if (jobId && !isUnavailable) {
      onDrop(jobId, repId, startMinutes);
    }
    setIsOver(false);
  };

  return (
    <div
      style={{ height: cellHeight }}
      className={`
        relative
        border-b
        ${isHourMark ? 'border-border-primary' : 'border-border-secondary/50'}
        ${isUnavailable ? 'bg-bg-tertiary day-view-unavailable' : ''}
        ${isOver && !isUnavailable ? 'bg-brand-bg-light ring-2 ring-inset ring-brand-primary' : ''}
        transition-colors duration-150
      `}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    />
  );
};

export default DayViewTimeCell;
