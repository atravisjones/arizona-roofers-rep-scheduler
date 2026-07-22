
import { TimeSlot } from './types';

// Google Sheets API key removed from client — all reads now go through /api/sheets (Vercel function)
// which holds GOOGLE_SHEETS_API_KEY server-side. See api/sheets.js for the allowlisted proxy.

// Supabase Configuration (KPI database — shared with roofr-search, speed-to-lead)
export const SUPABASE_URL = "https://ucfqgkbkxbztxlyniuph.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVjZnFna2JreGJ6dHhseW5pdXBoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzNjI1ODQsImV4cCI6MjA4OTkzODU4NH0.iIRHU4pxcVSMiWAcjtMgUsAVfwRnl90zg4Zkg0Fe4a0";

// Google Sheets API connection details
export const SPREADSHEET_ID = "1cFFEZNl7wXt40riZHnuZxGc1Zfm5lTlOz0rDCWGZJ0g";
export const SHEET_TITLE_PREFIX = "SRA";
export const DATA_RANGE = 'A2:H'; // Section banners determine where active rep data starts and stops.
export const MAX_REP_ROW = 175; // Reps below this row in the sheet are excluded (inactive, etc.)

// Rep skillsets sheet details
export const SKILLS_SHEET_TITLE = 'Appointment Blocks';
export const SKILLS_DATA_RANGE = 'A19:N39'; // header-driven; includes cols past Zip Code (2 Story Ladder, Veteran, Stories, Spanish)

// Job ID / Roofr URL sheet details — reads from Apt Outcome Tracker (Master Sheet tab)
// Column B = Address, Column O = Job ID
export const ROOFR_JOBS_SPREADSHEET_ID = "1Bw1Tug38f_cEkAN6V4XzlDT_lJf7UDMAUK0NjoBEtK0";
export const ROOFR_JOBS_SHEET_TITLE = 'Master Sheet';
export const ROOFR_JOBS_DATA_RANGE = 'B2:O'; // Fetch columns B (address) through O (job ID)

// Apt Outcome Tracker - for closing rate rankings (30 days close rate)
export const APT_OUTCOME_SPREADSHEET_ID = "1TtweJEEhVEO_DAgmvTY7PcaPQdmbxlOtPfffKdiXBcw";
export const APT_OUTCOME_SHEET_TITLE = 'Appointment Summary';
export const APT_OUTCOME_DATA_RANGE = 'B68:N100'; // Row 68 has headers, B=Sales Rep, M=30 days Close rate %

// Company Team Roster - live department roster (Active Roster tab). The Today Board
// reads this so rep/CSR classification stays current without editing code.
// Row 7 = header; B=Department, C=Role/Title, D=Name. Lead Center dept = CSRs.
export const COMPANY_ROSTER_SPREADSHEET_ID = "1XFJHD0IVZ8sJrQ7H2CrqU26a6n-FulPM8ABKc1hrh9o";
export const COMPANY_ROSTER_SHEET_TITLE = 'Active Roster';
export const COMPANY_ROSTER_DATA_RANGE = 'B7:D200';

// If fetching data fails, use mock data to allow the app to run.
export const USE_MOCK_DATA_ON_FAILURE = true;

// 2026-07-14: appointment timeframes gained an hour (8-11 / 11-1 / 2-5 / 5-8).
export const TIME_SLOTS: TimeSlot[] = [
  { id: 'ts-1', label: '8am - 11am' },
  { id: 'ts-2', label: '11am - 1pm' },
  { id: 'ts-3', label: '2pm - 5pm' },
  { id: 'ts-4', label: '5pm - 8pm' },
];

// Display labels for UI
export const TIME_SLOT_DISPLAY_LABELS: Record<string, string> = {
  'ts-1': '8AM - 11AM',
  'ts-2': '11AM - 1PM',
  'ts-3': '2PM - 5PM',
  'ts-4': '5PM - 8PM',
};

export const ROOF_KEYWORDS: readonly ['Tile', 'Shingle', 'Flat', 'Metal'] = ['Tile', 'Shingle', 'Flat', 'Metal'];
export const TYPE_KEYWORDS: readonly ['Insurance', 'Commercial'] = ['Insurance', 'Commercial'];
export const ATTRIBUTE_KEYWORDS: readonly ['Spanish Speaker', 'Ladder Pull', '2 Story Ladder'] = ['Spanish Speaker', 'Ladder Pull', '2 Story Ladder'];

export const TAG_KEYWORDS: readonly string[] = [...ROOF_KEYWORDS, ...TYPE_KEYWORDS, ...ATTRIBUTE_KEYWORDS];

// Day View Constants
export const DAY_VIEW_CELL_HEIGHT = 40;  // pixels per 30-min slot
export const DAY_VIEW_START_HOUR = 6;    // 6am
export const DAY_VIEW_END_HOUR = 20;     // 8pm (exclusive, so last slot is 7:30pm)
export const DAY_VIEW_REP_COLUMN_WIDTH = 150;  // minimum width for rep columns

