# Travel rotation

Whose turn it is to take the **Limited corridor**, **Tucson**, or the drive **up north**.
Three separate queues, at `/rotation`, plus an optional **Phoenix** column for comparison.

## Why it exists

Out-of-town trips were handed out ad hoc, so the same handful of reps absorbed the long drives while
others had not left the valley in months. The queue makes the order visible and self-maintaining.

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
2. Fetch `category = 'sales'` events for the range. The Window select offers rolling presets
   (`ROTATION_WINDOW_OPTIONS`, 30 days to 2 years, default `ROTATION_WINDOW_DAYS` = **360**) or
   **Date range…**, which swaps in a from/to pair, both ends inclusive. 180 was the wrong default:
   an up-north or Tucson run is rare enough that half a year left most reps tied on "never", which is
   no order at all. **The range moves everything**, running order included — "last went", days,
   appointments and sold are all measured inside it, so a 90-day view answers a different question
   than a 2-year one.

   A rolling window is `{ from, to: null }` — **open-ended at the top on purpose**. This
   **includes future-dated events**: a rep already booked south has taken their turn, and without
   that you would send them twice while planning the week. A **fixed** range loses the `booked` flag,
   correctly — nothing was "already booked" as of a window that closed in March.

   The upper bound is emitted as `lt.<the next day>`, never `lte.<to>`: `start_date` is TEXT with a
   time on it, so `lte.2026-08-21` would drop every appointment on the 21st.
3. Resolve `calendar_events.attendees` (numeric Roofr user ids) through `ROOFR_USER_ID_TO_REP`.
   Every mapped attendee is credited — a ride-along to Tucson is still a day spent driving there.
4. Classify each appointment's coordinates, most specific first: inside `Limited` → corridor, else
   inside `South` → Tucson, else **latitude ≥ 34.07** → up north, else neither. Limited wins any
   overlap because it is the carve-out.

   **Up north is a latitude rule, not a shape** (`ROTATION_NORTH_MIN_LAT`, Black Canyon City — the
   same threshold the GPS region classifier uses). The published `North` service area stops at the
   Verde Valley, but reps get sent to Sedona, Flagstaff, Payson and Show Low, and those are the
   longest drives anyone does. This queue answers *who is putting miles on*, not *do we service this
   address*, so widening the service area to make it work would tell the CSR scanner we sell in
   Flagstaff — a different claim, and not one to make from a scheduler page.

   Nothing in the valley reaches 34.07: Anthem 33.87, New River 33.92, Cave Creek 33.83.

   **Phoenix is checked last**, which is what makes it "the valley minus the corridor" for free:
   a corridor point was already claimed two steps earlier. It is a comparison column, not a
   rotation — nobody takes turns going to the valley. Hidden by default (remembered in
   `localStorage`), and **never** nudges auto-assign: `ROTATION_NUDGED_QUEUES` omits it, because
   nudging there would rescore every valley job by whose turn it is. It answers "is this rep light
   overall, or only out of town" — a rep at the front of all three travel queues reads very
   differently if their Phoenix column is full.
5. A **trip is a DAY**, not an appointment. Three stops in Casa Grande is one turn. The table also
   shows **Appt · Won** for the same window: appointments run in that region, and how many of them
   sold. Won is counted as **distinct jobs** (`jobs.stage_category` in `won`/`completed`) — a second
   visit to one house is a second appointment but not a second sale. `won_at` is deliberately not the
   test: 204 jobs carry one and have since gone to lost, and counting a cancelled deal as a win would
   flatter whoever sold it. **Sold** is `jobs.value` summed over those same deduped job ids. Roughly
   3% of won jobs carry no value; they count as a win worth $0 rather than dropping out of the win
   count, because a sale with no number on it is still a sale.

`fetchRotationData()` does the network half; `buildRotation()` is pure, so toggling a skip re-orders
the queues without refetching.

## Who is in the queue

In: reps whose availability-sheet section is `PHOENIX` or `NORTHERN`, plus unsectioned floaters
(they are already eligible for every region in auto-assign).

Sheet rows that are not people are dropped outright — `ROTATION_NON_REP_ROWS` in `constants.ts`,
currently just "Flex North", a coverage placeholder. They are not listed under **Not in rotation**,
because that would read as a real rep somebody decided to hold out.

`NORTHERN`-section reps are **not** treated as up-north residents the way `SOUTH`-section reps are
treated as Tucson residents. Deliberate: the sheet's NORTHERN banner marks who covers the north, not
who lives there, and a frequent goer sinks to the back of the queue on their own. Use the skip
toggle if someone should be out of a queue entirely.

Out, each shown under **Not in rotation** with its reason so exclusions stay auditable. They are
rendered in the **same columns** as the queue rather than a one-line summary, because their figures
are worth reading against everyone else's — Richard Hadsall is the biggest producer in Tucson by a
distance and is permanently excluded from it.

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

On a corridor, Tucson or up-north job only, the rep nearest the front of that queue gets a bonus of up to
`ROTATION_MAX_BONUS` (10), applied **after** the weighted average — the same way the specialist
bonus works. It is deliberately not a `ScoringWeights` key: adding one would change `totalWeight`
and silently rescale timeframe, rank, skills and distance for every job in the app. It also sits
below the timeframe weight, so a customer-requested window still wins.

Every job outside those three areas scores exactly as it did before this feature existed.

The switch is `scheduler_rotation_config.rotation_influence` — **one shared row, not per-day**.
`Settings` is stored per `date_key`, so a toggle there would quietly switch itself back on tomorrow.
It is editable on `/rotation` and in the assignment settings modal; both write straight through.

`updateRotationConfig` takes a **patch**, and `saveRotationConfig` writes only the columns present in
it. That is load-bearing, not tidiness: one shared row plus whole-object writes meant a browser
holding a stale copy pushed its old `rotation_influence` back over a colleague's change the moment
anyone clicked "remove" on a rep — last click wins, and the nudge switched itself off with nobody
having touched it. The two fields are independent; write them independently.

## Gotchas

- **`jobs.latitude` / `longitude` are TEXT columns.** Guard before `Number()`.
- **`calendar_events.start_date` is TEXT** (`'2026-03-12 13:00:00'`), so the window filter is a
  string compare against `YYYY-MM-DD`.
- **An unmapped attendee id is invisible damage.** That rep's trips file under nobody, so they read
  as "never went" and sit at the top of the queue for good. The page lists any unrecognised id seen
  on an out-of-town appointment. **Resolve it against `tools/production-map/roofr-users.json`** — a
  full Roofr team dump, id → name + email, which answers in one lookup what correlating `job_owner`
  across a rep's calendar only guesses at. It is a snapshot and goes stale, so an id missing from it
  is newer than the file; only then fall back to correlation, and check the name's department in
  `teams` before adding (`459345` looked like a rep by its calendar and is a Lead Center CSR).
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
| `types.ts` | `ROTATION_QUEUE_IDS` — the one list a fourth region would be added to |
| `services/rotationService.ts` | fetch, classify, build the queues |
| `components/RotationPage.tsx` | the `/rotation` page |
| `constants.ts` | area names, the north latitude, window, bonus cap, non-rep sheet rows, uid→rep map |
| `services/supabaseService.ts` | `fetchRotationConfig` / `saveRotationConfig` |
| `context/useAppLogic.ts` | loads it once per session; applies the auto-assign bonus |

Table: `scheduler_rotation_config` (single row, `id = 1`) in the KPI Supabase project.
