import React, { useState, useMemo, useEffect } from 'react';
import { useAppContext } from '../context/AppContext';
import UnassignedJobs from './UnassignedJobs';
import PasteJobsModal from './PasteJobsModal';
import PasteWeekModal from './PasteWeekModal';
import { LoadingIcon, PasteIcon, AutoAssignIcon, SearchIcon, DragHandleIcon, XIcon, SettingsIcon } from './icons';
import SettingsModal from './SettingsModal';
import FilterTabs from './FilterTabs';
import { Job } from '../types';
import { DaySchedule } from '../services/weekScheduleParser';

interface JobsPanelProps {
    onDragStart: () => void;
    onDragEnd: () => void;
}

const JobsPanel: React.FC<JobsPanelProps> = ({ onDragStart, onDragEnd }) => {
    const {
        isParsing, parsingError, isAutoAssigning, appState,
        handleParseJobs, handleAutoAssign,
        handleUpdateJob, handleRemoveJob, isLoadingReps, handleShowUnassignedJobsOnMap, handleJobDrop,
        setDraggedJob, handleJobDragEnd, setDraggedOverRepId, activeRoute, setFilteredUnassignedJobs
    } = useAppContext();

    const [jobSearchTerm, setJobSearchTerm] = useState('');
    const [isPasteModalOpen, setIsPasteModalOpen] = useState(false);
    const [isPasteWeekModalOpen, setIsPasteWeekModalOpen] = useState(false);
    const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
    const [jobsFilteredByTabs, setJobsFilteredByTabs] = useState<Job[]>(appState.unassignedJobs);

    const filteredUnassignedJobs = useMemo(() => {
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
                job.notes.toLowerCase().includes(lowercasedFilter)
            );
        });
    }, [jobsFilteredByTabs, jobSearchTerm]);

    // Push filtered unassigned jobs to context for synchronized map filtering
    useEffect(() => {
        setFilteredUnassignedJobs(filteredUnassignedJobs);
    }, [filteredUnassignedJobs, setFilteredUnassignedJobs]);

    const handleParseWeekSchedule = async (days: DaySchedule[], onComplete: () => void) => {
        // Process each day sequentially
        for (let i = 0; i < days.length; i++) {
            const day = days[i];

            // Wait for the current day to complete before moving to the next
            await new Promise<void>((resolve) => {
                handleParseJobs(day.content, () => {
                    resolve();
                });
            });

            // Small delay between days to ensure processing completes
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        // Call onComplete after all days are processed
        onComplete();
    };

    return (
        <>
            <div className="flex justify-between items-center mb-1 border-b border-border-primary pb-1">
                <h2 className="text-base font-bold text-text-primary flex items-center gap-2">
                    2. Unassigned Jobs
                    <span className="px-2 py-0.5 bg-tertiary text-secondary rounded-full text-xs font-medium">
                        {appState.unassignedJobs.length}
                    </span>
                </h2>

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

                    <div className="w-px h-4 bg-border-primary mx-1"></div>

                    <button
                        onClick={() => setIsSettingsModalOpen(true)}
                        className="p-1.5 text-text-quaternary hover:text-primary hover:bg-tertiary rounded-md transition-colors"
                        title="Assignment Settings"
                    >
                        <SettingsIcon className="h-4 w-4" />
                    </button>

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

            <FilterTabs
                unassignedJobs={appState.unassignedJobs}
                onFilterChange={setJobsFilteredByTabs}
            />

            {parsingError && <p className="text-tag-red-text text-xs my-1 text-center bg-tag-red-bg p-1.5 rounded-md border border-tag-red-border">{parsingError}</p>}

            <div className="flex-grow overflow-y-auto min-h-0 pt-1 custom-scrollbar">
                <UnassignedJobs
                    jobs={filteredUnassignedJobs}
                    onJobDrop={handleJobDrop}
                    onSetDraggedOverRepId={setDraggedOverRepId}
                    onJobDragStart={setDraggedJob}
                    onJobDragEnd={handleJobDragEnd}
                    onUpdateJob={handleUpdateJob}
                    onRemoveJob={handleRemoveJob}
                    onShowOnMap={() => handleShowUnassignedJobsOnMap(filteredUnassignedJobs)}
                />
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

            <SettingsModal
                isOpen={isSettingsModalOpen}
                onClose={() => setIsSettingsModalOpen(false)}
            />
        </>
    );
};

export default JobsPanel;