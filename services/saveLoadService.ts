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
