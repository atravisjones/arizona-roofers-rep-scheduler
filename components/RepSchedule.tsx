import React, { useMemo, useState, useRef, useEffect } from 'react';
import { Rep, Job, DisplayJob } from '../types';
import { ChevronDownIcon, ChevronUpIcon, PinIcon, ClipboardIcon, LockIcon, UnlockIcon, AutoAssignIcon, SwapIcon, OptimizeIcon, UndoIcon, SettingsIcon, TrophyIcon, XIcon, MenuIcon, MessageIcon } from './icons';
import { JobCard } from './JobCard';
import { SwapScheduleModal } from './SwapScheduleModal';
import { TAG_KEYWORDS, TIME_SLOT_DISPLAY_LABELS } from '../constants';
import { useAppContext } from '../context/AppContext';
import { mapTimeframeToSlotId } from '../services/geminiService';
import { parseTimeRange, doTimesOverlap } from '../utils/timeUtils';

// Helper to check if a rep is London Smith (case-insensitive)
const isLondon = (rep: Rep) => rep.name.trim().toLowerCase().startsWith('london smith');

interface RepScheduleProps {
    rep: Rep;
    onJobDrop: (jobId: string, target: { repId: string, slotId: string }, e: React.DragEvent<HTMLDivElement>) => void;
    onUnassign: (jobId: string) => void;
    onToggleLock: (repId: string) => void;
    onUpdateJob: (jobId: string, updatedDetails: Partial<Pick<Job, 'customerName' | 'address' | 'notes' | 'originalTimeframe'>>) => void;
    onRemoveJob: (jobId: string) => void;
    isSelected: boolean;
    onSelectRep: (e: React.MouseEvent) => void;
    selectedDay: string;
    isExpanded: boolean;
    onToggleExpansion: () => void;
    draggedOverRepId: string | null;
    onSetDraggedOverRepId: (id: string | null) => void;
    onJobDragStart: (job: Job) => void;
    onJobDragEnd: () => void;
    draggedJob: Job | null;
    isInvalidDropTarget?: boolean;
    invalidReason?: string;
    isOverrideActive?: boolean;
    isHighlighted?: boolean;
    selectedRepName?: string;
    isUnavailableForSlot?: boolean;
}

interface DropZoneProps {
    repId: string;
    slotId: string;
    onJobDrop: (jobId: string, target: { repId: string, slotId: string }, e: React.DragEvent<HTMLDivElement>) => void;
    label: string;
    isUnavailable: boolean;
    onJobDragStart: (job: Job) => void;
    onJobDragEnd: () => void;
    draggedJob: Job | null;
    jobs: Job[];
    onUnassign: (jobId: string) => void;
    // FIX: Update prop type to match context, allowing 'originalTimeframe' updates and fixing type inconsistencies.
    onUpdateJob: (jobId: string, updatedDetails: Partial<Pick<Job, 'customerName' | 'address' | 'notes' | 'originalTimeframe'>>) => void;
    onRemoveJob: (jobId: string) => void;
    isOptimized?: boolean;
}

const checkTimeMismatch = (originalTimeframe: string | undefined, slotLabel: string): boolean => {
    if (!originalTimeframe) {
        return false;
    }
    const getStartHour = (timeString: string): number | null => {
        const match = timeString.match(/^(\d{1,2})/);
        return match ? parseInt(match[1], 10) : null;
    };
    const jobStartHour = getStartHour(originalTimeframe);
    const slotStartHour = getStartHour(slotLabel);
    return jobStartHour !== null && slotStartHour !== null && jobStartHour !== slotStartHour;
};

