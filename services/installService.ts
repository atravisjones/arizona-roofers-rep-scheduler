import { InstallJob, Rep } from '../types';

/**
 * Fetch installs for a given date from the /api/installs endpoint
 */
export async function fetchInstalls(date: string): Promise<InstallJob[]> {
  try {
    const res = await fetch(`/api/installs?date=${encodeURIComponent(date)}`);
    if (!res.ok) {
      console.error(`Failed to fetch installs: ${res.status}`);
      return [];
    }
    const data = await res.json();
    const installs = Array.isArray(data) ? data : data.installs || [];
    return installs;
  } catch (error) {
    console.error('Error fetching installs:', error);
    return [];
  }
}

/**
 * Match crew names from installs to existing reps by fuzzy name matching.
 * Case-insensitive: check if crew name contains rep name or vice versa.
 * Returns Map<repId, InstallJob[]>
 */
export function matchCrewToReps(installs: InstallJob[], reps: Rep[]): Map<string, InstallJob[]> {
  const result = new Map<string, InstallJob[]>();

  // Initialize map with all rep IDs
  for (const rep of reps) {
    result.set(rep.id, []);
  }

  // For each install, try to match crew names AND jobOwner to reps
  for (const install of installs) {
    // Build list of names to match: crew names + jobOwner as fallback
    const namesToMatch = [...install.crewNames];
    if (install.jobOwner && !namesToMatch.some(n => n.toLowerCase().trim() === install.jobOwner.toLowerCase().trim())) {
      namesToMatch.push(install.jobOwner);
    }

    for (const name of namesToMatch) {
      const nameLower = name.toLowerCase().trim();
      if (!nameLower) continue;

      for (const rep of reps) {
        const repLower = rep.name.toLowerCase().trim();

        // Case-insensitive fuzzy matching
        if (
          nameLower.includes(repLower) ||
          repLower.includes(nameLower)
        ) {
          const existing = result.get(rep.id) || [];
          if (!existing.find(j => j.jobId === install.jobId)) {
            existing.push(install);
            result.set(rep.id, existing);
          }
          break; // Match this name to first matching rep
        }
      }
    }
  }

  return result;
}
