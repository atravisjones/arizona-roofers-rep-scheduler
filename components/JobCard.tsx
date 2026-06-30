import React, { useMemo, useState } from 'react';
import { Job, DisplayJob } from '../types';
import { TAG_KEYWORDS } from '../constants';
import { RescheduleIcon, UnassignJobIcon, StarIcon, MapPinIcon, EditIcon, SaveIcon, XIcon, UserIcon, TrashIcon, TrophyIcon, ExternalLinkIcon, HardHatIcon, LockIcon } from './icons';
import { useAppContext } from '../context/AppContext';
import { normalizeAddressForMatching } from '../services/googleSheetsService';
import { normalizeCustomerName } from '../services/roofrApiService';
import { JobEditModal } from './JobEditModal';

const TAG_CLASSES: Record<string, string> = {
    'Tile': 'bg-tag-orange-bg text-tag-orange-text border-tag-orange-border',
    'Shingle': 'bg-tag-amber-bg text-tag-amber-text border-tag-amber-border',
    'Flat': 'bg-tag-cyan-bg text-tag-cyan-text border-tag-cyan-border',
    'Metal': 'bg-tag-slate-bg text-tag-slate-text border-tag-slate-border',
    'Insurance': 'bg-tag-emerald-bg text-tag-emerald-text border-tag-emerald-border',
    'Commercial': 'bg-tag-purple-bg text-tag-purple-text border-tag-purple-border',
    'Paint': 'bg-tag-sky-bg text-tag-sky-text border-tag-sky-border',
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
    onUpdateJob?: (jobId: string, updatedDetails: Partial<Pick<Job, 'customerName' | 'address' | 'notes' | 'originalTimeframe'>>) => void;
    onRemove?: (jobId: string) => void;
    onPlaceOnMap?: (jobId: string) => void;
    isCompact?: boolean;
    isDraggable?: boolean;
    showAssignment?: boolean;
    showBookedBy?: boolean;
    currentRepId?: string;
    currentSlotId?: string;
}

