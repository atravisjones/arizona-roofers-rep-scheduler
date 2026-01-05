import React, { useMemo, useState } from 'react';
import { DisplayJob } from '../../types';
import { TAG_KEYWORDS } from '../../constants';
import { useAppContext } from '../../context/AppContext';
import { calculateJobPosition, formatMinutesAsTime } from './dayViewUtils';
import { UnassignJobIcon, MapPinIcon, ExternalLinkIcon, StarIcon, RescheduleIcon } from '../icons';

const TAG_CLASSES: Record<string, string> = {
  'Tile': 'bg-tag-orange-bg text-tag-orange-text',
  'Shingle': 'bg-tag-amber-bg text-tag-amber-text',
  'Flat': 'bg-tag-cyan-bg text-tag-cyan-text',
  'Metal': 'bg-tag-slate-bg text-tag-slate-text',
  'Insurance': 'bg-tag-emerald-bg text-tag-emerald-text',
  'Commercial': 'bg-tag-purple-bg text-tag-purple-text',
  'stories': 'bg-tag-teal-bg text-tag-teal-text',
  'sqft': 'bg-tag-sky-bg text-tag-sky-text',
  'yrs': 'bg-tag-stone-bg text-tag-stone-text',
};

interface DayViewJobBlockProps {
  job: DisplayJob;
  slotId: string;
  onDragStart?: (job: DisplayJob) => void;
  onDragEnd?: () => void;
  onClick?: (job: DisplayJob) => void;
  cellHeight: number;
  columnWidth: number;
}

