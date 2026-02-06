import React, { useState, useMemo, useEffect } from 'react';
import { useAppContext } from '../context/AppContext';
import UnassignedJobs from './UnassignedJobs';
import PasteJobsModal from './PasteJobsModal';
import PasteWeekModal from './PasteWeekModal';
import { LoadingIcon, PasteIcon, AutoAssignIcon, SearchIcon, XIcon, MapPinIcon } from './icons';
import FilterTabs from './FilterTabs';
import { JobCard } from './JobCard';
import { Job, DisplayJob } from '../types';
import { DaySchedule } from '../services/weekScheduleParser';

type JobsViewTab = 'unassigned' | 'all';

const JobsPanel: React.FC = () => {
    const {
        isParsing, parsingError, isAutoAssigning, appState,
        handleParseJobs, handleAutoAssign,
        handleUpdateJob, handleRemoveJob, isLoadingReps, handleShowUnassignedJobsOnMap, handleJobDrop,
        setDraggedJob, handleJobDragEnd, setDraggedOverRepId, activeRoute, setFilteredUnassignedJobs,
        allJobs
    } = useAppContext();

    const [jobSearchTerm, setJobSearchTerm] = useState('');
    const [isPasteModalOpen, setIsPasteModalOpen] = useState(false);
    const [isPasteWeekModalOpen, setIsPasteWeekModalOpen] = useState(false);
    const [jobsFilteredByTabs, setJobsFilteredByTabs] = useState<Job[]>(appState.unassignedJobs);
    const [activeViewTab, setActiveViewTab] = useState<JobsViewTab>('unassigned');

    // Filter jobs based on active view tab
    // allJobs from context is unfiltered by schedule column filters (rep/time slot)
    // This ensures Jobs column only filters by its own tags/search
    const jobsForFilter = useMemo(() => {
        return activeViewTab === 'unassigned' ? appState.unassignedJobs : allJobs;
    }, [activeViewTab, appState.unassignedJobs, allJobs]);

    // Apply search filter on top of tab-filtered jobs
    const filteredJobs = useMemo(() => {
        // jobsFilteredByTabs already contains the filter-tab filtered results
        let jobsToSearch = jobsFilteredByTabs;

        if (!jobSearchTerm.trim()) {
            return jobsToSearch;
        }

        const lowercasedFilter = jobSearchTerm.toLowerCase();
        return jobsToSearch.filter(job => {
            return (
                job.customerName.toLowerCase().includes(lowercasedFilter) ||
                job.address.toLowerCase().includes(lowercasedFilter) ||
                (job.city || '').toLowerCase().includes(lowercasedFilter) ||
                job.notes.toLowerCase().includes(lowercasedFilter) ||
                ((job as any).assignedRepName || '').toLowerCase().includes(lowercasedFilter)
            );
        });
    }, [jobsFilteredByTabs, jobSearchTerm]);

    // Push filtered unassigned jobs to context for synchronized map filtering
    useEffect(() => {
        if (activeViewTab === 'unassigned') {
            setFilteredUnassignedJobs(filteredJobs);
        }
    }, [filteredJobs, setFilteredUnassignedJobs, activeViewTab]);

    const handleParseWeekSchedule = async (days: DaySchedule[], onComplete: () => void) => {
        for (let i = 0; i < days.length; i++) {
            const day = days[i];
            await new Promise<void>((resolve) => {
                handleParseJobs(day.content, () => {
                    resolve();
                });
            });
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        onComplete();
    };

    const unassignedCount = appState.unassignedJobs.length;
    const allJobsCount = allJobs.length;

    return (
        <>
            <div className="flex justify-between items-center mb-1">
                <span className="px-2 py-0.5 bg-tertiary text-secondary rounded-full text-xs font-medium">
                    {activeViewTab === 'unassigned' ? unassignedCount : allJobsCount} jobs
                </span>

                <div className="flex items-center gap-1">
                    <div className="relative group">
                        <input
                            type="text"
                            className={`
                                pl-8 pr-7 py-1 text-xs border border-primary bg-secondary text-primary placeholder:text-secondary
                                rounded-md focus:ring-2 focus:ring-brand-primary focus:outline-none hover:bg-tertiary
                                transition-all w-28 focus:w-48
                                ${jobSearchTerm ? 'w-48' : ''}
                            `}
                            placeholder="Search jobs..."
                            value={jobSearchTerm}
                            onChange={e => setJobSearchTerm(e.target.value)}
                        />
                        <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-text-quaternary">
                            <SearchIcon className="h-3.5 w-3.5" />
                        </div>
                        {jobSearchTerm && (
                            <button onClick={() => setJobSearchTerm('')} className="absolute inset-y-0 right-0 pr-2 flex items-center text-text-quaternary hover:text-secondary cursor-pointer">
                                <XIcon className="h-3 w-3" />
                            </button>
                        )}
                    </div>

                </div>
            </div>

            {/* Unassigned / All Jobs Tabs */}
            <div className="flex p-1 bg-bg-tertiary rounded-lg mb-2 gap-1 select-none">
                <button
                    onClick={() => setActiveViewTab('unassigned')}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-md transition-all duration-200 ${
                        activeViewTab === 'unassigned'
                            ? 'bg-bg-primary text-brand-primary shadow-sm ring-1 ring-border-primary'
                            : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-quaternary/50'
                    }`}
                >
                    Unassigned
                    <span className={`px-1.5 py-0.5 text-[10px] rounded-full ${
                        activeViewTab === 'unassigned'
                            ? 'bg-brand-primary text-brand-text-on-primary'
                            : 'bg-bg-quaternary text-text-tertiary'
                    }`}>
                        {unassignedCount}
                    </span>
                </button>
                <button
                    onClick={() => setActiveViewTab('all')}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-md transition-all duration-200 ${
                        activeViewTab === 'all'
                            ? 'bg-bg-primary text-brand-primary shadow-sm ring-1 ring-border-primary'
                            : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-quaternary/50'
                    }`}
                >
                    All Jobs
                    <span className={`px-1.5 py-0.5 text-[10px] rounded-full ${
                        activeViewTab === 'all'
                            ? 'bg-brand-primary text-brand-text-on-primary'
                            : 'bg-bg-quaternary text-text-tertiary'
                    }`}>
                        {allJobsCount}
                    </span>
                </button>
            </div>

            <FilterTabs
                unassignedJobs={jobsForFilter}
                onFilterChange={setJobsFilteredByTabs}
            />

            {parsingError && <p className="text-tag-red-text text-xs my-1 text-center bg-tag-red-bg p-1.5 rounded-md border border-tag-red-border">{parsingError}</p>}

            <div className="flex-grow overflow-y-auto min-h-0 pt-1 custom-scrollbar">
                {activeViewTab === 'unassigned' ? (
                    <UnassignedJobs
                        jobs={filteredJobs}
                        onJobDrop={handleJobDrop}
                        onSetDraggedOverRepId={setDraggedOverRepId}
                        onJobDragStart={setDraggedJob}
                        onJobDragEnd={handleJobDragEnd}
                        onUpdateJob={handleUpdateJob}
                        onRemoveJob={handleRemoveJob}
                    />
                ) : (
                    <div className="h-full p-1.5 bg-bg-secondary rounded-lg border border-border-secondary overflow-y-auto custom-scrollbar">
                        {filteredJobs.length > 0 ? (
                            <div className="space-y-1.5">
                                {filteredJobs.map(job => (
                                    <JobCard
                                        key={job.id}
                                        job={job}
                                        onDragStart={setDraggedJob}
                                        onDragEnd={handleJobDragEnd}
                                        onUpdateJob={handleUpdateJob}
                                        onRemove={handleRemoveJob}
                                        showAssignment={true}
                                    />
                                ))}
                            </div>
                        ) : (
                            <div className="flex items-center justify-center h-full">
                                <p className="text-text-tertiary">No jobs found.</p>
                            </div>
                        )}
                    </div>
                )}
            </div>

            <PasteJobsModal
                isOpen={isPasteModalOpen}
                onClose={() => setIsPasteModalOpen(false)}
                onParse={handleParseJobs}
                isParsing={isParsing}
            />

            <PasteWeekModal
                isOpen={isPasteWeekModalOpen}
                onClose={() => setIsPasteWeekModalOpen(false)}
                onParseDays={handleParseWeekSchedule}
                isParsing={isParsing}
            />
        </>
    );
};

export default JobsPanel;