export const JobCard: React.FC<JobCardProps> = ({
    job, isMismatch, isTimeMismatch, onDragStart, onDragEnd, onUnassign, onUpdateJob, onRemove, onPlaceOnMap, isCompact = false, isDraggable = true, showAssignment = false, showBookedBy = false, currentRepId, currentSlotId
}) => {
    const { setHoveredJobId, roofrJobIdMap, roofrEnrichmentMap, roofrCustomerMap } = useAppContext();
    const [isModalOpen, setIsModalOpen] = useState(false);

    // Detect install jobs (pinned jobs with id starting with "install-")
    const isInstallJob = job.id.startsWith('install-');
    // Detect pinned self-gen / follow-up appointments (locked to rep, emerald-colored)
    const isPinned = !!(job as any).isPinned;
    const pinnedKind = (job as any).pinnedKind as 'self_gen' | 'followup' | undefined;
    // Detect paint jobs
    const isPaintJob = !!(job as any).isPaintJob || /\bpaint\b/i.test(job.notes || '');
    // Install jobs are not draggable
    const effectiveDraggable = isDraggable && !isInstallJob;

    const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
        if (isModalOpen || !effectiveDraggable) {
            e.preventDefault();
            return;
        }
        e.dataTransfer.setData('jobId', job.id);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart?.(job);
    };

    const allTags = useMemo(() => {
        if (!job.notes) return [];
        const notesLower = job.notes.toLowerCase();

        const ageMatch = job.notes.match(/\b(\d+)\s*yrs\b/i);
        const ageTag = ageMatch ? [{ type: 'yrs', value: `${ageMatch[1]}yrs`, classes: TAG_CLASSES['yrs'] }] : [];

        const roofTags = TAG_KEYWORDS.filter(keyword => new RegExp(`\\b${keyword.toLowerCase()}\\b`).test(notesLower))
            .map(tag => ({ type: 'roof', value: tag, classes: TAG_CLASSES[tag] }));

        const sqftMatch = job.notes.match(/\b([\d,]+)\s*sq\.?\b/i);
        const sqftTag = sqftMatch ? [{ type: 'sqft', value: `${sqftMatch[1]} sqft`, classes: TAG_CLASSES['sqft'] }] : [];

        const storiesMatch = job.notes.match(/\b(\d)S\b/i);
        const storiesTag = storiesMatch ? [{ type: 'stories', value: `${storiesMatch[1]} Story`, classes: TAG_CLASSES['stories'] }] : [];

        return [...ageTag, ...roofTags, ...sqftTag, ...storiesTag];
    }, [job.notes]);

    const isReschedule = useMemo(() => job.notes.includes('Recommended Reschedule'), [job.notes]);

    const { priorityLevel, priorityReason } = useMemo(() => {
        const priorityMatch = job.notes.match(/#+/);
        const level = priorityMatch ? priorityMatch[0].length : 0;
        if (level === 0) return { priorityLevel: 0, priorityReason: '' };

        const reasonMatch = job.notes.match(/#+\s*\(([^)]+)\)/);
        return { priorityLevel: level, priorityReason: reasonMatch ? reasonMatch[1] : 'Priority Job' };
    }, [job.notes]);

    const isActuallyMismatched = isMismatch || isTimeMismatch;

    const displayJob = job as DisplayJob;
    const assignmentScore = displayJob.assignmentScore;
    const isEliteMatch = typeof assignmentScore === 'number' && assignmentScore >= 90;

    const handleCardClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (isCompact && onUpdateJob) {
            setIsModalOpen(true); // In compact lists like Needs Details, click often implies desire to edit
        }
    };

    const cardClasses = useMemo(() => {
        const base = "border rounded-lg shadow-sm transition-all duration-200 relative group overflow-hidden";
        const stateClasses = effectiveDraggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer';
        let backgroundClasses = '';
        let highlightClasses = '';

        // Determine base background color. Install jobs take highest precedence.
        if (isInstallJob) {
            backgroundClasses = "bg-gradient-to-r from-amber-200 to-orange-300 border-orange-400 text-gray-900";
        } else if (isPinned) {
            backgroundClasses = "bg-gradient-to-br from-emerald-500 to-emerald-600 border-emerald-700 text-white";
        } else if (isPaintJob) {
            backgroundClasses = "bg-blue-900 border-blue-800 text-white";
        } else if (isActuallyMismatched) {
            backgroundClasses = "bg-tag-red-bg border-tag-red-border";
        } else if (isReschedule) {
            backgroundClasses = "bg-tag-blue-bg border-tag-blue-border";
        } else if (priorityLevel === 0 && isEliteMatch) {
            backgroundClasses = "bg-gradient-to-br from-bg-primary to-tag-amber-bg border-tag-amber-border";
        } else {
            backgroundClasses = "bg-bg-primary border-border-primary";
        }

        // Layer on priority styles (but not for install or pinned jobs — pinned stays emerald).
        if (!isInstallJob && !isPinned && priorityLevel > 0) {
            // If it's NOT an error, priority styling dictates the background.
            if (!isActuallyMismatched && !isReschedule) {
                // Metallic ladder. 0 stars = plain white baseline (lowest). Colors start at 1 star:
                // 1=light yellow, 2=light orange, 3=gold, 4=rose gold, 5+=goldish purple.
                if (priorityLevel >= 5) {
                    backgroundClasses = "bg-gradient-to-br from-purple-800 via-purple-600 to-amber-400 border-purple-800 text-white";
                } else if (priorityLevel === 4) {
                    backgroundClasses = "bg-gradient-to-br from-rose-400 via-pink-300 to-amber-300 border-rose-400 text-rose-950";
                } else if (priorityLevel === 3) {
                    backgroundClasses = "bg-gradient-to-br from-amber-400 to-yellow-600 border-amber-700 text-amber-950";
                } else if (priorityLevel === 2) {
                    backgroundClasses = "bg-gradient-to-br from-orange-200 to-orange-400 border-orange-500 text-orange-950";
                } else { // priorityLevel === 1
                    backgroundClasses = "bg-gradient-to-br from-yellow-100 to-yellow-300 border-yellow-400 text-yellow-950";
                }
            }

            // Add "shine" via ring, shadow, and pulse. This is always additive.
            // Shine grows with the tier.
            if (priorityLevel >= 5) {
                highlightClasses = "animate-pulse ring-2 ring-amber-400 ring-offset-2 ring-offset-white shadow-xl shadow-purple-500/60 z-10 scale-[1.01]";
            } else if (priorityLevel === 4) {
                highlightClasses = "ring-2 ring-rose-300/80 ring-offset-2 ring-offset-white shadow-lg shadow-rose-400/50";
            } else if (priorityLevel === 3) {
                highlightClasses = "ring-2 ring-amber-400/80 ring-offset-1 ring-offset-white shadow-md shadow-amber-500/40";
            } else if (priorityLevel === 2) {
                highlightClasses = "ring-2 ring-orange-300/70 ring-offset-1 ring-offset-white shadow-md shadow-orange-400/40";
            } else { // priorityLevel === 1
                highlightClasses = "ring-2 ring-yellow-300/70 ring-offset-1 ring-offset-white shadow-md shadow-yellow-400/30";
            }
        } else if (isInstallJob) {
            // Install jobs get a subtle shine effect
            highlightClasses = "ring-2 ring-orange-600/60 ring-offset-2 ring-offset-white shadow-lg shadow-orange-500/40";
        } else if (isPinned) {
            // Pinned self-gen / follow-up: emerald shine
            highlightClasses = "ring-2 ring-emerald-600/70 ring-offset-2 ring-offset-white shadow-lg shadow-emerald-500/40";
        } else if (isPaintJob) {
            highlightClasses = "ring-2 ring-blue-700 ring-offset-2 ring-offset-bg-primary shadow-lg";
        } else {
            // Only add hover shadow if not a priority job (which has its own shadow effects)
            highlightClasses = "hover:shadow-md";
        }

        return `${base} ${stateClasses} ${backgroundClasses} ${highlightClasses}`;
    }, [priorityLevel, isActuallyMismatched, isReschedule, effectiveDraggable, isEliteMatch, isInstallJob, isPaintJob, isPinned]);

    // Cards with a dark background (top tier goldish-purple or pinned emerald) need light text.
    const needsLightText = isPinned || (priorityLevel >= 5 && !isActuallyMismatched && !isReschedule);

    const googleMapsUrl = useMemo(() => {
        const addressParts = [job.address, job.city, job.zipCode].filter(Boolean);
        if (addressParts.length === 0) return '#';
        const query = encodeURIComponent(addressParts.join(', '));
        return `https://www.google.com/maps/search/?api=1&query=${query}`;
    }, [job.address, job.city, job.zipCode]);



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
            className="flex items-center space-x-1 bg-bg-primary border border-border-secondary hover:bg-bg-tertiary hover:border-border-tertiary text-text-tertiary px-1.5 py-0.5 rounded shadow-sm transition-all text-[9px] font-semibold leading-none whitespace-nowrap h-5"
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
            className="flex items-center space-x-1 bg-bg-primary border border-border-secondary hover:bg-bg-tertiary hover:border-border-tertiary text-text-tertiary px-1.5 py-0.5 rounded shadow-sm transition-all text-[9px] font-semibold leading-none whitespace-nowrap h-5 decoration-0"
            title="Open in Google Maps"
        >
            <MapPinIcon className="h-3 w-3" />
            <span className="inline">Maps</span>
        </a>
    );

    // Format address for Roofr search: expand directions, keep street only
    const formatAddressForRoofr = (addr: string): string => {
        // Use originalAddress if available, otherwise use current address
        const sourceAddr = job.originalAddress || addr;

        // Skip if it looks like coordinates
        if (/^-?\d+\.?\d*\s*,\s*-?\d+\.?\d*$/.test(sourceAddr.trim())) {
            return sourceAddr;
        }

        // Take only the street part (before any comma - removes city, state, zip)
        const streetPart = sourceAddr.split(',')[0].trim();

        // Expand direction abbreviations
        const directionMap: Record<string, string> = {
            ' N ': ' North ', ' S ': ' South ', ' E ': ' East ', ' W ': ' West ',
            ' NE ': ' Northeast ', ' NW ': ' Northwest ', ' SE ': ' Southeast ', ' SW ': ' Southwest ',
            '^N ': 'North ', '^S ': 'South ', '^E ': 'East ', '^W ': 'West ',
        };

        let formatted = ` ${streetPart} `; // Add spaces for matching

        // Replace directions
        Object.entries(directionMap).forEach(([abbr, full]) => {
            if (abbr.startsWith('^')) {
                // Handle start of string
                const pattern = new RegExp(abbr.replace('^', '^'), 'gi');
                formatted = formatted.replace(pattern, full);
            } else {
                formatted = formatted.replace(new RegExp(abbr, 'gi'), full);
            }
        });

        // Expand common street type abbreviations
        const streetTypes: Record<string, string> = {
            ' St$': ' Street', ' St ': ' Street ',
            ' Ave$': ' Avenue', ' Ave ': ' Avenue ',
            ' Blvd$': ' Boulevard', ' Blvd ': ' Boulevard ',
            ' Dr$': ' Drive', ' Dr ': ' Drive ',
            ' Rd$': ' Road', ' Rd ': ' Road ',
            ' Ln$': ' Lane', ' Ln ': ' Lane ',
            ' Ct$': ' Court', ' Ct ': ' Court ',
            ' Pl$': ' Place', ' Pl ': ' Place ',
            ' Cir$': ' Circle', ' Cir ': ' Circle ',
            ' Way$': ' Way', ' Way ': ' Way ',
            ' Pkwy$': ' Parkway', ' Pkwy ': ' Parkway ',
            ' Ter$': ' Terrace', ' Ter ': ' Terrace ',
        };

        Object.entries(streetTypes).forEach(([abbr, full]) => {
            if (abbr.includes('$')) {
                const pattern = new RegExp(abbr.replace('$', '$'), 'gi');
                formatted = formatted.replace(pattern, full);
            } else {
                formatted = formatted.replace(new RegExp(abbr, 'gi'), full);
            }
        });

        return formatted.trim();
    };

    // Resolve Roofr job: try address first, then customer name
    const resolveRoofrJob = () => {
        const normalized = normalizeAddressForMatching(job.address);
        const addrMatch = normalized ? roofrEnrichmentMap?.get(normalized) : null;
        if (addrMatch) return addrMatch;
        const normName = normalizeCustomerName(job.customerName);
        return normName ? roofrCustomerMap?.get(normName) || null : null;
    };

    const handleRoofrClick = async (e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();

        // Try direct match (address then customer name)
        const match = resolveRoofrJob();
        if (match?.jobId) {
            window.open(`https://app.roofr.com/dashboard/team/239329/jobs/list-view?selectedJobId=${match.jobId}`, '_blank');
            return;
        }

        // Also check the legacy ID map
        const normalized = normalizeAddressForMatching(job.address);
        const legacyJobId = normalized ? roofrJobIdMap?.get(normalized) : null;
        if (legacyJobId) {
            window.open(`https://app.roofr.com/dashboard/team/239329/jobs/list-view?selectedJobId=${legacyJobId}`, '_blank');
            return;
        }

        // Fallback: search by formatted address
        const formattedAddress = formatAddressForRoofr(job.address);

        try {
            await navigator.clipboard.writeText(formattedAddress);
        } catch (err) {
            console.error('Failed to copy address:', err);
        }

        const encodedAddress = encodeURIComponent(formattedAddress);
        const searchUrl = `https://app.roofr.com/dashboard/team/239329/jobs/list-view?page=1&filter%5Bq%5D=${encodedAddress}`;
        window.open(searchUrl, '_blank');
    };

    const RoofrLink = () => {
        const match = resolveRoofrJob();
        const hasDirectLink = !!match?.jobId;

        // Build enrichment tooltip
        let tooltipText = hasDirectLink ? 'Open Roofr job card' : `Search Roofr for "${job.address}"`;
        if (match) {
            const parts = [match.stage, match.leadSource];
            if (match.value) parts.push(`$${match.value.toLocaleString()}`);
            tooltipText = parts.filter(Boolean).join(' · ');
        }

        return (
            <button
                type="button"
                onClick={handleRoofrClick}
                className={`flex items-center space-x-1 border px-1.5 py-0.5 rounded shadow-sm transition-all text-[9px] font-semibold leading-none whitespace-nowrap h-5 ${
                    hasDirectLink
                        ? 'bg-tag-green-bg border-tag-green-border text-tag-green-text hover:bg-tag-emerald-bg'
                        : 'bg-bg-primary border-border-secondary hover:bg-bg-tertiary hover:border-border-tertiary text-text-tertiary'
                }`}
                title={tooltipText}
            >
                <ExternalLinkIcon className="h-3 w-3" />
                <span className="inline">Job Card</span>
            </button>
        );
    };

    // Display Logic for Time Slot - prefer the short label from time slot
    const displayTimeLabel = displayJob.timeSlotLabel || job.originalTimeframe || 'Anytime';

    // Check if original time differs from assigned (for tooltip)
    const showOriginalTime = job.originalTimeframe && displayJob.timeSlotLabel && job.originalTimeframe !== displayJob.timeSlotLabel;

    return (
        <div
            draggable={effectiveDraggable}
            onDragStart={handleDragStart}
            onDragEnd={onDragEnd}
            onClick={handleCardClick}
            onMouseEnter={() => setHoveredJobId(job.id)}
            onMouseLeave={() => setHoveredJobId(null)}
            className={cardClasses}
            title={isInstallJob ? '📍 Install anchor - This is a scheduled installation job.' : mismatchTitle}
        >
            {/* Compact install card */}
            {isInstallJob ? (
                <div className="px-1.5 py-1 flex items-center gap-1.5 min-w-0">
                    <HardHatIcon className="h-4 w-4 text-orange-800 shrink-0" />
                    <div className="min-w-0 flex-1">
                        <span className="text-[10px] font-bold text-gray-900 truncate block leading-tight">{job.city || 'Unknown'} — {job.customerName.replace(/^INSTALL:\s*/i, '')}</span>
                        <span className="text-[9px] text-gray-700 truncate block leading-tight">{job.address}</span>
                    </div>
                    {(job as any).installValue != null && (
                        <span className="text-[9px] font-bold text-orange-900 bg-orange-100 border border-orange-300 px-1.5 py-0.5 rounded whitespace-nowrap shrink-0">
                            ${Number((job as any).installValue).toLocaleString()}
                        </span>
                    )}
                </div>
            ) : isPaintJob ? (
                <div className="px-1.5 py-1">
                    {/* Paint job header: City + PAINT badge + time */}
                    <div className="flex justify-between items-center mb-0.5">
                        <h3 className="font-extrabold text-xs uppercase tracking-tight text-white truncate leading-none">
                            {job.city || 'Unknown City'}
                        </h3>
                        <div className="flex items-center gap-1">
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full border bg-white text-blue-900 border-white/80 whitespace-nowrap leading-none shadow-sm">
                                PAINT
                            </span>
                            <span className="text-[9px] font-bold px-1 rounded-full border bg-white/20 border-white/40 text-white leading-none">
                                {displayTimeLabel}
                            </span>
                        </div>
                    </div>
                    {/* Customer name */}
                    <p className="text-[10px] font-semibold text-white truncate leading-tight">{job.customerName}</p>
                    {/* Address */}
                    <p className="text-[9px] text-white/70 truncate leading-tight">{job.address}</p>
                    {/* Action buttons */}
                    <div className="flex items-center justify-end gap-1 mt-0.5">
                        <MapsLink />
                        {onUnassign && (
                            <ActionBtn onClick={(e) => { e.stopPropagation(); onUnassign(job.id); }} icon={UnassignJobIcon} label="Unassign" />
                        )}
                        {onUpdateJob && (
                            <ActionBtn onClick={(e) => { e.stopPropagation(); setIsModalOpen(true); }} icon={EditIcon} label="Edit" />
                        )}
                    </div>
                    {showAssignment && (job as any).assignedRepName && (
                        <div className="flex items-center gap-1 mt-0.5 pt-0.5 border-t border-white/30">
                            <UserIcon className="h-2.5 w-2.5 text-white/80" />
                            <span className="text-[9px] font-bold text-white/80 truncate">{(job as any).assignedRepName}</span>
                        </div>
                    )}
                    {onUpdateJob && (
                        <JobEditModal job={job} isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSave={onUpdateJob} onRemove={onRemove} onUnassign={onUnassign} currentRepId={currentRepId} currentSlotId={currentSlotId} />
                    )}
                </div>
            ) : (
            <>
            {/* Header: City & Status */}
            <div className={`px-1.5 py-0.5 flex justify-between items-start ${isCompact ? 'flex-col gap-0.5' : ''}`}>
                <div className="min-w-0 flex-1 mr-1">
                    <h3 className={`font-extrabold text-xs uppercase tracking-tight truncate leading-none ${needsLightText ? 'text-white' : 'text-text-primary'}`}>
                        {job.city || 'Unknown City'}
                    </h3>
                </div>
                <div className="flex items-center gap-0.5 flex-shrink-0">
                    {isInstallJob && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full border bg-orange-600 text-white border-orange-700 whitespace-nowrap leading-none shadow-sm">
                            INSTALL
                        </span>
                    )}

                    {isPinned && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full border bg-emerald-700 text-white border-emerald-800 whitespace-nowrap leading-none shadow-sm flex items-center gap-0.5">
                            <LockIcon className="h-2.5 w-2.5" />
                            {pinnedKind === 'self_gen' ? 'SELF-GEN' : pinnedKind === 'followup' ? 'FOLLOW-UP' : 'PINNED'}
                        </span>
                    )}

                    {priorityLevel > 0 && !isInstallJob && (
                        <div className="flex">
                            {[...Array(Math.min(priorityLevel, 5))].map((_, i) => (
                                <StarIcon key={i} className={`h-3 w-3 drop-shadow-[0_1px_1px_rgba(0,0,0,0.35)] ${priorityLevel >= 5 ? 'text-yellow-300' : 'text-amber-700'}`} />
                            ))}
                        </div>
                    )}

                    <span
                        className={`text-[9px] font-bold px-1 rounded-full border leading-none ${isInstallJob ? 'bg-white/30 border-orange-700 text-gray-900' : displayTimeLabel !== 'Anytime' ? 'bg-bg-primary/80 border-border-primary text-text-secondary shadow-sm' : 'bg-bg-tertiary text-text-tertiary border-transparent'}`}
                        title={showOriginalTime ? `Original Request: ${job.originalTimeframe}` : undefined}
                    >
                        {displayTimeLabel}
                    </span>
                </div>
            </div>

            {/* Middle: Tags & Actions Grid */}
            <div className="px-1.5 py-0.5 grid grid-cols-1 gap-0.5">
                {/* Tags */}
                {allTags.length > 0 && (
                    <div className="flex flex-wrap gap-0.5">
                        {allTags.map((tag, idx) => (
                            <span key={`${tag.value}-${idx}`} className={`text-[9px] font-bold px-1 py-0.5 rounded-full border whitespace-nowrap leading-none ${tag.classes}`}>
                                {tag.value}
                            </span>
                        ))}
                    </div>
                )}

                {/* Action Bar */}
                <div className="flex items-center justify-end gap-1">
                    {typeof assignmentScore === 'number' && !isCompact && (
                        <span
                            className={`mr-auto text-[9px] font-bold px-1 py-0.5 rounded border cursor-help flex items-center gap-0.5 leading-none
                            ${isEliteMatch
                                    ? 'text-tag-amber-text bg-tag-amber-bg border-tag-amber-border shadow-sm ring-1 ring-tag-amber-border/30'
                                    : 'text-text-tertiary bg-bg-tertiary border-border-primary'
                                }`}
                            title={getScoreTooltip(displayJob)}
                        >
                            {isEliteMatch && <TrophyIcon className="h-2 w-2 text-tag-amber-text" />}
                            {assignmentScore}
                        </span>
                    )}

                    {!isCompact ? (
                        <>
                            <RoofrLink />
                            <MapsLink />
                            {onPlaceOnMap && (
                                <ActionBtn
                                    onClick={(e) => { e.stopPropagation(); onPlaceOnMap(job.id); }}
                                    icon={MapPinIcon}
                                    label="Map"
                                    title="Click to manually place this job on the map"
                                />
                            )}
                            {onUnassign && (
                                <ActionBtn
                                    onClick={(e) => { e.stopPropagation(); onUnassign(job.id); }}
                                    icon={UnassignJobIcon}
                                    label="Unassign"
                                />
                            )}
                            {onUpdateJob && (
                                <ActionBtn
                                    onClick={(e) => { e.stopPropagation(); setIsModalOpen(true); }}
                                    icon={EditIcon}
                                    label="Edit"
                                />
                            )}
                        </>
                    ) : (
                        <div className="w-full flex justify-between items-center">
                            <span className="text-[9px] text-brand-text-light font-semibold italic leading-none">Click to edit</span>
                            <div className="flex items-center gap-1">
                                <RoofrLink />
                                <MapsLink />
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Footer: Address & Assignment */}
            <div className={`px-1.5 py-0.5 border-t ${needsLightText ? 'border-white/25' : 'border-black/5'}`}>
                <p className={`text-[9px] truncate font-medium leading-none ${needsLightText ? 'text-white/85' : 'text-text-tertiary'}`} title={job.address}>
                    {job.address}
                </p>
                {showBookedBy && (
                    <div className="flex items-center gap-1 mt-0.5">
                        <UserIcon className={`h-2.5 w-2.5 shrink-0 ${needsLightText ? 'text-white/90' : 'text-tag-amber-text'}`} />
                        <span className={`text-[9px] font-bold truncate ${needsLightText ? 'text-white/90' : 'text-tag-amber-text'}`} title={job.bookedBy ? `Get notes from: ${job.bookedBy}` : undefined}>
                            {job.bookedBy ? `Booked by: ${job.bookedBy}` : 'No rep on appointment'}
                        </span>
                    </div>
                )}
                {showAssignment && (job as any).assignedRepName && (
                    <div className="flex items-center gap-1 mt-0.5">
                        <UserIcon className={`h-2.5 w-2.5 ${needsLightText ? 'text-white' : 'text-brand-primary'}`} />
                        <span className={`text-[9px] font-bold truncate ${needsLightText ? 'text-white' : 'text-brand-primary'}`}>
                            {(job as any).assignedRepName}
                        </span>
                    </div>
                )}
                {showAssignment && !(job as any).assignedRepName && (
                    <div className="flex items-center gap-1 mt-0.5">
                        <span className="text-[9px] font-medium text-text-quaternary italic">
                            Unassigned
                        </span>
                    </div>
                )}
            </div>

            {/* Edit Modal */}
            {onUpdateJob && (
                <JobEditModal
                    job={job}
                    isOpen={isModalOpen}
                    onClose={() => setIsModalOpen(false)}
                    onSave={onUpdateJob}
                    onRemove={onRemove}
                    onUnassign={onUnassign}
                    currentRepId={currentRepId}
                    currentSlotId={currentSlotId}
                />
            )}
            </>
            )}
        </div>
    );
};
