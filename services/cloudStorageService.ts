import { AppState } from '../types';
import { SAVE_LOAD_API_URL } from '../constants';

const CLOUD_API_URL = SAVE_LOAD_API_URL;

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
 * Save a single day's state to cloud storage
 */
export async function saveStateToCloud(dateKey: string, data: AppState): Promise<SaveResponse> {
  try {
    const response = await fetch(CLOUD_API_URL, {
      method: 'POST',
      mode: 'cors',
      headers: {
        'Content-Type': 'text/plain',
      },
      body: JSON.stringify({
        action: 'save',
        dateKey,
        data
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error saving to cloud:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Load a single day's state from cloud storage
 */
export async function loadStateFromCloud(dateKey: string): Promise<LoadResponse> {
  try {
    const response = await fetch(CLOUD_API_URL, {
      method: 'POST',
      mode: 'cors',
      headers: {
        'Content-Type': 'text/plain',
      },
      body: JSON.stringify({
        action: 'load',
        dateKey
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error loading from cloud:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Save multiple days' states to cloud storage (bulk save)
 */
export async function saveAllStatesToCloud(states: Array<{ dateKey: string; data: AppState }>): Promise<SaveAllResponse> {
  try {
    const response = await fetch(CLOUD_API_URL, {
      method: 'POST',
      mode: 'cors',
      headers: {
        'Content-Type': 'text/plain',
      },
      body: JSON.stringify({
        action: 'saveAll',
        states
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error saving all to cloud:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Load multiple days' states from cloud storage (bulk load)
 */
export async function loadAllStatesFromCloud(dateKeys: string[]): Promise<LoadAllResponse> {
  try {
    const response = await fetch(CLOUD_API_URL, {
      method: 'POST',
      mode: 'cors',
      headers: {
        'Content-Type': 'text/plain',
      },
      body: JSON.stringify({
        action: 'loadAll',
        dateKeys
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error loading all from cloud:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}
