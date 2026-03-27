import React, { useMemo, useState } from 'react';
import { DisplayJob, RouteInfo } from '../types';
import LeafletMap from './LeafletMap';
import { LoadingIcon, RefreshIcon, MapPinIcon, VariationsIcon, ChevronDownIcon, ChevronUpIcon, TagIcon, StarIcon, HomeIcon } from './icons';
import { useAppContext } from '../context/AppContext';
import { JobCard } from './JobCard';
import { TIME_SLOTS, TIME_SLOT_DISPLAY_LABELS, TAG_KEYWORDS } from '../constants';

interface RouteMapPanelProps {
    routeData: {
        repName: string;
        mappableJobs: DisplayJob[];
        unmappableJobs: DisplayJob[];
        routeInfo: RouteInfo | null;
    } | null;
    isLoading: boolean;
}

// Helpers for time range parsing and comparison
const parseTime = (t: string) => {
    const match = t.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (!match) return null;
    let h = parseInt(match[1]);
    const m = parseInt(match[2] || '0');
    const p = match[3]?.toLowerCase();
    if (p === 'pm' && h < 12) h += 12;
    if (p === 'am' && h === 12) h = 0;
    // Heuristic for times like '1-4' to become 1pm-4pm, but not for 10am, 11am, 12pm
    if (!p && h >= 1 && h <= 7 && ![10, 11, 12].includes(h)) h += 12;
    return h * 60 + m;
};

const parseTimeRange = (timeStr: string | undefined): { start: number, end: number } | null => {
    if (!timeStr) return null;
    const parts = timeStr.split('-').map(s => s.trim());
    if (parts.length > 0) {
        const start = parseTime(parts[0]);
        // Assume 2hr window for single time entries, though most are ranges
        const end = parts.length > 1 ? parseTime(parts[1]) : (start !== null ? start + 120 : null);
        if (start !== null && end !== null) {
            return { start, end };
        }
    }
    return null;
};

const doRangesOverlap = (r1: { start: number, end: number } | null, r2: { start: number, end: number } | null): boolean => {
    if (!r1 || !r2) return false;
    // Standard overlap check: StartA < EndB and StartB < EndA
    return r1.start < r2.end && r2.start < r1.end;
};


// Helper functions for buckets
const sizeToBucket = (sqft: number) => {
    if (sqft < 1500) return '< 1500 sqft';
    if (sqft <= 2500) return '1500-2500 sqft';
    return '> 2500 sqft';
};
const ageToBucket = (age: number) => {
    if (age <= 5) return '0-5 yrs';
    if (age <= 10) return '6-10 yrs';
    if (age <= 15) return '11-15 yrs';
    if (age <= 20) return '16-20 yrs';
    return '> 20 yrs';
};

