# Schedules sections: Retail / Commercial / Insurance

The Schedules column has a section toggle (remembered per browser as
`planner.boardKind`; the old `/insurance` link opens on Insurance). It scopes the
rep columns, the Jobs list, and the map to one section — the per-day state,
history, and cloud save stay shared.

| Section    | Reps (`region` from the sheet banner)          | Jobs                                  |
|------------|------------------------------------------------|---------------------------------------|
| Retail     | PHX / NORTH / SOUTH / unknown (+ Flex North/South) | sales appts without "commercial"  |
| Commercial | COMMERCIAL (London Smith, Irving Lopez)         | sales appts whose notes say "commercial" (same test as the auto-assign router) |
| Insurance  | D2D (Michael Hurff, Flex D2D)                   | adjuster meetings                     |

Auto Assign still works on the whole day's unassigned pool regardless of the
toggle (it routes commercial to London itself); the button is hidden on Insurance.

Adjuster meetings are worked by door knockers (Michael Hurff today), not by the
retail sales reps.

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
- `isBoardRep` / `isBoardJob` in `useAppLogic.ts` define the sections above;
  `allJobs`, `boardReps`, `filteredReps` and `JobsPanel` derive from them.
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
