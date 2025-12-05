import React, { useMemo, useState, useEffect } from 'react';
import { Job, DisplayJob } from '../types';
import { TAG_KEYWORDS } from '../constants';
import { RescheduleIcon, UnassignJobIcon, StarIcon, MapPinIcon, EditIcon, SaveIcon, XIcon, UserIcon, TrashIcon, TrophyIcon, ExternalLinkIcon } from './icons';
import { useAppContext } from '../context/AppContext';
import { normalizeAddressForMatching } from '../services/googleSheetsService';

const TAG_CLASSES: Record<string, string> = {
    'Tile': 'bg-tag-orange-bg text-tag-orange-text border-tag-orange-border',
    'Shingle': 'bg-tag-amber-bg text-tag-amber-text border-tag-amber-border',
    'Flat': 'bg-tag-cyan-bg text-tag-cyan-text border-tag-cyan-border',
    'Metal': 'bg-tag-slate-bg text-tag-slate-text border-tag-slate-border',
    'Insurance': 'bg-tag-emerald-bg text-tag-emerald-text border-tag-emerald-border',
    'Commercial': 'bg-tag-purple-bg text-tag-purple-text border-tag-purple-border',
    'stories': 'bg-tag-teal-bg text-tag-teal-text border-tag-teal-border',
    'sqft': 'bg-tag-sky-bg text-tag-sky-text border-tag-sky-border',
    'yrs': 'bg-tag-stone-bg text-tag-stone-text border-tag-stone-border',
};

interface JobCardProps { 
  job: Job;
  isMismatch?: boolean;
  isTimeMismatch?: boolean;
  onDragStart?: (job: Job) => void;
  onDragEnd?: () => void;
  onUnassign?: (jobId: string) => void;
  // FIX: Update prop type to match context, allowing 'originalTimeframe' updates and fixing type inconsistencies.
  onUpdateJob?: (jobId: string, updatedDetails: Partial<Pick<Job, 'customerName' | 'address' | 'notes' | 'originalTimeframe'>>) => void;
  onRemove?: (jobId: string) => void;
  isCompact?: boolean;
  isDraggable?: boolean;
}

