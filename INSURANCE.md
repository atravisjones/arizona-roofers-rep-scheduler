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

Phone page updates (2026-09-08, later): the route starts from the phone's location (Google
Maps link omits `origin`; page asks for geolocation), the drive line is a real OSRM road
route (me → [checks before] → appointments → [checks after]) and checks are ranked by
straight-line miles to that road geometry; the bar shows road miles/minutes. Per-check
"+ Before appts / + After appts" fold a check into the route (localStorage per rep+day).
Call row = tel: dialer, Copy #, and a CTM desk link filtered to the number (CTM has no
app URL scheme). Map is sticky under the header with a Hide/Show toggle.

### Check outcomes (2026-09-08)

Each check on the phone page has Pickup confirmed / Declined / No answer. Outcomes go to KPI
Supabase table `insurance_check_outcomes` (job_id, rep, date_key, outcome; service-role RLS only)
through `api/check-outcomes.js` (GET `?days=N` newest-first, POST `{jobId, rep, date, outcome}`;
`outcome: null` deletes that rep+job+day). Latest row per job+date wins. Declined / No answer sink
to the bottom greyed out for that day, hide the Before/After buttons and drop any route pick;
Confirmed stays active in green. Tap the same button again to undo. Other days show as a
"History: 9/3 Declined · …" line (last 5, other reps' names in parentheses). The page reads 60 days.

Phone page v3 (2026-09-08, late): card tap = highlight only (no zoom). Buttons per check are
Call (tel:, the phone decides which app answers it), Navigate, Roofr (Roofr blue #2C9BD6).
Dispositions appear only after Call is tapped (localStorage `m-called:<rep>:<date>`):
+ Before appts / + Between appts / + After appts (any of these = outcome `confirmed` + route
pick; Between slots into the cheapest gap between appointments) and Declined / No answer.
The Drive button is `https://www.google.com/maps/dir//stop1/stop2/...` so Google fills the
origin with "Your location". CTM: `calls/phone?to_number=` opens the softphone but does NOT
populate the number (checked live 2026-09-08), and no app URL scheme exists, so tel: is the
best hand-off; if CTM Phone is his default calling app the phone routes tel: to it.

Call in CTM (2026-09-08, final): CTM has no dial-by-URL for the app. Verified from
app.calltrackingmetrics.com/.well-known/apple-app-site-association: the iOS app
(KSGS66UULE.com.calltrackingmetrics.phone) claims ONLY the `/home` path; Android assetlinks.json is `{}`.
So Call = copy the 10-digit number to the clipboard inside the click, show a toast, and open the app:
iOS `https://app.calltrackingmetrics.com/home` (universal link), Android
`intent://home#Intent;scheme=https;package=com.calltrackingmetrics.phone;...;end` (web fallback).
He pastes into the CTM dialer. Tapping Call is what unlocks the disposition row.

CTM hand-off — VERIFIED ON DEVICE 2026-09-08 (Travis's S22 Ultra over ADB, CTM Phone 2.0.22):
- The app's manifest registers custom schemes `ctmphone://` and `exp+ctm-phone://` (MainActivity),
  https app links for `app.calltrackingmetrics.com/home` and `app.ctm.com/home` (autoVerify), and
  NO `tel:` filter. Expo Router routes include `/(tabs)/call` (the dialpad) — so `ctmphone://call`
  opens the app directly on the dialpad. Tested 10 param/path shapes (`?number=`, `?phone=`,
  `?to=`, `/call/<digits>`, `/dial/<digits>`, …): none prefill the number; unknown paths render
  Expo's "Unmatched Route". The dialpad number display has no paste on long-press.
- The https link failed earlier because "Open supported links" was DISABLED for the app on the
  phone; enabled via `pm set-app-links-user-selection --user 0 --package com.calltrackingmetrics.phone true app.calltrackingmetrics.com app.ctm.com`.
- Page: Android uses `intent://call#Intent;scheme=ctmphone;package=com.calltrackingmetrics.phone;S.browser_fallback_url=…;end`,
  iOS uses `ctmphone://call` with the `/home` universal link as fallback. Button label carries the
  number (`📞 CTM · 602-332-0548`); clipboard copy still happens. Verified by tapping the button in
  Chrome on the phone: toast "Copied to clipboard", CTM Phone foreground on Dialpad.
- APK pulled to inspect: `adb pull $(pm path …)` then read `assets/index.android.bundle` (Hermes;
  strings still greppable). Test page for future candidates: `/m/ctm-test.html`.

Phone page v4 (2026-09-08): Drive button lives in the header ("▶ Drive (n)" = remaining stops,
Google Maps from Your location). Appointments have "Mark ran" (localStorage `m-ran:<rep>:<date>`),
added checks get "Picked up" (outcome `picked_up`, logged like the others; migration widened the
CHECK constraint). Ran stops and picked-up checks are greyed, drop out of the Google link and the
OSRM drive line, and picked-up checks sink to the bottom. Picking up fires a confetti popup with the
check value and the day's running total. Undo: tap again (picked up → back to confirmed).

## Phone page v5 (2026-09-08 pm)
- **Calendar in the sticky box.** Header button swaps Map ⇄ Calendar (`#mapWrap` holds both). Calendar = month grid with the rep's adjuster-meeting count per day (`api/adjuster-days.js?rep=&month=` → counts from `calendar_events` where `event_subtype='Adjuster meeting'` and attendees include the door-knocker's Roofr uid, map in `DOOR_KNOCKER_IDS`). Tapping a day fetches `?rep=&date=` (that day's meetings joined to `jobs`, share-link shape), geocodes any without coords via `/api/geocode`, and reloads `/m/` with a fresh `s=` link — so every per-day key (ran / called / picks / outcomes) lines up.
- **Appointment cards** now get `📞 CTM` + Roofr via `api/stop-lookup.js` (POST name+address → job_id, phone; street-number + first-word ilike on `jobs.address`, name tie-break). Jobs with no phone AND no `all_contacts` in the mirror show no button.
- **Secondary-contact phone fallback** (`fallbackPhone` in `api/insurance-checks.js`): when the primary contact has no phone (carrier as primary), first non-toll-free number from `all_contacts`, labelled with that contact's first name.
- **Checks:** Retail / Door knocker filter chips; dispositioned checks animate out (card slide+collapse, pin shrink) and drop off the map for the day; tapping a pin scrolls to the card (no popup); checks missing coords are geocoded in-page (cached in `localStorage m-geo`) — 13 of 41 lacked them.

## Phone page v6 (2026-09-08 evening)
- **Tabs:** Today (appointments + checks) | **Needs Adjuster (n)** = jobs in `Ins: Needs Adjuster Meeting` via `api/adjuster-queue.js` — Supabase base list + READ-ONLY live Roofr reads through the borrowed `roofr-main` session (same headers as `roofr-tasks.js`): carrier = job contact with `contact_type='insurance'`; adjuster = first phone in `insurance.notes` that isn't the carrier line / toll-free (name from the text before it or the previous line). Buttons Customer / Adjuster / Carrier all go through CTM. Orange "A" pins replace the day's pins + route while the tab is open; the map opens on greater Phoenix (`PHX_BOUNDS`), pinch out for Tucson.
- **Sort chips** on both lists (nearest / newest / waiting longest / rep / name). **Radius auto-widens** to the first radius with a live check (2→5→10→All).
- **Layout:** phone = sticky map (32vh) over scrolling lists, chip rows scroll sideways, 40px+ tap targets, safe-area padding. ≥900px (tablet landscape / desktop) = `#left` (map or calendar + route bar, pinned full-height) beside `#right` (tabs + lists). `setView('map')` clears the inline height so CSS owns it; `scrollToCard` offsets by header only in the two-column layout.
- Known: Jessel Chavez (9940428) shows in the queue with a stale `stage` (timeline says the job left the stage in May) — mirror issue, not page.

## Phone page v7 (2026-09-08 night) — Google Sign-In gate
- `/m/` shows a sign-in card until `POST /api/m-auth` accepts the account. Same OAuth client + HS256 session JWT as the planner (`api/auth.js` now exports `signSession`/`CLIENT_ID`/`SECRET`/`emailAllowed`/`TTL_SECONDS`); the page wraps `window.fetch` so every `/api/` call carries `Authorization: Bearer <session>` (localStorage `mAuth`). Footer shows "Signed in as … · Sign out".
- Rule (`api/_msession.js` → `mAllowed`): email passes ALLOWED_EMAILS domains AND (in `M_ALLOWED_EMAILS` env, OR a full address in ALLOWED_EMAILS, OR Google display name / email local-part matches an Active roster person in `teams` dept Management|Manager|Insurance, `rep_profiles` section MANAGEMENT|INSURANCE, or Michael Hurff). Roster-driven; `M_ALLOWED_EMAILS` (not set yet) is the override for people whose Google name differs from the roster.
- Gated: `check-outcomes`, `adjuster-queue`, `adjuster-days`, `stop-lookup` (`requireM`); `insurance-checks` needs any scheduler session (`requireSession`) — `insuranceChecksService.ts` now sends the planner's token. Auth off (no GOOGLE_OAUTH_CLIENT_ID) = everything open, as before.
- Days with no adjuster meetings: the Before/Between/After chips collapse to one "Add to route" chip.
- **URL moved (v7b):** the page now lives at `/insurance-tracker/` (`public/insurance-tracker/index.html`); `/m/` is a redirect that keeps the query string. With no `rep=` in the link the page uses the signed-in Google name as the rep (header "Michael's day", calendar counts, outcomes attribution) — share links from the planner still pin `rep=`. `api/adjuster-days.js` still maps only Michael Hurff → Roofr uid 507565 (`DOOR_KNOCKER_IDS`); other signed-in users see every adjuster meeting until their uid is added.
- **Access rule v2 (2026-09-08 late):** `api/_msession.js` now reads the company roster SHEET (`1XFJHD0IVZ8sJrQ7H2CrqU26a6n-FulPM8ABKc1hrh9o`, tab "Add To Team Roster") with the service account and allows Active rows whose Company/Personal Email matches and who are Team = **Office** in Administration / Lead Center / Insurance / Production / Manager / Management, plus Michael Hurff. Cached 5 min; if the sheet read fails it falls back to the Supabase teams/rep_profiles NAME match. `GET /api/m-auth?health=1` reports `roster: sheet|fallback` (41 people at deploy). The scheduler's `GOOGLE_SERVICE_ACCOUNT_JSON` was a dead 174-day-old key (token 400) — rotated to the current `service-account.json` (base64) on 2026-09-08; `roofr-appointments.py`'s Sheets fallback uses the same var.
