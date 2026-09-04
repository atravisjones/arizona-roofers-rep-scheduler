import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useAppContext } from '../context/AppContext';
import UnassignedJobs from './UnassignedJobs';
import PasteJobsModal from './PasteJobsModal';
import PasteWeekModal from './PasteWeekModal';
import { LoadingIcon, PasteIcon, AutoAssignIcon, SearchIcon, XIcon, MapPinIcon, HardHatIcon } from './icons';
import FilterTabs from './FilterTabs';
import { JobCard } from './JobCard';
import { Job, DisplayJob, InstallJob } from '../types';
import { DaySchedule } from '../services/weekScheduleParser';
import { SEG_WRAP, SEG_BTN, SEG_ON, SEG_OFF } from './ui';

type JobsViewTab = 'unassigned' | 'all' | 'installs';

const JobsPanel: React.FC = () => {
    const {
        isParsing, parsingError, isAutoAssigning, appState,
        handleParseJobs, handleAutoAssign,
        handleUpdateJob, handleRemoveJob, isLoadingReps, handleShowUnassignedJobsOnMap, handleJobDrop,
        setDraggedJob, handleJobDragEnd, setDraggedOverRepId, activeRoute, setFilteredUnassignedJobs,
        allJobs, installJobs, installsByRep, boardKind
    } = useAppContext();

    const [jobSearchTerm, setJobSearchTerm] = useState('');
    const [isPasteModalOpen, setIsPasteModalOpen] = useState(false);
    const [isPasteWeekModalOpen, setIsPasteWeekModalOpen] = useState(false);
    const [jobsFilteredByTabs, setJobsFilteredByTabs] = useState<Job[]>(appState.unassignedJobs);
    const [activeViewTab, setActiveViewTab] = useState<JobsViewTab>('unassigned');

    // Filter jobs based on active view tab
    // allJobs from context is unfiltered by schedule column filters (rep/time slot)
    // This ensures Jobs column only filters by its own tags/search
    const boardUnassignedJobs = useMemo(() => appState.unassignedJobs.filter(job =>
        boardKind === 'insurance' ? job.pinnedKind === 'adjuster' : job.pinnedKind !== 'adjuster'
    ), [appState.unassignedJobs, boardKind]);
    const boardAllJobs = useMemo(() => allJobs.filter(job =>
        boardKind === 'insurance' ? job.pinnedKind === 'adjuster' : job.pinnedKind !== 'adjuster'
    ), [allJobs, boardKind]);
    const jobsForFilter = useMemo(() => {
        return activeViewTab === 'unassigned' ? boardUnassignedJobs : boardAllJobs;
    }, [activeViewTab, boardUnassignedJobs, boardAllJobs]);

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

    // Push filtered unassigned jobs to context for synchronized map filtering (with ID-hash guard)
    const prevContextIdsRef = useRef<string>('');
    useEffect(() => {
        if (activeViewTab === 'unassigned') {
            const idsHash = filteredJobs.map(j => j.id).sort().join(',');
            if (idsHash !== prevContextIdsRef.current) {
                prevContextIdsRef.current = idsHash;
                setFilteredUnassignedJobs(filteredJobs);
            }
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

    const unassignedCount = boardUnassignedJobs.length;
    const allJobsCount = boardAllJobs.length;
    const installsCount = installJobs.length;

    // Build a set of top-value install IDs per rep for highlighting
    const topInstallIds = useMemo(() => {
        const ids = new Set<string>();
        installsByRep.forEach((repInstalls) => {
            if (repInstalls.length === 0) return;
            const top = repInstalls.reduce((best, cur) => {
                const curVal = typeof cur.value === 'number' ? cur.value : 0;
                const bestVal = typeof best.value === 'number' ? best.value : 0;
                return curVal > bestVal ? cur : best;
            }, repInstalls[0]);
            ids.add(top.jobId);
        });
        return ids;
    }, [installsByRep]);

    return (
        <>
            <div className="flex justify-between items-center mb-1">
                <span className="text-[11.5px] text-text-tertiary tabular-nums">
                    {activeViewTab === 'unassigned' ? unassignedCount : allJobsCount} jobs
                </span>

                <div className="flex items-center gap-1">
                    <div className="relative group">
                        <input
                            type="text"
                            className={`
                                h-7 w-28 rounded-md border border-border-secondary bg-bg-primary pl-8 pr-7 text-[11px] text-text-primary placeholder:text-text-tertiary
                                outline-none transition-colors duration-150 hover:border-brand-primary focus:border-brand-primary focus:w-48
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
            <div className={`${SEG_WRAP} mb-2 w-full`}>
                <button
                    onClick={() => setActiveViewTab('unassigned')}
                    className={`${SEG_BTN} flex-1 justify-center ${activeViewTab === 'unassigned' ? SEG_ON : SEG_OFF}`}
                >
                    Unassigned
                    <span className={`tabular-nums text-[10px] font-bold ${
                        activeViewTab === 'unassigned' ? 'text-brand-text-on-primary' : 'text-text-tertiary'
                    }`}>
                        {unassignedCount}
                    </span>
                </button>
                <button
                    onClick={() => setActiveViewTab('all')}
                    className={`${SEG_BTN} flex-1 justify-center ${activeViewTab === 'all' ? SEG_ON : SEG_OFF}`}
                >
                    All Jobs
                    <span className={`tabular-nums text-[10px] font-bold ${
                        activeViewTab === 'all' ? 'text-brand-text-on-primary' : 'text-text-tertiary'
                    }`}>
                        {allJobsCount}
                    </span>
                </button>
                <button
                    onClick={() => setActiveViewTab('installs')}
                    className={`${SEG_BTN} flex-1 justify-center ${activeViewTab === 'installs' ? 'bg-tag-amber-bg text-tag-amber-text' : SEG_OFF}`}
                >
                    Installs
                    <span className={`tabular-nums text-[10px] font-bold ${
                        activeViewTab === 'installs' ? 'text-tag-amber-text' : 'text-text-tertiary'
                    }`}>
                        {installsCount}
                    </span>
                </button>
            </div>

            <FilterTabs
                unassignedJobs={jobsForFilter}
                onFilterChange={setJobsFilteredByTabs}
            />

            {parsingError && <p className="text-tag-red-text text-xs my-1 text-center bg-tag-red-bg p-1.5 rounded-md border border-tag-red-border">{parsingError}</p>}

            <div className="flex-grow overflow-y-auto min-h-0 pt-1 custom-scrollbar">
                {activeViewTab === 'installs' ? (
                    <div className="h-full p-1.5 bg-bg-secondary rounded-lg border border-orange-200 overflow-y-auto custom-scrollbar">
                        {installJobs.length > 0 ? (
                            <div className="space-y-1">
                                {installJobs
                                    .slice()
                                    .sort((a, b) => ((typeof b.value === 'number' ? b.value : 0) - (typeof a.value === 'number' ? a.value : 0)))
                                    .map(install => {
                                        const isTop = topInstallIds.has(install.jobId);
                                        return (
                                            <div key={install.jobId} className={`px-2 py-1.5 rounded-lg border ${isTop ? 'bg-gradient-to-r from-amber-100 to-orange-200 border-orange-400 ring-1 ring-orange-300' : 'bg-bg-primary border-border-primary'}`}>
                                                <div className="flex items-center gap-1.5">
                                                    <HardHatIcon className={`h-3.5 w-3.5 shrink-0 ${isTop ? 'text-orange-800' : 'text-text-quaternary'}`} />
                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex items-center gap-1">
                                                            <span className={`text-[10px] font-bold truncate ${isTop ? 'text-orange-900' : 'text-text-primary'}`}>{install.city || 'Unknown'}</span>
                                                            <span className="text-[9px] text-text-tertiary truncate">— {install.customerName}</span>
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-[9px] text-text-quaternary truncate">{install.address}</span>
                                                        </div>
                                                    </div>
                                                    <div className="flex flex-col items-end shrink-0 gap-0.5">
                                                        {install.value != null && (
                                                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${isTop ? 'bg-orange-700 text-white' : 'bg-bg-tertiary text-text-secondary border border-border-primary'}`}>
                                                                ${Number(install.value).toLocaleString()}
                                                            </span>
                                                        )}
                                                        <span className="text-[8px] text-text-quaternary">{install.jobOwner}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                            </div>
                        ) : (
                            <div className="flex items-center justify-center h-full">
                                <p className="max-w-[220px] text-center text-[11.5px] text-text-tertiary">No active installs. Paste jobs or hit Load to pull from the sheet.</p>
                            </div>
                        )}
                    </div>
                ) : activeViewTab === 'unassigned' ? (
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
                                <p className="max-w-[220px] text-center text-[11.5px] text-text-tertiary">No jobs match these filters. Paste jobs or hit Load to pull from the sheet.</p>
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
