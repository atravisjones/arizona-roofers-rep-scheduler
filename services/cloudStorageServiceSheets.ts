import { AppState } from '../types';
import { GOOGLE_API_KEY, STORAGE_SPREADSHEET_ID, STORAGE_SHEET_NAME, SAVE_LOAD_API_URL } from '../constants';

// Apps Script Web App URL for the storage spreadsheet
const STORAGE_API_URL = SAVE_LOAD_API_URL;

interface SaveResponse {
  success: boolean;
  dateKey?: string;
  timestamp?: string;
  message?: string;
  error?: string;
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

/**
 * Fetches all rows from the storage sheet
 */
async function fetchAllRows(): Promise<any[][]> {
  try {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${STORAGE_SPREADSHEET_ID}/values/'${encodeURIComponent(STORAGE_SHEET_NAME)}'!A:C?key=${GOOGLE_API_KEY}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data.values || [];
  } catch (error) {
    console.error('Error fetching rows:', error);
    return [];
  }
}

/**
 * Find row index for a given date key
 */
function findRowIndex(rows: any[][], dateKey: string): number {
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] === dateKey) {
      return i;
    }
  }
  return -1;
}

/**
 * Save a single day's state using Apps Script
 */
export async function saveStateToCloud(dateKey: string, data: AppState): Promise<SaveResponse> {
  try {
    console.log('[CloudStorage] Saving to:', STORAGE_API_URL);
    console.log('[CloudStorage] Date:', dateKey);

    const response = await fetch(STORAGE_API_URL, {
      method: 'POST',
      mode: 'no-cors', // Try no-cors mode to bypass CORS
      headers: {
        'Content-Type': 'text/plain', // Use text/plain to avoid preflight
      },
      body: JSON.stringify({
        action: 'save',
        dateKey,
        data
      })
    });

    console.log('[CloudStorage] Response status:', response.status);
    console.log('[CloudStorage] Response type:', response.type);

    // In no-cors mode, we can't read the response
    // Assume success if no error was thrown
    if (response.type === 'opaque') {
      console.log('[CloudStorage] Request sent (opaque response - assumed success)');
      return {
        success: true,
        dateKey,
        timestamp: new Date().toISOString(),
        message: 'Saved (no-cors mode)'
      };
    }

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    console.log('[CloudStorage] Save result:', result);
    return result;
  } catch (error) {
    console.error('[CloudStorage] Error saving to cloud:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Load a single day's state from Google Sheets
 */
export async function loadStateFromCloud(dateKey: string): Promise<LoadResponse> {
  try {
    const rows = await fetchAllRows();
    const rowIndex = findRowIndex(rows, dateKey);

    if (rowIndex === -1) {
      return {
        success: false,
        dateKey,
        message: 'No data found for this date'
      };
    }

    const row = rows[rowIndex];
    const jsonString = row[1];
    const timestamp = row[2];

    try {
      const data = JSON.parse(jsonString);
      return {
        success: true,
        dateKey,
        data,
        timestamp
      };
    } catch (error) {
      return {
        success: false,
        dateKey,
        error: 'Failed to parse stored JSON'
      };
    }
  } catch (error) {
    console.error('Error loading from cloud:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Save multiple days' states using Apps Script
 */
export async function saveAllStatesToCloud(states: Array<{ dateKey: string; data: AppState }>): Promise<SaveAllResponse> {
  try {
    console.log('[CloudStorage] Bulk saving', states.length, 'states to:', STORAGE_API_URL);

    const response = await fetch(STORAGE_API_URL, {
      method: 'POST',
      mode: 'no-cors', // Try no-cors mode to bypass CORS
      headers: {
        'Content-Type': 'text/plain', // Use text/plain to avoid preflight
      },
      body: JSON.stringify({
        action: 'saveAll',
        states
      })
    });

    console.log('[CloudStorage] Response type:', response.type);

    // In no-cors mode, we can't read the response
    if (response.type === 'opaque') {
      console.log('[CloudStorage] Bulk request sent (opaque response - assumed success)');
      return {
        success: true,
        timestamp: new Date().toISOString(),
        results: states.map(s => ({
          dateKey: s.dateKey,
          success: true,
          action: 'saved (no-cors)'
        }))
      };
    }

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    console.log('[CloudStorage] Bulk save result:', result);
    return result;
  } catch (error) {
    console.error('[CloudStorage] Error saving all to cloud:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Load multiple days' states from Google Sheets (bulk load)
 */
export async function loadAllStatesFromCloud(dateKeys: string[]): Promise<LoadAllResponse> {
  try {
    const results: Array<{
      dateKey: string;
      success: boolean;
      data?: AppState;
      timestamp?: string;
      message?: string;
      error?: string;
    }> = [];

    for (const dateKey of dateKeys) {
      const result = await loadStateFromCloud(dateKey);
      results.push({
        dateKey,
        success: result.success,
        data: result.data,
        timestamp: result.timestamp,
        message: result.message,
        error: result.error
      });
    }

    return {
      success: true,
      results
    };
  } catch (error) {
    console.error('Error loading all from cloud:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}