const DropZone: React.FC<DropZoneProps> = ({ repId, slotId, onJobDrop, label, isUnavailable, onJobDragStart, onJobDragEnd, draggedJob, jobs, onUnassign, onUpdateJob, onRemoveJob, isOptimized }) => {
    const [isOver, setIsOver] = React.useState(false);
    // Use display label (shorter time range) for UI
    const displayLabel = TIME_SLOT_DISPLAY_LABELS[slotId] || label;

    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        if (!isOptimized) {
            setIsOver(true);
        } else {
            e.dataTransfer.dropEffect = 'none';
        }
    };

    const handleDragLeave = () => {
        setIsOver(false);
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        if (isOptimized) return;
        setIsOver(false);
        const jobId = draggedJob?.id;
        if (jobId) {
            onJobDrop(jobId, { repId, slotId }, e);
        }
    };

    const hasJobs = jobs.length > 0;
    const isDoubleBooked = jobs.length > 1;

    if (isUnavailable) {
        return (
            <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`mt-0.5 flex flex-col px-1.5 py-0.5 rounded-lg bg-bg-tertiary border-2 border-dashed transition-colors min-w-0 ${isOver ? 'border-tag-red-border bg-tag-red-bg' : hasJobs ? 'border-tag-red-border bg-tag-red-bg/50' : 'border-border-secondary'}`}>
                <div className="mb-0.5">
                    <h4 className={`font-bold text-[11px] uppercase ${isDoubleBooked ? 'text-tag-red-text' : hasJobs ? 'text-tag-red-text' : 'text-text-quaternary'}`}>
                        {displayLabel} <span className="font-normal text-text-quaternary ml-1">(Unavailable)</span>
                        {hasJobs && <span className="ml-1 font-bold text-tag-red-text text-[10px]">! Mismatch</span>}
                    </h4>
                </div>
                <div className={`flex-1 min-w-0 min-h-[20px] ${isDoubleBooked ? 'grid grid-cols-2 gap-1' : 'space-y-0.5'}`}>
                    {jobs.map(job => {
                        const isTimeMismatch = checkTimeMismatch(job.originalTimeframe, label);
                        return <JobCard
                            key={job.id}
                            job={job}
                            isMismatch={true}
                            isTimeMismatch={isTimeMismatch}
                            onDragStart={onJobDragStart}
                            onDragEnd={onJobDragEnd}
                            onUnassign={onUnassign}
                            onUpdateJob={onUpdateJob}
                            onRemove={onRemoveJob}
                            isCompact={isDoubleBooked}
                        />;
                    })}
                </div>
            </div>
        );
    }

    return (
        <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`mt-0.5 flex flex-col px-1.5 py-0.5 rounded-lg border-2 border-dashed transition-colors min-w-0 ${isOver ? 'border-brand-primary bg-brand-bg-light' : 'border-border-secondary'}`}
        >
            <div className="mb-0.5 flex justify-between items-center">
                <h4 className={`font-bold text-[11px] uppercase tracking-wide ${isDoubleBooked ? 'text-tag-red-text' : 'text-text-tertiary'}`}>{displayLabel}</h4>
                {hasJobs && isDoubleBooked && <span className="text-[9px] bg-tag-red-bg text-tag-red-text px-1.5 rounded font-bold">Double Booked</span>}
            </div>

            <div className={`flex-1 min-w-0 min-h-[28px] ${isDoubleBooked ? 'grid grid-cols-1 sm:grid-cols-2 gap-1' : hasJobs ? 'space-y-1' : 'flex flex-col items-center justify-center'}`}>
                {jobs.map(job => {
                    const isTimeMismatch = checkTimeMismatch(job.originalTimeframe, label);
                    return <JobCard
                        key={job.id}
                        job={job}
                        isMismatch={false}
                        isTimeMismatch={isTimeMismatch}
                        onDragStart={onJobDragStart}
                        onDragEnd={onJobDragEnd}
                        onUnassign={onUnassign}
                        onUpdateJob={onUpdateJob}
                        onRemove={onRemoveJob}
                        isCompact={isDoubleBooked}
                    />;
                })}
                {jobs.length === 0 && !isOptimized && <div className="text-[11px] text-text-quaternary font-medium select-none">Drop job here</div>}
            </div>
        </div>
    );
};

const renderStars = (level?: number) => {
    const totalStars = 3;
    const filledStars = level && level > 0 ? level : 0;
    const emptyStars = totalStars - filledStars;

    return (
        <div className="flex text-[10px] tracking-tighter">
            {[...Array(filledStars)].map((_, i) => <span key={`filled-${i}`} className="text-tag-amber-text">★</span>)}
            {[...Array(emptyStars)].map((_, i) => <span key={`empty-${i}`} className="text-border-primary">☆</span>)}
        </div>
    );
};

const REGION_CLASSES: Record<string, string> = {
    'PHX': 'bg-tag-blue-bg text-tag-blue-text border-tag-blue-border',
    'NORTH': 'bg-tag-green-bg text-tag-green-text border-tag-green-border',
    'SOUTH': 'bg-tag-orange-bg text-tag-orange-text border-tag-orange-border',
    'UNKNOWN': 'bg-bg-tertiary text-text-secondary border-border-primary'
};