const DayViewJobBlock: React.FC<DayViewJobBlockProps> = ({
  job,
  slotId,
  onDragStart,
  onDragEnd,
  onClick,
  cellHeight,
  columnWidth,
}) => {
  const {
    setHoveredJobId,
    handleUnassignJob,
    roofrJobIdMap,
  } = useAppContext();

  const [isHovered, setIsHovered] = useState(false);

  const position = useMemo(() =>
    calculateJobPosition(job.originalTimeframe, slotId, cellHeight),
    [job.originalTimeframe, slotId, cellHeight]
  );

  // Parse all tags including roof type, stories, sqft, and age
  const allTags = useMemo(() => {
    if (!job.notes) return [];
    const notesLower = job.notes.toLowerCase();

    // Age tag (e.g., "15 yrs")
    const ageMatch = job.notes.match(/\b(\d+)\s*yrs\b/i);
    const ageTag = ageMatch ? [{ type: 'yrs', value: `${ageMatch[1]}yrs`, classes: TAG_CLASSES['yrs'] }] : [];

    // Roof type tags (Tile, Shingle, Flat, Metal, Insurance, Commercial)
    const roofTags = TAG_KEYWORDS.filter(keyword =>
      new RegExp(`\\b${keyword.toLowerCase()}\\b`).test(notesLower)
    ).map(tag => ({ type: 'roof', value: tag, classes: TAG_CLASSES[tag] || 'bg-bg-tertiary text-secondary' }));

    // Square footage tag (e.g., "2,500 sq")
    const sqftMatch = job.notes.match(/\b([\d,]+)\s*sq\.?\b/i);
    const sqftTag = sqftMatch ? [{ type: 'sqft', value: `${sqftMatch[1]}sf`, classes: TAG_CLASSES['sqft'] }] : [];

    // Stories tag (e.g., "2S")
    const storiesMatch = job.notes.match(/\b(\d)S\b/i);
    const storiesTag = storiesMatch ? [{ type: 'stories', value: `${storiesMatch[1]}St`, classes: TAG_CLASSES['stories'] }] : [];

    return [...roofTags, ...sqftTag, ...storiesTag, ...ageTag];
  }, [job.notes]);

  // Check for priority level (# symbols)
  const { priorityLevel, priorityReason } = useMemo(() => {
    const priorityMatch = job.notes.match(/#+/);
    const level = priorityMatch ? priorityMatch[0].length : 0;
    if (level === 0) return { priorityLevel: 0, priorityReason: '' };

    const reasonMatch = job.notes.match(/#+\s*\(([^)]+)\)/);
    return { priorityLevel: level, priorityReason: reasonMatch ? reasonMatch[1] : 'Priority' };
  }, [job.notes]);

  // Check for reschedule
  const isReschedule = useMemo(() => job.notes.includes('Recommended Reschedule'), [job.notes]);

  const timeDisplay = useMemo(() => {
    return `${formatMinutesAsTime(position.startMinutes)} - ${formatMinutesAsTime(position.endMinutes)}`;
  }, [position.startMinutes, position.endMinutes]);

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData('jobId', job.id);
    e.dataTransfer.effectAllowed = 'move';
    onDragStart?.(job);
  };

  const handleDragEnd = () => {
    onDragEnd?.();
  };

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClick?.(job);
  };

  const handleMouseEnter = () => {
    setIsHovered(true);
    setHoveredJobId(job.id);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    setHoveredJobId(null);
  };

  const handleUnassign = (e: React.MouseEvent) => {
    e.stopPropagation();
    handleUnassignJob(job.id);
  };

  const openGoogleMaps = (e: React.MouseEvent) => {
    e.stopPropagation();
    const query = encodeURIComponent(job.address);
    window.open(`https://www.google.com/maps/search/?api=1&query=${query}`, '_blank');
  };

  // Get Roofr job URL if available
  const roofrJobId = roofrJobIdMap?.get(job.address.toLowerCase().trim());
  const roofrUrl = roofrJobId ? `https://app.roofr.com/jobs/${roofrJobId}` : null;

  const openRoofr = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (roofrUrl) window.open(roofrUrl, '_blank');
  };

  // Extract city for display
  const cityDisplay = job.city || '';

  // Extract address number and street for compact display
  const addressParts = job.address.split(',')[0] || job.address;

  // Calculate what to show based on available height
  const showTags = position.height > 40;
  const showScore = position.height > 50 && job.assignmentScore !== undefined;
  const showActions = isHovered && position.height > 40;
  const showPriority = priorityLevel > 0;

  // Determine card styling based on priority/reschedule status
  const cardBorderClass = useMemo(() => {
    if (priorityLevel >= 3) return 'border-amber-500 ring-2 ring-amber-400/50';
    if (priorityLevel === 2) return 'border-red-400 ring-1 ring-red-400/30';
    if (priorityLevel === 1) return 'border-amber-400';
    if (isReschedule) return 'border-blue-400';
    return 'border-brand-primary/30';
  }, [priorityLevel, isReschedule]);

  const cardBgClass = useMemo(() => {
    if (priorityLevel >= 3) return 'bg-gradient-to-br from-yellow-100 to-amber-200';
    if (priorityLevel === 2) return 'bg-gradient-to-br from-amber-50 to-red-100';
    if (priorityLevel === 1) return 'bg-amber-50';
    if (isReschedule) return 'bg-blue-50';
    return 'bg-brand-bg-light';
  }, [priorityLevel, isReschedule]);

  return (
    <div
      className={`day-view-job-block absolute left-1 right-1 ${cardBgClass} border rounded-md overflow-hidden cursor-grab active:cursor-grabbing transition-all z-10 ${
        isHovered ? 'border-brand-primary shadow-lg ring-2 ring-brand-primary/30 z-20' : `${cardBorderClass} hover:shadow-md`
      } ${priorityLevel >= 3 ? 'animate-pulse' : ''}`}
      style={{
        top: position.top,
        height: Math.max(position.height - 2, 30),
      }}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      title={priorityLevel > 0 ? `Priority: ${priorityReason}` : isReschedule ? 'Recommended Reschedule' : undefined}
    >
      <div className="p-1.5 h-full flex flex-col overflow-hidden relative">
        {/* Top row: Score badge and Priority stars */}
        <div className="absolute top-0.5 right-0.5 flex items-center gap-0.5">
          {showPriority && (
            <div className="flex">
              {[...Array(Math.min(priorityLevel, 3))].map((_, i) => (
                <StarIcon key={i} className={`h-2.5 w-2.5 ${
                  priorityLevel >= 3 ? 'text-red-500' :
                  priorityLevel === 2 ? 'text-orange-500' :
                  'text-amber-500'
                }`} />
              ))}
            </div>
          )}
          {isReschedule && !showPriority && (
            <RescheduleIcon className="h-2.5 w-2.5 text-blue-500" />
          )}
          {showScore && (
            <div className="bg-brand-primary text-brand-text-on-primary text-[8px] font-bold px-1 rounded">
              {Math.round(job.assignmentScore!)}
            </div>
          )}
        </div>

        {/* Time display */}
        <div className="text-[9px] font-semibold text-brand-primary truncate pr-10">
          {timeDisplay}
        </div>

        {/* City */}
        {cityDisplay && (
          <div className="text-[10px] font-bold text-primary truncate uppercase">
            {cityDisplay}
          </div>
        )}

        {/* Address */}
        <div className="text-[9px] text-secondary truncate flex-shrink-0">
          {addressParts}
        </div>

        {/* Tags - show all job details */}
        {showTags && allTags.length > 0 && (
          <div className="flex flex-wrap gap-0.5 mt-auto pt-0.5">
            {allTags.map((tag, idx) => (
              <span
                key={`${tag.type}-${idx}`}
                className={`px-1 py-0 text-[7px] font-semibold rounded ${tag.classes}`}
              >
                {tag.value}
              </span>
            ))}
          </div>
        )}

        {/* Action buttons - show on hover */}
        {showActions && (
          <div className="absolute bottom-1 right-1 flex gap-0.5 bg-bg-primary/90 rounded px-0.5 py-0.5">
            {roofrUrl && (
              <button
                onClick={openRoofr}
                className="p-0.5 hover:bg-brand-bg-light rounded text-brand-primary"
                title="Open in Roofr"
              >
                <ExternalLinkIcon className="h-3 w-3" />
              </button>
            )}
            <button
              onClick={openGoogleMaps}
              className="p-0.5 hover:bg-brand-bg-light rounded text-secondary hover:text-primary"
              title="Open in Google Maps"
            >
              <MapPinIcon className="h-3 w-3" />
            </button>
            <button
              onClick={handleUnassign}
              className="p-0.5 hover:bg-tag-red-bg rounded text-secondary hover:text-tag-red-text"
              title="Unassign Job"
            >
              <UnassignJobIcon className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default DayViewJobBlock;
