
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

// ---------------------------------------------------------------------------
// Travel rotation — fair turns to the Limited corridor, Tucson and up north
// ---------------------------------------------------------------------------

// Named service areas published by the boundary editor
// (speed-to-leads.vercel.app/service-area.html -> GET /api/service-area).
// Every queue classifies a job by asking that API which area owns its
// coordinates, so the shapes live in exactly one place. Rename an area there,
// change it here.
export const SERVICE_AREA_API = "https://speed-to-leads.vercel.app/api/service-area";
export const ROTATION_AREA_NAMES = { limited: "Limited", tucson: "South", north: "North" } as const;

// How far back a "last went" date is looked for. A rep with nothing in the
// window reads as "never" and sorts to the front of the queue.
//
// 360 days, not 180: an up-north or Tucson run is rare enough that half a year
// of history left most reps tied on "never", which is no order at all.
export const ROTATION_WINDOW_DAYS = 360;

// Availability-sheet rows that are not people. "Flex North" is a coverage
// placeholder, so it can never take a turn — it is dropped from the queues
// outright rather than listed under "Not in rotation", where it would read as a
// real rep who had been held out. Keyed by normalizeName().
export const ROTATION_NON_REP_ROWS = new Set<string>([
  "flexnorth",   // "Flex North" — a slot on the sheet, not a rep
]);

// Auto-assign nudge, applied AFTER the weighted average like the specialist
// bonus — adding a ScoringWeights key would change totalWeight and silently
// rescale every existing factor. Kept under the timeframe weight so a
// customer-requested window still wins.
export const ROTATION_MAX_BONUS = 10;

// Roofr numeric user id -> rep name, for reading who actually ran a past
// appointment. calendar_events.attendees holds these ids; jobs.job_owner is NOT
// a substitute (on a future appointment it is still the booking CSR).
//
// SECOND COPY LIVES IN api/roofr-appointments.py (REP_BY_USER_ID) — update both
// together. Each api/*.py file is its own Vercel bundle and none of them import
// a sibling module, so sharing one file is a deploy risk for 25 lines.
//
// An unmapped id is not an error you will see: that rep's trips quietly file
// under whoever owns the job, so they read as "never went" and sit at the top of
// the queue forever. Resolve new ids with the mode() query in roofr-appointments.py
// and confirm against the attendee email before adding.
//
// Deliberately absent: 372086 (Brenda Ochoa, office), 565310 / 494624
// (ride-along/shadow attendees — they would credit a turn to every rep they join).
// Ids that are correctly absent from the map above. Kept explicit so the
// rotation page's "unmapped" warning stays a real signal instead of always
// listing the same known non-reps.
export const ROOFR_NON_REP_USER_IDS = new Set<string>([
  "372086",   // Brenda Ochoa - office/insurance
  "565310",   // Hadley Duffy - ride-along, pairs with nearly every rep
  "494624",   // shadow attendee
  // Very high volume (80+ events, every region) but never the sole rep on his
  // own job — always alongside a mapped rep. Attends KPI, hiring, adjuster and
  // pre-build meetings: an ops function, not a fielded rep. The two jobs owned
  // by "Marcus Ruppel" (Production) that have a calendar event both carry this
  // id as sole attendee, so probably him. Non-rep either way.
  "562516",   // likely Marcus Ruppel - Production/ops
]);

export const ROOFR_USER_ID_TO_REP: Record<string, string> = {
  "355304": "Ashkan Etemadi",
  "352704": "Bradley Crohurst",
  "400700": "Brandon Cook",
  // Confirmed 2026-09-01: sole attendee on job 11005176 (Tucson), whose
  // job_owner reads "Carson Anderson"; teams roster has him Active, D2D Sales.
  "536907": "Carson Anderson",
  "416699": "Chandler Duffy",
  "568255": "Chris Diamond",
  "356679": "Christian Noren",
  "568245": "Claude Springer",
  "354859": "Cole Ludewig",
  "500123": "Connor Hamby",
  "568859": "Hunter Fairfield",
  "596692": "Irving Lopez",
  "497732": "James Chernek",
  "441144": "Jonathan Marino",
  // Archived reps, kept mapped on purpose: the 360-day window still contains
  // their trips, and an unmapped id would put them back in the warning banner
  // forever. They never appear in a queue — the queues are built from the
  // availability sheet, which no longer lists them.
  "455485": "Joseph Simms",   // Archived - Retail Sales, South book, thru 2026-04-25
  "450737": "William Yost",   // Archived - Retail Sales, thru 2026-01-05
  "522189": "Josh Jewett",
  "355180": "Justin Parker",
  "512700": "KORY DUMONE",
  "373987": "London smith",
  "352971": "Nick Williams",
  "407608": "Oliver Johnson",
  "472015": "Orlando Chavarria",
  "594358": "Preston Burt",
  "355065": "Richard Hadsall",
  "592399": "Ryan Tempel",
  "525242": "Stephen Chaidez",
  "482761": "Tanner Broadbent",
  "594355": "Troy Emerson",
  "451106": "William Ludewig",
};
