import React, { useMemo, useState, useRef } from 'react';
import { useAppContext } from '../context/AppContext';
import { XIcon, RescheduleIcon, ClipboardIcon } from './icons';
import { Rep, DisplayJob } from '../types';

interface NeedsRescheduleModalProps {
    isOpen: boolean;
    onClose: () => void;
}

// Helper function to check for non-overlapping times
const parseTimeRange = (timeStr: string | undefined): { start: number, end: number } | null => {
    if (!timeStr) return null;
    const parts = timeStr.split('-').map(s => s.trim());
    
    const parseTime = (t: string) => {
        const match = t.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
        if (!match) return 0;
        let h = parseInt(match[1]);
        const m = parseInt(match[2] || '0');
        const p = match[3]?.toLowerCase();
        if (p === 'pm' && h < 12) h += 12;
        if (p === 'am' && h === 12) h = 0;
        if (!p && h >= 1 && h <= 6) h += 12;
        return h * 60 + m;
    };

    if (parts.length >= 2) {
        return { start: parseTime(parts[0]), end: parseTime(parts[1]) };
    }
    return null;
};

const doTimesOverlap = (t1: string | undefined, t2: string | undefined): boolean => {
    const r1 = parseTimeRange(t1);
    const r2 = parseTimeRange(t2);
    if (!r1 || !r2) return true; // Assume overlap if parsing fails to avoid false positives
    return r1.start < r2.end && r2.start < r1.end;
};


const NeedsRescheduleModal: React.FC<NeedsRescheduleModalProps> = ({ isOpen, onClose }) => {
    const { appState, handleUpdateJob } = useAppContext();
    const [selectSuccess, setSelectSuccess] = useState(false);
    const contentRef = useRef<HTMLDivElement>(null);

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

    const jobsNeedingReschedule = useMemo(() => {
        const results: Array<{ rep: Rep; job: DisplayJob; reason: 'Mismatch' | 'Optimized' }> = [];
        const seenJobIds = new Set<string>();

        appState.reps.forEach(rep => {
            rep.schedule.forEach(slot => {
                slot.jobs.forEach(job => {
                    // Optimized jobs have `timeSlotLabel` on the job object. Manual jobs use the slot's label.
                    const scheduledTimeLabel = job.timeSlotLabel || slot.label;
                    
                    if (job.originalTimeframe && scheduledTimeLabel) {
                        const overlaps = doTimesOverlap(job.originalTimeframe, scheduledTimeLabel);
                        if (!overlaps && !seenJobIds.has(job.id)) {
                            // The reason is based on whether the rep's schedule was optimized.
                            const reason = rep.isOptimized ? 'Optimized' : 'Mismatch';
                            results.push({ rep, job: { ...job, timeSlotLabel: scheduledTimeLabel }, reason });
                            seenJobIds.add(job.id);
                        }
                    }
                });
            });
        });
        return results;
    }, [appState.reps]);

    const jobsByRep = useMemo(() => {
        return jobsNeedingReschedule.reduce((acc, { rep, job, reason }) => {
            if (!acc[rep.id]) {
                acc[rep.id] = {
                    repName: rep.name,
                    isOptimized: rep.isOptimized,
                    jobs: []
                };
            }
            acc[rep.id].jobs.push({ job, reason });
            return acc;
        }, {} as Record<string, { repName: string; isOptimized: boolean | undefined; jobs: { job: DisplayJob; reason: 'Mismatch' | 'Optimized' }[] }>);
    }, [jobsNeedingReschedule]);

    const handleConfirmReschedule = (job: DisplayJob) => {
        if (job.timeSlotLabel) {
            handleUpdateJob(job.id, { originalTimeframe: job.timeSlotLabel });
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-bg-secondary/60 backdrop-blur-sm flex items-center justify-center p-4 z-[60]" onClick={onClose}>
            <div className="bg-bg-primary rounded-xl shadow-2xl w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden animate-fade-in" onClick={e => e.stopPropagation()}>
                <header className="px-6 py-4 border-b border-border-primary flex justify-between items-center bg-tag-blue-bg rounded-t-xl">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-tag-blue-bg text-tag-blue-text rounded-lg border border-tag-blue-border shadow-sm">
                            <RescheduleIcon className="h-6 w-6" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-text-primary">Needs Reschedule</h2>
                            <p className="text-xs text-text-secondary">
                                Found {jobsNeedingReschedule.length} jobs with potential scheduling conflicts.
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
                        This list includes any job scheduled at a time that does not overlap with its original request. Check the box to confirm the change and remove it from this list.
                    </p>
                </div>

                <div ref={contentRef} className="flex-grow overflow-y-auto bg-bg-secondary p-4 custom-scrollbar">
                    {Object.keys(jobsByRep).length > 0 ? (
                        <div className="space-y-4">
                            {Object.values(jobsByRep).map(({ repName, isOptimized, jobs }) => (
                                <div key={repName} className="bg-bg-primary border border-border-primary rounded-lg shadow-sm">
                                    <h3 className="text-base font-bold text-text-primary px-4 py-2 border-b border-border-primary flex items-center gap-2">
                                        {repName}
                                        {isOptimized && <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-tag-teal-bg text-tag-teal-text border border-tag-teal-border">Optimized</span>}
                                    </h3>
                                    <ul className="divide-y divide-border-primary">
                                        {jobs.map(({ job, reason }) => (
                                            <li key={job.id} className="p-3 flex items-start gap-3 hover:bg-bg-secondary/50 transition-colors">
                                                <div className="flex-grow min-w-0 flex items-start gap-3">
                                                    {/* Checkbox */}
                                                    <div>
                                                        <input 
                                                            type="checkbox" 
                                                            className="h-5 w-5 mt-0.5 rounded border-border-secondary text-brand-primary focus:ring-brand-primary cursor-pointer"
                                                            title="Confirm reschedule. This will update the original time and remove this item from the list."
                                                            onChange={() => handleConfirmReschedule(job)}
                                                        />
                                                    </div>
                                                    {/* Details */}
                                                    <div className="flex-grow">
                                                        <p className="font-bold text-sm text-text-primary truncate">{job.city}</p>
                                                        <p className="text-xs text-text-tertiary truncate">{job.address}</p>
                                                        <div className="mt-1 text-xs flex flex-wrap gap-x-3 gap-y-1 items-center">
                                                            <p className="text-text-tertiary">Original: <span className="font-semibold text-text-secondary line-through">{job.originalTimeframe || 'N/A'}</span></p>
                                                            <p className="text-tag-blue-text">→ Scheduled: <span className="font-bold text-tag-blue-text/80">{job.timeSlotLabel || 'N/A'}</span></p>
                                                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                                                                reason === 'Mismatch' ? 'bg-tag-red-bg text-tag-red-text border-tag-red-border' : 'bg-tag-teal-bg text-tag-teal-text border-tag-teal-border'
                                                            }`}>
                                                                {reason}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            ))}
                        </div>
                    ) : (
                         <div className="flex flex-col items-center justify-center h-full text-text-quaternary text-center pb-10">
                            <div className="p-4 bg-tag-green-bg rounded-full mb-3">
                                <RescheduleIcon className="h-12 w-12 text-tag-green-text" />
                            </div>
                            <p className="text-lg font-semibold text-text-primary">All Good!</p>
                            <p className="text-sm mt-1">No jobs with time conflicts were found.</p>
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

export default NeedsRescheduleModal;