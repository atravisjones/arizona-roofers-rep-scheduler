import React, { useMemo, useRef, useState } from 'react';
import { DisplayJob, Job } from '../types';
import { TAG_KEYWORDS, TIME_SLOTS } from '../constants';
import { ClipboardIcon } from './icons';
import { useAppContext } from '../context/AppContext';
import { GREATER_PHOENIX_CITIES, NORTHERN_AZ_CITIES, SOUTHERN_AZ_CITIES, SOUTH_OUTER_RING_CITIES } from '../services/geography';
import { getEffectiveUnavailableSlots, isFieldSalesRep } from '../utils/repUtils';

// Helper to extract job type and clean up notes for display
const getJobDisplayDetails = (job: Job | DisplayJob) => {
    const notesLower = job.notes.toLowerCase();
    const foundTags = TAG_KEYWORDS.filter(keyword => {
        const regex = new RegExp(`\\b${keyword.toLowerCase()}\\b`);
        return regex.test(notesLower);
    });

    const jobType = foundTags.length > 0 ? foundTags.join('/') : 'Inspection';
    
    const priorityMatch = job.notes.match(/#+/);
    const priorityLevel = priorityMatch ? priorityMatch[0].length : 0;
    const priorityReasonMatch = job.notes.match(/#+\s*\(([^)]+)\)/);
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

    return { jobType, cleanNotes, rescheduleInfo, priorityLevel, priorityReason, roofAge, sqft, stories };
};

// Helper to shorten time label for the table
const shortenTimeLabel = (label: string) => {
    return label
        .replace(/am/gi, '')
        .replace(/pm/gi, '')
        .replace(/\s*-\s*/g, '–') // en-dash
        .trim();
};

// Helper to determine region bucket for stats
const getRegionBucket = (city: string) => {
    const c = city.toLowerCase().trim();
    if (SOUTHERN_AZ_CITIES.has(c)) return 'Tucson';
    if (NORTHERN_AZ_CITIES.has(c)) return 'Northern';
    if (SOUTH_OUTER_RING_CITIES.has(c)) return 'Outer Cities'; 
    // Fallback: if it's in general Phoenix list but not outer ring
    if (GREATER_PHOENIX_CITIES.has(c)) return 'Valley';
    // Default fallback
    return 'Valley';
};

interface DailySummaryModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const DailySummaryModal: React.FC<DailySummaryModalProps> = ({ isOpen, onClose }) => {
    const { assignedJobs: jobs, appState, selectedDate } = useAppContext();
    const summaryRef = useRef<HTMLDivElement>(null);
    const [selectSuccess, setSelectSuccess] = useState(false);
    
    const formattedDate = selectedDate.toLocaleDateString('en-US');
    // Updated to Plural "Appointments"
    const subjectLine = `Appointments Summary ${formattedDate}`;

    // 1. Existing Detailed List Logic (Group by Time Slot)
    const jobsByTimeSlot = useMemo<Record<string, DisplayJob[]>>(() => {
        const assignedJobs = jobs.filter(j => j.assignedRepName);

        const grouped = assignedJobs.reduce((acc, job) => {
            // Use original timeframe for sorting/grouping if possible to match customer expectations
            const slot = job.originalTimeframe || job.timeSlotLabel || 'Uncategorized';
            if (!acc[slot]) acc[slot] = [];
            acc[slot].push(job);
            return acc;
        }, {} as Record<string, DisplayJob[]>);
        
        const getSortableTime = (timeString: string): number => {
            if (!timeString || timeString === 'Uncategorized') return 99;
            const timePart = timeString.split('-')[0].trim();
            const match = timePart.match(/(\d{1,2}):?(\d{2})?\s*(am|pm)?/i);

            if (!match) return 99;

            let hour = parseInt(match[1], 10);
            const minutes = match[2] ? parseInt(match[2], 10) : 0;
            const period = match[3] ? match[3].toLowerCase() : null;
            
            if (period === 'pm' && hour < 12) hour += 12;
            if (period === 'am' && hour === 12) hour = 0;
            
            // Heuristic for missing am/pm if early morning
            if (!period && hour >= 1 && hour <= 6) hour += 12;

            return hour + (minutes / 60);
        };
        
        const sortedSlots = Object.keys(grouped).sort((a, b) => {
            if (a === 'Uncategorized') return 1;
            if (b === 'Uncategorized') return -1;
            const aStart = getSortableTime(a);
            const bStart = getSortableTime(b);
            return aStart - bStart;
        });

        const finalGrouped: Record<string, DisplayJob[]> = {};
        for (const slot of sortedSlots) {
            finalGrouped[slot] = grouped[slot];
        }
        return finalGrouped;
    }, [jobs]);

    // 2. New Logic: Stats & Overview Table
    const { overviewData, stats } = useMemo(() => {
        const currentStats = {
            total: 0,
            valley: 0,
            outer: 0,
            tucson: 0,
            northern: 0,
        };

        const data = [...appState.reps]
            .sort((a, b) => {
                // Sort by salesRank (closing rate) - lower rank = better
                const aRank = a.salesRank ?? 999;
                const bRank = b.salesRank ?? 999;
                return aRank - bRank;
            })
            .map(rep => {
                // Get all jobs for this rep in order of time slots
                const repJobs = rep.schedule.flatMap(slot => 
                    slot.jobs.map(j => ({ ...j, timeSlotLabel: slot.label }))
                );
                
                if (repJobs.length === 0) return null;

                // Update stats
                currentStats.total += repJobs.length;
                repJobs.forEach(j => {
                    const region = getRegionBucket(j.city || '');
                    if (region === 'Valley') currentStats.valley++;
                    else if (region === 'Outer Cities') currentStats.outer++;
                    else if (region === 'Tucson') currentStats.tucson++;
                    else if (region === 'Northern') currentStats.northern++;
                    else currentStats.valley++; // Default to valley for misc
                });

                // Format Cities
                const cities = repJobs.map(j => j.city || 'Unknown');
                const uniqueCities = Array.from(new Set(cities));
                let citiesDisplay = '';
                
                if (uniqueCities.length === 1) {
                    citiesDisplay = `${uniqueCities[0]} (×${cities.length})`;
                } else {
                    // List in order
                    citiesDisplay = cities.join(', ');
                }

                // Format Time Blocks - Prioritize Original Request
                const timeBlocks = repJobs.map(j => shortenTimeLabel(j.originalTimeframe || j.timeSlotLabel || ''));
                const timeBlocksDisplay = timeBlocks.join(', ');

                return {
                    name: rep.name,
                    count: repJobs.length,
                    cities: citiesDisplay,
                    timeBlocks: timeBlocksDisplay
                };
            })
            .filter((d): d is NonNullable<typeof d> => d !== null);

        // Sort by total count descending for the table
        data.sort((a, b) => b.count - a.count);

        return { overviewData: data, stats: currentStats };
    }, [appState.reps]);

    // Get day name for availability checking
    const dayName = useMemo(() =>
        selectedDate.toLocaleDateString('en-US', { weekday: 'long' }),
        [selectedDate]
    );

    // Calculate reps that are off and reps available but with no jobs
    // Excludes management and door knockers (only shows field sales reps)
    const { repsOff, repsAvailableNoJobs } = useMemo(() => {
        const off: string[] = [];
        const availableNoJobs: string[] = [];

        appState.reps.forEach(rep => {
            // Skip non-field sales reps (management, door knockers, etc.)
            if (!isFieldSalesRep(rep)) return;

            const unavailableSlots = getEffectiveUnavailableSlots(rep, dayName);
            const isFullyUnavailable = unavailableSlots.length >= TIME_SLOTS.length;
            const jobCount = rep.schedule.flatMap(s => s.jobs).length;

            if (isFullyUnavailable) {
                off.push(rep.name);
            } else if (jobCount === 0) {
                availableNoJobs.push(rep.name);
            }
        });

        // Sort alphabetically
        off.sort((a, b) => a.localeCompare(b));
        availableNoJobs.sort((a, b) => a.localeCompare(b));

        return { repsOff: off, repsAvailableNoJobs: availableNoJobs };
    }, [appState.reps, dayName]);


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
            <div className="popup-surface w-full max-w-5xl h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
                <header className="p-4 border-b border-border-primary flex justify-between items-center flex-shrink-0 bg-bg-secondary">
                    <h2 className="text-lg font-bold text-text-primary">Daily Job Summary</h2>
                    <div className="flex items-center space-x-4">
                        <button 
                            onClick={handleSelectAll}
                            className={`flex items-center space-x-2 px-4 py-2 rounded-md text-sm font-semibold transition-colors disabled:opacity-50 ${selectSuccess ? 'bg-tag-green-bg text-tag-green-text' : 'bg-brand-primary hover:bg-brand-secondary text-brand-text-on-primary'}`}
                            disabled={jobs.length === 0}
                        >
                            <ClipboardIcon />
                            <span>{selectSuccess ? 'Selected!' : 'Select All'}</span>
                        </button>
                        <button onClick={onClose} className="text-text-quaternary hover:text-text-secondary text-3xl leading-none">&times;</button>
                    </div>
                </header>
                <div className="flex-grow bg-bg-primary text-text-primary p-8 overflow-y-auto font-sans">
                    <div ref={summaryRef} className="space-y-8">
                        
                        {/* 1. Email Subject & Header */}
                        <div className="mb-6">
                            <div className="bg-bg-tertiary p-3 rounded-md mb-4 border border-border-primary">
                                <p className="font-mono text-sm text-text-primary select-all font-bold">
                                    {subjectLine}
                                </p>
                            </div>

                            <div className="text-center">
                                <h1 className="text-xl font-bold text-tag-green-text mb-4 uppercase">{subjectLine}</h1>
                                <div className="text-left inline-block text-text-primary">
                                    <p>Total Appointments: {stats.total}</p>
                                    <p>Valley: {stats.valley}</p>
                                    <p>Outer Cities: {stats.outer}</p>
                                    <p>Tucson: {stats.tucson}</p>
                                    <p>Northern: {stats.northern}</p>
                                </div>
                            </div>
                        </div>
                        
                        <hr className="border-border-secondary" />

                        {/* 2. Overview Table */}
                        <div>
                            <h2 className="text-xl font-bold mb-3 text-text-primary">2. Overview Table</h2>
                            <table className="min-w-full border-collapse border border-border-tertiary text-sm text-text-primary">
                                <thead>
                                    <tr className="bg-bg-secondary">
                                        <th className="border border-border-tertiary px-2 py-1 text-left font-bold w-40">Rep</th>
                                        <th className="border border-border-tertiary px-2 py-1 text-left font-bold w-16">Total</th>
                                        <th className="border border-border-tertiary px-2 py-1 text-left font-bold">Cities</th>
                                        <th className="border border-border-tertiary px-2 py-1 text-left font-bold w-64">Time Blocks (Original)</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {overviewData.map((row, idx) => (
                                        <tr key={row.name} className={idx % 2 === 0 ? 'bg-bg-primary' : 'bg-bg-secondary'}>
                                            <td className="border border-border-tertiary px-2 py-1 font-bold">{row.name}</td>
                                            <td className="border border-border-tertiary px-2 py-1">{row.count}</td>
                                            <td className="border border-border-tertiary px-2 py-1">{row.cities}</td>
                                            <td className="border border-border-tertiary px-2 py-1">{row.timeBlocks}</td>
                                        </tr>
                                    ))}
                                    {overviewData.length === 0 && (
                                        <tr>
                                            <td colSpan={4} className="border border-border-tertiary px-2 py-4 text-center text-text-tertiary italic">No assigned jobs.</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>

                        <hr className="border-border-secondary" />

                        {/* 3. Detailed Schedule */}
                        <div>
                            {Object.keys(jobsByTimeSlot).length > 0 ? (
                                Object.keys(jobsByTimeSlot).map((timeSlot) => {
                                    const jobsInSlot = jobsByTimeSlot[timeSlot];
                                    return (
                                        <div key={timeSlot} className="mb-6">
                                            <h3 className="text-lg font-mono font-bold text-text-primary mb-2">
                                                {timeSlot} ({jobsInSlot.length})
                                            </h3>
                                            <ul className="list-disc list-inside space-y-1 font-mono text-sm text-text-primary">
                                                {jobsInSlot.map(job => {
                                                    const { jobType, rescheduleInfo, priorityLevel, priorityReason, roofAge, sqft, stories } = getJobDisplayDetails(job);
                                                    const locationDisplay = [job.city ? job.city.toUpperCase() : '', job.zipCode ? `AZ ${job.zipCode}` : null].filter(Boolean).join(', ');
                                                    const tags = [roofAge, jobType, sqft, stories].filter(Boolean).join(' ');

                                                    return (
                                                        <li key={job.id}>
                                                            <span className="uppercase">{locationDisplay}</span>
                                                            {' '}(<strong className="text-text-primary font-bold">{tags}</strong>)
                                                            {priorityLevel > 0 && <span className="text-tag-amber-text font-bold ml-1">{'#'.repeat(priorityLevel)} {priorityReason}</span>}
                                                            {rescheduleInfo && <span className="text-tag-blue-text italic ml-1">(Rescheduled from {rescheduleInfo})</span>}
                                                            {' '}→ {job.assignedRepName}
                                                        </li>
                                                    );
                                                })}
                                            </ul>
                                        </div>
                                    );
                                })
                            ) : (
                                <p className="text-text-tertiary italic">No assigned jobs.</p>
                            )}
                        </div>

                        <hr className="border-border-secondary" />

                        {/* 4. Reps Off Today */}
                        <div>
                            <h2 className="text-xl font-bold mb-3 text-text-primary">4. Reps Off Today ({repsOff.length})</h2>
                            {repsOff.length > 0 ? (
                                <ul className="text-sm text-text-secondary space-y-1">
                                    {repsOff.map(name => (
                                        <li key={name}>{name}</li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="text-sm text-text-tertiary italic">All reps are available today.</p>
                            )}
                        </div>

                        <hr className="border-border-secondary" />

                        {/* 5. Available Reps with No Jobs */}
                        <div>
                            <h2 className="text-xl font-bold mb-3 text-text-primary">5. Available Reps - No Jobs ({repsAvailableNoJobs.length})</h2>
                            {repsAvailableNoJobs.length > 0 ? (
                                <ul className="text-sm text-text-secondary space-y-1">
                                    {repsAvailableNoJobs.map(name => (
                                        <li key={name}>{name}</li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="text-sm text-text-tertiary italic">All available reps have jobs assigned.</p>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default DailySummaryModal;