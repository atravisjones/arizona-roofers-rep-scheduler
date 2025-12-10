import { Job, Rep, AppState, JobChange, ChangeType } from '../types';

/**
 * Finds a job in the app state (either assigned or unassigned)
 */
export function findJobInState(jobId: string, state: AppState): { job: Job; repId?: string; repName?: string; slotId?: string; slotLabel?: string } | null {
  // Check unassigned jobs
  const unassignedJob = state.unassignedJobs.find(j => j.id === jobId);
  if (unassignedJob) {
    return { job: unassignedJob };
  }

  // Check assigned jobs
  for (const rep of state.reps) {
    for (const slot of rep.schedule) {
      const job = slot.jobs.find(j => j.id === jobId);
      if (job) {
        return {
          job,
          repId: rep.id,
          repName: rep.name,
          slotId: slot.id,
          slotLabel: slot.label
        };
      }
    }
  }

  return null;
}

/**
 * Compares two job objects and returns the differences
 */
export function compareJobs(oldJob: Job, newJob: Job): string[] {
  const differences: string[] = [];

  if (oldJob.customerName !== newJob.customerName) {
    differences.push(`Customer: "${oldJob.customerName}" → "${newJob.customerName}"`);
  }
  if (oldJob.address !== newJob.address) {
    differences.push(`Address: "${oldJob.address}" → "${newJob.address}"`);
  }
  if (oldJob.city !== newJob.city) {
    differences.push(`City: "${oldJob.city}" → "${newJob.city}"`);
  }
  if (oldJob.notes !== newJob.notes) {
    differences.push(`Notes: "${oldJob.notes}" → "${newJob.notes}"`);
  }
  if (oldJob.originalTimeframe !== newJob.originalTimeframe) {
    differences.push(`Time: "${oldJob.originalTimeframe}" → "${newJob.originalTimeframe}"`);
  }

  return differences;
}

/**
 * Generates a unique job identifier based on address (for matching jobs across imports)
 */
export function getJobIdentifier(job: Job): string {
  // Normalize address for comparison
  const normalizedAddress = job.address.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
  const normalizedCity = job.city.toLowerCase().trim();
  return `${normalizedAddress}-${normalizedCity}`;
}

/**
 * Finds an existing job in the state that matches the given job by address
 */
export function findMatchingJob(newJob: Job, state: AppState): { job: Job; repId?: string; slotId?: string } | null {
  const newJobId = getJobIdentifier(newJob);

  // Check unassigned jobs
  for (const job of state.unassignedJobs) {
    if (getJobIdentifier(job) === newJobId) {
      return { job };
    }
  }

  // Check assigned jobs
  for (const rep of state.reps) {
    for (const slot of rep.schedule) {
      for (const job of slot.jobs) {
        if (getJobIdentifier(job) === newJobId) {
          return { job, repId: rep.id, slotId: slot.id };
        }
      }
    }
  }

  return null;
}

/**
 * Compares old and new states to detect job changes
 */
