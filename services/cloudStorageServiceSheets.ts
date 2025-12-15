import { AppState } from '../types';
import { GOOGLE_API_KEY, STORAGE_SPREADSHEET_ID, STORAGE_SHEET_NAME, SAVE_LOAD_API_URL } from '../constants';

// Apps Script Web App URL for the storage spreadsheet
const STORAGE_API_URL = SAVE_LOAD_API_URL;

// Rolling 7-day storage configuration
// Row 1 = yesterday (-1), Row 2 = today (0), Row 3 = tomorrow (+1), etc.
// This keeps the sheet lightweight with only 7 rows that get overwritten
const ROLLING_DAYS_CONFIG = {
  startOffset: -1,  // Row 1 starts at yesterday
  totalRows: 7,     // 7 days total: yesterday through 5 days from now
};

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

/**
 * Get today's date in YYYY-MM-DD format (local timezone)
 */
function getTodayDateKey(): string {
  const today = new Date();
  return today.toISOString().split('T')[0];
}

/**
 * Calculate the row number (1-indexed) for a given date key
 * Row 1 = yesterday, Row 2 = today, Row 3 = tomorrow, etc.
 * Returns -1 if the date is outside the rolling window
 */
export function getRowForDateKey(dateKey: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const targetDate = new Date(dateKey + 'T00:00:00');
  targetDate.setHours(0, 0, 0, 0);

  // Calculate day difference from today
  const diffTime = targetDate.getTime() - today.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

  // Convert to row number: offset of -1 (yesterday) = row 1
  const rowNumber = diffDays - ROLLING_DAYS_CONFIG.startOffset + 1;

  // Check if within valid range (1 to totalRows)
  if (rowNumber < 1 || rowNumber > ROLLING_DAYS_CONFIG.totalRows) {
    return -1; // Outside rolling window
  }

  return rowNumber;
}

/**
 * Get the date key for a given row number
 */
export function getDateKeyForRow(rowNumber: number): string {
  const today = new Date();
  today.setHours(12, 0, 0, 0); // Use noon to avoid DST issues

  // Row 1 = startOffset (-1 = yesterday), Row 2 = startOffset + 1 (0 = today), etc.
  const dayOffset = ROLLING_DAYS_CONFIG.startOffset + (rowNumber - 1);

  const targetDate = new Date(today);
  targetDate.setDate(targetDate.getDate() + dayOffset);

  return targetDate.toISOString().split('T')[0];
}

/**
 * Fetches all rows from the storage sheet (rows 1-7 for rolling window)
 */
