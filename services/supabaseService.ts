import { supabase } from './supabaseClient';
import { AppState, Rep, Job, DisplayJob, Settings, JobChange, ScheduledTimeSlot } from '../types';
import { TIME_SLOTS } from '../constants';

// ============================================================================
// Types for Supabase responses
// ============================================================================

interface SupabaseRep {
  id: string;
  external_id: string;
  name: string;
  availability: string | null;
  region: string | null;
  source_row: number | null;
  skills: Record<string, number> | null;
  zip_codes: string[] | null;
  sales_rank: number | null;
  unavailable_slots: Record<string, string[]> | null;
}

interface SupabaseJob {
  id: string;
  external_id: string;
  customer_name: string;
  address: string;
  city: string | null;
  zip_code: string | null;
  notes: string | null;
  original_timeframe: string | null;
}

interface SupabaseSchedule {
  id: string;
  date_key: string;
  job_id: string;
  rep_id: string | null;
  slot_id: string;
  slot_label: string;
  assignment_score: number | null;
  score_breakdown: Record<string, number> | null;
  is_locked: boolean;
  jobs?: SupabaseJob;
  reps?: SupabaseRep;
}

interface SupabaseUnassignedJob {
  id: string;
  date_key: string;
  job_id: string;
  jobs?: SupabaseJob;
}

// ============================================================================
// Helper Functions
// ============================================================================

function supabaseRepToRep(sr: SupabaseRep, scheduleSlots: ScheduledTimeSlot[] = []): Rep {
  return {
    id: sr.external_id,
    name: sr.name,
    availability: sr.availability || '',
    schedule: scheduleSlots.length > 0 ? scheduleSlots : TIME_SLOTS.map(ts => ({ ...ts, jobs: [] })),
    skills: sr.skills || {},
    region: (sr.region as 'PHX' | 'NORTH' | 'SOUTH' | 'UNKNOWN') || 'UNKNOWN',
    zipCodes: sr.zip_codes || [],
    salesRank: sr.sales_rank || undefined,
    unavailableSlots: sr.unavailable_slots || {},
    sourceRow: sr.source_row || undefined,
  };
}

function supabaseJobToJob(sj: SupabaseJob): Job {
  return {
    id: sj.external_id,
    customerName: sj.customer_name,
    address: sj.address,
    city: sj.city || undefined,
    zipCode: sj.zip_code || undefined,
    notes: sj.notes || '',
    originalTimeframe: sj.original_timeframe || undefined,
  };
}

function supabaseJobToDisplayJob(sj: SupabaseJob, schedule?: SupabaseSchedule): DisplayJob {
  return {
    ...supabaseJobToJob(sj),
    assignedRepName: schedule?.reps?.name,
    timeSlotLabel: schedule?.slot_label,
    assignmentScore: schedule?.assignment_score || undefined,
    scoreBreakdown: schedule?.score_breakdown as any,
  };
}

// ============================================================================
// Reps Operations
// ============================================================================

