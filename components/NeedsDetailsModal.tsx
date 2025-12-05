import React, { useMemo, useRef, useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { JobCard } from './JobCard';
import { XIcon, RepairIcon, ClipboardIcon } from './icons';
import { Job } from '../types';
import { TAG_KEYWORDS } from '../constants';

interface NeedsDetailsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const NeedsDetailsModal: React.FC<NeedsDetailsModalProps> = ({ isOpen, onClose }) => {
    const { 
        appState, 
        handleJobDragEnd, 
        handleUpdateJob, 
        handleRemoveJob,
        setDraggedJob
    } = useAppContext();

    const contentRef = useRef<HTMLDivElement>(null);
    const [selectSuccess, setSelectSuccess] = useState(false);

    const handleSelectAll = () => {
        if (contentRef.current) {
            const range = document.createRange();
            range.selectNode(contentRef.current);
            const selection = window.getSelection();
            if (selection) {
                selection.removeAllRanges();
                selection.addRange(range);
                setSelectSuccess(true);
                setTimeout(() => setSelectSuccess(false), 2500);
            }
        }
    };

    const countTags = (job: Job) => {
        const notes = (job.notes || '').toLowerCase();
        let count = 0;
        // Check keywords (Tile, Shingle, etc)
        TAG_KEYWORDS.forEach(tag => {
            if (new RegExp(`\\b${tag.toLowerCase()}\\b`).test(notes)) count++;
        });
        // Check numeric patterns
        if (/\b\d+\s*sq/i.test(notes)) count++; // sqft
        if (/\b\d+\s*yrs\b/i.test(notes)) count++; // age
        if (/\b\d+S\b/i.test(notes)) count++; // stories
        return count;
    };

    const jobsNeedingDetails = useMemo(() => {
        // Filter from Unassigned Jobs
        return appState.unassignedJobs.filter(job => countTags(job) <= 1);
    }, [appState.unassignedJobs]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-bg-secondary/60 backdrop-blur-sm flex items-center justify-center p-4 z-[60]" onClick={onClose}>
            <div className="bg-bg-primary rounded-xl shadow-2xl w-full max-w-3xl h-[85vh] flex flex-col overflow-hidden animate-fade-in" onClick={e => e.stopPropagation()}>
                <header className="px-6 py-4 border-b border-border-primary flex justify-between items-center bg-tag-amber-bg rounded-t-xl">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-tag-amber-bg text-tag-amber-text rounded-lg border border-tag-amber-border shadow-sm">
                            <RepairIcon className="h-6 w-6" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-text-primary">Jobs Needing Details</h2>
                            <p className="text-xs text-text-secondary">
                                Found {jobsNeedingDetails.length} jobs with missing information (Age, Size, Type).
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center space-x-4">
                         <button
                            onClick={handleSelectAll}
                            className={`flex items-center space-x-2 px-4 py-2 rounded-md text-sm font-semibold transition-colors shadow-sm ${selectSuccess ? 'bg-tag-green-bg text-tag-green-text' : 'bg-bg-primary text-brand-primary border border-border-primary hover:bg-brand-bg-light'}`}
                        >
                            <ClipboardIcon />
                            <span>{selectSuccess ? 'Selected!' : 'Select All'}</span>
                        </button>
                        <button onClick={onClose} className="text-text-quaternary hover:text-text-secondary p-1 rounded-full hover:bg-bg-tertiary transition">
                            <XIcon className="h-6 w-6" />
                        </button>
                    </div>
                </header>

                <div className="bg-bg-primary p-4 border-b border-border-primary">
                    <p className="text-sm text-text-secondary leading-relaxed">
                        These jobs have <b>1 or fewer</b> data tags. Updating them with details like 
                        <i> "20yrs", "2500sqft", "Tile"</i> will improve the AI Auto-Assign score. 
                        Click a card to edit.
                    </p>
                </div>

                <div ref={contentRef} className="flex-grow overflow-y-auto bg-bg-secondary p-4 custom-scrollbar">
                    {jobsNeedingDetails.length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {jobsNeedingDetails.map(job => (
                                <JobCard 
                                    key={job.id}
                                    job={job}
                                    onDragStart={setDraggedJob}
                                    onDragEnd={handleJobDragEnd}
                                    onUpdateJob={handleUpdateJob}
                                    onRemove={handleRemoveJob}
                                    isCompact={false}
                                    isDraggable={false} // Disable drag in modal to focus on editing
                                />
                            ))}
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full text-text-quaternary text-center pb-10">
                            <div className="p-4 bg-tag-green-bg rounded-full mb-3">
                                <RepairIcon className="h-12 w-12 text-tag-green-text" />
                            </div>
                            <p className="text-lg font-semibold text-text-primary">All Clear!</p>
                            <p className="text-sm mt-1">No sparse jobs found in the unassigned list.</p>
                        </div>
                    )}
                </div>
                
                <footer className="px-6 py-3 bg-bg-secondary border-t border-border-primary flex justify-end rounded-b-xl">
                    <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-text-secondary bg-bg-primary border border-border-secondary rounded-lg hover:bg-bg-tertiary transition shadow-sm">
                        Close
                    </button>
                </footer>
            </div>
        </div>
    );
};

export default NeedsDetailsModal;