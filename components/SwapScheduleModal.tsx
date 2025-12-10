import React, { useMemo, useState } from 'react';
import { Rep, DisplayJob } from '../types';
import { XIcon, SwapIcon, UserIcon } from './icons';

interface SwapScheduleModalProps {
    isOpen: boolean;
    onClose: () => void;
    sourceRep: Rep;
    availableReps: Rep[];
    onSwap: (targetRepId: string) => void;
}

export const SwapScheduleModal: React.FC<SwapScheduleModalProps> = ({ isOpen, onClose, sourceRep, availableReps, onSwap }) => {
    const [searchTerm, setSearchTerm] = useState('');

    const filteredReps = useMemo(() => {
        return availableReps.filter(rep => rep.name.toLowerCase().includes(searchTerm.toLowerCase()));
    }, [availableReps, searchTerm]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-bg-secondary/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4" onClick={onClose}>
            <div className="popup-surface w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden animate-fade-in shadow-2xl rounded-lg border border-border-primary" onClick={e => e.stopPropagation()}>

                {/* Header */}
                <div className="bg-bg-secondary px-4 py-3 border-b border-border-primary flex justify-between items-center bg-brand-bg-light/30">
                    <div>
                        <h3 className="font-bold text-text-primary text-lg flex items-center gap-2">
                            <SwapIcon className="h-5 w-5 text-brand-primary" />
                            Swap Schedule
                        </h3>
                        <p className="text-xs text-text-tertiary mt-0.5">
                            Select a representative to swap schedules with <span className="font-bold text-text-primary">{sourceRep.name}</span>.
                        </p>
                    </div>
                    <button onClick={onClose} className="text-text-quaternary hover:text-text-secondary p-1 rounded-full hover:bg-bg-tertiary transition">
                        <XIcon className="h-6 w-6" />
                    </button>
                </div>

                {/* Search Bar */}
                <div className="p-3 border-b border-border-primary bg-bg-primary">
                    <input
                        type="text"
                        placeholder="Search reps..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-border-secondary rounded-md bg-bg-secondary text-text-primary focus:ring-2 focus:ring-brand-primary focus:outline-none"
                    />
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-3 bg-bg-tertiary/30">
                    {filteredReps.length === 0 ? (
                        <div className="text-center py-8 text-text-quaternary italic">
                            No available reps found.
                        </div>
                    ) : (
                        filteredReps.map(rep => {
                            const jobCount = rep.schedule.flatMap(s => s.jobs).length;
                            const jobs = rep.schedule.flatMap(s => s.jobs);

                            return (
                                <div key={rep.id} className="bg-bg-primary border border-border-primary rounded-lg shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden group">
                                    <div className="p-3 flex justify-between items-start gap-3">
                                        {/* Rep Info */}
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2 mb-1.5">
                                                <div className="h-8 w-8 rounded-full bg-brand-bg-light flex items-center justify-center border border-brand-primary/20">
                                                    <UserIcon className="h-4 w-4 text-brand-primary" />
                                                </div>
                                                <div>
                                                    <h4 className="font-bold text-text-primary leading-tight">{rep.name}</h4>
                                                    <div className="flex items-center gap-2 text-xs text-text-tertiary">
                                                        <span className="bg-bg-tertiary px-1.5 rounded border border-border-primary">
                                                            {jobCount} Jobs
                                                        </span>
                                                        {rep.region && (
                                                            <span className="bg-bg-tertiary px-1.5 rounded border border-border-primary text-[10px] font-mono">
                                                                {rep.region}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Jobs Summary */}
                                            {jobs.length > 0 ? (
                                                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                                                    {jobs.map((job, idx) => (
                                                        <div key={job.id} className="text-xs bg-bg-secondary/50 border border-border-secondary/50 rounded px-2 py-1 flex items-center justify-between truncate">
                                                            <span className="font-semibold text-text-secondary truncate mr-2">{job.city || 'Unknown'}</span>
                                                            <span className="text-[10px] text-text-quaternary font-mono flex-shrink-0">
                                                                {job.timeSlotLabel || job.originalTimeframe || 'Scheduled'}
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <div className="mt-2 text-xs text-text-quaternary italic px-1">
                                                    No jobs assigned currently.
                                                </div>
                                            )}
                                        </div>

                                        {/* Action Button */}
                                        <div className="flex flex-col justify-center self-center">
                                            <button
                                                onClick={() => onSwap(rep.id)}
                                                className="whitespace-nowrap bg-bg-primary hover:bg-brand-primary hover:text-brand-text-on-primary text-brand-primary border border-brand-primary px-4 py-2 rounded-md font-bold text-sm transition-colors shadow-sm group-hover:bg-brand-primary group-hover:text-brand-text-on-primary"
                                            >
                                                Swap
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>
        </div>
    );
};
