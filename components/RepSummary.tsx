import React, { useMemo, useRef, useState } from 'react';
import { Rep, Job } from '../types';
import { TAG_KEYWORDS, TIME_SLOTS } from '../constants';
import { ClipboardIcon } from './icons';
import { useAppContext } from '../context/AppContext';

// Helper to extract job type and clean up notes for display
const getJobDisplayDetails = (job: Job) => {
    const notesLower = job.notes.toLowerCase();
    const foundTags = TAG_KEYWORDS.filter(keyword => {
        const regex = new RegExp(`\\b${keyword.toLowerCase()}\\b`);
        return regex.test(notesLower);
    });

    const jobType = foundTags.length > 0 ? foundTags.join('/') : 'Inspection';
    
    const isGoldJob = job.notes.includes('#');
    const priorityReasonMatch = job.notes.match(/#\s*\(([^)]+)\)/);
    const priorityReason = priorityReasonMatch ? `(${priorityReasonMatch[1]})` : '';

    const ageMatch = job.notes.match(/\b(\d+\s*yrs)\b/i);
    const roofAge = ageMatch ? ageMatch[0] : null;

    const sqftMatch = job.notes.match(/\b(\d+)\s*sq\.?\b/i);
    const sqft = sqftMatch ? `${sqftMatch[1]}sqft` : null;

    const storiesMatch = job.notes.match(/\b(\d)S\b/i);
    const stories = storiesMatch ? `${storiesMatch[1]} Story` : null;

    // Extract reschedule info
    const rescheduleRegex = /\(Recommended Reschedule from ([^)]+)\)/i;
    const rescheduleMatch = job.notes.match(rescheduleRegex);
    const rescheduleInfo = rescheduleMatch ? rescheduleMatch[1] : null;

    // Remove tags and boilerplate text to get clean, human-readable notes
    let cleanNotes = job.notes;
    foundTags.forEach(tag => {
        cleanNotes = cleanNotes.replace(new RegExp(`\\b${tag}\\b`, 'ig'), '').trim();
    });
    cleanNotes = cleanNotes
        .replace(/\(Recommended Reschedule from [^)]+\)/gi, '')
        .replace(/\(Scheduled: [^)]+\)/gi, '')
        .replace(/\(\s*\)/g, '') // remove empty parentheses
        .replace(/^[-,.\s]+|[-,.\s]+$/g, '') // trim lingering separators
        .trim();

    return { jobType, cleanNotes, rescheduleInfo, isGoldJob, priorityReason, roofAge, sqft, stories };
};

interface RepSummaryModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const RepSummaryModal: React.FC<RepSummaryModalProps> = ({ isOpen, onClose }) => {
    const { appState, selectedDate } = useAppContext();
    const reps = appState.reps;
    const selectedDayString = selectedDate.toLocaleString('en-us', { weekday: 'long' });

    const summaryRef = useRef<HTMLDivElement>(null);
    const [selectSuccess, setSelectSuccess] = useState(false);

    const repsWithJobs = useMemo(() => {
        return reps
            .map(rep => ({
                ...rep,
                totalJobs: rep.schedule.reduce((acc, slot) => acc + slot.jobs.length, 0)
            }))
            .filter(rep => rep.totalJobs > 0)
            .sort((a,b) => a.name.localeCompare(b.name));
    }, [reps]);