async function fetchAllRows(): Promise<any[][]> {
  try {
    // Only fetch rows 1-7 (our rolling window)
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${STORAGE_SPREADSHEET_ID}/values/'${encodeURIComponent(STORAGE_SHEET_NAME)}'!A1:C${ROLLING_DAYS_CONFIG.totalRows}?key=${GOOGLE_API_KEY}`;
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
 * Find row index for a given date key (0-indexed for array access)
 * Uses the rolling window calculation based on today's date
 */
function findRowIndex(rows: any[][], dateKey: string): number {
  const rowNumber = getRowForDateKey(dateKey);
  if (rowNumber === -1) {
    return -1; // Date is outside rolling window
  }
  // Convert 1-indexed row number to 0-indexed array index
  return rowNumber - 1;
}

/**
 * Save a single day's state using Apps Script
 * Uses fixed row positions based on day offset from today
 */
export async function saveStateToCloud(dateKey: string, data: AppState): Promise<SaveResponse> {
  try {
    const rowNumber = getRowForDateKey(dateKey);

    if (rowNumber === -1) {
      console.warn('[CloudStorage] Date outside rolling window:', dateKey);
      return {
        success: false,
        dateKey,
        error: `Date ${dateKey} is outside the rolling 7-day window (yesterday through 5 days from now)`
      };
    }

    console.log('[CloudStorage] Saving to:', STORAGE_API_URL);
    console.log('[CloudStorage] Date:', dateKey, '-> Row:', rowNumber);

    const response = await fetch(STORAGE_API_URL, {
      method: 'POST',
      mode: 'no-cors', // Try no-cors mode to bypass CORS
      headers: {
        'Content-Type': 'text/plain', // Use text/plain to avoid preflight
      },
      body: JSON.stringify({
        action: 'saveToRow',
        dateKey,
        rowNumber,
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
        rowNumber,
        timestamp: new Date().toISOString(),
        message: `Saved to row ${rowNumber} (no-cors mode)`
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
 * Uses fixed row positions based on day offset from today
 */
export async function loadStateFromCloud(dateKey: string): Promise<LoadResponse> {
  try {
    const rowNumber = getRowForDateKey(dateKey);

    if (rowNumber === -1) {
      return {
        success: false,
        dateKey,
        message: `Date ${dateKey} is outside the rolling 7-day window`
      };
    }

    const rows = await fetchAllRows();
    const rowIndex = rowNumber - 1; // Convert to 0-indexed

    // Check if row exists
    if (rowIndex >= rows.length || !rows[rowIndex]) {
      return {
        success: false,
        dateKey,
        message: `No data found for ${dateKey} (row ${rowNumber})`
      };
    }

    const row = rows[rowIndex];

    // Verify the date in the row matches what we expect (or accept empty/mismatched for overwrite)
    const storedDateKey = row[0];
    const jsonString = row[1];
    const timestamp = row[2];

    // If no JSON data in this row
    if (!jsonString) {
      return {
        success: false,
        dateKey,
        message: `No data stored in row ${rowNumber} for ${dateKey}`
      };
    }

    // If the stored date doesn't match (old data from previous day cycle), just log it
    // The data is still valid for the date it was saved for, but we report as "no data" for the requested date
    // This allows the UI to proceed without erroring, and the next save will overwrite with correct date
    if (storedDateKey && storedDateKey !== dateKey) {
      console.log(`[CloudStorage] Row ${rowNumber} has data for ${storedDateKey}, but we requested ${dateKey} - treating as no data for this date`);
      return {
        success: false,
        dateKey,
        message: `No current data for ${dateKey} (row contains old data from ${storedDateKey})`
      };
    }

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
 * Uses fixed row positions based on day offset from today
 */
export async function saveAllStatesToCloud(states: Array<{ dateKey: string; data: AppState }>): Promise<SaveAllResponse> {
  try {
    // Add row numbers to each state and filter out dates outside the rolling window
    const statesWithRows = states.map(s => {
      const rowNumber = getRowForDateKey(s.dateKey);
      return {
        ...s,
        rowNumber
      };
    });

    const validStates = statesWithRows.filter(s => s.rowNumber !== -1);
    const invalidStates = statesWithRows.filter(s => s.rowNumber === -1);

    if (invalidStates.length > 0) {
      console.warn('[CloudStorage] Skipping dates outside rolling window:', invalidStates.map(s => s.dateKey));
    }

    if (validStates.length === 0) {
      return {
        success: false,
        error: 'No dates within the rolling 7-day window to save'
      };
    }

    console.log('[CloudStorage] Bulk saving', validStates.length, 'states to:', STORAGE_API_URL);
    console.log('[CloudStorage] Row mappings:', validStates.map(s => `${s.dateKey} -> Row ${s.rowNumber}`));

    const response = await fetch(STORAGE_API_URL, {
      method: 'POST',
      mode: 'no-cors', // Try no-cors mode to bypass CORS
      headers: {
        'Content-Type': 'text/plain', // Use text/plain to avoid preflight
      },
      body: JSON.stringify({
        action: 'saveAllToRows',
        states: validStates
      })
    });

    console.log('[CloudStorage] Response type:', response.type);

    // In no-cors mode, we can't read the response
    if (response.type === 'opaque') {
      console.log('[CloudStorage] Bulk request sent (opaque response - assumed success)');
      const results = [
        ...validStates.map(s => ({
          dateKey: s.dateKey,
          success: true,
          action: `saved to row ${s.rowNumber} (no-cors)`,
          rowNumber: s.rowNumber
        })),
        ...invalidStates.map(s => ({
          dateKey: s.dateKey,
          success: false,
          error: 'Date outside rolling window'
        }))
      ];
      return {
        success: true,
        timestamp: new Date().toISOString(),
        results
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
