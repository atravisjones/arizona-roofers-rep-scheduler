import { supabase } from './supabaseClient';
import { AppState } from '../types';
import { RealtimeChannel } from '@supabase/supabase-js';

// ============================================================================
// Real-time Subscription Service for Schedule Backups
// ============================================================================

type BackupUpdateCallback = (dateKey: string, data: AppState) => void;
type ConnectionStatusCallback = (status: 'connected' | 'disconnected' | 'error') => void;

let channel: RealtimeChannel | null = null;
let onBackupUpdate: BackupUpdateCallback | null = null;
let onConnectionStatus: ConnectionStatusCallback | null = null;

/**
 * Subscribe to real-time updates for schedule_backups table.
 * This enables the Scheduler App to receive updates when the Routing API syncs new jobs.
 */
export function subscribeToBackupUpdates(
  callbacks: {
    onUpdate: BackupUpdateCallback;
    onStatus?: ConnectionStatusCallback;
  }
): void {
  // Store callbacks
  onBackupUpdate = callbacks.onUpdate;
  onConnectionStatus = callbacks.onStatus || null;

  // Unsubscribe from any existing channel
  if (channel) {
    console.log('[RealtimeService] Cleaning up existing subscription...');
    channel.unsubscribe();
    channel = null;
  }

  console.log('[RealtimeService] Setting up real-time subscription for schedule_backups...');

  // Create a new channel for schedule_backups changes
  channel = supabase
    .channel('schedule_backups_changes')
    .on(
      'postgres_changes',
      {
        event: '*', // Listen to all events (INSERT, UPDATE, DELETE)
        schema: 'public',
        table: 'schedule_backups',
      },
      (payload) => {
        console.log('[RealtimeService] Received update:', payload.eventType, payload.new);

        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          const record = payload.new as {
            date_key: string;
            save_type: string;
            snapshot: AppState;
          };

          if (record.date_key && record.snapshot && onBackupUpdate) {
            console.log(`[RealtimeService] Notifying of backup update for ${record.date_key}`);
            onBackupUpdate(record.date_key, record.snapshot);
          }
        }
      }
    )
    .subscribe((status) => {
      console.log('[RealtimeService] Subscription status:', status);

      if (onConnectionStatus) {
        if (status === 'SUBSCRIBED') {
          onConnectionStatus('connected');
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          onConnectionStatus('disconnected');
        } else if (status === 'TIMED_OUT') {
          onConnectionStatus('error');
        }
      }
    });
}

/**
 * Subscribe to updates for a specific date's backups.
 * More efficient than listening to all backups if only interested in current day.
 */
export function subscribeToDateBackup(
  dateKey: string,
  callbacks: {
    onUpdate: (data: AppState) => void;
    onStatus?: ConnectionStatusCallback;
  }
): void {
  // Unsubscribe from any existing channel
  if (channel) {
    console.log('[RealtimeService] Cleaning up existing subscription...');
    channel.unsubscribe();
    channel = null;
  }

  console.log(`[RealtimeService] Setting up real-time subscription for ${dateKey}...`);

  channel = supabase
    .channel(`backup_${dateKey}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'schedule_backups',
        filter: `date_key=eq.${dateKey}`,
      },
      (payload) => {
        console.log('[RealtimeService] Received update for', dateKey, ':', payload.eventType);

        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          const record = payload.new as { snapshot: AppState };
          if (record.snapshot) {
            callbacks.onUpdate(record.snapshot);
          }
        }
      }
    )
    .subscribe((status) => {
      console.log(`[RealtimeService] Subscription status for ${dateKey}:`, status);

      if (callbacks.onStatus) {
        if (status === 'SUBSCRIBED') {
          callbacks.onStatus('connected');
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          callbacks.onStatus('disconnected');
        } else if (status === 'TIMED_OUT') {
          callbacks.onStatus('error');
        }
      }
    });
}

/**
 * Unsubscribe from all real-time updates.
 */
export function unsubscribeFromBackupUpdates(): void {
  if (channel) {
    console.log('[RealtimeService] Unsubscribing from real-time updates...');
    channel.unsubscribe();
    channel = null;
    onBackupUpdate = null;
    onConnectionStatus = null;
  }
}

/**
 * Check if real-time subscription is active.
 */
export function isSubscribed(): boolean {
  return channel !== null;
}
