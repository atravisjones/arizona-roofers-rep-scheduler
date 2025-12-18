
import { TimeSlot } from './types';

// WARNING: Storing API keys in client-side code is insecure.
// This is for demonstration purposes only. The API key is used for Google Maps and Google Sheets.
export const GOOGLE_API_KEY = "AIzaSyAUU9vrRIAepLUJedcIrmmfJDyVKjGhINI";

// Save/Load API - Web App URL (Version 3 - 3-Tab Pipeline)
// Deployed: Dec 17, 2025 - Import → Main → Backup pipeline
export const SAVE_LOAD_API_URL = "https://script.google.com/a/macros/arizonaroofers.com/s/AKfycby-nAl9EFU5ktX0FIafzMCtxARgS6Xv0XaHIysirFpJOPcPYzXaItxqEKn4yawnzbSoQw/exec";

// Google Sheets API connection details
export const SPREADSHEET_ID = "1cFFEZNl7wXt40riZHnuZxGc1Zfm5lTlOz0rDCWGZJ0g";
export const SHEET_TITLE_PREFIX = "SRA";
export const DATA_RANGE = 'A2:H175'; // Fetch data starting from row 2, stop at row 175 to exclude inactive reps below
export const MAX_REP_ROW = 175; // Reps below this row in the sheet are excluded (inactive, etc.)

// Cloud Storage spreadsheet (for saving/loading app state)
export const STORAGE_SPREADSHEET_ID = "1Jn_7K25iMJ35h0FGtWaz4FS4u2bfiKzJQmFEPyA3hdk";
export const STORAGE_SHEET_NAME = "Sheet1";

// Rep skillsets sheet details
export const SKILLS_SHEET_TITLE = 'Appointment Blocks';
export const SKILLS_DATA_RANGE = 'A19:H52';
export const SALES_ORDER_DATA_RANGE = 'A43:G85'; // Fetching header row + all month columns (Oct-Mar)

// Job ID / Roofr URL sheet details
export const ROOFR_JOBS_SPREADSHEET_ID = "1KadSyM67SOB6agq2YDHkZLYMXnn81Fna5jTWDBQQuog";
export const ROOFR_JOBS_SHEET_TITLE = 'Main';
export const ROOFR_JOBS_DATA_RANGE = 'A2:B'; // Fetch all rows in columns A and B

// If fetching data fails, use mock data to allow the app to run.
export const USE_MOCK_DATA_ON_FAILURE = true;

export const TIME_SLOTS: TimeSlot[] = [
  { id: 'ts-1', label: '7:30am - 10am' },
  { id: 'ts-2', label: '10am - 1pm' },
  { id: 'ts-3', label: '1pm - 4pm' },
  { id: 'ts-4', label: '4pm - 7pm' },
];

// Display labels for UI (shorter time ranges)
export const TIME_SLOT_DISPLAY_LABELS: Record<string, string> = {
  'ts-1': '7:30AM - 9AM',
  'ts-2': '10AM - 12PM',
  'ts-3': '1PM - 3PM',
  'ts-4': '4PM - 6PM',
};

export const ROOF_KEYWORDS: readonly ['Tile', 'Shingle', 'Flat', 'Metal'] = ['Tile', 'Shingle', 'Flat', 'Metal'];
export const TYPE_KEYWORDS: readonly ['Insurance', 'Commercial'] = ['Insurance', 'Commercial'];

export const TAG_KEYWORDS: readonly string[] = [...ROOF_KEYWORDS, ...TYPE_KEYWORDS];