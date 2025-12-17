import React, { useState, useMemo, useEffect } from 'react';
import { Job } from '../types';
import { TAG_KEYWORDS } from '../constants';
import { MapPinIcon, XIcon, TagIcon, StarIcon, ClockIcon } from './icons';
import { EAST_TO_WEST_CITIES } from '../services/geography';

type ActiveTab = 'city' | 'tags' | 'time';

interface FilterTabsProps {
    unassignedJobs: Job[];
    onFilterChange: (filteredJobs: Job[]) => void;
}

const TabButton: React.FC<{
    tabId: ActiveTab;
    activeTab: ActiveTab;
    label: string;
    icon: React.ReactNode;
    onClick: (tab: ActiveTab) => void;
}> = ({ tabId, activeTab, label, icon, onClick }) => (
    <button
        onClick={() => onClick(tabId)}
        className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1 text-xs font-bold rounded-md transition-all duration-200 ${activeTab === tabId
            ? 'bg-bg-primary text-brand-primary shadow-sm ring-1 ring-border-primary'
            : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-quaternary/50'
            }`}
    >
        {React.cloneElement(icon as React.ReactElement<{ className?: string }>, {
            className: `h-3.5 w-3.5 ${activeTab === tabId ? 'text-brand-primary' : 'text-text-quaternary'}`
        })}
        <span>{label}</span>
    </button>
);

const chipBaseClass = "px-2 py-0.5 text-[10px] font-medium rounded-full border transition-all duration-200 flex items-center gap-1 select-none cursor-pointer hover:shadow-sm";
const chipActiveClass = "bg-brand-primary text-brand-text-on-primary border-brand-primary shadow-sm ring-1 ring-brand-primary/20";
const chipInactiveClass = "bg-bg-primary text-text-secondary border-border-primary hover:border-brand-primary/50 hover:bg-brand-bg-light hover:text-brand-primary";
const chipDisabledClass = "bg-bg-tertiary text-text-quaternary border-border-secondary opacity-50 cursor-not-allowed";

// Helper functions for tag extraction
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

const getJobCity = (job: Job) => job.city || 'Misc.';
const getJobTime = (job: Job) => job.originalTimeframe || 'Unspecified';
const getJobPriority = (job: Job) => {
    const match = job.notes.match(/#+/);
    return match ? match[0].length : 0;
};
const getJobRoofTypes = (job: Job) => {
    const notesLower = job.notes.toLowerCase();
    return TAG_KEYWORDS.filter(keyword => new RegExp(`\\b${keyword.toLowerCase()}\\b`).test(notesLower));
};
const getJobStories = (job: Job) => {
    const match = job.notes.match(/\b(\d)S\b/i);
    return match ? match[1] : null;
};
const getJobSize = (job: Job) => {
    const match = job.notes.match(/\b(\d+)\s*sq/i);
    return match ? sizeToBucket(parseInt(match[1], 10)) : null;
};
const getJobAge = (job: Job) => {
    const match = job.notes.match(/\b(\d+)\s*yrs\b/i);
    return match ? ageToBucket(parseInt(match[1], 10)) : null;
};

const FilterTabs: React.FC<FilterTabsProps> = ({ unassignedJobs, onFilterChange }) => {
    const [activeTab, setActiveTab] = useState<ActiveTab>('city');

    // State for each filter type
    const [cityFilters, setCityFilters] = useState<Set<string>>(new Set());
    const [timeFilters, setTimeFilters] = useState<Set<string>>(new Set());
    const [tagFilters, setTagFilters] = useState<{
        roofTypes: Set<string>;
        stories: Set<string>;
        sizes: Set<string>;
        priorityLevels: Set<number>;
        ages: Set<string>;
    }>({ roofTypes: new Set(), stories: new Set(), sizes: new Set(), priorityLevels: new Set(), ages: new Set() });

    // Apply a specific filter to jobs (used for computing available options)
    const applyFilter = (jobs: Job[], excludeFilter?: 'city' | 'time' | 'priority' | 'roof' | 'stories' | 'sizes' | 'ages') => {
        let filtered = [...jobs];

        // City filter
        if (excludeFilter !== 'city' && cityFilters.size > 0) {
            filtered = filtered.filter(job => cityFilters.has(getJobCity(job)));
        }

        // Time filter
        if (excludeFilter !== 'time' && timeFilters.size > 0) {
            filtered = filtered.filter(job => timeFilters.has(getJobTime(job)));
        }

        // Priority filter
        if (excludeFilter !== 'priority' && tagFilters.priorityLevels.size > 0) {
            filtered = filtered.filter(job => tagFilters.priorityLevels.has(getJobPriority(job)));
        }

        // Roof type filter
        if (excludeFilter !== 'roof' && tagFilters.roofTypes.size > 0) {
            filtered = filtered.filter(job => {
                const jobRoofTypes = getJobRoofTypes(job);
                return Array.from(tagFilters.roofTypes).some(type => jobRoofTypes.includes(type));
            });
        }

        // Stories filter
        if (excludeFilter !== 'stories' && tagFilters.stories.size > 0) {
            filtered = filtered.filter(job => {
                const stories = getJobStories(job);
                return stories && tagFilters.stories.has(stories);
            });
        }

        // Size filter
        if (excludeFilter !== 'sizes' && tagFilters.sizes.size > 0) {
            filtered = filtered.filter(job => {
                const size = getJobSize(job);
                return size && tagFilters.sizes.has(size);
            });
        }

        // Age filter
        if (excludeFilter !== 'ages' && tagFilters.ages.size > 0) {
            filtered = filtered.filter(job => {
                const age = getJobAge(job);
                return age && tagFilters.ages.has(age);
            });
        }

        return filtered;
    };

    // Fully filtered jobs (all filters applied)
    const filteredJobs = useMemo(() => {
        return applyFilter(unassignedJobs);
    }, [unassignedJobs, cityFilters, timeFilters, tagFilters]);

    // Compute available options based on jobs that would remain if we exclude that specific filter
    const availableCities = useMemo(() => {
        const cityOrder = EAST_TO_WEST_CITIES.reduce((acc, city, index) => {
            acc[city] = index;
            return acc;
        }, {} as Record<string, number>);

        // Get jobs with all filters EXCEPT city
        const jobsForCityOptions = applyFilter(unassignedJobs, 'city');
        const cities = Array.from(new Set(jobsForCityOptions.map(j => getJobCity(j))))
            .sort((a: string, b: string) => {
                const orderA = cityOrder[a.toUpperCase()] ?? 999;
                const orderB = cityOrder[b.toUpperCase()] ?? 999;
                return orderA - orderB;
            });

        return cities;
    }, [unassignedJobs, timeFilters, tagFilters]);

    const availableTimeSlots = useMemo(() => {
        // Get jobs with all filters EXCEPT time
        const jobsForTimeOptions = applyFilter(unassignedJobs, 'time');
        const slots = new Set<string>();
        jobsForTimeOptions.forEach(job => {
            slots.add(getJobTime(job));
        });
        return Array.from(slots).sort((a, b) => {
            if (a === 'Unspecified') return 1;
            if (b === 'Unspecified') return -1;
            const getStartHour = (s: string) => {
                const match = s.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
                if (!match) return 99;
                let h = parseInt(match[1]);
                const period = match[3]?.toLowerCase();
                if (period === 'pm' && h < 12) h += 12;
                if (period === 'am' && h === 12) h = 0;
                return h;
            };
            return getStartHour(a) - getStartHour(b);
        });
    }, [unassignedJobs, cityFilters, tagFilters]);

    const { availableTags, availablePriorityLevels } = useMemo(() => {
        const roofTypes = new Set<string>();
        const stories = new Set<string>();
        const sizeBuckets = new Set<string>();
        const ageBuckets = new Set<string>();
        const priorityLevels = new Set<number>();

        // For each tag type, compute available options excluding that filter
        const jobsForPriority = applyFilter(unassignedJobs, 'priority');
        jobsForPriority.forEach(job => {
            const level = getJobPriority(job);
            if (level > 0) priorityLevels.add(level);
        });

        const jobsForRoof = applyFilter(unassignedJobs, 'roof');
        jobsForRoof.forEach(job => {
            getJobRoofTypes(job).forEach(type => roofTypes.add(type));
        });

        const jobsForStories = applyFilter(unassignedJobs, 'stories');
        jobsForStories.forEach(job => {
            const s = getJobStories(job);
            if (s) stories.add(s);
        });

        const jobsForSizes = applyFilter(unassignedJobs, 'sizes');
        jobsForSizes.forEach(job => {
            const size = getJobSize(job);
            if (size) sizeBuckets.add(size);
        });

        const jobsForAges = applyFilter(unassignedJobs, 'ages');
        jobsForAges.forEach(job => {
            const age = getJobAge(job);
            if (age) ageBuckets.add(age);
        });

        return {
            availableTags: {
                roofTypes: Array.from(roofTypes).sort(),
                stories: Array.from(stories).sort((a, b) => parseInt(a, 10) - parseInt(b, 10)),
                sizes: ['< 1500 sqft', '1500-2500 sqft', '> 2500 sqft'].filter(bucket => sizeBuckets.has(bucket)),
                ages: ['0-5 yrs', '6-10 yrs', '11-15 yrs', '16-20 yrs', '> 20 yrs'].filter(bucket => ageBuckets.has(bucket)),
            },
            availablePriorityLevels: Array.from(priorityLevels).sort(),
        };
    }, [unassignedJobs, cityFilters, timeFilters, tagFilters]);

    // Effect to notify parent of filtered jobs
    useEffect(() => {
        onFilterChange(filteredJobs);
    }, [filteredJobs, onFilterChange]);

    const handleClearFilters = () => {
        setCityFilters(new Set());
        setTimeFilters(new Set());
        setTagFilters({ roofTypes: new Set(), stories: new Set(), sizes: new Set(), priorityLevels: new Set(), ages: new Set() });
    };

    const hasActiveFilters = cityFilters.size > 0 || timeFilters.size > 0 ||
        tagFilters.roofTypes.size > 0 || tagFilters.stories.size > 0 ||
        tagFilters.sizes.size > 0 || tagFilters.priorityLevels.size > 0 ||
        tagFilters.ages.size > 0;

    const renderTabContent = () => {
        switch (activeTab) {
            case 'city':
                return (
                    <div className="flex flex-wrap gap-1.5 items-center">
                        {availableCities.length > 0 ? availableCities.map(city => (
                            <button key={city}
                                onClick={(e) => {
                                    e.preventDefault();
                                    if (e.altKey) {
                                        setCityFilters(prev => { const n = new Set(prev); n.has(city) ? n.delete(city) : n.add(city); return n; });
                                    } else {
                                        setCityFilters(prev => { if (prev.has(city) && prev.size === 1) return new Set(); return new Set([city]); });
                                    }
                                }}
                                className={`${cityFilters.has(city) ? chipActiveClass : chipInactiveClass} ${chipBaseClass}`}>
                                {city}
                            </button>
                        )) : (
                            <span className="text-xs text-text-quaternary italic">No cities match current filters</span>
                        )}
                    </div>
                );
            case 'time':
                return (
                    <div className="flex flex-wrap gap-1.5 items-center">
                        {availableTimeSlots.length > 0 ? availableTimeSlots.map(slot => (
                            <button key={slot}
                                onClick={(e) => {
                                    e.preventDefault();
                                    if (e.altKey) {
                                        setTimeFilters(prev => { const n = new Set(prev); n.has(slot) ? n.delete(slot) : n.add(slot); return n; });
                                    } else {
                                        setTimeFilters(prev => { if (prev.has(slot) && prev.size === 1) return new Set(); return new Set([slot]); });
                                    }
                                }}
                                className={`${timeFilters.has(slot) ? chipActiveClass : chipInactiveClass} ${chipBaseClass}`}>
                                {slot}
                            </button>
                        )) : (
                            <span className="text-xs text-text-quaternary italic">No time slots match current filters</span>
                        )}
                    </div>
                );
            case 'tags':
                const hasAnyTags = availablePriorityLevels.length > 0 || availableTags.roofTypes.length > 0 ||
                    availableTags.stories.length > 0 || availableTags.ages.length > 0 || availableTags.sizes.length > 0;

                if (!hasAnyTags) {
                    return <span className="text-xs text-text-quaternary italic">No tags match current filters</span>;
                }

                return (
                    <div className="space-y-1.5">
                        {availablePriorityLevels.length > 0 && (
                            <div className="flex items-start gap-2">
                                <span className="w-12 pt-0.5 text-[9px] font-bold text-text-quaternary uppercase text-right flex-shrink-0">Status</span>
                                <div className="flex flex-wrap gap-1">
                                    {availablePriorityLevels.map(level => (
                                        <button
                                            key={level}
                                            onClick={() => setTagFilters(f => { const n = new Set(f.priorityLevels); n.has(level) ? n.delete(level) : n.add(level); return { ...f, priorityLevels: n }; })}
                                            className={`${tagFilters.priorityLevels.has(level) ? 'bg-tag-amber-bg text-tag-amber-text border-tag-amber-border ring-1 ring-tag-amber-border/50' : chipInactiveClass} ${chipBaseClass}`}
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
                                <span className="w-12 pt-0.5 text-[9px] font-bold text-text-quaternary uppercase text-right flex-shrink-0">Roof</span>
                                <div className="flex flex-wrap gap-1">
                                    {availableTags.roofTypes.map(tag => (
                                        <button key={tag} onClick={() => setTagFilters(f => { const n = new Set(f.roofTypes); n.has(tag) ? n.delete(tag) : n.add(tag); return { ...f, roofTypes: n }; })} className={`${tagFilters.roofTypes.has(tag) ? chipActiveClass : chipInactiveClass} ${chipBaseClass}`}>{tag}</button>
                                    ))}
                                </div>
                            </div>
                        )}
                        {availableTags.stories.length > 0 && (
                            <div className="flex items-start gap-2">
                                <span className="w-12 pt-0.5 text-[9px] font-bold text-text-quaternary uppercase text-right flex-shrink-0">Height</span>
                                <div className="flex flex-wrap gap-1">
                                    {availableTags.stories.map(tag => (
                                        <button key={tag} onClick={() => setTagFilters(f => { const n = new Set(f.stories); n.has(tag) ? n.delete(tag) : n.add(tag); return { ...f, stories: n }; })} className={`${tagFilters.stories.has(tag) ? chipActiveClass : chipInactiveClass} ${chipBaseClass}`}>{tag} Story</button>
                                    ))}
                                </div>
                            </div>
                        )}
                        {availableTags.ages.length > 0 && (
                            <div className="flex items-start gap-2">
                                <span className="w-12 pt-0.5 text-[9px] font-bold text-text-quaternary uppercase text-right flex-shrink-0">Age</span>
                                <div className="flex flex-wrap gap-1">
                                    {availableTags.ages.map(tag => (
                                        <button key={tag} onClick={() => setTagFilters(f => { const n = new Set(f.ages); n.has(tag) ? n.delete(tag) : n.add(tag); return { ...f, ages: n }; })} className={`${tagFilters.ages.has(tag) ? chipActiveClass : chipInactiveClass} ${chipBaseClass}`}>{tag}</button>
                                    ))}
                                </div>
                            </div>
                        )}
                        {availableTags.sizes.length > 0 && (
                            <div className="flex items-start gap-2">
                                <span className="w-12 pt-0.5 text-[9px] font-bold text-text-quaternary uppercase text-right flex-shrink-0">Size</span>
                                <div className="flex flex-wrap gap-1">
                                    {availableTags.sizes.map(tag => (
                                        <button key={tag} onClick={() => setTagFilters(f => { const n = new Set(f.sizes); n.has(tag) ? n.delete(tag) : n.add(tag); return { ...f, sizes: n }; })} className={`${tagFilters.sizes.has(tag) ? chipActiveClass : chipInactiveClass} ${chipBaseClass}`}>{tag}</button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                );
        }
    };

    // Count active filters for each tab
    const cityFilterCount = cityFilters.size;
    const timeFilterCount = timeFilters.size;
    const tagFilterCount = tagFilters.roofTypes.size + tagFilters.stories.size + tagFilters.sizes.size + tagFilters.priorityLevels.size + tagFilters.ages.size;

    return (
        <div className="mb-2">
            <div className="flex p-1 bg-bg-tertiary rounded-lg mb-3 gap-1 select-none">
                <button
                    onClick={() => setActiveTab('city')}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1 text-xs font-bold rounded-md transition-all duration-200 ${activeTab === 'city'
                        ? 'bg-bg-primary text-brand-primary shadow-sm ring-1 ring-border-primary'
                        : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-quaternary/50'
                        }`}
                >
                    <MapPinIcon className={`h-3.5 w-3.5 ${activeTab === 'city' ? 'text-brand-primary' : 'text-text-quaternary'}`} />
                    <span>By City</span>
                    {cityFilterCount > 0 && (
                        <span className="px-1.5 py-0.5 text-[9px] rounded-full bg-brand-primary text-brand-text-on-primary">{cityFilterCount}</span>
                    )}
                </button>
                <button
                    onClick={() => setActiveTab('time')}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1 text-xs font-bold rounded-md transition-all duration-200 ${activeTab === 'time'
                        ? 'bg-bg-primary text-brand-primary shadow-sm ring-1 ring-border-primary'
                        : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-quaternary/50'
                        }`}
                >
                    <ClockIcon className={`h-3.5 w-3.5 ${activeTab === 'time' ? 'text-brand-primary' : 'text-text-quaternary'}`} />
                    <span>By Time</span>
                    {timeFilterCount > 0 && (
                        <span className="px-1.5 py-0.5 text-[9px] rounded-full bg-brand-primary text-brand-text-on-primary">{timeFilterCount}</span>
                    )}
                </button>
                <button
                    onClick={() => setActiveTab('tags')}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1 text-xs font-bold rounded-md transition-all duration-200 ${activeTab === 'tags'
                        ? 'bg-bg-primary text-brand-primary shadow-sm ring-1 ring-border-primary'
                        : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-quaternary/50'
                        }`}
                >
                    <TagIcon className={`h-3.5 w-3.5 ${activeTab === 'tags' ? 'text-brand-primary' : 'text-text-quaternary'}`} />
                    <span>By Tags</span>
                    {tagFilterCount > 0 && (
                        <span className="px-1.5 py-0.5 text-[9px] rounded-full bg-brand-primary text-brand-text-on-primary">{tagFilterCount}</span>
                    )}
                </button>
            </div>
            <div className="flex items-center justify-between px-1 mb-1">
                <span className="text-[10px] font-bold text-text-quaternary uppercase tracking-wider">
                    {activeTab === 'city' ? 'Filter by City (Alt+Click for Multi)' : activeTab === 'time' ? 'Filter by Time Slot (Alt+Click for Multi)' : 'Filter by Attributes'}
                </span>
                {hasActiveFilters && (
                    <button onClick={handleClearFilters} className="text-[10px] font-bold text-tag-red-text hover:text-tag-red-text/80 flex items-center gap-1 transition-colors px-2 py-0.5 rounded hover:bg-tag-red-bg">
                        <XIcon className="h-3 w-3" /> Clear Filters
                    </button>
                )}
            </div>
            <div className="max-h-[140px] overflow-y-auto p-2 bg-bg-primary rounded-lg border border-border-primary shadow-sm custom-scrollbar">
                {renderTabContent()}
            </div>
        </div>
    );
};

export default FilterTabs;