export async function fetchReps(): Promise<{ success: boolean; reps?: Rep[]; error?: string }> {
  try {
    const { data, error } = await supabase
      .from('reps')
      .select('*')
      .order('sales_rank', { ascending: true, nullsFirst: false });

    if (error) throw error;

    const reps = (data || []).map(sr => supabaseRepToRep(sr));
    return { success: true, reps };
  } catch (error) {
    console.error('[Supabase] Error fetching reps:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function upsertReps(reps: Rep[]): Promise<{ success: boolean; error?: string }> {
  try {
    const supabaseReps = reps.map(rep => ({
      external_id: rep.id,
      name: rep.name,
      availability: rep.availability,
      region: rep.region || 'UNKNOWN',
      source_row: rep.sourceRow,
      skills: rep.skills || {},
      zip_codes: rep.zipCodes || [],
      sales_rank: rep.salesRank,
      unavailable_slots: rep.unavailableSlots || {},
    }));

    const { error } = await supabase
      .from('reps')
      .upsert(supabaseReps, { onConflict: 'external_id' });

    if (error) throw error;
    return { success: true };
  } catch (error) {
    console.error('[Supabase] Error upserting reps:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// ============================================================================
// Jobs Operations
// ============================================================================

export async function upsertJob(job: Job): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase
      .from('jobs')
      .upsert({
        external_id: job.id,
        customer_name: job.customerName,
        address: job.address,
        city: job.city,
        zip_code: job.zipCode,
        notes: job.notes,
        original_timeframe: job.originalTimeframe,
      }, { onConflict: 'external_id' });

    if (error) throw error;
    return { success: true };
  } catch (error) {
    console.error('[Supabase] Error upserting job:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function upsertJobs(jobs: Job[]): Promise<{ success: boolean; error?: string }> {
  try {
    const supabaseJobs = jobs.map(job => ({
      external_id: job.id,
      customer_name: job.customerName,
      address: job.address,
      city: job.city,
      zip_code: job.zipCode,
      notes: job.notes,
      original_timeframe: job.originalTimeframe,
    }));

    const { error } = await supabase
      .from('jobs')
      .upsert(supabaseJobs, { onConflict: 'external_id' });

    if (error) throw error;
    return { success: true };
  } catch (error) {
    console.error('[Supabase] Error upserting jobs:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// ============================================================================
// Daily Schedule Operations (Main Save/Load)
// ============================================================================

export async function saveDailySchedule(
  dateKey: string,
  state: AppState
): Promise<{ success: boolean; error?: string }> {
  try {
    console.log('[Supabase] Saving schedule for:', dateKey);

    // 1. Collect all jobs (assigned + unassigned)
    const allJobs: Job[] = [...state.unassignedJobs];
    for (const rep of state.reps) {
      for (const slot of rep.schedule) {
        for (const job of slot.jobs) {
          allJobs.push(job);
        }
      }
    }

    // 2. Upsert all jobs
    if (allJobs.length > 0) {
      const jobResult = await upsertJobs(allJobs);
      if (!jobResult.success) throw new Error(jobResult.error);
    }

    // 3. Get job ID mappings (external_id -> uuid)
    const jobExternalIds = allJobs.map(j => j.id);
    const { data: jobMappings } = await supabase
      .from('jobs')
      .select('id, external_id')
      .in('external_id', jobExternalIds.length > 0 ? jobExternalIds : ['__none__']);

    const jobIdMap = new Map<string, string>();
    (jobMappings || []).forEach(j => jobIdMap.set(j.external_id, j.id));

    // 4. Upsert reps
    const repResult = await upsertReps(state.reps);
    if (!repResult.success) throw new Error(repResult.error);

    // 5. Get rep ID mappings
    const repExternalIds = state.reps.map(r => r.id);
    const { data: repMappings } = await supabase
      .from('reps')
      .select('id, external_id')
      .in('external_id', repExternalIds.length > 0 ? repExternalIds : ['__none__']);

    const repIdMap = new Map<string, string>();
    (repMappings || []).forEach(r => repIdMap.set(r.external_id, r.id));

    // 6. Delete existing schedules for this date
    await supabase
      .from('daily_schedules')
      .delete()
      .eq('date_key', dateKey);

    await supabase
      .from('unassigned_jobs')
      .delete()
      .eq('date_key', dateKey);

    // 7. Insert assigned jobs (schedules)
    const scheduleRows: any[] = [];
    for (const rep of state.reps) {
      const repUuid = repIdMap.get(rep.id);
      for (const slot of rep.schedule) {
        for (const job of slot.jobs) {
          const jobUuid = jobIdMap.get(job.id);
          if (jobUuid) {
            scheduleRows.push({
              date_key: dateKey,
              job_id: jobUuid,
              rep_id: repUuid,
              slot_id: slot.id,
              slot_label: slot.label,
              assignment_score: (job as DisplayJob).assignmentScore,
              score_breakdown: (job as DisplayJob).scoreBreakdown,
              is_locked: rep.isLocked || false,
            });
          }
        }
      }
    }

    if (scheduleRows.length > 0) {
      const { error: scheduleError } = await supabase
        .from('daily_schedules')
        .insert(scheduleRows);
      if (scheduleError) throw scheduleError;
    }

    // 8. Insert unassigned jobs
    const unassignedRows = state.unassignedJobs
      .map(job => {
        const jobUuid = jobIdMap.get(job.id);
        return jobUuid ? { date_key: dateKey, job_id: jobUuid } : null;
      })
      .filter(Boolean);

    if (unassignedRows.length > 0) {
      const { error: unassignedError } = await supabase
        .from('unassigned_jobs')
        .insert(unassignedRows);
      if (unassignedError) throw unassignedError;
    }

    // 9. Save settings
    const { error: settingsError } = await supabase
      .from('settings')
      .upsert({
        date_key: dateKey,
        config: state.settings,
      }, { onConflict: 'date_key' });
    if (settingsError) throw settingsError;

    console.log('[Supabase] Save complete for:', dateKey);
    return { success: true };
  } catch (error) {
    console.error('[Supabase] Error saving daily schedule:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function loadDailySchedule(
  dateKey: string
): Promise<{ success: boolean; data?: AppState; error?: string; message?: string }> {
  try {
    console.log('[Supabase] Loading schedule for:', dateKey);

    // 1. Fetch all reps
    const { data: repsData, error: repsError } = await supabase
      .from('reps')
      .select('*')
      .order('sales_rank', { ascending: true, nullsFirst: false });

    if (repsError) throw repsError;

    // 2. Fetch schedules for this date with job details
    const { data: scheduleData, error: scheduleError } = await supabase
      .from('daily_schedules')
      .select(`
        *,
        jobs (*),
        reps (*)
      `)
      .eq('date_key', dateKey);

    if (scheduleError) throw scheduleError;

    // 3. Fetch unassigned jobs for this date
    const { data: unassignedData, error: unassignedError } = await supabase
      .from('unassigned_jobs')
      .select(`
        *,
        jobs (*)
      `)
      .eq('date_key', dateKey);

    if (unassignedError) throw unassignedError;

    // 4. Fetch settings for this date (use maybeSingle to handle no rows gracefully)
    const { data: settingsData } = await supabase
      .from('settings')
      .select('config')
      .eq('date_key', dateKey)
      .maybeSingle();

    // 5. Build rep schedules
    const schedulesByRep = new Map<string, Map<string, DisplayJob[]>>();
    const lockedReps = new Set<string>();

    for (const schedule of (scheduleData || [])) {
      if (!schedule.jobs || !schedule.reps) continue;

      const repExternalId = schedule.reps.external_id;
      if (!schedulesByRep.has(repExternalId)) {
        schedulesByRep.set(repExternalId, new Map());
      }

      const repSchedule = schedulesByRep.get(repExternalId)!;
      if (!repSchedule.has(schedule.slot_id)) {
        repSchedule.set(schedule.slot_id, []);
      }

      repSchedule.get(schedule.slot_id)!.push(supabaseJobToDisplayJob(schedule.jobs, schedule));

      if (schedule.is_locked) {
        lockedReps.add(repExternalId);
      }
    }

    // 6. Build reps array with schedules
    const reps: Rep[] = (repsData || []).map(sr => {
      const repSchedule = schedulesByRep.get(sr.external_id);
      const scheduleSlots: ScheduledTimeSlot[] = TIME_SLOTS.map(ts => ({
        ...ts,
        jobs: repSchedule?.get(ts.id) || [],
      }));

      return {
        ...supabaseRepToRep(sr, scheduleSlots),
        isLocked: lockedReps.has(sr.external_id),
      };
    });

    // 7. Build unassigned jobs
    const unassignedJobs: Job[] = (unassignedData || [])
      .filter(u => u.jobs)
      .map(u => supabaseJobToJob(u.jobs!));

    // 8. Build settings (use defaults if not found)
    const defaultSettings: Settings = {
      allowDoubleBooking: false,
      maxJobsPerSlot: 2,
      allowAssignOutsideAvailability: false,
      maxJobsPerRep: 4,
      minJobsPerRep: 3,
      maxCitiesPerRep: 3,
      weightSameCity: 8,
      weightAdjacentCity: 6,
      weightSkillMatch: 5,
      unavailabilityPenalty: 1.2,
      strictTimeSlotMatching: true,
      maxTravelTimeMinutes: 75,
      scoringWeights: {
        timeframeMatch: 10.0,
        performance: 8.0,
        skillRoofing: 5.0,
        skillType: 4.0,
        distanceCluster: 2.0,
        distanceBase: 1.0,
      },
      allowRegionalRepsInPhoenix: false,
    };

    const settings: Settings = settingsData?.config || defaultSettings;

    // Check if we found any data
    const hasData = (scheduleData && scheduleData.length > 0) ||
                    (unassignedData && unassignedData.length > 0);

    if (!hasData) {
      console.log('[Supabase] No schedule data found for:', dateKey);
      return {
        success: false,
        message: `No data found for ${dateKey}`,
        data: { reps, unassignedJobs: [], settings },
      };
    }

    console.log('[Supabase] Load complete for:', dateKey);
    return {
      success: true,
      data: { reps, unassignedJobs, settings },
    };
  } catch (error) {
    console.error('[Supabase] Error loading daily schedule:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// ============================================================================
// Change Log Operations
// ============================================================================

export async function logChange(change: JobChange): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase
      .from('change_log')
      .insert({
        date_key: change.dateKey,
        job_external_id: change.jobId,
        change_type: change.type,
        timestamp: change.timestamp,
        before_state: change.before,
        after_state: change.after,
        details: change.details,
      });

    if (error) throw error;
    return { success: true };
  } catch (error) {
    console.error('[Supabase] Error logging change:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function fetchChangeLogs(
  dateKey: string
): Promise<{ success: boolean; changes?: JobChange[]; error?: string }> {
  try {
    const { data, error } = await supabase
      .from('change_log')
      .select('*')
      .eq('date_key', dateKey)
      .order('timestamp', { ascending: false });

    if (error) throw error;

    const changes: JobChange[] = (data || []).map(c => ({
      type: c.change_type as JobChange['type'],
      jobId: c.job_external_id,
      timestamp: c.timestamp,
      dateKey: c.date_key,
      before: c.before_state,
      after: c.after_state,
      details: c.details,
    }));

    return { success: true, changes };
  } catch (error) {
    console.error('[Supabase] Error fetching change logs:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// ============================================================================
// Geocode Cache Operations
// ============================================================================

export async function getGeocode(
  address: string
): Promise<{ lat: number; lon: number } | null> {
  try {
    const { data, error } = await supabase
      .from('geocode_cache')
      .select('latitude, longitude')
      .eq('address', address)
      .single();

    if (error || !data) return null;

    return {
      lat: parseFloat(data.latitude),
      lon: parseFloat(data.longitude),
    };
  } catch {
    return null;
  }
}

export async function saveGeocode(
  address: string,
  coords: { lat: number; lon: number }
): Promise<void> {
  try {
    await supabase
      .from('geocode_cache')
      .upsert({
        address,
        latitude: coords.lat,
        longitude: coords.lon,
      }, { onConflict: 'address' });
  } catch (error) {
    console.error('[Supabase] Error saving geocode:', error);
  }
}

// ============================================================================
// Bulk Operations (for multi-day save/load)
// ============================================================================

export async function saveAllDailySchedules(
  states: Array<{ dateKey: string; data: AppState }>
): Promise<{ success: boolean; results: Array<{ dateKey: string; success: boolean; error?: string }> }> {
  const results: Array<{ dateKey: string; success: boolean; error?: string }> = [];

  for (const { dateKey, data } of states) {
    const result = await saveDailySchedule(dateKey, data);
    results.push({
      dateKey,
      success: result.success,
      error: result.error,
    });
  }

  return {
    success: results.every(r => r.success),
    results,
  };
}

export async function loadAllDailySchedules(
  dateKeys: string[]
): Promise<{ success: boolean; results: Array<{ dateKey: string; success: boolean; data?: AppState; error?: string }> }> {
  const results: Array<{ dateKey: string; success: boolean; data?: AppState; error?: string }> = [];

  for (const dateKey of dateKeys) {
    const result = await loadDailySchedule(dateKey);
    results.push({
      dateKey,
      success: result.success,
      data: result.data,
      error: result.error,
    });
  }

  return {
    success: results.some(r => r.success),
    results,
  };
}