const generateColorFromName = (name: string): string => {
    let hash = 0;
    if (name.length === 0) return 'hsl(0, 0%, 80%)';
    for (let i = 0; i < name.length; i++) {
        const char = name.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    const hue = Math.abs(hash % 360);
    return `hsl(${hue}, 65 %, 75 %)`;
};

interface ScoreDetailsModalProps {
    isOpen: boolean;
    onClose: () => void;
    repName: string;
    averageScore: number;
    jobs: DisplayJob[];
}

const ScoreDetailsModal: React.FC<ScoreDetailsModalProps> = ({ isOpen, onClose, repName, averageScore, jobs }) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-bg-secondary/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4" onClick={onClose}>
            <div className="popup-surface w-full max-w-lg overflow-hidden animate-fade-in" onClick={e => e.stopPropagation()}>
                <div className="bg-bg-secondary px-4 py-3 border-b border-border-primary flex justify-between items-center">
                    <div>
                        <h3 className="font-bold text-text-primary text-sm">{repName} - Performance Breakdown</h3>
                        <div className="text-xs text-text-tertiary flex items-center gap-1 mt-0.5">
                            Daily Average Score: <span className="font-bold text-tag-amber-text bg-tag-amber-bg px-1.5 rounded border border-tag-amber-border">{averageScore}</span>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-text-quaternary hover:text-text-secondary p-1 rounded-full hover:bg-bg-tertiary transition"><XIcon className="h-5 w-5" /></button>
                </div>
                <div className="p-4 max-h-[60vh] overflow-y-auto custom-scrollbar space-y-3">
                    <div className="text-[10px] bg-tag-blue-bg border border-tag-blue-border rounded p-2 text-tag-blue-text">
                        Priority: <span className="font-bold">1.</span> Timeframe Match, <span className="font-bold">2.</span> Sales Rank (# leads), <span className="font-bold">3.</span> Skills (Roof & Type), <span className="font-bold">4.</span> Distance (Cluster & Home)
                    </div>
                    {jobs.map(job => {
                        const b = job.scoreBreakdown || { timeframeMatch: 0, distanceBase: 0, distanceCluster: 0, skillRoofing: 0, skillType: 0, performance: 0, penalty: 0 };
                        const isElite = typeof job.assignmentScore === 'number' && job.assignmentScore >= 90;
                        const penaltyVal = Math.abs(Math.round(b.penalty));
                        const showTypeScore = b.skillType >= 0; // If -1, hide it
                        const hasTimeframeMatch = b.timeframeMatch > 0;

                        return (
                            <div key={job.id} className={`border rounded-md p-2 text-sm shadow-sm ${isElite ? 'bg-tag-amber-bg/30 border-tag-amber-border' : 'bg-bg-primary border-border-primary'}`}>
                                <div className="flex justify-between items-start mb-2">
                                    <div className="min-w-0 pr-2">
                                        <div className="font-bold text-text-primary text-xs uppercase truncate">{job.city || 'Unknown City'}</div>
                                        <div className="text-xs text-text-tertiary truncate">{job.address}</div>
                                    </div>
                                    <div className={`font-bold px-1.5 py-0.5 rounded border whitespace-nowrap text-xs flex-shrink-0 ${isElite ? 'bg-tag-amber-bg text-tag-amber-text border-tag-amber-border' : 'bg-bg-tertiary text-text-secondary border-border-primary'}`}>
                                        {job.assignmentScore || 0}
                                    </div>
                                </div>
                                <div className="grid grid-cols-7 gap-1 text-[10px] text-text-tertiary mt-2">
                                    {/* Priority 1: Timeframe Match (HIGHEST) */}
                                    <div className={`rounded px-1 py-1 text-center border ${hasTimeframeMatch ? 'bg-tag-green-bg border-tag-green-border' : 'bg-bg-secondary border-border-primary opacity-50'}`}>
                                        <div className={`font-bold text-xs ${hasTimeframeMatch ? 'text-tag-green-text' : 'text-text-quaternary'}`}>{hasTimeframeMatch ? Math.round(b.timeframeMatch) : '-'}</div>
                                        <div className="text-[8px] uppercase tracking-wide">Time</div>
                                    </div>
                                    {/* Priority 2: Sales Rank (HIGH) */}
                                    <div className={`rounded px-1 py-1 text-center border ${b.performance > 0 ? 'bg-tag-amber-bg border-tag-amber-border' : 'bg-bg-secondary border-border-primary opacity-50'}`}>
                                        <div className={`font-bold text-xs ${b.performance > 0 ? 'text-tag-amber-text' : 'text-text-quaternary'}`}>{b.performance > 0 ? `${Math.round(b.performance)}` : '-'}</div>
                                        <div className="text-[8px] uppercase tracking-wide">Rank</div>
                                    </div>
                                    {/* Priority 3: Skills (MEDIUM) */}
                                    <div className="bg-bg-secondary rounded px-1 py-1 text-center border border-border-primary">
                                        <div className="font-bold text-text-primary text-xs">{Math.round(b.skillRoofing)}</div>
                                        <div className="text-[8px] uppercase tracking-wide">Roof</div>
                                    </div>
                                    {showTypeScore ? (
                                        <div className="bg-bg-secondary rounded px-1 py-1 text-center border border-border-primary">
                                            <div className="font-bold text-text-primary text-xs">{Math.round(b.skillType)}</div>
                                            <div className="text-[8px] uppercase tracking-wide">Type</div>
                                        </div>
                                    ) : (
                                        <div className="rounded px-1 py-1 text-center border border-transparent opacity-25">
                                            <div className="text-xs">-</div>
                                            <div className="text-[8px] uppercase tracking-wide">Type</div>
                                        </div>
                                    )}
                                    {/* Priority 4: Distance (LOWEST) */}
                                    <div className="bg-bg-secondary rounded px-1 py-1 text-center border border-border-primary">
                                        <div className="font-bold text-text-primary text-xs">{Math.round(b.distanceCluster)}</div>
                                        <div className="text-[8px] uppercase tracking-wide">Clust</div>
                                    </div>
                                    <div className="bg-bg-secondary rounded px-1 py-1 text-center border border-border-primary">
                                        <div className="font-bold text-text-primary text-xs">{Math.round(b.distanceBase)}</div>
                                        <div className="text-[8px] uppercase tracking-wide">Home</div>
                                    </div>
                                    {/* Penalty */}
                                    <div className={`rounded px-1 py-1 text-center border ${penaltyVal > 0 ? 'bg-tag-red-bg border-tag-red-border' : 'bg-bg-secondary border-border-primary opacity-50'}`}>
                                        <div className={`font-bold text-xs ${penaltyVal > 0 ? 'text-tag-red-text' : 'text-text-quaternary'}`}>{penaltyVal > 0 ? `-${penaltyVal}` : '-'}</div>
                                        <div className="text-[8px] uppercase tracking-wide">Pen</div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                    {jobs.length === 0 && <p className="text-text-tertiary text-center italic text-xs">No scored jobs assigned.</p>}
                </div>
            </div>
        </div>
    );
};


const RepSchedule: React.FC<RepScheduleProps> = ({ rep, onJobDrop, onUnassign, onToggleLock, onUpdateJob, onRemoveJob, isSelected, onSelectRep, selectedDay, isExpanded, onToggleExpansion, draggedOverRepId, onSetDraggedOverRepId, onJobDragStart, onJobDragEnd, draggedJob, isInvalidDropTarget = false, invalidReason = '', isOverrideActive = false, isHighlighted = false, selectedRepName, isUnavailableForSlot = false }) => {
    const { appState, isAutoAssigning, isAiAssigning, isParsing, handleAutoAssignForRep, handleOptimizeRepRoute, handleUnoptimizeRepRoute, handleSwapSchedules, handleShowZipOnMap, setRepSettingsModalRepId, selectedDate, setHoveredRepId } = useAppContext();
    const [isSwapModalOpen, setIsSwapModalOpen] = useState(false);
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const swapMenuRef = useRef<HTMLDivElement>(null);
    const [isScoreDetailsOpen, setIsScoreDetailsOpen] = useState(false);
    const [copySuccess, setCopySuccess] = useState(false);

    const hasUnassignedJobs = appState.unassignedJobs.length > 0;
    const isAssignmentRunning = isAutoAssigning || isAiAssigning || isParsing;

    // Determine if this rep should be dimmed based on rep filter
    const isDimmed = selectedRepName && !rep.name.toLowerCase().includes(selectedRepName.toLowerCase());

    const unavailableSlotIdsForToday = useMemo(() => new Set(rep.unavailableSlots?.[selectedDay] || []), [rep.unavailableSlots, selectedDay]);

    const jobCount = useMemo(() => rep.schedule.flatMap(s => s.jobs).length, [rep.schedule]);
    const isFullyUnavailable = useMemo(() => unavailableSlotIdsForToday.size === 4 && !rep.isOptimized, [unavailableSlotIdsForToday, rep.isOptimized]);
    const isNotWorking = isFullyUnavailable && jobCount === 0;

    const wasHoverExpanded = useRef(false);
    const expansionTimer = useRef<number | null>(null);

    const assignedCities = useMemo(() => {
        const cities = new Set<string>();
        rep.schedule.forEach(slot => {
            slot.jobs.forEach(job => {
                if (job.city) {
                    cities.add(job.city);
                }
            });
        });
        return Array.from(cities).sort();
    }, [rep.schedule]);

    const { averageScore, averageBreakdown, scoredJobs } = useMemo(() => {
        const jobs = rep.schedule.flatMap(s => s.jobs);
        const scored = jobs.filter(j => typeof j.assignmentScore === 'number');
        if (scored.length === 0) return { averageScore: 0, averageBreakdown: null, scoredJobs: [] };

        const totalScore = scored.reduce((sum, j) => sum + (j.assignmentScore || 0), 0);

        const totalBreakdown = scored.reduce((acc, j) => {
            const b = j.scoreBreakdown || { distanceBase: 0, distanceCluster: 0, skillRoofing: 0, skillType: 0, performance: 0, penalty: 0 };
            return {
                distanceBase: acc.distanceBase + b.distanceBase,
                distanceCluster: acc.distanceCluster + b.distanceCluster,
                skillRoofing: acc.skillRoofing + b.skillRoofing,
                skillType: acc.skillType + b.skillType,
                performance: acc.performance + b.performance,
                penalty: acc.penalty + b.penalty
            };
        }, { distanceBase: 0, distanceCluster: 0, skillRoofing: 0, skillType: 0, performance: 0, penalty: 0 });

        return {
            averageScore: Math.round(totalScore / scored.length),
            averageBreakdown: {
                distanceBase: Math.round(totalBreakdown.distanceBase / scored.length),
                distanceCluster: Math.round(totalBreakdown.distanceCluster / scored.length),
                skillRoofing: Math.round(totalBreakdown.skillRoofing / scored.length),
                skillType: Math.round(totalBreakdown.skillType / scored.length),
                performance: Math.round(totalBreakdown.performance / scored.length),
                penalty: Math.round(totalBreakdown.penalty / scored.length)
            },
            scoredJobs: scored
        };
    }, [rep.schedule]);

    const scoreTooltip = useMemo(() => {
        if (!averageBreakdown) return `Daily Average Score: ${averageScore} \n\n(No scored jobs)`;
        return `Daily Average Score: ${averageScore} \n\nAverage Breakdown: \n• Home Dist: ${averageBreakdown.distanceBase} \n• Cluster Dist: ${averageBreakdown.distanceCluster} \n• Roof Skill: ${averageBreakdown.skillRoofing} \n${averageBreakdown.skillType >= 0 ? `• Type Skill: ${averageBreakdown.skillType}\n` : ''}• Rank Bonus: ${averageBreakdown.performance} \n• Penalties: -${Math.abs(averageBreakdown.penalty)} \n\nClick to see details per job.`;
    }, [averageScore, averageBreakdown]);

    const googleMapsUrl = useMemo(() => {
        const addresses = rep.schedule
            .flatMap(slot => slot.jobs)
            .map(job => job.address);

        if (addresses.length === 0) return '#';

        const encoded = addresses.map(addr => encodeURIComponent(addr));

        // Add Home Base to start/end if available
        if (rep.zipCodes && rep.zipCodes.length > 0) {
            const homeAddr = encodeURIComponent(`${rep.zipCodes[0]}, Arizona`);
            encoded.unshift(homeAddr);
            encoded.push(homeAddr);
        }

        return `https://www.google.com/maps/dir/${encoded.join('/')}`;
    }, [rep.schedule, rep.zipCodes]);

    const handleInternalDrop = (jobId: string, target: { repId: string, slotId: string }, e: React.DragEvent<HTMLDivElement>) => {
        wasHoverExpanded.current = false;
        onJobDrop(jobId, target, e);
    };

    const handleContainerDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();

        if (!draggedJob) return;
        if (rep.isOptimized) return;

        let targetSlotId = rep.schedule[0].id;

        if (draggedJob.originalTimeframe) {
            const mapped = mapTimeframeToSlotId(draggedJob.originalTimeframe);
            if (mapped) targetSlotId = mapped;
        } else {
            const openSlot = rep.schedule.find(s => !unavailableSlotIdsForToday.has(s.id) && s.jobs.length === 0);
            if (openSlot) targetSlotId = openSlot.id;
        }

        onJobDrop(draggedJob.id, { repId: rep.id, slotId: targetSlotId }, e);
        wasHoverExpanded.current = false;
    };

    useEffect(() => {
        const isBeingHovered = draggedOverRepId === rep.id;
        if (expansionTimer.current) { clearTimeout(expansionTimer.current); expansionTimer.current = null; }
        if (isBeingHovered && !isExpanded) {
            expansionTimer.current = window.setTimeout(() => { onToggleExpansion(); wasHoverExpanded.current = true; }, 300);
        } else if (!isBeingHovered && isExpanded && wasHoverExpanded.current) {
            onToggleExpansion(); wasHoverExpanded.current = false;
        }
        return () => { if (expansionTimer.current) clearTimeout(expansionTimer.current); };
    }, [draggedOverRepId, rep.id, isExpanded, onToggleExpansion]);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) { setIsMenuOpen(false); }
        }
        if (isMenuOpen) { document.addEventListener("mousedown", handleClickOutside); }
        return () => { document.removeEventListener("mousedown", handleClickOutside); };
    }, [isMenuOpen]);

    useEffect(() => { if (!isExpanded) { wasHoverExpanded.current = false; } }, [isExpanded]);

    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        if ((isInvalidDropTarget || rep.isLocked || rep.isOptimized) && !isOverrideActive) { e.dataTransfer.dropEffect = 'none'; } else { e.dataTransfer.dropEffect = 'move'; }
        if (draggedOverRepId !== rep.id) { onSetDraggedOverRepId(rep.id); }
    };

    const isBeingHoveredWithJob = draggedOverRepId === rep.id && draggedJob;

    const skillMatchStatus = useMemo(() => {
        if (!isBeingHoveredWithJob || !draggedJob) return 'none';
        const notesLower = draggedJob.notes.toLowerCase();
        const jobTags = TAG_KEYWORDS.filter(keyword => new RegExp(`\\b${keyword.toLowerCase()}\\b`).test(notesLower));
        if (jobTags.length === 0) return 'none';
        const primaryTag = jobTags[0];
        const skillLevel = rep.skills?.[primaryTag];
        if (skillLevel === undefined || skillLevel <= 1) return 'poor';
        if (skillLevel === 2) return 'average';
        if (skillLevel >= 3) return 'good';
        return 'none';
    }, [isBeingHoveredWithJob, draggedJob, rep.skills]);

    const isDoubleBooked = useMemo(() => { return rep.schedule.some(slot => slot.jobs.length > 1); }, [rep.schedule]);

    const containerClasses = useMemo(() => {
        const base = 'p-1.5 rounded-lg transition-all duration-300 border-2 min-w-0';
        let stateClasses = '';

        // Double-booked takes highest priority for visual warning
        if (isDoubleBooked && !isBeingHoveredWithJob) {
            stateClasses = 'border-tag-red-border bg-tag-red-bg/30 shadow-md ring-2 ring-tag-red-border/50';
        }
        else if (rep.isOptimized) { stateClasses = 'border-tag-teal-border bg-tag-teal-bg/50 shadow-inner'; }
        else if (rep.isLocked) { stateClasses = 'border-tag-amber-border bg-tag-amber-bg shadow-inner'; }
        else if (isHighlighted) { stateClasses = 'border-tag-sky-border bg-tag-sky-bg shadow-lg scale-[1.02]'; }
        else if (isBeingHoveredWithJob) {
            if (isInvalidDropTarget) {
                if (isOverrideActive) { stateClasses = 'border-tag-purple-border bg-tag-purple-bg/50'; }
                else { stateClasses = 'border-tag-red-border bg-tag-red-bg/50 opacity-60 cursor-not-allowed'; }
            } else {
                switch (skillMatchStatus) {
                    case 'good': stateClasses = 'border-tag-green-border bg-tag-green-bg/50'; break;
                    case 'average': stateClasses = 'border-tag-amber-border bg-tag-amber-bg/50'; break;
                    case 'poor': stateClasses = 'border-tag-red-border bg-tag-red-bg/50'; break;
                    default: stateClasses = 'border-brand-primary bg-brand-bg-light';
                }
            }
        } else if (isSelected) { stateClasses = 'border-brand-primary bg-brand-bg-light'; }
        else { stateClasses = 'border-border-primary bg-bg-secondary shadow-sm hover:shadow-md'; }

        // London Smith never gets desaturated styling - always show in full color
        const isLondonRep = isLondon(rep);
        const unavailabilityClasses = isFullyUnavailable && !isLondonRep ? 'opacity-60 grayscale' : '';

        // Apply dimming when rep filter is active and this rep doesn't match
        const dimmingClasses = isDimmed && !isLondonRep ? 'opacity-40 grayscale' : '';

        // Apply grayscale when rep is unavailable for the selected time slot filter
        const slotUnavailableClasses = isUnavailableForSlot && !isLondonRep ? 'opacity-50 grayscale' : '';

        return `${base} ${stateClasses} ${unavailabilityClasses} ${dimmingClasses} ${slotUnavailableClasses}`;
    }, [isSelected, isBeingHoveredWithJob, skillMatchStatus, isFullyUnavailable, isInvalidDropTarget, isOverrideActive, isHighlighted, rep.isLocked, rep.isOptimized, isDoubleBooked, isDimmed, isUnavailableForSlot]);

    const containerTitle = useMemo(() => {
        if (!isBeingHoveredWithJob) return '';
        if (rep.isOptimized) { return `Schedule is optimized. Use the global 'Undo' button to revert.` }
        if (rep.isLocked) { return `This rep is locked. Hold Alt/Option to override and drop job.` }
        if (isInvalidDropTarget) {
            if (isOverrideActive) { return `OVERRIDE ACTIVE: ${invalidReason}`; }
            return `${invalidReason} Hold Alt/Option to override.`;
        }
        return '';
    }, [isBeingHoveredWithJob, isInvalidDropTarget, isOverrideActive, invalidReason, rep.isLocked, rep.isOptimized]);

    const repColor = useMemo(() => generateColorFromName(rep.name), [rep.name]);

    const rankColor = useMemo(() => {
        const rank = rep.salesRank;
        if (!rank) return 'text-text-quaternary';
        if (rank === 1) return 'text-tag-amber-text font-black'; // Gold
        if (rank === 2) return 'text-text-secondary font-bold'; // Silver
        if (rank === 3) return 'text-tag-orange-text font-bold'; // Bronze
        if (rank <= 10) return 'text-text-secondary font-semibold';
        return 'text-text-tertiary';
    }, [rep.salesRank]);

    const rankIcon = useMemo(() => {
        const rank = rep.salesRank;
        if (rank === 1) return <span className="text-sm">🥇</span>;
        if (rank === 2) return <span className="text-sm">🥈</span>;
        if (rank === 3) return <span className="text-sm">🥉</span>;
        if (rank && rank <= 10) return <span className="text-xs">⭐</span>;
        return null;
    }, [rep.salesRank]);

    const handleSwapClick = (targetRepId: string) => {
        handleSwapSchedules(rep.id, targetRepId);
        setIsSwapModalOpen(false);
        setIsMenuOpen(false);
    };

    const handleCopySchedule = () => {
        const allJobs = rep.schedule.flatMap(s => s.jobs);
        if (allJobs.length === 0) return;

        const dateStr = selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
        let text = `Route for ${rep.name} - ${dateStr}\n\n`;

        allJobs.forEach((job, idx) => {
            const timeDisplay = job.originalTimeframe || job.timeSlotLabel || 'Scheduled';
            text += `${timeDisplay}: ${job.city?.toUpperCase() || ''}`;

            // Add Original Request info and Warning if different and NO OVERLAP
            if (job.originalTimeframe && job.timeSlotLabel && job.originalTimeframe !== job.timeSlotLabel) {
                const overlaps = doTimesOverlap(job.originalTimeframe, job.timeSlotLabel);
                if (!overlaps) {
                    text += ` (Scheduled: ${job.timeSlotLabel})`;
                    text += ` - WARNING: POTENTIAL RESCHEDULE NECESSARY`;
                }
            }
            text += `\n`;

            text += `${job.address}\n`;
            if (job.notes) text += `Notes: ${job.notes}\n`;
            if (job.customerName && job.customerName !== job.city) text += `Customer: ${job.customerName}\n`;
            text += `\n`;
        });

        text += `Google Maps Route:\n${googleMapsUrl}`;

        navigator.clipboard.writeText(text).then(() => {
            setCopySuccess(true);
            setTimeout(() => setCopySuccess(false), 2000);
        });
    };

    return (
        <div onDragOver={handleDragOver} onDrop={handleContainerDrop} className={containerClasses} title={containerTitle}>
            <div
                className="flex justify-between items-center cursor-pointer"
                onClick={onToggleExpansion}
                onMouseEnter={() => setHoveredRepId(rep.id)}
                onMouseLeave={() => setHoveredRepId(null)}
            >
                <div className="flex items-center min-w-0 flex-1 mr-2">
                    <div
                        className="w-4 h-4 rounded-full mr-1.5 flex-shrink-0 ring-1 ring-inset ring-border-secondary"
                        style={{ backgroundColor: repColor }}
                        title={rep.name}
                    />
                    <h3 className="text-sm font-bold truncate text-text-primary">{rep.name}</h3>
                    {rep.isOptimized ? (
                        <div className="ml-1.5 flex items-center bg-tag-teal-bg text-tag-teal-text border border-tag-teal-border rounded-full px-1.5 py-0">
                            <span className="text-xs font-semibold mr-1">Optimized</span>
                            <button
                                onClick={(e) => { e.stopPropagation(); handleUnoptimizeRepRoute(rep.id); }}
                                className="p-0.5 hover:bg-tag-teal-bg/80 rounded-full text-tag-teal-text transition-colors"
                                title="Reset to original schedule"
                            >
                                <UndoIcon className="h-3 w-3" />
                            </button>
                        </div>
                    ) : isDoubleBooked && (
                        <span className={`ml-2 text-xs font-semibold px-2 py-0.5 rounded-full bg-tag-red-bg text-tag-red-text border border-tag-red-border whitespace-nowrap`}>Double-Booked</span>
                    )}
                    {rep.region && rep.region !== 'UNKNOWN' && rep.region !== 'PHX' && (
                        <span className={`ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded border whitespace-nowrap ${REGION_CLASSES[rep.region]}`}>{rep.region}</span>
                    )}
                    {isFullyUnavailable && !(isLondon(rep) && selectedDay !== 'Sunday') && (
                        <span className="ml-2 text-[10px] bg-bg-quaternary text-text-tertiary font-semibold px-1.5 py-0.5 rounded whitespace-nowrap">Unavailable</span>
                    )}
                </div>
                <div className="flex items-center space-x-1 flex-shrink-0">
                    {rep.isOptimized && (
                        <button
                            onClick={(e) => { e.stopPropagation(); handleCopySchedule(); }}
                            className={`p-1 rounded-full text-sm transition-colors ${copySuccess ? 'bg-tag-green-bg text-tag-green-text' : 'bg-bg-tertiary hover:bg-tag-teal-bg text-text-quaternary hover:text-tag-teal-text'}`}
                            title="Copy Itinerary to Clipboard"
                        >
                            <MessageIcon className="h-3.5 w-3.5" />
                        </button>
                    )}
                    <button
                        onClick={(e) => { e.stopPropagation(); onSelectRep(e); }}
                        className={`p-1 rounded-full text-sm transition-colors ${isSelected ? 'bg-brand-primary text-brand-text-on-primary' : 'bg-bg-tertiary hover:bg-brand-bg-light text-text-quaternary hover:text-brand-primary'}`}
                        title="Pin to Map View"
                    >
                        <PinIcon className="h-3.5 w-3.5" />
                    </button>

                    <div className="relative" ref={menuRef}>
                        <button
                            onClick={(e) => { e.stopPropagation(); setIsMenuOpen(prev => !prev); }}
                            className="p-1 rounded-full text-sm transition-colors bg-bg-tertiary text-text-tertiary hover:bg-bg-quaternary hover:text-text-primary"
                            title="More Options"
                        >
                            <MenuIcon className="h-4 w-4" />
                        </button>

                        {isMenuOpen && (
                            <div className="popup-surface absolute top-full right-0 mt-2 w-48 z-20 py-1 animate-fade-in overflow-hidden">
                                <button
                                    onClick={(e) => { e.stopPropagation(); handleAutoAssignForRep(rep.id); setIsMenuOpen(false); }}
                                    className="w-full text-left px-4 py-2 text-xs text-text-secondary hover:bg-bg-secondary flex items-center disabled:opacity-50 disabled:cursor-not-allowed"
                                    disabled={rep.isLocked || !hasUnassignedJobs || isAssignmentRunning || rep.isOptimized}
                                >
                                    <AutoAssignIcon className="h-3 w-3 mr-2" /> Auto-Assign
                                </button>
                                <button
                                    onClick={(e) => { e.stopPropagation(); handleOptimizeRepRoute(rep.id); setIsMenuOpen(false); }}
                                    className="w-full text-left px-4 py-2 text-xs text-text-secondary hover:bg-bg-secondary flex items-center disabled:opacity-50 disabled:cursor-not-allowed"
                                    disabled={jobCount < 2 || isAssignmentRunning}
                                >
                                    <OptimizeIcon className="h-3 w-3 mr-2" /> Optimize Route
                                </button>

                                <div className="relative">
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setIsMenuOpen(false);
                                            setIsSwapModalOpen(true);
                                        }}
                                        className="w-full text-left px-4 py-2 text-xs text-text-secondary hover:bg-bg-secondary flex items-center disabled:opacity-50 disabled:cursor-not-allowed"
                                        disabled={rep.isLocked || rep.isOptimized || jobCount === 0}
                                    >
                                        <SwapIcon className="h-3 w-3 mr-2" /> Swap Schedule...
                                    </button>
                                </div>

                                <button
                                    onClick={(e) => { e.stopPropagation(); setRepSettingsModalRepId(rep.id); setIsMenuOpen(false); }}
                                    className="w-full text-left px-4 py-2 text-xs text-text-secondary hover:bg-bg-secondary flex items-center"
                                >
                                    <SettingsIcon className="h-3 w-3 mr-2" /> Rep Settings
                                </button>

                                <a
                                    href={googleMapsUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => { if (jobCount === 0) e.preventDefault(); setIsMenuOpen(false); e.stopPropagation(); }}
                                    className={`w-full text-left px-4 py-2 text-xs text-text-secondary hover:bg-bg-secondary flex items-center ${jobCount === 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
                                >
                                    <ClipboardIcon className="h-3 w-3 mr-2" /> Google Maps
                                </a>

                                <div className="border-t border-border-primary my-1"></div>

                                <button
                                    onClick={(e) => { e.stopPropagation(); onToggleLock(rep.id); setIsMenuOpen(false); }}
                                    className="w-full text-left px-4 py-2 text-xs text-text-secondary hover:bg-bg-secondary flex items-center"
                                >
                                    {rep.isLocked ? <UnlockIcon className="h-3 w-3 mr-2" /> : <LockIcon className="h-3 w-3 mr-2" />}
                                    {rep.isLocked ? 'Unlock Rep' : 'Lock Rep'}
                                </button>
                            </div>
                        )}
                    </div>

                    {isExpanded ? <ChevronUpIcon /> : <ChevronDownIcon />}
                </div>
            </div>
            <div className="mt-1 space-y-0.5">
                <div className="flex justify-between items-start">
                    <div className="space-y-0.5 min-w-0">
                        {rep.zipCodes && rep.zipCodes.length > 0 && (
                            <div className="text-[10px] text-text-tertiary flex flex-wrap items-center gap-1">
                                <span>Areas:</span>
                                {rep.zipCodes.map(zip => (
                                    <button
                                        key={zip}
                                        onClick={(e) => { e.stopPropagation(); handleShowZipOnMap(zip, rep); }}
                                        className="px-1 bg-bg-tertiary hover:bg-brand-bg-light hover:text-brand-text-light rounded text-[9px] font-mono transition-colors border border-border-primary"
                                        title="Show area on map"
                                        type="button"
                                    >
                                        {zip}
                                    </button>
                                ))}
                            </div>
                        )}
                        {assignedCities.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-0.5">
                                {assignedCities.map(city => (
                                    <span key={city} className="px-1.5 bg-brand-bg-light text-brand-text-light border border-brand-primary/20 text-[9px] font-bold rounded">{city}</span>
                                ))}
                            </div>
                        )}
                    </div>
                    <div className={`text-[10px] text-right font-mono flex flex-col items-end flex-shrink-0 ml-2 ${rankColor}`} title="Sales Rank (lower is better)">
                        {rep.salesRank ? (
                            <>
                                <span className="flex items-center gap-1 whitespace-nowrap">
                                    {rankIcon}
                                    Rank: <span className={`font-bold ${rep.salesRank <= 3 ? 'text-sm' : ''}`}>#{rep.salesRank}</span>
                                </span>
                            </>
                        ) : (
                            <span className="text-text-quaternary whitespace-nowrap">Unranked</span>
                        )}
                    </div>
                </div>
            </div>

            {/* Header */}
            <div className="px-1.5 py-1 border-b border-border-secondary flex justify-between items-center bg-bg-secondary/50 rounded-t-lg select-none">
                <div className="flex items-center space-x-1">
                    <span className="text-[10px] text-text-tertiary mr-1 font-medium leading-none">{jobCount} job{jobCount !== 1 ? 's' : ''}</span>

                    {isExpanded ? <ChevronUpIcon className="h-3.5 w-3.5 text-text-quaternary ml-1" /> : <ChevronDownIcon className="h-3.5 w-3.5 text-text-quaternary ml-1" />}
                </div>
            </div>

            {isExpanded && (
                <>
                    {rep.skills && (
                        <div className="mt-1.5 pt-1 border-t border-dashed border-border-primary">
                            <div className="flex flex-wrap gap-x-3 gap-y-0.5 items-center">
                                {TAG_KEYWORDS.map(skill => {
                                    const level = rep.skills?.[skill];

                                    if (level && level > 0) {
                                        return (<div key={skill} className="flex items-center space-x-1 text-[9px]"> <span className="text-text-tertiary font-medium">{skill}</span> {renderStars(level)} </div>)
                                    }
                                    return null;
                                })}
                            </div>
                        </div>
                    )}
                    <div className="mt-1.5 space-y-0.5">
                        {rep.isOptimized ? (
                            <div className="mt-2 space-y-2">
                                {rep.schedule.flatMap(s => s.jobs).map((job, idx, allJobs) => {
                                    return (
                                        <React.Fragment key={job.id}>
                                            <JobCard
                                                job={job}
                                                isMismatch={false}
                                                isTimeMismatch={false}
                                                onDragStart={onJobDragStart}
                                                onDragEnd={onJobDragEnd}
                                                onUnassign={onUnassign}
                                                onUpdateJob={onUpdateJob}
                                                onRemove={onRemoveJob}
                                                isDraggable={false}
                                            />
                                        </React.Fragment>
                                    );
                                })}
                            </div>
                        ) : (
                            rep.schedule.map(slot => {
                                // London Smith is always available except on Sundays
                                const isSunday = selectedDay === 'Sunday';
                                const isUnavailable = isLondon(rep) && !isSunday ? false : unavailableSlotIdsForToday.has(slot.id);
                                return (<DropZone key={slot.id} repId={rep.id} slotId={slot.id} onJobDrop={handleInternalDrop} label={slot.label} isUnavailable={isUnavailable} onJobDragStart={onJobDragStart} onJobDragEnd={onJobDragEnd} draggedJob={draggedJob} jobs={slot.jobs} onUnassign={onUnassign} onUpdateJob={onUpdateJob} onRemoveJob={onRemoveJob} isOptimized={false} />);
                            })
                        )}
                    </div>
                </>
            )}

            <ScoreDetailsModal
                isOpen={isScoreDetailsOpen}
                onClose={() => setIsScoreDetailsOpen(false)}
                repName={rep.name}
                averageScore={averageScore}
                jobs={scoredJobs as DisplayJob[]}
            />

            <SwapScheduleModal
                isOpen={isSwapModalOpen}
                onClose={() => setIsSwapModalOpen(false)}
                sourceRep={rep}
                availableReps={appState.reps.filter(r => r.id !== rep.id && !r.isLocked && !r.isOptimized)}
                onSwap={handleSwapClick}
            />
        </div>
    );
};

export default RepSchedule;