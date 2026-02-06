import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useAppContext } from '../context/AppContext';
import RepSchedule from './RepSchedule';
import { DayViewPanel } from './DayView';
import { LoadingIcon, ErrorIcon, SearchIcon, ExpandAllIcon, CollapseAllIcon, UnassignAllIcon, LockIcon, UnlockIcon, XIcon, TrophyIcon, ListIcon, GridIcon } from './icons';
import { SortKey, Job, Rep, DisplayJob } from '../types';
import { TIME_SLOTS, TIME_SLOT_DISPLAY_LABELS } from '../constants';

// Helper function to format rep names for the filter tags
const formatRepNameForFilter = (fullName: string): string => {
    const cleanedName = fullName.replace(/"/g, '').trim();
    const parts = cleanedName.split(' ').filter(Boolean);
    if (parts.length === 0) return fullName;
    const firstName = parts[0];
    if (parts.length === 1) return firstName;
    let lastName = '';
    const lastPart = parts[parts.length - 1];
    const regions = ['PHOENIX', 'TUCSON'];
    if (parts.length === 2 && regions.includes(lastPart.toUpperCase())) return firstName;
    if (parts.length === 3 && regions.includes(lastPart.toUpperCase())) lastName = parts[1];
    else if (parts.length > 2 && regions.includes(lastPart.toUpperCase())) lastName = parts[parts.length - 2];
    else lastName = parts[parts.length - 1];
    return `${firstName} ${lastName.charAt(0).toUpperCase()}`;
};

// Helper to check if a rep is London Smith (case-insensitive)
const isLondon = (rep: Rep) => rep.name.trim().toLowerCase().startsWith('london smith');

const chipBaseClass = "px-2 py-0.5 text-[10px] font-medium rounded-full border transition-all duration-200 flex items-center gap-1 select-none cursor-pointer hover:shadow-sm";
const chipActiveClass = "bg-brand-primary text-brand-text-on-primary border-brand-primary shadow-sm ring-1 ring-brand-primary/20";
const chipInactiveClass = "bg-bg-tertiary text-secondary border-border-primary hover:border-brand-primary/50 hover:bg-brand-bg-light hover:text-brand-primary";

// Optimized Rep Styles (Teal)
const chipOptimizedActiveClass = "bg-tag-teal-bg text-tag-teal-text border-tag-teal-border shadow-sm ring-1 ring-tag-teal-border";
const chipOptimizedInactiveClass = "bg-tag-teal-bg/50 text-tag-teal-text border-tag-teal-border/50 hover:border-tag-teal-border hover:bg-tag-teal-bg hover:text-tag-teal-text";

// Fixed palette of maximally distinct, vivid colors — guarantees reds, oranges, etc.
const DISTINCT_PALETTE = [
    '#dc2626', // red
    '#2563eb', // blue
    '#16a34a', // green
    '#ea580c', // orange
    '#7c3aed', // violet
    '#0891b2', // cyan
    '#db2777', // pink
    '#ca8a04', // amber
    '#0d9488', // teal
    '#65a30d', // lime
    '#4f46e5', // indigo
    '#c026d3', // fuchsia
    '#b45309', // dark orange
    '#0e7490', // dark cyan
    '#15803d', // dark green
    '#9333ea', // purple
    '#be123c', // crimson
    '#1d4ed8', // royal blue
];
const getRepColorByPosition = (name: string, allNames: string[]): string => {
    const sorted = [...new Set(allNames)].sort();
    const index = sorted.indexOf(name);
    if (index < 0 || sorted.length === 0) return '#808080';
    return DISTINCT_PALETTE[index % DISTINCT_PALETTE.length];
};

const SchedulesPanel: React.FC = () => {
    const {
        appState, isLoadingReps, repsError, filteredReps,
        expandedRepIds, draggedOverRepId, draggedJob,
        handleJobDrop, handleUnassignJob, handleToggleRepLock, handleUpdateJob, handleRemoveJob,
        handleToggleRepExpansion, handleToggleAllReps, handleShowRoute,
        setDraggedOverRepId, handleJobDragEnd, setDraggedJob,
        sortConfig, setSortConfig, handleClearAllSchedules, assignedJobsCount, isOverrideActive,
        setFilteredAssignedJobs, selectedRepId, setSelectedRepId, selectedDate, checkCityRuleViolation,
        swapSourceRepId, setSwapSourceRepId, handleSwapSchedules,
        uiSettings, updateUiSettings, setHoveredRepId
    } = useAppContext();

    // Get current view mode (default to 'list')
    const viewMode = uiSettings.schedulesViewMode || 'list';

    // Filter States
    const [repSearchTerm, setRepSearchTerm] = useState('');
    const [cityFilters] = useState<Set<string>>(new Set());
    const [lockFilter] = useState<'all' | 'locked' | 'unlocked'>('all');
    const [selectedRepFilters, setSelectedRepFilters] = useState<Set<string>>(new Set());
    const [selectedSlotFilter, setSelectedSlotFilter] = useState<string | null>(null);

    // Determine the actual day name (e.g. "Monday") for the selected date to check availability correctly
    const selectedDay = useMemo(() => selectedDate.toLocaleDateString('en-US', { weekday: 'long' }), [selectedDate]);

    // Apply filters including the search term filter and selected rep filter
    const visibleReps = useMemo(() => {
        let reps = filteredReps('', cityFilters, lockFilter);

        // Filter by selected reps (when clicking on rep chips)
        if (selectedRepFilters.size > 0) {
            reps = reps.filter(rep => selectedRepFilters.has(rep.id));
        }

        // Filter out reps who are unavailable OR already have a job in the selected slot
        if (selectedSlotFilter) {
            reps = reps.filter(rep => {
                // London Smith always appears (special rules - always available except Sundays)
                if (isLondon(rep)) return true;

                // Check if slot is marked as unavailable for this day
                const isUnavailable = rep.unavailableSlots?.[selectedDay]?.includes(selectedSlotFilter) ?? false;
                if (isUnavailable) return false;

                // Check if rep already has a job in this slot
                const slotSchedule = rep.schedule.find(slot => slot.id === selectedSlotFilter);
                const hasJobInSlot = slotSchedule && slotSchedule.jobs.length > 0;
                if (hasJobInSlot) return false;

                return true; // Show rep - they're available and have no job in this slot
            });
        }

        // Filter by search term - search across multiple fields
        if (repSearchTerm) {
            const searchLower = repSearchTerm.toLowerCase();
            reps = reps.filter(rep => {
                // Search in rep name
                if (rep.name.toLowerCase().includes(searchLower)) return true;

                // Search in job details (cities, addresses, tags, customer names)
                return rep.schedule.some(slot =>
                    slot.jobs.some(job => {
                        // Search in city
                        if (job.city?.toLowerCase().includes(searchLower)) return true;
                        // Search in address
                        if (job.address.toLowerCase().includes(searchLower)) return true;
                        // Search in notes (tags)
                        if (job.notes.toLowerCase().includes(searchLower)) return true;
                        // Search in customer name
                        if (job.customerName.toLowerCase().includes(searchLower)) return true;
                        return false;
                    })
                );
            });
        }

        // Sort by availability status - available reps first, unavailable at bottom
        reps = reps.sort((a, b) => {
            const aUnavailableSlots = a.unavailableSlots?.[selectedDay] || [];
            const bUnavailableSlots = b.unavailableSlots?.[selectedDay] || [];

            const aIsFullyUnavailable = aUnavailableSlots.length >= 4 && !a.isOptimized;
            const bIsFullyUnavailable = bUnavailableSlots.length >= 4 && !b.isOptimized;

            // Primary sort: available reps before unavailable reps
            if (aIsFullyUnavailable !== bIsFullyUnavailable) {
                return aIsFullyUnavailable ? 1 : -1;
            }

            // Secondary sort: maintain existing sort order (no change)
            return 0;
        });

        return reps;
    }, [filteredReps, cityFilters, lockFilter, selectedRepFilters, selectedSlotFilter, selectedDay, repSearchTerm]);

    // Helper to check if rep is unavailable for the selected time slot
    const isRepUnavailableForSlot = (rep: Rep): boolean => {
        if (!selectedSlotFilter) return false;
        return rep.unavailableSlots?.[selectedDay]?.includes(selectedSlotFilter) ?? false;
    };

    // Push visible jobs to context for synchronized map filtering.
    // Use a ref to prevent infinite loops by checking content equality (via IDs)
    const prevVisibleJobIdsRef = useRef<string>('');

    useEffect(() => {
        const visibleJobs = visibleReps.flatMap(rep =>
            rep.schedule.flatMap(slot =>
                slot.jobs.map(job => ({ ...job, assignedRepName: rep.name, timeSlotLabel: slot.label }))
            )
        );

        const idsHash = JSON.stringify(visibleJobs.map(j => j.id).sort());
        if (idsHash !== prevVisibleJobIdsRef.current) {
            prevVisibleJobIdsRef.current = idsHash;
            setFilteredAssignedJobs(visibleJobs);
        }
    }, [visibleReps, setFilteredAssignedJobs]);

    const handleSortChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const value = e.target.value;
        if (value.startsWith('skill-')) {
            const skill = value.replace('skill-', '') as any;
            setSortConfig({ key: skill, direction: 'desc' });
        } else {
            setSortConfig({ key: value as SortKey, direction: 'asc' });
        }
    };

    return (
        <div className="flex flex-col h-full min-h-0 overflow-hidden">
            <div className="flex justify-between items-center mb-3 flex-shrink-0">
                <div className="flex items-center gap-2">
                    <div className="flex items-center px-2 py-0.5 bg-tag-amber-bg text-tag-amber-text rounded-full border border-tag-amber-border text-xs font-medium" title="Assigned Jobs">
                        {assignedJobsCount} Assigned
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {/* View Toggle Buttons */}
                    <div className="flex bg-bg-tertiary rounded-md p-0.5 border border-border-primary">
                        <button
                            onClick={() => updateUiSettings({ schedulesViewMode: 'list' })}
                            className={`p-1.5 rounded transition-all ${
                                viewMode === 'list'
                                    ? 'bg-brand-primary text-brand-text-on-primary shadow-sm'
                                    : 'text-text-tertiary hover:text-secondary hover:bg-bg-secondary'
                            }`}
                            title="List View"
                        >
                            <ListIcon className="h-3.5 w-3.5" />
                        </button>
                        <button
                            onClick={() => updateUiSettings({ schedulesViewMode: 'day' })}
                            className={`p-1.5 rounded transition-all ${
                                viewMode === 'day'
                                    ? 'bg-brand-primary text-brand-text-on-primary shadow-sm'
                                    : 'text-text-tertiary hover:text-secondary hover:bg-bg-secondary'
                            }`}
                            title="Day View"
                        >
                            <GridIcon className="h-3.5 w-3.5" />
                        </button>
                    </div>

                    <div className="relative group">
                        <input
                            type="text"
                            className={`
                        pl-8 pr-7 py-1.5 text-xs border border-primary bg-secondary text-primary placeholder:text-secondary
                        rounded-md focus:ring-2 focus:ring-brand-primary focus:outline-none hover:bg-tertiary
                        transition-all w-32 focus:w-48
                        ${repSearchTerm ? 'w-48' : ''}
                    `}
                            placeholder="Search reps..."
                            value={repSearchTerm}
                            onChange={e => setRepSearchTerm(e.target.value)}
                        />
                        <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-text-quaternary group-focus-within:text-brand-primary transition-colors">
                            <SearchIcon className="h-3.5 w-3.5" />
                        </div>
                        {repSearchTerm && (
                            <button onClick={() => setRepSearchTerm('')} className="absolute inset-y-0 right-0 pr-2 flex items-center text-text-quaternary hover:text-secondary cursor-pointer">
                                <XIcon className="h-3 w-3" />
                            </button>
                        )}
                    </div>

                </div>
            </div>

            {/* Time Slot Filter Buttons */}
            <div className="bg-secondary rounded-lg p-2 mb-2 border border-border-primary flex-shrink-0">
                <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-bold text-text-quaternary uppercase tracking-wider">
                        Filter by Time Slot
                    </span>
                    {selectedSlotFilter && (
                        <button
                            onClick={() => setSelectedSlotFilter(null)}
                            className="text-[10px] font-bold text-brand-primary hover:text-brand-primary/80 transition-colors"
                        >
                            Clear
                        </button>
                    )}
                </div>
                <div className="flex gap-1.5">
                    {TIME_SLOTS.map(slot => (
                        <button
                            key={slot.id}
                            onClick={() => setSelectedSlotFilter(selectedSlotFilter === slot.id ? null : slot.id)}
                            className={`${chipBaseClass} ${
                                selectedSlotFilter === slot.id
                                    ? chipActiveClass
                                    : chipInactiveClass
                            }`}
                        >
                            {TIME_SLOT_DISPLAY_LABELS[slot.id] || slot.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Rep Filter Buttons */}
            <div className="bg-secondary rounded-lg p-2 mb-3 border border-border-primary flex-shrink-0">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-bold text-text-quaternary uppercase tracking-wider">
                        Filter by Rep (Click to Select)
                    </span>
                    {(selectedRepFilters.size > 0 || repSearchTerm) && (
                        <button
                            onClick={() => { setSelectedRepFilters(new Set()); setRepSearchTerm(''); setSelectedRepId(null); }}
                            className="text-[10px] font-bold text-tag-red-text hover:text-tag-red-text/80 flex items-center gap-1 transition-colors px-2 py-0.5 rounded hover:bg-tag-red-bg"
                        >
                            <XIcon className="h-3 w-3" /> Clear Filters {selectedRepFilters.size > 0 && `(${selectedRepFilters.size})`}
                        </button>
                    )}
                </div>
                <div className="max-h-[100px] overflow-y-auto p-2 bg-primary rounded border border-border-primary custom-scrollbar">
                    <div className="flex flex-wrap gap-1.5 items-center">
                        {appState.reps
                            .filter(rep => {
                                // London Smith always appears (special rules - always available except Sundays)
                                if (isLondon(rep)) return true;

                                // If time slot filter is active, hide reps unavailable or with job in that slot
                                if (selectedSlotFilter) {
                                    const isUnavailable = rep.unavailableSlots?.[selectedDay]?.includes(selectedSlotFilter) ?? false;
                                    if (isUnavailable) return false;

                                    const slotSchedule = rep.schedule.find(slot => slot.id === selectedSlotFilter);
                                    const hasJobInSlot = slotSchedule && slotSchedule.jobs.length > 0;
                                    if (hasJobInSlot) return false;
                                }

                                // Only show available reps in the filter section (hide fully unavailable reps)
                                const unavailableSlots = rep.unavailableSlots?.[selectedDay] || [];
                                const isFullyUnavailable = unavailableSlots.length >= 4;
                                return !isFullyUnavailable;
                            })
                            .sort((a, b) => {
                                // Sort by salesRank (lower rank = better = comes first)
                                const aRank = a.salesRank ?? 999;
                                const bRank = b.salesRank ?? 999;
                                if (aRank !== bRank) return aRank - bRank;
                                // Fallback to name if ranks are equal
                                return a.name.localeCompare(b.name);
                            })
                            .map(rep => {
                                const isSelected = selectedRepFilters.has(rep.id);
                                const jobCount = rep.schedule.flatMap(s => s.jobs).length;
                                const isOptimized = rep.isOptimized;
                                const isDoubleBooked = rep.schedule.some(slot => slot.jobs.length > 1);

                                let chipClass = isSelected ? chipActiveClass : chipInactiveClass;

                                // Double-booked takes priority for visual warning
                                if (isDoubleBooked) {
                                    chipClass = "bg-tag-red-bg text-tag-red-text border-tag-red-border ring-2 ring-tag-red-border/50";
                                } else if (isOptimized) {
                                    chipClass = isSelected ? chipOptimizedActiveClass : chipOptimizedInactiveClass;
                                }

                                if (rep.isLocked && !isDoubleBooked) {
                                    chipClass += " ring-2 ring-tag-amber-border border-tag-amber-border z-10";
                                }

                                // Swap Mode Styling
                                const isSwapSource = swapSourceRepId === rep.id;
                                const isSwapTarget = swapSourceRepId && !isSwapSource && !rep.isLocked && !rep.isOptimized;
                                const isSwapDisabled = swapSourceRepId && (rep.isLocked || rep.isOptimized || isSwapSource);

                                if (isSwapSource) {
                                    chipClass = "bg-brand-primary text-brand-text-on-primary border-brand-primary shadow ring-2 ring-brand-primary ring-offset-1";
                                } else if (isSwapTarget) {
                                    chipClass = "bg-bg-secondary text-text-primary border-brand-primary border-dashed hover:bg-brand-bg-light hover:border-solid animate-pulse cursor-pointer";
                                } else if (isSwapDisabled && !isLondon(rep)) {
                                    // London Smith never gets desaturated styling - always show in full color
                                    chipClass = "opacity-40 cursor-not-allowed bg-bg-tertiary text-text-quaternary border-border-primary";
                                }

                                // Calculate availability for this day
                                // London Smith always shows 4 available slots regardless of sheet data
                                const unavailableSlotsToday = rep.unavailableSlots?.[selectedDay] || [];
                                const availableSlots = isLondon(rep) ? 4 : 4 - unavailableSlotsToday.length;

                                return (
                                    <button
                                        key={rep.id}
                                        onMouseEnter={() => setHoveredRepId(rep.id)}
                                        onMouseLeave={() => setHoveredRepId(null)}
                                        onClick={() => {
                                            if (swapSourceRepId) {
                                                if (isSwapTarget) {
                                                    handleSwapSchedules(swapSourceRepId, rep.id);
                                                    setSwapSourceRepId(null);
                                                }
                                            } else {
                                                // Left-click: single select (clears others) or deselect if already selected
                                                if (isSelected && selectedRepFilters.size === 1) {
                                                    // Only this one selected, clear selection
                                                    setSelectedRepFilters(new Set());
                                                    setSelectedRepId(null);
                                                } else {
                                                    // Select only this rep
                                                    setSelectedRepFilters(new Set([rep.id]));
                                                    setSelectedRepId(rep.id);
                                                }
                                            }
                                        }}
                                        onContextMenu={(e) => {
                                            e.preventDefault();
                                            if (swapSourceRepId) return;
                                            // Right-click: toggle this rep in multi-select
                                            setSelectedRepFilters(prev => {
                                                const newSet = new Set(prev);
                                                if (newSet.has(rep.id)) {
                                                    newSet.delete(rep.id);
                                                } else {
                                                    newSet.add(rep.id);
                                                }
                                                return newSet;
                                            });
                                            // Set map highlight to most recently added, or null if all removed
                                            setSelectedRepId(isSelected ? null : rep.id);
                                        }}
                                        disabled={!!isSwapDisabled}
                                        title={isDoubleBooked ? `${rep.name} - Double Booked!` : `${rep.name} - ${availableSlots}/4 slots available (Right-click to multi-select)`}
                                        className={`${chipClass} ${chipBaseClass}`}
                                    >
                                        <span
                                            className="w-2.5 h-2.5 rounded-full flex-shrink-0 ring-1 ring-inset ring-black/10"
                                            style={{ backgroundColor: rep.customColor || getRepColorByPosition(rep.name, appState.reps.map(r => r.name)) }}
                                        />
                                        {formatRepNameForFilter(rep.name)}
                                        {/* Assigned/Available indicator - red if no jobs, green if 1+ */}
                                        <span className={`ml-1 text-[8px] font-medium ${
                                            isSelected
                                                ? 'text-white'
                                                : jobCount === 0
                                                    ? 'text-tag-red-text'
                                                    : 'text-tag-teal-text'
                                        }`}>
                                            {jobCount}/{availableSlots}
                                        </span>
                                    </button>
                                );
                            })}
                    </div>
                </div>
            </div>

            {/* Conditional rendering based on view mode */}
            {viewMode === 'list' ? (
                <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
                    {/* List View Controls */}
                    <div className="flex flex-wrap gap-2 mb-3 items-center justify-between bg-primary p-1 rounded border border-border-primary flex-shrink-0">
                        <div className="flex items-center space-x-1">
                            <button
                                onClick={() => handleToggleAllReps(visibleReps)}
                                className="p-1.5 rounded hover:bg-tertiary text-text-tertiary hover:text-brand-primary transition"
                                title={expandedRepIds.size === visibleReps.length ? "Collapse All" : "Expand All"}
                            >
                                {expandedRepIds.size === visibleReps.length ? <CollapseAllIcon className="h-4 w-4" /> : <ExpandAllIcon className="h-4 w-4" />}
                            </button>

                            <button
                                onClick={handleClearAllSchedules}
                                disabled={assignedJobsCount === 0}
                                className="p-1.5 rounded hover:bg-tag-red-bg text-text-quaternary hover:text-tag-red-text transition disabled:opacity-30"
                                title="Unassign All Jobs"
                            >
                                <UnassignAllIcon className="h-4 w-4" />
                            </button>

                            <div className="h-4 w-px bg-border-primary mx-1"></div>

                            <button
                                onClick={() => setLockFilter(prev => prev === 'locked' ? 'all' : 'locked')}
                                className={`p-1.5 rounded transition ${lockFilter === 'locked' ? 'bg-tag-amber-bg text-tag-amber-text' : 'text-text-quaternary hover:bg-tertiary hover:text-secondary'}`}
                                title="Show Locked Only"
                            >
                                <LockIcon className="h-3.5 w-3.5" />
                            </button>
                            <button
                                onClick={() => setLockFilter(prev => prev === 'unlocked' ? 'all' : 'unlocked')}
                                className={`p-1.5 rounded transition ${lockFilter === 'unlocked' ? 'bg-brand-bg-light text-brand-text-light' : 'text-text-quaternary hover:bg-tertiary hover:text-secondary'}`}
                                title="Show Unlocked Only"
                            >
                                <UnlockIcon className="h-3.5 w-3.5" />
                            </button>
                        </div>

                        <div className="flex items-center space-x-2">
                            <label htmlFor="sort-select" className="text-xs font-semibold text-text-tertiary">Sort:</label>
                            <select
                                id="sort-select"
                                className="text-xs border border-primary rounded p-1 focus:ring-2 focus:ring-brand-primary focus:outline-none bg-secondary text-primary hover:bg-tertiary"
                                value={sortConfig.key === 'Tile' || sortConfig.key === 'Shingle' || sortConfig.key === 'Flat' ? `skill-${sortConfig.key}` : sortConfig.key}
                                onChange={handleSortChange}
                            >
                                <option value="name">Name (A-Z)</option>
                                <option value="salesRank">Sales Rank (Best First)</option>
                                <option value="jobCount">Most Jobs</option>
                                <option value="cityCount">City Spread</option>
                                <option value="availability">Availability</option>
                                <option value="skillCount">Total Skill Level</option>
                                <optgroup label="By Skill Level">
                                    <option value="skill-Tile">Best Tile</option>
                                    <option value="skill-Shingle">Best Shingle</option>
                                    <option value="skill-Flat">Best Flat</option>
                                    <option value="skill-Metal">Best Metal</option>
                                    <option value="skill-Insurance">Best Insurance</option>
                                    <option value="skill-Commercial">Best Commercial</option>
                                </optgroup>
                            </select>
                        </div>
                    </div>

                    {/* List View Content */}
                    <div className="flex-grow overflow-y-auto min-h-0 space-y-2 pr-1 custom-scrollbar">
                        {isLoadingReps ? (
                            <div className="flex flex-col items-center justify-center h-32 text-text-tertiary">
                                <LoadingIcon className="text-brand-primary h-8 w-8 mb-2" />
                                <p className="text-sm font-medium">Loading Reps...</p>
                            </div>
                        ) : repsError ? (
                            <div className="flex flex-col items-center justify-center h-32 text-tag-red-text bg-tag-red-bg rounded-lg p-4 border border-tag-red-border">
                                <ErrorIcon className="h-8 w-8 mb-2" />
                                <p className="text-sm text-center">{repsError}</p>
                            </div>
                        ) : visibleReps.length > 0 ? (
                            visibleReps.map(rep => {
                                // Highlight rep if search term matches rep name OR if rep is explicitly selected
                                const isHighlighted = (repSearchTerm && rep.name.toLowerCase().includes(repSearchTerm.toLowerCase())) || selectedRepFilters.has(rep.id);
                                return (
                                    <RepSchedule
                                        key={rep.id}
                                        rep={rep}
                                        selectedDay={selectedDay}
                                        onJobDrop={handleJobDrop}
                                        onUnassign={handleUnassignJob}
                                        onToggleLock={handleToggleRepLock}
                                        onUpdateJob={handleUpdateJob}
                                        onRemoveJob={handleRemoveJob}
                                        isSelected={rep.id === selectedRepId}
                                        onSelectRep={(e) => {
                                            // Toggle rep selection - clicking again deselects
                                            const newSelectedId = selectedRepId === rep.id ? null : rep.id;
                                            setSelectedRepId(newSelectedId);
                                            // Show route on map when rep is selected
                                            if (newSelectedId) {
                                                handleShowRoute(newSelectedId, false);
                                            }
                                        }}
                                        isExpanded={expandedRepIds.has(rep.id)}
                                        onToggleExpansion={() => handleToggleRepExpansion(rep.id)}
                                        draggedOverRepId={draggedOverRepId}
                                        onSetDraggedOverRepId={setDraggedOverRepId}
                                        onJobDragStart={setDraggedJob}
                                        onJobDragEnd={handleJobDragEnd}
                                        draggedJob={draggedJob}
                                        isInvalidDropTarget={draggedJob ? checkCityRuleViolation(rep, draggedJob.city).violated : false}
                                        invalidReason="Max Cities Reached"
                                        isOverrideActive={isOverrideActive}
                                        isHighlighted={isHighlighted}
                                        selectedRepName={repSearchTerm || undefined}
                                        isUnavailableForSlot={isRepUnavailableForSlot(rep)}
                                    />
                                );
                            })
                        ) : (
                            <div className="flex flex-col items-center justify-center h-32 text-text-quaternary">
                                <p className="text-sm italic">No reps match your filter.</p>
                            </div>
                        )}
                    </div>
                </div>
            ) : (
                /* Day View */
                <div className="flex-1 min-h-0 flex flex-col">
                    <DayViewPanel reps={visibleReps} />
                </div>
            )}
        </div>
    );
};

export default SchedulesPanel;
