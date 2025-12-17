import React, { useState } from 'react';
import { Job } from '../types';
import { JobCard } from './JobCard';
import { useAppContext } from '../context/AppContext';

interface UnassignedJobsProps {
  jobs: Job[];
  onJobDrop: (jobId: string, target: 'unassigned') => void;
  onSetDraggedOverRepId: (id: string | null) => void;
  onJobDragStart: (job: Job) => void;
  onJobDragEnd: () => void;
  onUpdateJob: (jobId: string, updatedDetails: Partial<Pick<Job, 'customerName' | 'address' | 'notes' | 'originalTimeframe'>>) => void;
  onRemoveJob: (jobId: string) => void;
}

const UnassignedJobs: React.FC<UnassignedJobsProps> = ({ jobs, onJobDrop, onSetDraggedOverRepId, onJobDragStart, onJobDragEnd, onUpdateJob, onRemoveJob }) => {
  const [isOver, setIsOver] = useState(false);
  const { draggedJob } = useAppContext();

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    onSetDraggedOverRepId(null);

    const isFromAnotherPanel = draggedJob && !jobs.some(job => job.id === draggedJob.id);
    setIsOver(!!isFromAnotherPanel);
  };

  const handleDragLeave = () => {
    setIsOver(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsOver(false);
    const jobId = draggedJob?.id;
    if (jobId) {
      onJobDrop(jobId, 'unassigned');
    }
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`h-full p-1.5 bg-bg-secondary rounded-lg border-2 border-dashed transition-colors overflow-y-auto custom-scrollbar ${isOver ? 'border-brand-primary bg-brand-bg-light' : 'border-border-secondary'}`}
    >
      {jobs.length > 0 ? (
        <div className="space-y-1.5">
          {jobs.map(job => (
            <JobCard
              key={job.id}
              job={job}
              onDragStart={onJobDragStart}
              onDragEnd={onJobDragEnd}
              onUpdateJob={onUpdateJob}
              onRemove={onRemoveJob}
            />
          ))}
        </div>
      ) : (
        <div className="flex items-center justify-center h-full">
          <p className="text-text-tertiary">No unassigned jobs. Paste and process jobs to begin.</p>
        </div>
      )}
    </div>
  );
};

export default UnassignedJobs;