const getJobTags = (job: DisplayJob) => {
    const roofTypes = new Set<string>();
    const stories = new Set<string>();

    const notesLower = job.notes.toLowerCase();
    TAG_KEYWORDS.forEach(keyword => {
        if (new RegExp(`\\b${keyword.toLowerCase()}\\b`).test(notesLower)) {
            roofTypes.add(keyword);
        }
    });

    const storiesMatch = job.notes.match(/\b(\d)S\b/i);
    if (storiesMatch) stories.add(storiesMatch[1]);

    let sizeBucket: string | null = null;
    const sqftMatch = job.notes.match(/\b(\d+)\s*sq/i);
    if (sqftMatch) sizeBucket = sizeToBucket(parseInt(sqftMatch[1], 10));

    let ageBucket: string | null = null;
    const ageMatch = job.notes.match(/\b(\d+)\s*yrs\b/i);
    if (ageMatch) ageBucket = ageToBucket(parseInt(ageMatch[1], 10));

    let priorityLevel: number | null = null;
    const priorityMatch = job.notes.match(/#+/);
    if (priorityMatch) priorityLevel = priorityMatch[0].length;

    return { roofTypes, stories, sizeBucket, ageBucket, priorityLevel };
};

const checkJobMatch = (
    job: DisplayJob,
    tags: ReturnType<typeof getJobTags>,
    filters: {
        roofTypes: Set<string>;
        stories: Set<string>;
        sizes: Set<string>;
        priorityLevels: Set<number>;
        ages: Set<string>;
    },
    selectedTimeSlotId: string | null
) => {
    // Time Check
    if (selectedTimeSlotId) {
        const jobRange = parseTimeRange(job.timeSlotLabel);
        const selectedSlot = TIME_SLOTS.find(ts => ts.id === selectedTimeSlotId);
        if (selectedSlot) {
            const filterRange = parseTimeRange(selectedSlot.label);
            // If job has no time but filter is active? Assuming filter is exclusionary.
            if (!doRangesOverlap(filterRange, jobRange)) return false;
        }
    }

    // Tag Checks
    if (filters.priorityLevels.size > 0) {
        if (tags.priorityLevel === null || !filters.priorityLevels.has(tags.priorityLevel)) return false;
    }

    if (filters.roofTypes.size > 0) {
        // OR logic within category
        const hasMatch = Array.from(filters.roofTypes).some(t => tags.roofTypes.has(t));
        if (!hasMatch) return false;
    }

    if (filters.stories.size > 0) {
        const hasMatch = Array.from(filters.stories).some(t => tags.stories.has(t));
        if (!hasMatch) return false;
    }

    if (filters.sizes.size > 0) {
        if (!tags.sizeBucket || !filters.sizes.has(tags.sizeBucket)) return false;
    }

    if (filters.ages.size > 0) {
        if (!tags.ageBucket || !filters.ages.has(tags.ageBucket)) return false;
    }

    return true;
};

interface TagFilters {
    roofTypes: Set<string>;
    stories: Set<string>;
    sizes: Set<string>;
    priorityLevels: Set<number>;
    ages: Set<string>;
}

const RouteMapPanel: React.FC<RouteMapPanelProps> = ({ routeData, isLoading }) => {
    const { handleUpdateJob, handleUnassignJob, handleRemoveJob, handleRefreshRoute, handleShowAllJobsOnMap, handleTryAddressVariations, isTryingVariations, uiSettings, placementJobId, setPlacementJobId, handlePlaceJobOnMap, selectedRepId, appState } = useAppContext();
    // selectedRepFilters may not exist in context yet - default to empty Set
    const selectedRepFilters = new Set<string>();
    const [copySuccess, setCopySuccess] = useState(false);

    const [isUnplottedExpanded, setIsUnplottedExpanded] = useState(true);
    const [showTagFilters, setShowTagFilters] = useState(false);
    const [showRepHomes, setShowRepHomes] = useState(false);

    // State for filtering
    const [selectedTimeSlotId, setSelectedTimeSlotId] = useState<string | null>(null);
    const [tagFilters, setTagFilters] = useState<TagFilters>({ roofTypes: new Set(), stories: new Set(), sizes: new Set(), priorityLevels: new Set(), ages: new Set() });

    // Memoize parsed tags for all jobs to avoid frequent regex
    const jobTagsMap = useMemo(() => {
        const map = new Map<string, ReturnType<typeof getJobTags>>();
        if (routeData) {
            routeData.mappableJobs.forEach(job => {
                map.set(job.id, getJobTags(job));
            });
        }
        return map;
    }, [routeData]);

    // Extract available tags dynamically based on ALL active filters
    const { availableTags, availablePriorityLevels } = useMemo(() => {
        if (!routeData) return { availableTags: { roofTypes: [], stories: [], sizes: [], ages: [] }, availablePriorityLevels: [] };

        const roofs = new Set<string>();
        const stories = new Set<string>();
        const sizeBuckets = new Set<string>();
        const ageBuckets = new Set<string>();
        const priorities = new Set<number>();

        routeData.mappableJobs.forEach(job => {
            const tags = jobTagsMap.get(job.id);
            if (!tags) return;

            if (checkJobMatch(job, tags, tagFilters, selectedTimeSlotId)) {
                // Add to sets
                tags.roofTypes.forEach(r => roofs.add(r));
                tags.stories.forEach(s => stories.add(s));
                if (tags.sizeBucket) sizeBuckets.add(tags.sizeBucket);
                if (tags.ageBucket) ageBuckets.add(tags.ageBucket);
                if (tags.priorityLevel !== null) priorities.add(tags.priorityLevel);
            }
        });

        return {
            availableTags: {
                roofTypes: Array.from(roofs).sort(),
                stories: Array.from(stories).sort((a, b) => parseInt(a, 10) - parseInt(b, 10)),
                sizes: ['< 1500 sqft', '1500-2500 sqft', '> 2500 sqft'].filter(b => sizeBuckets.has(b)),
                ages: ['0-5 yrs', '6-10 yrs', '11-15 yrs', '16-20 yrs', '> 20 yrs'].filter(b => ageBuckets.has(b)),
            },
            availablePriorityLevels: Array.from(priorities).sort(),
        };
    }, [routeData, tagFilters, selectedTimeSlotId, jobTagsMap]);

    const handleCopyUnplotted = () => {
        if (!routeData || routeData.unmappableJobs.length === 0) return;

        const addressesToCopy = routeData.unmappableJobs.map(job => job.address).join('\n');

        navigator.clipboard.writeText(addressesToCopy).then(() => {
            setCopySuccess(true);
            setTimeout(() => setCopySuccess(false), 2500);
        }).catch(err => {
            console.error("Failed to copy unplotted addresses:", err);
            alert("Could not copy addresses. Please check browser permissions.");
        });
    };

    const toggleTimeSlot = (slotId: string) => {
        setSelectedTimeSlotId(prev => prev === slotId ? null : slotId);
    };

    // Filter jobs based on active time slots and selected rep - sets 'isDimmed' on non-matching jobs
    const jobsForMap = useMemo(() => {
        if (!routeData) return [];

        const { repName } = routeData;
        const isOverviewMap = repName === 'Unassigned Jobs' || repName === 'Job Map' || repName === 'All Rep Locations' || repName.startsWith('Zip:');
        const isRepView = !isOverviewMap;

        // Get all selected reps' names (for multi-select filtering)
        const selectedRepNames = new Set<string>();
        if (selectedRepFilters.size > 0) {
            selectedRepFilters.forEach(repId => {
                const rep = appState.reps.find(r => r.id === repId);
                if (rep) selectedRepNames.add(rep.name);
            });
        }
        const hasRepFilter = selectedRepNames.size > 0;

        return routeData.mappableJobs.map(job => {
            const tags = jobTagsMap.get(job.id);
            // Default to matching if tags parsing failed (unlikely)
            const isMatch = tags ? checkJobMatch(job, tags, tagFilters, selectedTimeSlotId) : true;

            // Saturation Filter: Dim if not belonging to the current rep (when in Rep View)
            // OR if reps are selected and this job doesn't belong to any of them
            const belongsToRep = job.assignedRepName === repName;
            const belongsToSelectedReps = hasRepFilter ? selectedRepNames.has(job.assignedRepName || '') : true;

            // Final dim state: Dimmed if:
            // 1. Filter mismatch (time/tags)
            // 2. Rep View AND Not Rep's Job (unless it's start location)
            // 3. Reps are selected AND job doesn't belong to any selected rep (unless it's their home/start)
            const isSelectedRepHome = job.isStartLocation && selectedRepNames.has(job.assignedRepName || '');
            const isDimmed = !isMatch ||
                (isRepView && !belongsToRep && !job.isStartLocation) ||
                (hasRepFilter && !belongsToSelectedReps && !isSelectedRepHome);

            return { ...job, isDimmed };
        });
    }, [routeData, selectedTimeSlotId, tagFilters, jobTagsMap, selectedRepFilters, appState.reps]);

    const routeInfoForMap = routeData?.routeInfo || null;
    const mapType = (routeData?.repName === 'Unassigned Jobs' || routeData?.repName === 'Job Map' || routeData?.repName === 'All Rep Locations' || routeData?.repName?.startsWith('Zip:')) ? 'unassigned' : 'route';

    return (
        <div className="w-full h-full flex flex-col bg-bg-secondary rounded-lg overflow-hidden">
            <header className="p-3 border-b border-border-primary bg-bg-primary flex-shrink-0">
                <div className="bg-bg-secondary p-2 rounded-lg flex flex-col gap-2 w-auto border border-border-primary">
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleShowAllJobsOnMap}
                            disabled={isLoading}
                            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${isLoading ? 'bg-bg-tertiary text-text-quaternary cursor-not-allowed' : 'bg-bg-tertiary text-text-secondary hover:bg-bg-quaternary'}`}
                            title="Show all assigned and unassigned jobs on the map"
                        >
                            <MapPinIcon />
                            <span>Show All</span>
                        </button>
                        <button
                            onClick={handleRefreshRoute}
                            disabled={isLoading}
                            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${isLoading ? 'bg-bg-tertiary text-text-quaternary cursor-not-allowed' : 'bg-bg-tertiary text-text-secondary hover:bg-bg-quaternary'}`}
                            title="Refresh map view to update rep colors and routes"
                        >
                            <RefreshIcon />
                            <span>Refresh</span>
                        </button>
                        <button
                            onClick={() => setShowRepHomes(!showRepHomes)}
                            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${showRepHomes
                                ? 'bg-brand-primary text-brand-text-on-primary border-brand-primary shadow-sm'
                                : 'bg-bg-tertiary text-text-secondary hover:bg-bg-quaternary'}`}
                            title="Toggle rep home locations on/off"
                        >
                            <HomeIcon className="h-3.5 w-3.5" />
                            <span>Rep Homes</span>
                        </button>
                    </div>

                    <div className="border-t -mx-2 border-border-primary"></div>

                    <div className="flex flex-col gap-2">
                        <div className="flex flex-wrap items-center gap-1 select-none">
                            <button
                                onClick={() => setShowTagFilters(!showTagFilters)}
                                className={`px-2 py-0.5 text-[10px] font-bold rounded-md border transition-all flex items-center gap-1 mr-2 ${showTagFilters
                                    ? 'bg-bg-primary text-brand-primary border-brand-primary shadow-sm'
                                    : 'bg-bg-primary text-text-quaternary border-border-primary hover:text-text-secondary hover:bg-bg-secondary'
                                    }`}
                            >
                                <TagIcon className="h-3 w-3" />
                                <span>Tags</span>
                            </button>

                            <span className="text-[10px] font-bold text-text-quaternary uppercase mr-1">Time:</span>
                            {TIME_SLOTS.map(slot => {
                                const isActive = selectedTimeSlotId === slot.id;
                                return (
                                    <button
                                        key={slot.id}
                                        onClick={() => toggleTimeSlot(slot.id)}
                                        className={`px-2 py-0.5 text-[10px] font-medium rounded-full border transition-all ${isActive
                                            ? 'bg-brand-primary text-brand-text-on-primary border-brand-primary shadow-sm'
                                            : 'bg-bg-primary text-text-tertiary border-border-primary hover:border-brand-primary/50 hover:text-brand-primary'
                                            }`}
                                    >
                                        {(TIME_SLOT_DISPLAY_LABELS[slot.id] || slot.label).replace(/AM|PM|am|pm/gi, '').replace(/\s/g, '')}
                                    </button>
                                );
                            })}
                            {(selectedTimeSlotId !== null || Object.values(tagFilters).some((s: any) => s.size > 0)) && (
                                <button onClick={() => { setSelectedTimeSlotId(null); setTagFilters({ roofTypes: new Set(), stories: new Set(), sizes: new Set(), priorityLevels: new Set(), ages: new Set() }); }} className="text-[10px] text-brand-primary underline ml-1 hover:text-brand-secondary">
                                    Clear
                                </button>
                            )}
                        </div>

                        {showTagFilters && (
                            <div className="p-2 bg-bg-primary rounded-md border border-border-primary space-y-2">
                                {availablePriorityLevels.length > 0 && (
                                    <div className="flex items-start gap-2">
                                        <span className="w-10 pt-0.5 text-[9px] font-bold text-text-quaternary uppercase text-right flex-shrink-0">Status</span>
                                        <div className="flex flex-wrap gap-1">
                                            {availablePriorityLevels.map(level => (
                                                <button
                                                    key={level}
                                                    onClick={() => setTagFilters(f => {
                                                        // Left-click: single select
                                                        const n = new Set(f.priorityLevels);
                                                        const wasSelected = n.has(level);
                                                        const manySelected = n.size > 1;
                                                        n.clear();
                                                        if (!wasSelected || manySelected) n.add(level);
                                                        return { ...f, priorityLevels: n };
                                                    })}
                                                    onContextMenu={(e) => {
                                                        e.preventDefault();
                                                        // Right-click: multi-select
                                                        setTagFilters(f => {
                                                            const n = new Set(f.priorityLevels);
                                                            n.has(level) ? n.delete(level) : n.add(level);
                                                            return { ...f, priorityLevels: n };
                                                        });
                                                    }}
                                                    className={`px-2 py-0.5 text-[10px] font-medium rounded-full border transition-all flex items-center gap-1 ${tagFilters.priorityLevels.has(level) ? 'bg-tag-amber-bg text-tag-amber-text border-tag-amber-border ring-1 ring-tag-amber-border/50' : 'bg-bg-primary text-text-secondary border-border-primary hover:border-brand-primary/50'}`}
                                                >
                                                    <StarIcon className={`h-3 w-3 ${tagFilters.priorityLevels.has(level) ? 'text-tag-amber-text' : 'text-text-quaternary'}`} />
                                                    {'#'.repeat(level)}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                {availableTags.roofTypes.length > 0 && (
                                    <div className="flex items-start gap-2">
                                        <span className="w-10 pt-0.5 text-[9px] font-bold text-text-quaternary uppercase text-right flex-shrink-0">Roof</span>
                                        <div className="flex flex-wrap gap-1">
                                            {availableTags.roofTypes.map(tag => (
                                                <button key={tag}
                                                    onClick={() => setTagFilters(f => {
                                                        // Left-click: single select
                                                        const n = new Set(f.roofTypes);
                                                        const wasSelected = n.has(tag);
                                                        const manySelected = n.size > 1;
                                                        n.clear();
                                                        if (!wasSelected || manySelected) n.add(tag);
                                                        return { ...f, roofTypes: n };
                                                    })}
                                                    onContextMenu={(e) => {
                                                        e.preventDefault();
                                                        // Right-click: multi-select
                                                        setTagFilters(f => {
                                                            const n = new Set(f.roofTypes);
                                                            n.has(tag) ? n.delete(tag) : n.add(tag);
                                                            return { ...f, roofTypes: n };
                                                        });
                                                    }}
                                                    className={`px-2 py-0.5 text-[10px] font-medium rounded-full border transition-all ${tagFilters.roofTypes.has(tag) ? 'bg-brand-primary text-brand-text-on-primary border-brand-primary' : 'bg-bg-primary text-text-secondary border-border-primary hover:border-brand-primary/50'}`}
                                                >{tag}</button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                {availableTags.stories.length > 0 && (
                                    <div className="flex items-start gap-2">
                                        <span className="w-10 pt-0.5 text-[9px] font-bold text-text-quaternary uppercase text-right flex-shrink-0">Height</span>
                                        <div className="flex flex-wrap gap-1">
                                            {availableTags.stories.map(tag => (
                                                <button key={tag}
                                                    onClick={() => setTagFilters(f => {
                                                        // Left-click: single select
                                                        const n = new Set(f.stories);
                                                        const wasSelected = n.has(tag);
                                                        const manySelected = n.size > 1;
                                                        n.clear();
                                                        if (!wasSelected || manySelected) n.add(tag);
                                                        return { ...f, stories: n };
                                                    })}
                                                    onContextMenu={(e) => {
                                                        e.preventDefault();
                                                        // Right-click: multi-select
                                                        setTagFilters(f => {
                                                            const n = new Set(f.stories);
                                                            n.has(tag) ? n.delete(tag) : n.add(tag);
                                                            return { ...f, stories: n };
                                                        });
                                                    }}
                                                    className={`px-2 py-0.5 text-[10px] font-medium rounded-full border transition-all ${tagFilters.stories.has(tag) ? 'bg-brand-primary text-brand-text-on-primary border-brand-primary' : 'bg-bg-primary text-text-secondary border-border-primary hover:border-brand-primary/50'}`}
                                                >{tag} Story</button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                {availableTags.ages.length > 0 && (
                                    <div className="flex items-start gap-2">
                                        <span className="w-10 pt-0.5 text-[9px] font-bold text-text-quaternary uppercase text-right flex-shrink-0">Age</span>
                                        <div className="flex flex-wrap gap-1">
                                            {availableTags.ages.map(tag => (
                                                <button key={tag}
                                                    onClick={() => setTagFilters(f => {
                                                        // Left-click: single select
                                                        const n = new Set(f.ages);
                                                        const wasSelected = n.has(tag);
                                                        const manySelected = n.size > 1;
                                                        n.clear();
                                                        if (!wasSelected || manySelected) n.add(tag);
                                                        return { ...f, ages: n };
                                                    })}
                                                    onContextMenu={(e) => {
                                                        e.preventDefault();
                                                        // Right-click: multi-select
                                                        setTagFilters(f => {
                                                            const n = new Set(f.ages);
                                                            n.has(tag) ? n.delete(tag) : n.add(tag);
                                                            return { ...f, ages: n };
                                                        });
                                                    }}
                                                    className={`px-2 py-0.5 text-[10px] font-medium rounded-full border transition-all ${tagFilters.ages.has(tag) ? 'bg-brand-primary text-brand-text-on-primary border-brand-primary' : 'bg-bg-primary text-text-secondary border-border-primary hover:border-brand-primary/50'}`}
                                                >{tag}</button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                {availableTags.sizes.length > 0 && (
                                    <div className="flex items-start gap-2">
                                        <span className="w-10 pt-0.5 text-[9px] font-bold text-text-quaternary uppercase text-right flex-shrink-0">Size</span>
                                        <div className="flex flex-wrap gap-1">
                                            {availableTags.sizes.map(tag => (
                                                <button key={tag}
                                                    onClick={() => setTagFilters(f => {
                                                        // Left-click: single select
                                                        const n = new Set(f.sizes);
                                                        const wasSelected = n.has(tag);
                                                        const manySelected = n.size > 1;
                                                        n.clear();
                                                        if (!wasSelected || manySelected) n.add(tag);
                                                        return { ...f, sizes: n };
                                                    })}
                                                    onContextMenu={(e) => {
                                                        e.preventDefault();
                                                        // Right-click: multi-select
                                                        setTagFilters(f => {
                                                            const n = new Set(f.sizes);
                                                            n.has(tag) ? n.delete(tag) : n.add(tag);
                                                            return { ...f, sizes: n };
                                                        });
                                                    }}
                                                    className={`px-2 py-0.5 text-[10px] font-medium rounded-full border transition-all ${tagFilters.sizes.has(tag) ? 'bg-brand-primary text-brand-text-on-primary border-brand-primary' : 'bg-bg-primary text-text-secondary border-border-primary hover:border-brand-primary/50'}`}
                                                >{tag}</button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

            </header>

            <div className="flex-grow relative bg-bg-quaternary">
                <LeafletMap jobs={jobsForMap} routeInfo={routeInfoForMap} mapType={mapType} placementJobId={placementJobId} onPlaceJob={handlePlaceJobOnMap} showRepHomes={showRepHomes} reps={appState.reps} />
            </div>

            {routeData && routeData.routeInfo && (routeData.repName !== 'Unassigned Jobs' && routeData.repName !== 'Job Map' && routeData.repName !== 'All Rep Locations' && !routeData.repName.startsWith('Zip:')) && !isLoading && (
                <footer className="p-2 border-t border-border-primary text-center bg-bg-primary text-sm font-semibold text-text-secondary flex-shrink-0">
                    Estimated Route: {routeData.routeInfo.distance.toFixed(1)} miles / {routeData.routeInfo.duration.toFixed(0)} mins driving
                </footer>
            )}
        </div>
    );
};

export default RouteMapPanel;