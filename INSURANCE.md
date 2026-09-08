# Schedules sections: Retail / Commercial / Insurance

The Schedules column has a section toggle. Each section has its own URL
(`/retail`, `/commercial`, `/insurance`; `/` opens the last-used one, remembered
per browser as `planner.boardKind`). It scopes the
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

## Insurance check pickups (added 2026-09-08)

Goal: when Michael (or any door knocker) drives to adjuster meetings, grab the insurance
checks homeowners are holding on the way there or back.

- **Source:** `api/insurance-checks.js` — every non-deleted job whose `stage` is
  `INS: Collect ACV` (same query as the production map's Insurance tab). Returns
  coords, value, phone, owner/assignee, `daysInStage` (latest Collect ACV entry in
  `stage_timeline`, else job age), `isD2D` (lead_source contains "door"). Edge-cached 5 min.
  Jobs without stored coords are geocoded client-side (`fillMissingCoords`).
- **Map overlay** (`LeafletMap` props `checks/showChecks/checkRadiusMiles/pickupIds/onTogglePickup`):
  `$` pins, green = retail/insurance lead, purple = D2D. Only rendered on the Insurance section.
  With a rep route drawn, pins within the radius glow and the rest dim. Popup: tel:, Open in
  Roofr, Add/Remove from route.
- **Route panel** (`RoutePanel.tsx`): `Checks` toggle (default on for Insurance), radius 2/5/10 mi,
  "Checks near route" list sorted by straight-line miles off the OSRM geometry
  (`milesOffRoute`). `Add` folds the check into the rep's stops via greedy cheapest insertion
  and re-asks OSRM (`buildRouteWithPickups`); the footer shows the with-pickups distance/time
  delta. Pickups are panel-local state and reset whenever the route changes — nothing is
  written to Roofr or the schedule.
- Gotcha: `routeInfo.coordinates` holds EVERY marker on the map (context jobs included) and
  is index-aligned with `mappableJobs`; the rep's real stops are the entries whose
  `assignedRepName` matches the route's rep. Re-routing off the full list sends you to Tucson.

### Share day (phone page for the rep) — 2026-09-08

`public/m/index.html` is a static, no-login page (served before the SPA rewrite). The
"Share day" button in the checks card builds `/m/?rep=<name>&date=YYYY-MM-DD&s=<base64url JSON>`
where `s` = the rep's stops `[{n,a,t,la,lo}]` (name, address, time label, coords) taken from the
drawn route. The stops travel in the link on purpose: `daily_schedules` is empty in Supabase
(planner day state never lands there), so a server lookup would miss manual placements. The page
fetches `/api/insurance-checks`, ranks checks by miles from the nearest stop (2/5/10/All), and
gives every stop and check a Google Maps Navigate link (`maps/dir/?api=1&destination=`), checks a
`tel:` Call and Roofr link, plus a whole-route link with `waypoints=`. The link is a snapshot —
re-share after moving appointments. Nothing on the page writes anywhere.
