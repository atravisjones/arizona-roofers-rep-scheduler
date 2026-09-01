# South rotation

Whose turn it is to take the **Limited corridor** and whose turn it is to take **Tucson**.
Two separate queues, at `/rotation`.

## Why it exists

Southern trips were handed out ad hoc, so the same handful of reps absorbed the long drives while
others had not been south in months. The queue makes the order visible and self-maintaining.

## Where the numbers come from

Nothing is entered by hand. A queue that depends on someone remembering to update it stops being
true within a week, so every figure is derived:

```
speed-to-leads /api/service-area  ──► the polygons (Limited, South, Phoenix, North)
KPI Supabase calendar_events      ──► who was where, and when
KPI Supabase jobs                 ──► lat/lng for each appointment
```

1. Fetch the published service areas. Disabled areas are dropped.

   **Precedence is deliberately ignored here.** The editor's precedence answers "which single area
   *names* this address" — what the CSR banner and the decline log need. The rotation asks "did the
   rep actually drive out there", a plain geographic question about the shape. Honouring precedence
   meant a corridor carve-out drawn inside Phoenix was invisible: Phoenix sits above it, claims every
   corridor town, and the queue stayed empty while looking correctly configured. Making the corridor
   outrank Phoenix would have renamed 13 towns in the scanner to satisfy a scheduler page. So
   `Limited` is simply checked first, then `South`.
2. Fetch `category = 'sales'` events for the window (`ROTATION_WINDOW_DAYS`, default 180). This
   **includes future-dated events**: a rep already booked south has taken their turn, and without
   that you would send them twice while planning the week.
3. Resolve `calendar_events.attendees` (numeric Roofr user ids) through `ROOFR_USER_ID_TO_REP`.
   Every mapped attendee is credited — a ride-along to Tucson is still a day spent driving there.
4. Classify each appointment's coordinates: inside `Limited` → corridor, else inside `South` →
   Tucson, else neither. Limited wins any overlap because it is the more specific shape.
5. A **trip is a DAY**, not an appointment. Three stops in Casa Grande is one turn.

`fetchRotationData()` does the network half; `buildRotation()` is pure, so toggling a skip re-orders
the queues without refetching.

## Who is in the queue

In: reps whose availability-sheet section is `PHOENIX` or `NORTHERN`, plus unsectioned floaters
(they are already eligible for every region in auto-assign).

Out, each shown under **Not in rotation** with its reason so exclusions stay auditable:

| Reason | Source |
|---|---|
| Tucson resident | `rep.region === 'SOUTH'` — the sheet's TUCSON banner |
| Commercial only | `isCommercialOnlyRep()` — the sheet's COMMERCIAL banner |
| Not field sales | `isFieldSalesRep()` — management and door-knockers |
| Skipped by hand | the per-queue skip toggle |

The first three are standing policy and need no upkeep: move a rep between sections in the
availability sheet and the rotation follows. The skip toggle covers everything else — someone who
can do a corridor run but not a full Tucson day is skipped on **one** queue, not both.

## Auto-assign

On a Limited or Tucson job only, the rep nearest the front of that queue gets a bonus of up to
`ROTATION_MAX_BONUS` (10), applied **after** the weighted average — the same way the specialist
bonus works. It is deliberately not a `ScoringWeights` key: adding one would change `totalWeight`
and silently rescale timeframe, rank, skills and distance for every job in the app. It also sits
below the timeframe weight, so a customer-requested window still wins.

Every job outside those two areas scores exactly as it did before this feature existed.

The switch is `scheduler_rotation_config.rotation_influence` — **one shared row, not per-day**.
`Settings` is stored per `date_key`, so a toggle there would quietly switch itself back on tomorrow.
It is editable on `/rotation` and in the assignment settings modal; both write straight through.

## Gotchas

- **`jobs.latitude` / `longitude` are TEXT columns.** Guard before `Number()`.
- **`calendar_events.start_date` is TEXT** (`'2026-03-12 13:00:00'`), so the window filter is a
  string compare against `YYYY-MM-DD`.
- **An unmapped attendee id is invisible damage.** That rep's trips file under nobody, so they read
  as "never went" and sit at the top of the queue for good. The page lists any unrecognised id seen
  on a southern appointment. Before adding one to `ROOFR_USER_ID_TO_REP`, confirm it against the
  attendee email on a real event — the `mode()` popularity heuristic has misattributed a user before.
  Ids that are correctly absent (office staff, ride-alongs) live in `ROOFR_NON_REP_USER_IDS` so the
  warning stays a real signal.
- **`ROOFR_USER_ID_TO_REP` has a second copy** in `api/roofr-appointments.py`. Update both together.
  Each `api/*.py` file is its own Vercel bundle and none of them import a sibling, so sharing one
  module is a deploy risk not worth taking for 25 lines.
- **`jobs.job_owner` is not a fallback.** On a future appointment it is still the booking CSR, so
  using it would invent trips for whoever booked them.
- **Skips are keyed by `normalizeName(rep.name)`, never `rep.id`** — rep ids are position-based
  (`rep-<index>-<name>`) and shift whenever a row is inserted in the availability sheet.

## Files

| File | Role |
|---|---|
| `services/rotationService.ts` | fetch, classify, build the queues |
| `components/RotationPage.tsx` | the `/rotation` page |
| `constants.ts` | area names, window, bonus cap, the uid→rep map |
| `services/supabaseService.ts` | `fetchRotationConfig` / `saveRotationConfig` |
| `context/useAppLogic.ts` | loads it once per session; applies the auto-assign bonus |

Table: `scheduler_rotation_config` (single row, `id = 1`) in the KPI Supabase project.
