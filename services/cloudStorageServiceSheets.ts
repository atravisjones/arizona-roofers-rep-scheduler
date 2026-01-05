import { AppState } from '../types';
import {
  saveDailySchedule,
  loadDailySchedule,
  saveAllDailySchedules,
  loadAllDailySchedules,
} from './supabaseService';

// ============================================================================
// Cloud Storage Service - Now powered by Supabase
// ============================================================================

interface SaveResponse {
  success: boolean;
  dateKey?: string;
  timestamp?: string;
  message?: string;
  error?: string;
  rowNumber?: number;
}

interface LoadResponse {
  success: boolean;
  dateKey?: string;
  data?: AppState;
  timestamp?: string;
  message?: string;
  error?: string;
}

interface SaveAllResponse {
  success: boolean;
  timestamp?: string;
  results?: Array<{
    dateKey: string;
    success: boolean;
    action?: string;
    error?: string;
    rowNumber?: number;
  }>;
  error?: string;
}

interface LoadAllResponse {
  success: boolean;
  results?: Array<{
    dateKey: string;
    success: boolean;
    data?: AppState;
    timestamp?: string;
    message?: string;
    error?: string;
  }>;
  error?: string;
}

// Keep these helper functions for compatibility
export function getRowForDateKey(dateKey: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const targetDate = new Date(dateKey + 'T00:00:00');
  targetDate.setHours(0, 0, 0, 0);

  const diffTime = targetDate.getTime() - today.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

  // Row calculation (kept for compatibility, not used by Supabase)
  const rowNumber = diffDays - (-1) + 1;
  if (rowNumber < 1 || rowNumber > 7) {
    return -1;
  }
  return rowNumber;
}

export function getDateKeyForRow(rowNumber: number): string {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const dayOffset = -1 + (rowNumber - 1);
  const targetDate = new Date(today);
  targetDate.setDate(targetDate.getDate() + dayOffset);
  return targetDate.toISOString().split('T')[0];
}

/**
 * Save a single day's state to Supabase
 */
export async function saveStateToCloud(dateKey: string, data: AppState): Promise<SaveResponse> {
  console.log('[CloudStorage] Saving to Supabase for date:', dateKey);

  const result = await saveDailySchedule(dateKey, data);

  if (result.success) {
    return {
      success: true,
      dateKey,
      timestamp: new Date().toISOString(),
      message: `Saved to Supabase successfully`,
    };
  } else {
    return {
      success: false,
      dateKey,
      error: result.error || 'Failed to save to Supabase',
    };
  }
}

/**
 * Load a single day's state from Supabase
 */
export async function loadStateFromCloud(dateKey: string): Promise<LoadResponse> {
  console.log('[CloudStorage] Loading from Supabase for date:', dateKey);

  const result = await loadDailySchedule(dateKey);

  if (result.success && result.data) {
    return {
      success: true,
      dateKey,
      data: result.data,
      timestamp: new Date().toISOString(),
    };
  } else {
    return {
      success: false,
      dateKey,
      message: result.message || result.error || `No data found for ${dateKey}`,
      data: result.data, // May contain default reps even on "failure"
    };
  }
}

/**
 * Save multiple days' states to Supabase
 */
export async function saveAllStatesToCloud(
  states: Array<{ dateKey: string; data: AppState }>
): Promise<SaveAllResponse> {
  console.log('[CloudStorage] Bulk saving', states.length, 'states to Supabase');

  const result = await saveAllDailySchedules(states);

  return {
    success: result.success,
    timestamp: new Date().toISOString(),
    results: result.results.map(r => ({
      dateKey: r.dateKey,
      success: r.success,
      action: r.success ? 'saved to Supabase' : undefined,
      error: r.error,
    })),
  };
}

/**
 * Load multiple days' states from Supabase
 */
export async function loadAllStatesFromCloud(dateKeys: string[]): Promise<LoadAllResponse> {
  console.log('[CloudStorage] Bulk loading', dateKeys.length, 'dates from Supabase');

  const result = await loadAllDailySchedules(dateKeys);

  return {
    success: result.success,
    results: result.results.map(r => ({
      dateKey: r.dateKey,
      success: r.success,
      data: r.data,
      timestamp: new Date().toISOString(),
      error: r.error,
    })),
  };
}