export const JobCard: React.FC<JobCardProps> = ({ 
    job, isMismatch, isTimeMismatch, onDragStart, onDragEnd, onUnassign, onUpdateJob, onRemove, isCompact = false, isDraggable = true
}) => {
    const { setHoveredJobId, roofrJobIdMap } = useAppContext();
    const [isEditing, setIsEditing] = useState(false);
    const [customerName, setCustomerName] = useState(job.customerName);
    const [address, setAddress] = useState(job.address);
    const [notes, setNotes] = useState(job.notes);

    useEffect(() => {
        setCustomerName(job.customerName);
        setAddress(job.address);
        setNotes(job.notes);
    }, [job]);

    const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
        if (isEditing || !isDraggable) {
            e.preventDefault();
            return;
        }
        e.dataTransfer.setData('jobId', job.id);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart?.(job);
    }
    
    const handleSave = (e: React.MouseEvent) => {
        e.stopPropagation();
        onUpdateJob?.(job.id, { customerName, address, notes });
        setIsEditing(false);
    };

    const handleCancel = (e: React.MouseEvent) => {
        e.stopPropagation();
        setCustomerName(job.customerName);
        setAddress(job.address);
        setNotes(job.notes);
        setIsEditing(false);
    };

    const handleRemove = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (window.confirm(`Are you sure you want to permanently remove this job?\n\n${job.address}`)) {
            onRemove?.(job.id);
        }
    };

    const allTags = useMemo(() => {
        if (!job.notes) return [];
        const notesLower = job.notes.toLowerCase();
        
        const ageMatch = job.notes.match(/\b(\d+)\s*yrs\b/i);
        const ageTag = ageMatch ? [{ type: 'yrs', value: `${ageMatch[1]}yrs`, classes: TAG_CLASSES['yrs'] }] : [];

        const roofTags = TAG_KEYWORDS.filter(keyword => new RegExp(`\\b${keyword.toLowerCase()}\\b`).test(notesLower))
            .map(tag => ({ type: 'roof', value: tag, classes: TAG_CLASSES[tag] }));

        const sqftMatch = job.notes.match(/\b(\d+)\s*sq\.?\b/i);
        const sqftTag = sqftMatch ? [{ type: 'sqft', value: `${sqftMatch[1]} sqft`, classes: TAG_CLASSES['sqft'] }] : [];

        const storiesMatch = job.notes.match(/\b(\d)S\b/i);
        const storiesTag = storiesMatch ? [{ type: 'stories', value: `${storiesMatch[1]} Story`, classes: TAG_CLASSES['stories'] }] : [];
        
        return [...ageTag, ...roofTags, ...sqftTag, ...storiesTag];
    }, [job.notes]);

  const isReschedule = useMemo(() => job.notes.includes('Recommended Reschedule'), [job.notes]);
  const { isPriority, priorityReason } = useMemo(() => {
    const isPrio = job.notes.includes('#');
    if (!isPrio) return { isPriority: false, priorityReason: '' };
    const match = job.notes.match(/#\s*\(([^)]+)\)/);
    return { isPriority: true, priorityReason: match ? match[1] : 'Priority Job' };
  }, [job.notes]);
  const isActuallyMismatched = isMismatch || isTimeMismatch;

  const displayJob = job as DisplayJob;
  const assignmentScore = displayJob.assignmentScore;
  const isEliteMatch = typeof assignmentScore === 'number' && assignmentScore >= 90;

  const handleCardClick = (e: React.MouseEvent<HTMLDivElement>) => {
      if (isEditing) return;
      if (isCompact && !isEditing) {
          setIsEditing(true); // In compact lists like Needs Details, click often implies desire to edit
      }
  };
  
  const cardClasses = useMemo(() => {
    const base = "border rounded-lg shadow-sm transition-all duration-200 relative group overflow-hidden";
    let stateClasses = '';

    if (isEditing) {
        stateClasses = "ring-2 ring-brand-primary bg-brand-bg-light/50 p-2";
    } else if (isDraggable) {
        stateClasses = "cursor-grab active:cursor-grabbing";
    } else {
        stateClasses = "cursor-pointer"; // Indicate clickable
    }

    let colorClasses = '';
    if (isEliteMatch && !isEditing) {
        colorClasses = "bg-gradient-to-br from-primary to-tag-amber-bg border-tag-amber-border shadow-md ring-1 ring-tag-amber-border/50"; 
    } else if (isPriority && !isEditing) {
        colorClasses = "bg-tag-amber-bg border-tag-amber-border hover:shadow-md";
    } else if (isActuallyMismatched && !isEditing) {
        colorClasses = "bg-tag-red-bg border-tag-red-border hover:shadow-md";
    } else if (isReschedule && !isEditing) {
        colorClasses = "bg-tag-blue-bg border-tag-blue-border hover:shadow-md";
    } else if (!isEditing) {
        colorClasses = "bg-primary border-border-primary hover:shadow-md";
    }
    
    return `${base} ${stateClasses} ${colorClasses}`;
  }, [isActuallyMismatched, isPriority, isReschedule, isEditing, isDraggable, isEliteMatch]);

  const googleMapsUrl = useMemo(() => {
    const addressParts = [job.address, job.city, job.zipCode].filter(Boolean);
    if (addressParts.length === 0) return '#';
    const query = encodeURIComponent(addressParts.join(', '));
    return `https://www.google.com/maps/search/?api=1&query=${query}`;
  }, [job.address, job.city, job.zipCode]);

  const roofrUrl = useMemo(() => {
    if (!job.address || !roofrJobIdMap || roofrJobIdMap.size === 0) return null;
    const normalizedAddress = normalizeAddressForMatching(job.address);
    if (normalizedAddress) {
        const jobId = roofrJobIdMap.get(normalizedAddress);
        if (jobId) {
            return `https://app.roofr.com/dashboard/team/239329/jobs/list-view?selectedJobId=${jobId}`;
        }
    }
    return null;
  }, [job.address, roofrJobIdMap]);


  let mismatchTitle = '';
  if (isMismatch) {
      mismatchTitle = "Schedule Mismatch: Rep is unavailable during this time.";
  } else if (isTimeMismatch) {
      mismatchTitle = `Time Mismatch: Job's original schedule was ${job.originalTimeframe}.`;
  } else if (isReschedule) {
      mismatchTitle = job.notes; 
  }

  const getScoreTooltip = (job: DisplayJob) => {
      if (!job.scoreBreakdown) return "Assignment Score calculated based on proximity, skills, and rep performance.";
      const b = job.scoreBreakdown;
      const penaltyVal = Math.abs(Math.round(b.penalty));
      return `Assignment Score: ${job.assignmentScore} / 100 ${isEliteMatch ? '🏆 ELITE MATCH' : ''}

SCORING BREAKDOWN:
------------------
• Job Cluster (${Math.round(b.distanceCluster)}): Proximity to other jobs in today's route.
• Roofing Skill (${Math.round(b.skillRoofing)}): Match for specific roof type (Tile, Flat, etc).
${b.skillType >= 0 ? `• Job Type (${Math.round(b.skillType)}): Match for Insurance vs Commercial.` : ''}
• Home Base (${Math.round(b.distanceBase)}): Proximity to rep's home zip code.
${b.performance > 0 ? `• Sales Rank (${Math.round(b.performance)}): Weighted High for Priority Jobs.` : ''}
${penaltyVal > 0 ? `• PENALTY (-${penaltyVal}): Deducted for scheduling conflicts.` : ''}`;
  };

  // Action Button Component
  const ActionBtn = ({ onClick, icon: Icon, label, title }: { onClick?: (e: React.MouseEvent) => void, icon: any, label: string, title?: string }) => (
      <button 
        type="button" 
        onClick={onClick} 
        className="flex items-center space-x-1 bg-primary border border-border-secondary hover:bg-tertiary hover:border-border-tertiary text-text-tertiary px-1.5 py-0.5 rounded shadow-sm transition-all text-[9px] font-semibold leading-none whitespace-nowrap h-5"
        title={title}
      >
          <Icon className="h-3 w-3" />
          <span className="inline">{label}</span>
      </button>
  );

  const MapsLink = () => (
      <a 
        href={googleMapsUrl} 
        target="_blank" 
        rel="noopener noreferrer" 
        onClick={(e) => e.stopPropagation()} 
        className="flex items-center space-x-1 bg-primary border border-border-secondary hover:bg-tertiary hover:border-border-tertiary text-text-tertiary px-1.5 py-0.5 rounded shadow-sm transition-all text-[9px] font-semibold leading-none whitespace-nowrap h-5 decoration-0"
        title="Open in Google Maps"
      >
          <MapPinIcon className="h-3 w-3" />
          <span className="inline">Maps</span>
      </a>
  );
  
  const RoofrLink = () => (
      <a 
        href={roofrUrl!} 
        target="_blank" 
        rel="noopener noreferrer" 
        onClick={(e) => e.stopPropagation()} 
        className="flex items-center space-x-1 bg-primary border border-border-secondary hover:bg-tertiary hover:border-border-tertiary text-text-tertiary px-1.5 py-0.5 rounded shadow-sm transition-all text-[9px] font-semibold leading-none whitespace-nowrap h-5 decoration-0"
        title="Open in Roofr"
      >
          <ExternalLinkIcon className="h-3 w-3" />
          <span className="inline">Roofr</span>
      </a>
  );


  if (isEditing) {
      return (
        <div className={cardClasses} onClick={(e) => e.stopPropagation()}>
            <div className="flex flex-col space-y-2">
            <div>
                <label className="text-xs font-bold text-text-tertiary">City / Cust.</label>
                <input value={customerName} onChange={e => setCustomerName(e.target.value)} className="w-full p-1 border bg-secondary border-primary rounded-md text-sm text-primary placeholder:text-secondary hover:bg-tertiary focus:ring-2 focus:ring-brand-primary focus:outline-none" autoFocus />
            </div>
            <div>
                <label className="text-xs font-bold text-text-tertiary">Address</label>
                <textarea value={address} onChange={e => setAddress(e.target.value)} className="w-full p-1 border bg-secondary border-primary rounded-md text-sm text-primary placeholder:text-secondary hover:bg-tertiary focus:ring-2 focus:ring-brand-primary focus:outline-none" rows={2} />
            </div>
            <div>
                <label className="text-xs font-bold text-text-tertiary">Notes</label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} className="w-full p-1 border bg-secondary border-primary rounded-md text-sm text-primary placeholder:text-secondary hover:bg-tertiary focus:ring-2 focus:ring-brand-primary focus:outline-none" rows={3} />
            </div>
            <div className="mt-1 pt-1 border-t border-border-primary/50 flex items-center justify-between">
                {onRemove && (
                    <button type="button" onClick={handleRemove} className="flex items-center space-x-0.5 px-2 py-1 text-[10px] border rounded-md text-tag-red-text bg-primary hover:bg-tag-red-bg transition" title="Remove Job Permanently">
                    <TrashIcon className="h-3 w-3" />
                    <span>Del</span>
                    </button>
                )}
                <div className="flex items-center space-x-1">
                    <button onClick={handleCancel} className="flex items-center space-x-0.5 px-2 py-1 text-[10px] border rounded-md text-text-tertiary bg-primary hover:bg-tertiary transition" title="Cancel">
                    <XIcon className="h-3 w-3" />
                    <span>Cancel</span>
                    </button>
                    <button onClick={handleSave} className="flex items-center space-x-0.5 px-2 py-1 text-[10px] border rounded-md text-brand-text-on-primary bg-tag-green-bg text-tag-green-text hover:bg-tag-green-bg/80 transition" title="Save Changes">
                    <SaveIcon className="h-3 w-3" />
                    <span>Save</span>
                    </button>
                </div>
            </div>
            </div>
        </div>
      )
  }

  // Display Logic for Time Slot
  const displayTimeLabel = displayJob.timeSlotLabel || job.originalTimeframe || 'Anytime';
  const shortTimeLabel = displayTimeLabel.split(' ')[0]; // Gets "7:30am" from "7:30am - 9:00am"
  
  // Check if we should show the original request (if optimized and different)
  const showOriginalTime = job.originalTimeframe && displayJob.timeSlotLabel && job.originalTimeframe !== displayJob.timeSlotLabel;
  const formattedOriginalTime = job.originalTimeframe ? job.originalTimeframe.replace(/\s/g, '').replace(/am/gi, 'a').replace(/pm/gi, 'p') : '';

  return (
    <div
      draggable={isDraggable}
      onDragStart={handleDragStart}
      onDragEnd={onDragEnd}
      onClick={handleCardClick}
      onMouseEnter={() => setHoveredJobId(job.id)}
      onMouseLeave={() => setHoveredJobId(null)}
      className={cardClasses}
      title={mismatchTitle}
    >
        {/* Header: City & Status */}
        <div className={`px-2 pt-1.5 pb-1 flex justify-between items-start ${isCompact ? 'flex-col gap-1' : ''}`}>
            <div className="min-w-0 flex-1 mr-2">
                <h3 className="font-extrabold text-xs uppercase tracking-tight text-text-primary truncate leading-tight">
                    {job.city || 'Unknown City'}
                </h3>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
                {isPriority && <StarIcon className="h-3.5 w-3.5 text-tag-amber-text drop-shadow-sm" />}
                
                {showOriginalTime && (
                    <span className="text-[9px] text-text-quaternary font-mono mr-0.5 hidden sm:inline-block bg-tertiary px-1 rounded border border-border-primary" title={`Original Request: ${job.originalTimeframe}`}>
                        Req:{formattedOriginalTime}
                    </span>
                )}

                <span className={`text-[10px] font-bold px-1.5 rounded-full border ${
                    displayTimeLabel !== 'Anytime' ? 'bg-primary/80 border-border-primary text-secondary shadow-sm' : 'bg-tertiary text-text-tertiary border-transparent'
                }`}>
                    {/* Use full label if it's a specific generated slot (contains hyphen), else short */}
                    {displayTimeLabel.includes('-') && displayTimeLabel.length < 20 ? displayTimeLabel : shortTimeLabel}
                </span>
            </div>
        </div>

        {/* Middle: Tags & Actions Grid */}
        <div className="px-2 py-1 grid grid-cols-1 gap-1.5">
            {/* Tags */}
            {allTags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                    {allTags.map((tag, idx) => (
                        <span key={`${tag.value}-${idx}`} className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border whitespace-nowrap ${tag.classes}`}>
                            {tag.value}
                        </span>
                    ))}
                </div>
            )}
            
            {/* Action Bar */}
            <div className="flex items-center justify-end gap-1 mt-0.5">
                {typeof assignmentScore === 'number' && !isCompact && (
                    <span 
                        className={`mr-auto text-[9px] font-bold px-1.5 py-0.5 rounded border cursor-help flex items-center gap-0.5
                            ${isEliteMatch 
                                ? 'text-tag-amber-text bg-tag-amber-bg border-tag-amber-border shadow-sm ring-1 ring-tag-amber-border/30' 
                                : 'text-text-tertiary bg-tertiary border-border-primary'
                            }`} 
                        title={getScoreTooltip(displayJob)}
                    >
                        {isEliteMatch && <TrophyIcon className="h-2.5 w-2.5 text-tag-amber-text" />}
                        {assignmentScore}
                    </span>
                )}
                
                {!isCompact ? (
                    <>
                        {roofrUrl && <RoofrLink />}
                        <MapsLink />
                        {onUnassign && (
                            <ActionBtn 
                                onClick={(e) => { e.stopPropagation(); onUnassign(job.id); }} 
                                icon={UnassignJobIcon} 
                                label="Unassign" 
                            />
                        )}
                        {onUpdateJob && (
                            <ActionBtn 
                                onClick={(e) => { e.stopPropagation(); setIsEditing(true); }} 
                                icon={EditIcon} 
                                label="Edit" 
                            />
                        )}
                    </>
                ) : (
                    <div className="w-full flex justify-between items-center">
                         <span className="text-[9px] text-brand-text-light font-semibold italic">Click card to edit</span>
                         <div className="flex items-center gap-1">
                            {roofrUrl && <RoofrLink />}
                            <MapsLink />
                         </div>
                    </div>
                )}
            </div>
        </div>

        {/* Footer: Address */}
        <div className="px-2 pb-1.5 pt-1 mt-0.5 border-t border-black/5">
            <p className="text-[10px] text-text-tertiary truncate font-medium leading-tight" title={job.address}>
                {job.address}
            </p>
        </div>
    </div>
  );
};