export function detectJobChanges(
  dateKey: string,
  oldState: AppState | null,
  newState: AppState,
  timestamp: string
): JobChange[] {
  const changes: JobChange[] = [];

  if (!oldState) {
    // If no old state, all jobs in new state are additions
    newState.unassignedJobs.forEach(job => {
      changes.push({
        type: 'added',
        jobId: job.id,
        timestamp,
        dateKey,
        after: {
          customerName: job.customerName,
          address: job.address,
          city: job.city,
          notes: job.notes,
          originalTimeframe: job.originalTimeframe
        },
        details: 'Job added as unassigned'
      });
    });

    newState.reps.forEach(rep => {
      rep.schedule.forEach(slot => {
        slot.jobs.forEach(job => {
          changes.push({
            type: 'added',
            jobId: job.id,
            timestamp,
            dateKey,
            after: {
              customerName: job.customerName,
              address: job.address,
              city: job.city,
              notes: job.notes,
              originalTimeframe: job.originalTimeframe,
              repId: rep.id,
              repName: rep.name,
              slotId: slot.id,
              slotLabel: slot.label
            },
            details: `Job added and assigned to ${rep.name} (${slot.label})`
          });
        });
      });
    });

    return changes;
  }

  // Build maps of jobs by identifier for matching
  const oldJobsMap = new Map<string, { job: Job; location: any }>();
  const newJobsMap = new Map<string, { job: Job; location: any }>();

  // Map old jobs
  oldState.unassignedJobs.forEach(job => {
    oldJobsMap.set(getJobIdentifier(job), { job, location: { type: 'unassigned' } });
  });
  oldState.reps.forEach(rep => {
    rep.schedule.forEach(slot => {
      slot.jobs.forEach(job => {
        oldJobsMap.set(getJobIdentifier(job), {
          job,
          location: { type: 'assigned', repId: rep.id, repName: rep.name, slotId: slot.id, slotLabel: slot.label }
        });
      });
    });
  });

  // Map new jobs
  newState.unassignedJobs.forEach(job => {
    newJobsMap.set(getJobIdentifier(job), { job, location: { type: 'unassigned' } });
  });
  newState.reps.forEach(rep => {
    rep.schedule.forEach(slot => {
      slot.jobs.forEach(job => {
        newJobsMap.set(getJobIdentifier(job), {
          job,
          location: { type: 'assigned', repId: rep.id, repName: rep.name, slotId: slot.id, slotLabel: slot.label }
        });
      });
    });
  });

  // Find removed jobs
  oldJobsMap.forEach((oldJobData, identifier) => {
    if (!newJobsMap.has(identifier)) {
      const beforeData: any = {
        customerName: oldJobData.job.customerName,
        address: oldJobData.job.address,
        city: oldJobData.job.city,
        notes: oldJobData.job.notes,
        originalTimeframe: oldJobData.job.originalTimeframe
      };

      if (oldJobData.location.type === 'assigned') {
        beforeData.repId = oldJobData.location.repId;
        beforeData.repName = oldJobData.location.repName;
        beforeData.slotId = oldJobData.location.slotId;
        beforeData.slotLabel = oldJobData.location.slotLabel;
      }

      changes.push({
        type: 'removed',
        jobId: oldJobData.job.id,
        timestamp,
        dateKey,
        before: beforeData,
        details: oldJobData.location.type === 'assigned'
          ? `Job removed from ${oldJobData.location.repName} (${oldJobData.location.slotLabel})`
          : 'Job removed from unassigned'
      });
    }
  });

  // Find added and updated jobs
  newJobsMap.forEach((newJobData, identifier) => {
    const oldJobData = oldJobsMap.get(identifier);

    if (!oldJobData) {
      // New job added
      const afterData: any = {
        customerName: newJobData.job.customerName,
        address: newJobData.job.address,
        city: newJobData.job.city,
        notes: newJobData.job.notes,
        originalTimeframe: newJobData.job.originalTimeframe
      };

      if (newJobData.location.type === 'assigned') {
        afterData.repId = newJobData.location.repId;
        afterData.repName = newJobData.location.repName;
        afterData.slotId = newJobData.location.slotId;
        afterData.slotLabel = newJobData.location.slotLabel;
      }

      changes.push({
        type: 'added',
        jobId: newJobData.job.id,
        timestamp,
        dateKey,
        after: afterData,
        details: newJobData.location.type === 'assigned'
          ? `Job added and assigned to ${newJobData.location.repName} (${newJobData.location.slotLabel})`
          : 'Job added as unassigned'
      });
    } else {
      // Check for updates or moves
      const jobDifferences = compareJobs(oldJobData.job, newJobData.job);
      const oldLoc = oldJobData.location;
      const newLoc = newJobData.location;

      const locationChanged =
        oldLoc.type !== newLoc.type ||
        (oldLoc.type === 'assigned' && newLoc.type === 'assigned' &&
          (oldLoc.repId !== newLoc.repId || oldLoc.slotId !== newLoc.slotId));

      if (jobDifferences.length > 0 || locationChanged) {
        const beforeData: any = {
          customerName: oldJobData.job.customerName,
          address: oldJobData.job.address,
          city: oldJobData.job.city,
          notes: oldJobData.job.notes,
          originalTimeframe: oldJobData.job.originalTimeframe
        };

        const afterData: any = {
          customerName: newJobData.job.customerName,
          address: newJobData.job.address,
          city: newJobData.job.city,
          notes: newJobData.job.notes,
          originalTimeframe: newJobData.job.originalTimeframe
        };

        if (oldLoc.type === 'assigned') {
          beforeData.repId = oldLoc.repId;
          beforeData.repName = oldLoc.repName;
          beforeData.slotId = oldLoc.slotId;
          beforeData.slotLabel = oldLoc.slotLabel;
        }

        if (newLoc.type === 'assigned') {
          afterData.repId = newLoc.repId;
          afterData.repName = newLoc.repName;
          afterData.slotId = newLoc.slotId;
          afterData.slotLabel = newLoc.slotLabel;
        }

        let details = '';
        if (locationChanged && jobDifferences.length > 0) {
          details = `Job updated and moved. ${jobDifferences.join(', ')}`;
        } else if (locationChanged) {
          if (oldLoc.type === 'unassigned' && newLoc.type === 'assigned') {
            details = `Job assigned to ${newLoc.repName} (${newLoc.slotLabel})`;
          } else if (oldLoc.type === 'assigned' && newLoc.type === 'unassigned') {
            details = `Job unassigned from ${oldLoc.repName} (${oldLoc.slotLabel})`;
          } else if (oldLoc.type === 'assigned' && newLoc.type === 'assigned') {
            details = `Job moved from ${oldLoc.repName} (${oldLoc.slotLabel}) to ${newLoc.repName} (${newLoc.slotLabel})`;
          }
        } else {
          details = jobDifferences.join(', ');
        }

        changes.push({
          type: locationChanged ? 'moved' : 'updated',
          jobId: newJobData.job.id,
          timestamp,
          dateKey,
          before: beforeData,
          after: afterData,
          details
        });
      }
    }
  });

  return changes;
}
