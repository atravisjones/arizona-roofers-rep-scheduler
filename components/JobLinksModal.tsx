import React from 'react';
import { Job } from '../types';
import { ExternalLinkIcon, XIcon } from './icons';
import { normalizeAddressForMatching } from '../services/googleSheetsService';

interface JobLinksModalProps {
    isOpen: boolean;
    onClose: () => void;
    jobs: Job[];
    roofrJobIdMap: Map<string, string>;
    repName: string;
}

const JobLinksModal: React.FC<JobLinksModalProps> = ({ isOpen, onClose, jobs, roofrJobIdMap, repName }) => {
    if (!isOpen) return null;

    // Filter jobs to only unique addresses (in case of duplicates/multiple days)
    const uniqueJobs = Array.from(new Map(jobs.map(job => [normalizeAddressForMatching(job.address) || job.address, job])).values());

    // Check coverage
    const linkCount = uniqueJobs.filter(j => {
        const norm = normalizeAddressForMatching(j.address);
        return norm && roofrJobIdMap.has(norm);
    }).length;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in" onClick={onClose}>
            <div className="bg-bg-primary rounded-lg shadow-xl w-full max-w-sm mx-4 border border-border-primary overflow-hidden flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="px-4 py-3 border-b border-border-primary flex justify-between items-center bg-bg-secondary">
                    <div>
                        <h3 className="text-sm font-bold text-text-primary">Job Card Links</h3>
                        <p className="text-[10px] text-text-tertiary">{repName} • {linkCount} / {uniqueJobs.length} linked</p>
                    </div>
                    <button onClick={onClose} className="text-text-tertiary hover:text-text-primary transition-colors">
                        <XIcon className="h-5 w-5" />
                    </button>
                </div>

                {/* List */}
                <div className="overflow-y-auto p-2 space-y-2 custom-scrollbar">
                    {uniqueJobs.length === 0 ? (
                        <div className="text-center py-8 text-text-quaternary italic text-xs">
                            No jobs assigned to this rep.
                        </div>
                    ) : (
                        uniqueJobs.map((job, idx) => {
                            const normalized = normalizeAddressForMatching(job.address);
                            const jobId = normalized ? roofrJobIdMap.get(normalized) : null;
                            const roofrUrl = jobId ? `https://app.roofr.com/dashboard/team/239329/jobs/details/${jobId}` : null;

                            return (
                                <div key={job.id} className="flex items-center justify-between gap-3 p-2 bg-bg-primary border border-border-secondary rounded transition hover:border-border-tertiary hover:shadow-sm">
                                    <div className="min-w-0 flex-1">
                                        <div className="text-xs font-semibold text-text-primary truncate" title={job.city}>{job.city}</div>
                                        <div className="text-[10px] text-text-secondary truncate" title={job.address}>{job.address}</div>
                                    </div>

                                    <a
                                        href={roofrUrl || '#'}
                                        target={roofrUrl ? "_blank" : undefined}
                                        rel={roofrUrl ? "noopener noreferrer" : undefined}
                                        className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-md shadow-sm transition-all text-[10px] font-bold leading-none whitespace-nowrap h-7 border ${roofrUrl
                                            ? 'bg-brand-primary text-brand-text-on-primary border-brand-primary hover:bg-brand-secondary cursor-pointer ring-1 ring-brand-primary/20'
                                            : 'bg-bg-tertiary text-text-quaternary border-border-secondary cursor-not-allowed opacity-60'
                                            }`}
                                        title={roofrUrl ? "Open Roofr Job Card" : "No Job Card Link Found"}
                                        onClick={(e) => {
                                            if (!roofrUrl) e.preventDefault();
                                        }}
                                    >
                                        <ExternalLinkIcon className="h-3.5 w-3.5" />
                                        <span>Job Card</span>
                                    </a>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>
        </div>
    );
};

export default JobLinksModal;
