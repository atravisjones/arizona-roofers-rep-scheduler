import { supabase } from './supabaseClient';
import { AppState, BackupVersion, BackupListItem, BackupSnapshot, SaveType, BACKUP_CONFIG } from '../types';

// ============================================================================
// Manual Save Functions
// ============================================================================

/**
 * Create a manual save backup.
 * Maintains 3-6 versions, rotating out oldest when exceeding 6.
 */
export async function createManualBackup(
  dateKey: string,
  state: AppState
): Promise<{ success: boolean; version?: BackupVersion; error?: string }> {
  try {
    console.log('[BackupService] Creating manual backup for:', dateKey);

    // 1. Fetch existing manual backups for this date
    const { data: existing, error: fetchError } = await supabase
      .from('schedule_backups')
      .select('id, version_number')
      .eq('date_key', dateKey)
      .eq('save_type', 'manual')
      .order('version_number', { ascending: true });

    if (fetchError) throw fetchError;

    const existingVersions = existing || [];
    const versionCount = existingVersions.length;

    // 2. If at max (6), delete oldest and shift versions
    if (versionCount >= BACKUP_CONFIG.MAX_MANUAL_VERSIONS) {
      console.log('[BackupService] At max versions, rotating oldest...');

      // Delete the oldest (version 1)
      const oldest = existingVersions[0];
      const { error: deleteError } = await supabase
        .from('schedule_backups')
        .delete()
        .eq('id', oldest.id);

      if (deleteError) throw deleteError;

      // Shift remaining versions down by 1
      for (let i = 1; i < existingVersions.length; i++) {
        const { error: updateError } = await supabase
          .from('schedule_backups')
          .update({ version_number: existingVersions[i].version_number - 1 })
          .eq('id', existingVersions[i].id);

        if (updateError) throw updateError;
      }
    }

    // 3. Determine new version number
    const newVersionNumber = Math.min(versionCount + 1, BACKUP_CONFIG.MAX_MANUAL_VERSIONS);

    // 4. Insert new backup
    const { data: inserted, error: insertError } = await supabase
      .from('schedule_backups')
      .insert({
        date_key: dateKey,
        save_type: 'manual',
        version_number: newVersionNumber,
        snapshot: state,
      })
      .select()
      .single();

    if (insertError) throw insertError;

    console.log('[BackupService] Manual backup created:', inserted.id, 'v' + newVersionNumber);

    return {
      success: true,
      version: {
        id: inserted.id,
        dateKey: inserted.date_key,
        saveType: inserted.save_type as SaveType,
        versionNumber: inserted.version_number,
        createdAt: inserted.created_at,
        updatedAt: inserted.updated_at,
      },
    };
  } catch (error) {
    console.error('[BackupService] Error creating manual backup:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// ============================================================================
// Auto-Save Functions
// ============================================================================

/**
 * Create or update the auto-save backup.
 * Only keeps one auto-save per date (upsert).
 */
export async function upsertAutoBackup(
  dateKey: string,
  state: AppState
): Promise<{ success: boolean; error?: string }> {
  try {
    console.log('[BackupService] Upserting auto backup for:', dateKey);

    const { error } = await supabase
      .from('schedule_backups')
      .upsert({
        date_key: dateKey,
        save_type: 'auto',
        version_number: 1, // Always 1 for auto-saves
        snapshot: state,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'date_key,save_type,version_number'
      });

    if (error) throw error;

    console.log('[BackupService] Auto backup upserted for:', dateKey);
    return { success: true };
  } catch (error) {
    console.error('[BackupService] Error upserting auto backup:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// ============================================================================
// Load Functions
// ============================================================================

/**
 * Fetch list of available backups for display in load modal.
 * Returns both manual and auto backups metadata (not full data).
 */
export async function fetchBackupList(
  dateKey?: string
): Promise<{ success: boolean; backups?: BackupListItem[]; error?: string }> {
  try {
    console.log('[BackupService] Fetching backup list', dateKey ? `for ${dateKey}` : '(all dates)');

    let query = supabase
      .from('schedule_backups')
      .select('id, date_key, save_type, version_number, created_at, updated_at, snapshot')
      .order('updated_at', { ascending: false });

    if (dateKey) {
      query = query.eq('date_key', dateKey);
    }

    const { data, error } = await query;

    if (error) throw error;

    const backups: BackupListItem[] = (data || []).map(row => {
      const snapshot = row.snapshot as AppState;

      // Count jobs (assigned + unassigned)
      let jobCount = snapshot?.unassignedJobs?.length || 0;
      if (snapshot?.reps) {
        for (const rep of snapshot.reps) {
          if (rep.schedule) {
            for (const slot of rep.schedule) {
              jobCount += slot.jobs?.length || 0;
            }
          }
        }
      }

      return {
        id: row.id,
        dateKey: row.date_key,
        saveType: row.save_type as SaveType,
        versionNumber: row.version_number,
        createdAt: row.updated_at || row.created_at, // Use updated_at for auto-saves
        jobCount,
        repCount: snapshot?.reps?.length || 0,
      };
    });

    console.log('[BackupService] Found', backups.length, 'backups');
    return { success: true, backups };
  } catch (error) {
    console.error('[BackupService] Error fetching backup list:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Load a specific backup by ID.
 */
export async function loadBackup(
  backupId: string
): Promise<{ success: boolean; data?: BackupSnapshot; error?: string }> {
  try {
    console.log('[BackupService] Loading backup:', backupId);

    const { data, error } = await supabase
      .from('schedule_backups')
      .select('*')
      .eq('id', backupId)
      .single();

    if (error) throw error;

    console.log('[BackupService] Backup loaded:', data.date_key, data.save_type, 'v' + data.version_number);

    return {
      success: true,
      data: {
        version: {
          id: data.id,
          dateKey: data.date_key,
          saveType: data.save_type as SaveType,
          versionNumber: data.version_number,
          createdAt: data.created_at,
          updatedAt: data.updated_at,
        },
        data: data.snapshot as AppState,
      },
    };
  } catch (error) {
    console.error('[BackupService] Error loading backup:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Get the most recent backup (either manual or auto) for a given date.
 */
export async function getMostRecentBackup(
  dateKey: string
): Promise<{ success: boolean; backup?: BackupListItem; error?: string }> {
  try {
    const { data, error } = await supabase
      .from('schedule_backups')
      .select('id, date_key, save_type, version_number, created_at, updated_at')
      .eq('date_key', dateKey)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return { success: true, backup: undefined };
    }

    return {
      success: true,
      backup: {
        id: data.id,
        dateKey: data.date_key,
        saveType: data.save_type as SaveType,
        versionNumber: data.version_number,
        createdAt: data.updated_at || data.created_at,
      },
    };
  } catch (error) {
    console.error('[BackupService] Error getting most recent backup:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Load the most recent backup for a specific date (full data, not just metadata).
 * This is used when navigating to a new day to check if Supabase has data for it.
 */
export async function loadBackupForDate(
  dateKey: string
): Promise<{ success: boolean; data?: BackupSnapshot; error?: string }> {
  try {
    console.log('[BackupService] Loading backup for date:', dateKey);

    // Get the most recent backup for this date (prefer auto-save)
    const { data, error } = await supabase
      .from('schedule_backups')
      .select('*')
      .eq('date_key', dateKey)
      .order('save_type', { ascending: true }) // 'auto' comes before 'manual' alphabetically
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      console.log('[BackupService] No backup found for date:', dateKey);
      return { success: false, error: 'No backup found' };
    }

    console.log('[BackupService] Found backup for', dateKey, ':', data.save_type, 'v' + data.version_number);

    return {
      success: true,
      data: {
        version: {
          id: data.id,
          dateKey: data.date_key,
          saveType: data.save_type as SaveType,
          versionNumber: data.version_number,
          createdAt: data.created_at,
          updatedAt: data.updated_at,
        },
        data: data.snapshot as AppState,
      },
    };
  } catch (error) {
    console.error('[BackupService] Error loading backup for date:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Get all unique date keys that have backups.
 */
export async function getBackupDateKeys(): Promise<{ success: boolean; dateKeys?: string[]; error?: string }> {
  try {
    const { data, error } = await supabase
      .from('schedule_backups')
      .select('date_key')
      .order('date_key', { ascending: false });

    if (error) throw error;

    // Get unique date keys
    const dateKeys = [...new Set((data || []).map(row => row.date_key))];

    return { success: true, dateKeys };
  } catch (error) {
    console.error('[BackupService] Error getting backup date keys:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Delete all backups for a specific date (both manual and auto).
 */
export async function deleteBackupsForDate(
  dateKey: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase
      .from('schedule_backups')
      .delete()
      .eq('date_key', dateKey);

    if (error) throw error;

    console.log('[BackupService] Deleted all backups for:', dateKey);
    return { success: true };
  } catch (error) {
    console.error('[BackupService] Error deleting backups:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