    const handleSelectAll = () => {
        if (summaryRef.current) {
            const range = document.createRange();
            range.selectNode(summaryRef.current);
            const selection = window.getSelection();
            if (selection) {
                selection.removeAllRanges();
                selection.addRange(range);
                setSelectSuccess(true);
                setTimeout(() => setSelectSuccess(false), 2500);
            }
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-bg-secondary/60 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={onClose}>
            <div className="bg-bg-primary rounded-xl shadow-2xl w-full max-w-4xl h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <header className="p-4 border-b border-border-primary flex justify-between items-center flex-shrink-0">
                    <h2 className="text-lg font-bold text-text-primary">Summary by Representative</h2>
                    <div className="flex items-center space-x-4">
                        <button 
                            onClick={handleSelectAll}
                            className={`flex items-center space-x-2 px-4 py-2 rounded-md text-sm font-semibold transition-colors disabled:opacity-50 ${selectSuccess ? 'bg-tag-green-bg text-tag-green-text' : 'bg-brand-primary hover:bg-brand-secondary text-brand-text-on-primary'}`}
                            disabled={repsWithJobs.length === 0}
                        >
                            <ClipboardIcon />
                            <span>{selectSuccess ? 'Selected!' : 'Select All'}</span>
                        </button>
                        <button onClick={onClose} className="text-text-quaternary hover:text-text-secondary text-3xl leading-none">&times;</button>
                    </div>
                </header>
                <div className="flex-grow bg-bg-primary text-text-primary rounded-b-lg p-4 overflow-y-auto font-mono">
                    <div ref={summaryRef}>
                        {repsWithJobs.length > 0 ? (
                            repsWithJobs.map(rep => {
                                const allJobsForRep = rep.schedule.flatMap(slot => 
                                    slot.jobs.map(job => ({ ...job, timeSlotLabel: slot.label }))
                                );
                                
                                const unavailableSlotIds = new Set(rep.unavailableSlots?.[selectedDayString] || []);
                                
                                // Only consider slots available if they are NOT unavailable AND have NO jobs assigned
                                const availableSlots = rep.schedule
                                    .filter(slot => {
                                        const isUnavailable = unavailableSlotIds.has(slot.id);
                                        const hasJobs = slot.jobs.length > 0;
                                        return !isUnavailable && !hasJobs;
                                    })
                                    .map(slot => slot.label);

                                return (
                                <div key={rep.id} className="py-4 border-b border-border-primary last:border-b-0">
                                    <h3 className="text-xl font-bold text-text-primary mb-1">
                                        {rep.name} ({rep.totalJobs})
                                    </h3>
                                    <div className="mb-3 flex flex-wrap items-center gap-1">
                                        <span className="text-sm text-text-tertiary mr-1">Available:</span>
                                        {availableSlots.length > 0 ? (
                                            availableSlots.map(label => (
                                                <span key={label} className="px-2 py-0.5 rounded text-xs font-bold bg-tag-green-bg text-tag-green-text border border-tag-green-border">
                                                    {label}
                                                </span>
                                            ))
                                        ) : (
                                            <span className="text-sm text-text-quaternary italic">No free slots today</span>
                                        )}
                                    </div>
                                    <ul className="space-y-1">
                                        {allJobsForRep.map(job => {
                                            const { jobType, rescheduleInfo, isGoldJob, priorityReason, roofAge, sqft, stories } = getJobDisplayDetails(job);
                                            const fullAddress = [job.address, job.customerName, `AZ ${job.zipCode || ''}`].filter(Boolean).join(', ');
                                            const tags = [roofAge, jobType, sqft, stories].filter(Boolean).join(' ');
                                            // Priority: Original Timeframe, then Slot Label
                                            const timeDisplay = job.originalTimeframe || job.timeSlotLabel;
                                            return (
                                                <li key={job.id}>
                                                    <span className="text-text-tertiary">{timeDisplay}:</span> {fullAddress} (<strong className="text-text-primary font-bold">{tags}</strong>)
                                                    {isGoldJob && <span className="text-tag-amber-text font-bold ml-2"># {priorityReason}</span>}
                                                    {rescheduleInfo && <span className="text-tag-blue-text italic ml-2">(Rescheduled from {rescheduleInfo})</span>}
                                                </li>
                                            );
                                        })}
                                    </ul>
                                </div>
                            )})
                        ) : (
                            <div className="flex items-center justify-center h-full">
                                <p className="text-text-tertiary font-sans">No assigned jobs to summarize.</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default RepSummaryModal;