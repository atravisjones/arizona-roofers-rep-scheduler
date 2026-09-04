# Insurance board (`/insurance`)

Adjuster meetings are worked by door knockers (Michael Hurff today), not by the
retail sales reps. The Insurance tab is the Planner with a different rep set and
a different job set; it shares the per-day state, history, and cloud save.

## Data flow
- `api/roofr-appointments.py` returns EVERY `Adjuster meeting` calendar event for
  the day. Attendee Roofr user ids are resolved only against
  `DOOR_KNOCKER_BY_USER_ID` (never sales reps, never the job owner). A matched
  meeting is one row per door knocker with `pinned: true`; an unmatched meeting
  is a single row with blank attendees and `pinned: false`.
- `services/googleSheetsService.ts` maps the sheet banners `Insurance`,
  `Door To Door`, or `D2D` to `region: 'D2D'`. Reps under them are door knockers.
- `context/useAppLogic.ts` `loadSheetForDate`: adjuster rows match D2D reps only
  (full name / first name / canonical name); sales rows never match D2D reps.
  A matched adjuster meeting is pinned to that door knocker's slot; an unmatched
  one goes to Unassigned with `pinnedKind: 'adjuster'`, `isPinned: false`.
  A manual placement on a door knocker survives a reload.

## Board rules
- `filteredReps`: Insurance shows only D2D reps; Planner hides them.
- `JobsPanel`: Insurance lists only adjuster jobs; Planner hides them.
- `handleJobDrop`: adjuster jobs drop only on D2D reps (or back to Unassigned);
  nothing else drops on a D2D rep. Roofr-pinned adjuster meetings stay locked.
- Auto Assign: D2D reps are never candidates (`isJobValidForRepRegion`), adjuster
  jobs are never routed. The Auto Assign button is hidden on Insurance.
- Today Board (live): adjuster rows are hidden; Tentative still shows whatever
  was planned on a door knocker.

## Adding a door knocker
1. Add their rows under the `Insurance` / `Door To Door` banner on the SRA sheet
   (and to Supabase `rep_profiles` section `D2D` so generated tabs carry them).
2. Add their Roofr user id to `DOOR_KNOCKER_BY_USER_ID` so tagged meetings
   auto-pin. Without it they still get a column and can take meetings by drag.
