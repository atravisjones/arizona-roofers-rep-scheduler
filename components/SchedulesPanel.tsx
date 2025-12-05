import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useAppContext } from '../context/AppContext';
import RepSchedule from './RepSchedule';
import { LoadingIcon, ErrorIcon, SearchIcon, DragHandleIcon, ExpandAllIcon, CollapseAllIcon, UnassignAllIcon, LockIcon, UnlockIcon, XIcon, UserIcon, MapPinIcon, TagIcon, StarIcon, RoofIcon, StoriesIcon, SizeIcon, ChevronDownIcon, TrophyIcon } from './icons';
import { SortKey, Job, Rep, DisplayJob } from '../types';
import { EAST_TO_WEST_CITIES } from '../services/geography';
import { TIME_SLOTS, TAG_KEYWORDS } from '../constants';

type ActiveTab = 'rep' | 'city' | 'tags' | 'skills';

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

const TabButton: React.FC<{ 
    tabId: ActiveTab; 
    activeTab: ActiveTab; 
    label: string; 
    icon: React.ReactNode; 
    onClick: (tab: ActiveTab) => void;
}> = ({ tabId, activeTab, label, icon, onClick }) => (
    <button
        onClick={() => onClick(tabId)}
        className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1 text-xs font-bold rounded-md transition-all duration-200 ${
            activeTab === tabId 
            ? 'bg-primary text-brand-primary shadow-sm ring-1 ring-border-primary' 
            : 'text-text-tertiary hover:text-secondary hover:bg-quaternary/50'
        }`}
    >
        {React.cloneElement(icon as React.ReactElement<{ className?: string }>, { 
            className: `h-3.5 w-3.5 ${activeTab === tabId ? 'text-brand-primary' : 'text-text-tertiary'}` 
        })}
        <span>{label}</span>
    </button>
);

const chipBaseClass = "px-2 py-0.5 text-[10px] font-medium rounded-full border transition-all duration-200 flex items-center gap-1 select-none cursor-pointer hover:shadow-sm";
const chipActiveClass = "bg-brand-primary text-brand-text-on-primary border-brand-primary shadow-sm ring-1 ring-brand-primary/20";
const chipInactiveClass = "bg-primary text-secondary border-border-primary hover:border-brand-primary/50 hover:bg-brand-bg-light hover:text-brand-primary";

// Optimized Rep Styles (Teal)
const chipOptimizedActiveClass = "bg-tag-teal-bg text-tag-teal-text border-tag-teal-border shadow-sm ring-1 ring-tag-teal-border";
const chipOptimizedInactiveClass = "bg-tag-teal-bg/50 text-tag-teal-text border-tag-teal-border/50 hover:border-tag-teal-border hover:bg-tag-teal-bg hover:text-tag-teal-text";

interface SchedulesPanelProps {
    onDragStart: () => void;
    onDragEnd: () => void;
}

const SchedulesPanel: React.FC<SchedulesPanelProps> = ({ onDragStart, onDragEnd }) => {
  const { 
      appState, isLoadingReps, repsError, filteredReps, 
      expandedRepIds, draggedOverRepId, draggedJob,
      handleJobDrop, handleUnassignJob, handleToggleRepLock, handleUpdateJob, handleRemoveJob,
      handleToggleRepExpansion, handleToggleAllReps, handleShowRoute,
      setDraggedOverRepId, handleJobDragEnd, setDraggedJob,
      sortConfig, setSortConfig, handleClearAllSchedules, assignedJobsCount, isOverrideActive,
      setFilteredAssignedJobs, selectedRepId, selectedDate, checkCityRuleViolation
  } = useAppContext();

  // Filter States
  const [repSearchTerm, setRepSearchTerm] = useState('');
  const [cityFilters, setCityFilters] = useState<Set<string>>(new Set());
  const [lockFilter, setLockFilter] = useState<'all' | 'locked' | 'unlocked'>('all');
  const [activeTab, setActiveTab] = useState<ActiveTab>('rep');

  // Determine the actual day name (e.g. "Monday") for the selected date to check availability correctly
  const selectedDay = useMemo(() => selectedDate.toLocaleDateString('en-US', { weekday: 'long' }), [selectedDate]);

  const visibleReps = useMemo(() => filteredReps(repSearchTerm, cityFilters, lockFilter), [filteredReps, repSearchTerm, cityFilters, lockFilter]);

  const assignedCities = useMemo(() => {
      const cities = new Set<string>();
      appState.reps.forEach(rep => {
          rep.schedule.forEach(slot => slot.jobs.forEach(job => {
              if (job.city) cities.add(job.city);
          }));
      });
      return Array.from(cities).sort();
  }, [appState.reps]);

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

  const renderFilterTabContent = () => {
      switch (activeTab) {
          case 'rep':
              return (
                  <div className="flex flex-wrap gap-1.5 items-center">
                      {appState.reps
                        .filter(rep => {
                            // Only show reps who are working (have jobs OR have available slots)
                            const jobCount = rep.schedule.flatMap(s => s.jobs).length;
                            const unavailableSlots = rep.unavailableSlots?.[selectedDay] || [];
                            const isFullyUnavailable = unavailableSlots.length === TIME_SLOTS.length && !rep.isOptimized;
                            return jobCount > 0 || !isFullyUnavailable;
                        })
                        .map(rep => {
                          const isMatch = rep.name.toLowerCase().includes(repSearchTerm.toLowerCase()) && repSearchTerm !== '';
                          const jobCount = rep.schedule.flatMap(s => s.jobs).length;
                          const isOptimized = rep.isOptimized;
                          
                          let chipClass = isMatch ? chipActiveClass : chipInactiveClass;
                          if (isOptimized) {
                              chipClass = isMatch ? chipOptimizedActiveClass : chipOptimizedInactiveClass;
                          }
                          
                          return (
                              <button key={rep.id} 
                                  onClick={() => setRepSearchTerm(prev => prev === rep.name ? '' : rep.name)} 
                                  className={`${chipClass} ${chipBaseClass}`}>
                                  {formatRepNameForFilter(rep.name)}
                                  {jobCount > 0 && (
                                      <span className={`ml-1.5 flex items-center justify-center h-4 min-w-[16px] px-1 text-[9px] font-bold rounded-full ${
                                          isMatch 
                                            ? (isOptimized ? 'bg-tag-teal-text text-primary' : 'bg-brand-secondary text-brand-text-on-primary') 
                                            : (isOptimized ? 'bg-tag-teal-bg text-tag-teal-text' : 'bg-brand-bg-light text-brand-text-light')
                                      }`}>
                                          {jobCount}
                                      </span>
                                  )}
                              </button>
                          );
                      })}
                  </div>
              );
          case 'city':
              return (
                  <div className="flex flex-wrap gap-1.5 items-center">
                      {assignedCities.map(city => (
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
                      ))}
                  </div>
              );
          case 'tags':
          case 'skills': // Reusing UI for simplicity or expand later
              return <div className="text-xs text-text-quaternary italic p-2 text-center">Filter by tags/skills coming soon. Use search for now.</div>;
      }
  };

  return (
    <>
      <div className="flex justify-between items-center mb-3 border-b border-border-primary pb-2">
        <h2 className="text-base font-bold text-text-primary flex items-center gap-2">
            1. Schedules
            <div className="flex items-center px-2 py-0.5 bg-tag-amber-bg text-tag-amber-text rounded-full border border-tag-amber-border text-xs font-medium" title="Assigned Jobs">
                {assignedJobsCount} Assigned
            </div>
            {visibleReps.length > 0 && (
                <div className="flex items-center px-2 py-0.5 bg-tertiary text-secondary rounded-full border border-border-primary text-xs font-medium" title="Average Score">
                    <TrophyIcon className="h-3 w-3 mr-1 text-tag-amber-text" />
                    <span className="font-bold">Avg: {Math.round(visibleReps.reduce((acc, rep) => {
                        const jobs = rep.schedule.flatMap(s => s.jobs).filter(j => typeof j.assignmentScore === 'number');
                        if (jobs.length === 0) return acc;
                        const repAvg = jobs.reduce((sum, j) => sum + (j.assignmentScore || 0), 0) / jobs.length;
                        return acc + repAvg;
                    }, 0) / (visibleReps.filter(r => r.schedule.flatMap(s => s.jobs).some(j => typeof j.assignmentScore === 'number')).length || 1))}</span>
                </div>
            )}
        </h2>
        
        <div className="flex items-center gap-2">
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
            
            <div
                draggable
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                className="p-1.5 cursor-grab text-border-tertiary hover:text-secondary hover:bg-tertiary rounded-md transition-colors active:cursor-grabbing"
                title="Drag to reorder column"
            >
                <DragHandleIcon className="h-4 w-4" />
            </div>
        </div>
      </div>

      {/* Filters Section */}
      <div className="bg-secondary rounded-lg p-1.5 mb-3 border border-border-primary">
          <div className="flex gap-1 mb-2 select-none">
                <TabButton activeTab={activeTab} onClick={setActiveTab} tabId="rep" label="By Region" icon={<UserIcon />} />
                <TabButton activeTab={activeTab} onClick={setActiveTab} tabId="city" label="By City" icon={<MapPinIcon />} />
                <TabButton activeTab={activeTab} onClick={setActiveTab} tabId="tags" label="By Attributes" icon={<TagIcon />} />
                <TabButton activeTab={activeTab} onClick={setActiveTab} tabId="skills" label="By Skill" icon={<StarIcon />} />
          </div>
          
          <div className="flex items-center justify-between px-1 mb-1">
                 <span className="text-[10px] font-bold text-text-quaternary uppercase tracking-wider">
                     {activeTab === 'city' ? 'Filter by City (Alt+Click for Multi)' : activeTab === 'rep' ? 'Filter by Rep (Click to Select)' : 'Filter Options'}
                 </span>
                 {(cityFilters.size > 0 || repSearchTerm) && (
                    <button onClick={() => { setCityFilters(new Set()); setRepSearchTerm(''); }} className="text-[10px] font-bold text-tag-red-text hover:text-tag-red-text/80 flex items-center gap-1 transition-colors px-2 py-0.5 rounded hover:bg-tag-red-bg">
                        <XIcon className="h-3 w-3" /> Clear Filters 
                    </button>
                 )}
            </div>

          <div className="max-h-[100px] overflow-y-auto p-2 bg-primary rounded border border-border-primary custom-scrollbar">
              {renderFilterTabContent()}
          </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-3 items-center justify-between bg-primary p-1 rounded border border-border-primary">
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
          visibleReps.map(rep => (
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
              onSelectRep={(e) => { handleShowRoute(rep.id, false); }}
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
            />
          ))
        ) : (
          <div className="flex flex-col items-center justify-center h-32 text-text-quaternary">
            <p className="text-sm italic">No reps match your filter.</p>
          </div>
        )}
      </div>
    </>
  );
};

export default SchedulesPanel;