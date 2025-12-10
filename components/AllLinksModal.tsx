import React, { useMemo } from 'react';
import { DisplayJob } from '../types';
import { ExternalLinkIcon, XIcon, CheckCircleIcon, AlertCircleIcon } from './icons';
import { normalizeAddressForMatching } from '../services/googleSheetsService';

interface AllLinksModalProps {
    isOpen: boolean;
    onClose: () => void;
    allJobs: DisplayJob[];
    roofrJobIdMap: Map<string, string>;
}

const AllLinksModal: React.FC<AllLinksModalProps> = ({ isOpen, onClose, allJobs, roofrJobIdMap }) => {
    if (!isOpen) return null;

    // Group jobs by rep and deduplicate by address
    const jobsByRep = useMemo(() => {
        const grouped = new Map<string, DisplayJob[]>();

        allJobs.forEach(job => {
            const repName = job.assignedRepName || 'Unassigned';
            if (!grouped.has(repName)) {
                grouped.set(repName, []);
            }
            grouped.get(repName)!.push(job);
        });

        // Deduplicate jobs by normalized address within each rep
        const result = new Map<string, DisplayJob[]>();
        grouped.forEach((jobs, repName) => {
            const uniqueJobs = Array.from(
                new Map(
                    jobs.map(job => [
                        normalizeAddressForMatching(job.address) || job.address,
                        job
                    ])
                ).values()
            );
            result.set(repName, uniqueJobs);
        });

        return result;
    }, [allJobs]);

    // Calculate overall statistics
    const totalJobs = useMemo(() => {
        return Array.from(jobsByRep.values()).reduce((sum, jobs) => sum + jobs.length, 0);
    }, [jobsByRep]);

    const linkedJobs = useMemo(() => {
        let count = 0;
        jobsByRep.forEach(jobs => {
            jobs.forEach(job => {
                const norm = normalizeAddressForMatching(job.address);
                if (norm && roofrJobIdMap.has(norm)) {
                    count++;
                }
            });
        });
        return count;
    }, [jobsByRep, roofrJobIdMap]);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in" onClick={onClose}>
            <div className="bg-bg-primary rounded-lg shadow-xl w-full max-w-4xl mx-4 border border-border-primary overflow-hidden flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="px-6 py-4 border-b border-border-primary flex justify-between items-center bg-bg-secondary">
                    <div>
                        <h3 className="text-lg font-bold text-text-primary">All Job Card Links</h3>
                        <p className="text-xs text-text-tertiary mt-1">
                            {linkedJobs} / {totalJobs} jobs linked ({Math.round((linkedJobs / totalJobs) * 100)}% coverage)
                        </p>
                    </div>
                    <button onClick={onClose} className="text-text-tertiary hover:text-text-primary transition-colors">
                        <XIcon className="h-6 w-6" />
                    </button>
                </div>

                {/* Content */}
                <div className="overflow-y-auto p-4 custom-scrollbar">
                    {Array.from(jobsByRep.entries()).map(([repName, jobs]) => {
                        const repLinkedCount = jobs.filter(j => {
                            const norm = normalizeAddressForMatching(j.address);
                            return norm && roofrJobIdMap.has(norm);
                        }).length;

                        return (
                            <div key={repName} className="mb-6 last:mb-0">
                                {/* Rep Header */}
                                <div className="flex items-center justify-between mb-3 pb-2 border-b border-border-secondary">
                                    <h4 className="text-sm font-bold text-text-primary">{repName}</h4>
                                    <span className="text-xs text-text-tertiary">
                                        {repLinkedCount} / {jobs.length} linked
                                    </span>
                                </div>

                                {/* Jobs Grid */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    {jobs.map((job) => {
                                        const normalized = normalizeAddressForMatching(job.address);
                                        const jobId = normalized ? roofrJobIdMap.get(normalized) : null;
                                        const roofrUrl = jobId ? `https://app.roofr.com/dashboard/team/239329/jobs/details/${jobId}` : null;
                                        const hasLink = !!roofrUrl;

                                        return (
                                            <div
                                                key={job.id}
                                                className={`flex items-center justify-between gap-3 p-3 rounded-lg border transition-all ${
                                                    hasLink
                                                        ? 'bg-tag-green-bg/30 border-tag-green-border hover:border-tag-green-text hover:shadow-sm'
                                                        : 'bg-tag-red-bg/30 border-tag-red-border hover:border-tag-red-text'
                                                }`}
                                            >
                                                {/* Status Icon */}
                                                <div className="flex-shrink-0">
                                                    {hasLink ? (
                                                        <CheckCircleIcon className="h-5 w-5 text-tag-green-text" />
                                                    ) : (
                                                        <AlertCircleIcon className="h-5 w-5 text-tag-red-text" />
                                                    )}
                                                </div>

                                                {/* Job Info */}
                                                <div className="min-w-0 flex-1">
                                                    <div className="text-xs font-semibold text-text-primary truncate" title={job.customerName}>
                                                        {job.customerName}
                                                    </div>
                                                    <div className="text-[10px] text-text-secondary truncate" title={job.city}>
                                                        {job.city}
                                                    </div>
                                                    <div className="text-[10px] text-text-tertiary truncate" title={job.address}>
                                                        {job.address}
                                                    </div>
                                                    {job.timeSlotLabel && (
                                                        <div className="text-[9px] text-text-quaternary mt-0.5">
                                                            {job.timeSlotLabel}
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Link Button */}
                                                <a
                                                    href={roofrUrl || '#'}
                                                    target={roofrUrl ? "_blank" : undefined}
                                                    rel={roofrUrl ? "noopener noreferrer" : undefined}
                                                    className={`flex-shrink-0 flex items-center space-x-1.5 px-3 py-2 rounded-md shadow-sm transition-all text-[10px] font-bold leading-none whitespace-nowrap border ${
                                                        roofrUrl
                                                            ? 'bg-brand-primary text-brand-text-on-primary border-brand-primary hover:bg-brand-secondary cursor-pointer ring-1 ring-brand-primary/20'
                                                            : 'bg-bg-tertiary text-text-quaternary border-border-secondary cursor-not-allowed opacity-60'
                                                    }`}
                                                    title={roofrUrl ? "Open Roofr Job Card" : "No Job Card Link Found"}
                                                    onClick={(e) => {
                                                        if (!roofrUrl) e.preventDefault();
                                                    }}
                                                >
                                                    <ExternalLinkIcon className="h-3.5 w-3.5" />
                                                    <span>Open</span>
                                                </a>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}

                    {totalJobs === 0 && (
                        <div className="text-center py-12 text-text-quaternary italic">
                            No jobs assigned yet.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default AllLinksModal;
