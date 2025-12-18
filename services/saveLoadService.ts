import { SAVE_LOAD_API_URL } from '../constants';
import { AppState } from '../types';

interface SaveStateResponse {
    success: boolean;
    dateKey: string;
    timestamp?: string;
    message?: string;
    error?: string;
}

interface LoadStateResponse {
    success: boolean;
    dateKey: string;
    data?: AppState; // The stored JSON data
    timestamp?: string;
    message?: string;
    error?: string;
}

interface PipelineLogEntry {
    step: string;
    success: boolean;
    rowCount: number;
    message: string;
}

interface PipelineSummary {
    importedRows: number;
    backupRows: number;
    mainRows: number;
    importCleared: boolean;
}

interface PipelineResponse {
    success: boolean;
    timestamp: string;
    message?: string;
    error?: string;
    summary?: PipelineSummary;
    log?: PipelineLogEntry[];
}

interface PipelineStatusResponse {
    success: boolean;
    timestamp: string;
    status?: {
        import: { exists: boolean; rowCount: number };
        main: { exists: boolean; rowCount: number };
        backup: { exists: boolean; rowCount: number };
        lastRun: {
            timestamp: string;
            success: boolean;
            message: string;
            details: string;
        } | null;
    };
    error?: string;
}

/**
 * Saves the application state for a specific date to the Google Sheet.
 */
export async function saveState(dateKey: string, data: any): Promise<SaveStateResponse> {
    try {
        const payload = {
            action: 'save',
            dateKey,
            data
        };

        const payloadString = JSON.stringify(payload);
        console.log(`[SaveState] Payload size: ${payloadString.length} chars`);
        if (payloadString.length > 50000000) console.warn('[SaveState] Payload is dangerously large!');

        const response = await fetch(SAVE_LOAD_API_URL, {
            method: 'POST',
            redirect: "follow",
            headers: {
                "Content-Type": "text/plain;charset=utf-8",
            },
            body: payloadString
        });

        if (!response.ok) {
            return { success: false, dateKey, error: `HTTP Error: ${response.status}` };
        }

        const result = await response.json();
        return result;

    } catch (error) {
        console.error("Error saving state:", error);
        return { success: false, dateKey, error: String(error) };
    }
}

/**
 * Loads the application state for a specific date from the Google Sheet.
 */
export async function loadState(dateKey: string): Promise<LoadStateResponse> {
    try {
        const payload = {
            action: 'load',
            dateKey
        };

        // Google Apps Script Web Apps often require POST for passing body data, 
        // even for 'read' actions if we designed the API that way (which we did).
        const response = await fetch(SAVE_LOAD_API_URL, {
            method: 'POST',
            redirect: "follow",
            headers: {
                "Content-Type": "text/plain;charset=utf-8",
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            return { success: false, dateKey, error: `HTTP Error: ${response.status}` };
        }

        const result = await response.json();
        return result;

    } catch (error) {
        console.error("Error loading state:", error);
        return { success: false, dateKey, error: String(error) };
    }
}

/**
 * Saves multiple states at once (bulk save).
 */
export async function saveAllStates(states: { dateKey: string, data: any }[]): Promise<any> {
    try {
        const payload = {
            action: 'saveAll',
            states
        };

        const response = await fetch(SAVE_LOAD_API_URL, {
            method: 'POST',
            redirect: "follow",
            headers: {
                "Content-Type": "text/plain;charset=utf-8",
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
        return await response.json();

    } catch (error) {
        console.error("Error saving all states:", error);
        throw error;
    }
}

// ============================================
// 3-Tab Pipeline Functions
// ============================================

/**
 * Imports data and runs the full 3-tab pipeline:
 * 1. Write data to Import tab
 * 2. Copy Main → Backup (rollback snapshot)
 * 3. Copy Import → Main
 * 4. Clear Import (leave headers) - ONLY after Main is successfully updated
 * 5. Log the operation with timestamp and row counts
 */
export async function importAndProcess(data: any[][]): Promise<PipelineResponse> {
    try {
        const payload = {
            action: 'importAndProcess',
            data
        };

        const payloadString = JSON.stringify(payload);
        console.log(`[ImportAndProcess] Payload size: ${payloadString.length} chars`);

        const response = await fetch(SAVE_LOAD_API_URL, {
            method: 'POST',
            redirect: "follow",
            headers: {
                "Content-Type": "text/plain;charset=utf-8",
            },
            body: payloadString
        });

        if (!response.ok) {
            return {
                success: false,
                timestamp: new Date().toISOString(),
                error: `HTTP Error: ${response.status}`
            };
        }

        const result = await response.json();

        // Log the pipeline result
        if (result.success) {
            console.log('[Pipeline] Completed successfully:', result.summary);
        } else {
            console.error('[Pipeline] Failed:', result.error);
            if (result.log) {
                console.log('[Pipeline] Log:', result.log);
            }
        }

        return result;

    } catch (error) {
        console.error("Error in importAndProcess:", error);
        return {
            success: false,
            timestamp: new Date().toISOString(),
            error: String(error)
        };
    }
}

/**
 * Runs the pipeline using existing Import tab contents (no new data).
 * Useful when data has already been placed in Import tab externally.
 */
export async function runPipeline(): Promise<PipelineResponse> {
    try {
        const payload = {
            action: 'runPipeline'
        };

        const response = await fetch(SAVE_LOAD_API_URL, {
            method: 'POST',
            redirect: "follow",
            headers: {
                "Content-Type": "text/plain;charset=utf-8",
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            return {
                success: false,
                timestamp: new Date().toISOString(),
                error: `HTTP Error: ${response.status}`
            };
        }

        const result = await response.json();

        if (result.success) {
            console.log('[RunPipeline] Completed successfully:', result.summary);
        } else {
            console.error('[RunPipeline] Failed:', result.error);
        }

        return result;

    } catch (error) {
        console.error("Error in runPipeline:", error);
        return {
            success: false,
            timestamp: new Date().toISOString(),
            error: String(error)
        };
    }
}

/**
 * Gets the current status of the pipeline tabs (row counts, last run info).
 */
export async function getPipelineStatus(): Promise<PipelineStatusResponse> {
    try {
        const response = await fetch(`${SAVE_LOAD_API_URL}?action=status`, {
            method: 'GET',
            redirect: "follow"
        });

        if (!response.ok) {
            return {
                success: false,
                timestamp: new Date().toISOString(),
                error: `HTTP Error: ${response.status}`
            };
        }

        return await response.json();

    } catch (error) {
        console.error("Error getting pipeline status:", error);
        return {
            success: false,
            timestamp: new Date().toISOString(),
            error: String(error)
        };
    }
}
