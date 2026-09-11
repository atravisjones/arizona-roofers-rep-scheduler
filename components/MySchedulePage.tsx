import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AvailabilityData,
  AvailabilityStatus,
  Exception,
  Profile,
  Resolved,
  loadAvailability,
  saveAvailability,
} from '../services/availabilityApi';
import {
  SLOTS,
  WEEKDAYS,
  addWeeks,
  availabilityFlags,
  availabilityStatus,
  dateKey,
  mondayOf,
  nextAvailabilityStatus,
  patternStatus,
  weekDays,
} from '../utils/availability';

// Rep self-service schedule, phone-first. Two tabs:
//   Weeks   — swipe through the next 8 weeks; tap a slot to cycle ON → FLEX → OFF; day / week off buttons.
//   Default — the standing weekly pattern; saving applies from the Monday two weeks out. Dated changes
//             (time off) are exceptions and are never touched by a default change.
// Managers open it with ?as=<rep_id> (same as the availability board's "View as").

const DAY_SLOTS = SLOTS.slice(0, 4) as string[];
const WEEKS_AHEAD = 8;
const SLOT_TIME: Record<string, string> = { s1: '8–11', s2: '11–1', s3: '2–5', s4: '5–8' };
const STATE_LABEL: Record<AvailabilityStatus, string> = { on: 'ON', flex: 'FLEX', off: 'OFF' };
const stateClass = (state: AvailabilityStatus, exception: boolean) =>
  `${
    state === 'on'
      ? 'border-[#6aa84f] bg-[#b6d7a8] text-[#274e13]'
      : state === 'flex'
        ? 'border-dashed border-tag-blue-text bg-tag-blue-bg text-tag-blue-text'
        : 'border-[#b7b7b7] bg-[#e6e6e6] text-[#595959]'
  } ${exception ? (state === 'off' ? 'line-through decoration-2' : 'underline decoration-2 underline-offset-2') : ''}`;

const fmtDay = (key: string) =>
  new Date(`${key}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const fmtWeek = (monday: string) => {
  const sunday = weekDays(monday)[6];
  const a = new Date(`${monday}T12:00:00`);
  const b = new Date(`${sunday}T12:00:00`);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  return `${a.toLocaleDateString('en-US', opts)} – ${b.toLocaleDateString('en-US', opts)}`;
};
const thisMonday = () => dateKey(mondayOf(new Date()));

type Cell = { state: AvailabilityStatus; source: string; exception?: Exception };

const MySchedulePage: React.FC = () => {
  const viewAs = useMemo(() => {
    try {
      return new URLSearchParams(window.location.search).get('as');
    } catch {
      return null;
    }
  }, []);
  const [data, setData] = useState<AvailabilityData | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'weeks' | 'default'>('weeks');
  const [toast, setToast] = useState<{ text: string; kind: 'ok' | 'error' } | null>(null);
  const [busy, setBusy] = useState(0);
  const start = useMemo(() => thisMonday(), []);
  const mondays = useMemo(() => Array.from({ length: WEEKS_AHEAD }, (_, i) => addWeeks(start, i)), [start]);
  const [weekIndex, setWeekIndex] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  const showToast = (text: string, kind: 'ok' | 'error' = 'ok') => {
    setToast({ text, kind });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2500);
  };

  const fetchData = useCallback(async () => {
    try {
      const next = await loadAvailability(start, weekDays(mondays[WEEKS_AHEAD - 1])[6], viewAs);
      setData(next);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your schedule.');
    }
  }, [start, mondays, viewAs]);
  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const isManager = Boolean(data?.me.is_manager);
  const repId = data?.me.view_as || data?.me.rep_id || null;
  const profile: Profile | undefined = data?.profiles.find((p) => p.id === repId);
  const pattern = data?.patterns.find((p) => p.rep_id === repId);

  const cells = useMemo(() => {
    const map = new Map<string, Cell>();
    if (!data || !repId) return map;
    const exceptions = new Map<string, Exception>();
    data.exceptions.forEach((x) => {
      if (x.rep_id === repId) exceptions.set(`${x.exception_date}:${x.slot}`, x);
    });
    data.resolved.forEach((r: Resolved) => {
      if (r.rep_id !== repId) return;
      const key = `${r.work_date}:${r.slot}`;
      map.set(key, { state: availabilityStatus(r), source: r.source || 'pattern', exception: exceptions.get(key) });
    });
    return map;
  }, [data, repId]);
  const holidays = useMemo(() => new Map((data?.holidays || []).map((h) => [h.date, h.name])), [data]);

  // ON → FLEX → OFF → ON. Landing on the standing-pattern state deletes the exception (holiday /
  // meeting days have an OFF baseline, so the first tap opens the rep up).
  const nextFor = (day: string, slot: string): AvailabilityStatus | null => {
    const cell = cells.get(`${day}:${slot}`);
    const current = cell?.state ?? 'off';
    const chosen = nextAvailabilityStatus(current);
    const overlay = cell?.source === 'holiday' || cell?.source === 'meeting';
    const base = overlay ? 'off' : data && repId ? patternStatus(data.patterns, repId, day, slot) : 'off';
    return chosen === base ? null : chosen;
  };

  const applyLocal = (changes: Array<{ date: string; slot: string; status: AvailabilityStatus | null }>) => {
    setData((old) => {
      if (!old || !repId) return old;
      const want = new Map(changes.map((c) => [`${c.date}:${c.slot}`, c]));
      const resolved = old.resolved.map((r) => {
        const c = r.rep_id === repId ? want.get(`${r.work_date}:${r.slot}`) : undefined;
        if (!c) return r;
        const status = c.status ?? (data && repId ? patternStatus(old.patterns, repId, c.date, c.slot) : 'off');
        return { ...r, ...availabilityFlags(status), status, source: c.status ? 'exception' : 'pattern' };
      });
      const exceptions = old.exceptions.filter(
        (x) => x.rep_id !== repId || !want.has(`${x.exception_date}:${x.slot}`),
      );
      changes.forEach((c) => {
        if (c.status)
          exceptions.push({
            id: `optimistic-${c.date}-${c.slot}`,
            rep_id: repId,
            exception_date: c.date,
            slot: c.slot,
            ...availabilityFlags(c.status),
            status: c.status,
            note: null,
          });
      });
      return { ...old, resolved, exceptions };
    });
  };

  const writeChanges = async (
    changes: Array<{ date: string; slot: string; status: AvailabilityStatus | null }>,
    success: string,
  ) => {
    if (!repId || changes.length === 0) return;
    setBusy((n) => n + 1);
    applyLocal(changes);
    try {
      await saveAvailability({ action: 'set_exceptions', rep_id: repId, changes });
      showToast(success);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save', 'error');
    } finally {
      setBusy((n) => n - 1);
      void fetchData();
    }
  };

  const tapSlot = (day: string, slot: string) => {
    const status = nextFor(day, slot);
    void writeChanges([{ date: day, slot, status }], status ? `${fmtDay(day)} ${SLOT_TIME[slot]} → ${STATE_LABEL[status]}` : `${fmtDay(day)} ${SLOT_TIME[slot]} back to default`);
  };
  const dayAllOff = (day: string) => DAY_SLOTS.every((slot) => (cells.get(`${day}:${slot}`)?.state ?? 'off') === 'off');
  const setDay = (day: string, status: AvailabilityStatus | null) =>
    writeChanges(
      DAY_SLOTS.map((slot) => ({ date: day, slot, status })),
      status ? `${fmtDay(day)} → ${STATE_LABEL[status]} all day` : `${fmtDay(day)} back to default`,
    );
  const setWeek = (monday: string, status: AvailabilityStatus | null) =>
    writeChanges(
      weekDays(monday).flatMap((day) => DAY_SLOTS.map((slot) => ({ date: day, slot, status }))),
      status ? `Week of ${fmtWeek(monday)} → ${STATE_LABEL[status]}` : `Week of ${fmtWeek(monday)} back to default`,
    );

  // Swipe: native scroll-snap; keep the index in sync for the header + arrows.
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    setWeekIndex(Math.round(el.scrollLeft / el.clientWidth));
  };
  const goWeek = (index: number) => {
    const el = scroller.current;
    const clamped = Math.max(0, Math.min(WEEKS_AHEAD - 1, index));
    if (el) el.scrollTo({ left: clamped * el.clientWidth, behavior: 'smooth' });
    setWeekIndex(clamped);
  };

  // ----- Default week (standing pattern) -----
  const defaultFrom = useMemo(() => addWeeks(start, 2), [start]);
  const [draft, setDraft] = useState<Record<number, Record<string, AvailabilityStatus>> | null>(null);
  const [savingDefault, setSavingDefault] = useState(false);
  const patternGrid = useMemo(() => {
    const grid: Record<number, Record<string, AvailabilityStatus>> = {};
    WEEKDAYS.forEach((_, weekday) => {
      grid[weekday] = {};
      SLOTS.forEach((slot) => {
        grid[weekday][slot] = availabilityStatus(pattern?.slots.find((s) => s.weekday === weekday && s.slot === slot));
      });
    });
    return grid;
  }, [pattern]);
  const grid = draft ?? patternGrid;
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(patternGrid);
  const tapDefault = (weekday: number, slot: string) =>
    setDraft((cur) => {
      const base = cur ?? patternGrid;
      return { ...base, [weekday]: { ...base[weekday], [slot]: nextAvailabilityStatus(base[weekday][slot]) } };
    });
  const saveDefault = async () => {
    if (!repId || !draft) return;
    setSavingDefault(true);
    try {
      await saveAvailability({
        action: 'set_pattern',
        rep_id: repId,
        effective_from: defaultFrom,
        slots: Object.entries(draft).flatMap(([weekday, slots]) =>
          Object.entries(slots).map(([slot, status]) => ({ weekday: Number(weekday), slot, status })),
        ),
      });
      setDraft(null);
      showToast(`Default saved. Applies from ${fmtDay(defaultFrom)}.`);
      await fetchData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save default', 'error');
    } finally {
      setSavingDefault(false);
    }
  };

  // ----- render -----
  if (error && !data)
    return (
      <div className="mx-auto max-w-md p-6 text-center">
        <p className="text-sm font-semibold text-tag-red-text">Could not load your schedule</p>
        <p className="mt-1 text-xs text-text-secondary">{error}</p>
        <button type="button" onClick={() => void fetchData()} className="mt-4 rounded-md bg-brand-primary px-4 py-2 text-sm font-semibold text-brand-text-on-primary">
          Try again
        </button>
      </div>
    );
  if (!data)
    return <p className="p-8 text-center text-sm text-text-tertiary">Loading your schedule…</p>;
  if (!repId || !profile)
    return (
      <div className="mx-auto max-w-md p-6">
        <h1 className="text-xl font-bold text-text-primary">My schedule</h1>
        {isManager ? (
          <div className="mt-3 space-y-2">
            <p className="text-sm text-text-secondary">Pick a rep to open their schedule.</p>
            {data.profiles
              .filter((p) => !p.is_placeholder)
              .map((p) => (
                <a key={p.id} href={`/my-schedule?as=${p.id}`} className="block rounded-md border border-border-secondary bg-bg-primary px-3 py-3 text-sm font-semibold text-text-primary">
                  {p.display_name} <span className="text-xs font-normal text-text-tertiary">· {p.section}</span>
                </a>
              ))}
          </div>
        ) : (
          <p role="alert" className="mt-3 rounded-md border border-tag-amber-border bg-tag-amber-bg px-3 py-3 text-sm text-tag-amber-text">
            No rep profile is linked to {data.me.email || 'your email'}. Ask a manager to add your email to your rep profile.
          </p>
        )}
      </div>
    );

  const btn = 'flex h-12 flex-1 items-center justify-center rounded-lg border-2 text-base font-bold tabular-nums active:brightness-90 disabled:opacity-60';

  return (
    // The app shell pins html/body/#root to 100vh with overflow hidden (planner layout), so this
    // page must be its own scroll container or a phone can't scroll it at all.
    <div className="mx-auto h-screen max-w-md overflow-y-auto overscroll-y-contain bg-bg-secondary pb-24" style={{ height: '100dvh', WebkitOverflowScrolling: 'touch' }}>
      <header className="sticky top-0 z-20 border-b border-border-secondary bg-bg-primary px-4 pb-2 pt-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[.2em] text-brand-primary">
              {data.me.view_as ? 'Manager preview' : 'My schedule'}
            </p>
            <h1 className="text-lg font-bold leading-tight text-text-primary">{profile.display_name}</h1>
          </div>
          {isManager && (
            <a href="/availability" className="text-xs font-semibold text-brand-primary">
              Board
            </a>
          )}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-1 rounded-lg bg-bg-secondary p-1">
          {(['weeks', 'default'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              aria-pressed={tab === t}
              className={`rounded-md py-2 text-sm font-semibold ${tab === t ? 'bg-bg-primary text-text-primary shadow' : 'text-text-tertiary'}`}
            >
              {t === 'weeks' ? 'Weeks' : 'Default week'}
            </button>
          ))}
        </div>
        <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-text-tertiary">
          <span><b className="text-[#38761d]">ON</b> book me</span>
          <span><b className="text-tag-blue-text">FLEX</b> call me first</span>
          <span><b>OFF</b> not available</span>
          <span>Tap a slot to change it.</span>
        </p>
      </header>

      {tab === 'weeks' ? (
        <>
          <div className="flex items-center justify-between px-4 py-2">
            <button type="button" onClick={() => goWeek(weekIndex - 1)} disabled={weekIndex === 0} className="rounded-md border border-border-secondary bg-bg-primary px-3 py-1.5 text-sm font-bold disabled:opacity-30" aria-label="Previous week">‹</button>
            <p className="text-sm font-semibold text-text-primary">
              {weekIndex === 0 ? 'This week' : weekIndex === 1 ? 'Next week' : `Week of ${mondays[weekIndex].slice(5).replace('-', '/')}`}
              <span className="ml-1 text-xs font-normal text-text-tertiary">{fmtWeek(mondays[weekIndex])}</span>
            </p>
            <button type="button" onClick={() => goWeek(weekIndex + 1)} disabled={weekIndex === WEEKS_AHEAD - 1} className="rounded-md border border-border-secondary bg-bg-primary px-3 py-1.5 text-sm font-bold disabled:opacity-30" aria-label="Next week">›</button>
          </div>
          <div ref={scroller} onScroll={onScroll} className="flex snap-x snap-mandatory overflow-x-auto scroll-smooth" style={{ scrollbarWidth: 'none' }}>
            {mondays.map((monday) => (
              <section key={monday} className="w-full shrink-0 snap-start px-3" aria-label={`Week of ${fmtWeek(monday)}`}>
                <div className="mb-2 flex gap-2">
                  <button type="button" disabled={busy > 0} onClick={() => void setWeek(monday, 'off')} className="flex-1 rounded-md border border-border-secondary bg-bg-primary py-2 text-xs font-semibold text-text-secondary">Whole week OFF</button>
                  <button type="button" disabled={busy > 0} onClick={() => void setWeek(monday, null)} className="flex-1 rounded-md border border-border-secondary bg-bg-primary py-2 text-xs font-semibold text-text-secondary">Reset week to default</button>
                </div>
                <div className="space-y-2">
                  {weekDays(monday).map((day) => {
                    const holiday = holidays.get(day);
                    const off = dayAllOff(day);
                    return (
                      <div key={day} className="rounded-xl border border-border-secondary bg-bg-primary p-2">
                        <div className="mb-1.5 flex items-center justify-between">
                          <p className="text-sm font-bold text-text-primary">
                            {fmtDay(day)}
                            {holiday && <span className="ml-2 rounded bg-tag-amber-bg px-1.5 py-0.5 text-[10px] font-semibold text-tag-amber-text">{holiday}</span>}
                          </p>
                          <button
                            type="button"
                            disabled={busy > 0}
                            onClick={() => void setDay(day, off ? null : 'off')}
                            className="rounded-md border border-border-secondary px-2 py-1 text-[11px] font-semibold text-text-secondary"
                          >
                            {off ? 'Reset day' : 'Day OFF'}
                          </button>
                        </div>
                        <div className="flex gap-1.5">
                          {DAY_SLOTS.map((slot) => {
                            const cell = cells.get(`${day}:${slot}`);
                            const state = cell?.state ?? 'off';
                            const glyph = cell?.source === 'meeting' ? 'M' : cell?.source === 'holiday' ? 'H' : STATE_LABEL[state];
                            return (
                              <button
                                key={slot}
                                type="button"
                                disabled={busy > 0}
                                onClick={() => tapSlot(day, slot)}
                                className={`${btn} flex-col leading-none ${stateClass(state, Boolean(cell?.exception))}`}
                                aria-label={`${fmtDay(day)} ${SLOT_TIME[slot]}: ${STATE_LABEL[state]}`}
                              >
                                <span className="text-[10px] font-semibold opacity-70">{SLOT_TIME[slot]}</span>
                                <span className="mt-0.5">{glyph}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
          <p className="px-4 pt-3 text-[11px] text-text-tertiary">Swipe left or right for other weeks. Underlined or struck slots are one-off changes; everything else follows your default week.</p>
        </>
      ) : (
        <div className="px-3 pt-2">
          <p className="mb-2 text-xs text-text-secondary">
            Your standing week. Saving applies from <b>{fmtDay(defaultFrom)}</b> onward. Time off you already
            set stays as it is.
          </p>
          <div className="space-y-2">
            {WEEKDAYS.map((day, weekday) => (
              <div key={day} className="flex items-center gap-2 rounded-xl border border-border-secondary bg-bg-primary p-2">
                <span className="w-9 text-sm font-bold text-text-primary">{day}</span>
                {DAY_SLOTS.map((slot) => {
                  const state = grid[weekday][slot];
                  return (
                    <button
                      key={slot}
                      type="button"
                      onClick={() => tapDefault(weekday, slot)}
                      className={`${btn} flex-col leading-none ${stateClass(state, false)}`}
                      aria-label={`${day} ${SLOT_TIME[slot]}: ${STATE_LABEL[state]}`}
                    >
                      <span className="text-[10px] font-semibold opacity-70">{SLOT_TIME[slot]}</span>
                      <span className="mt-0.5">{STATE_LABEL[state]}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-text-tertiary">Mon and Fri 8–11 stay off on company-meeting weeks regardless of your default.</p>
          <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-border-secondary bg-bg-primary p-3">
            <div className="mx-auto flex max-w-md gap-2">
              <button type="button" disabled={!dirty || savingDefault} onClick={() => setDraft(null)} className="flex-1 rounded-lg border border-border-secondary py-3 text-sm font-semibold text-text-secondary disabled:opacity-40">
                Discard
              </button>
              <button type="button" disabled={!dirty || savingDefault} onClick={() => void saveDefault()} className="flex-[2] rounded-lg bg-brand-primary py-3 text-sm font-bold text-brand-text-on-primary disabled:opacity-40">
                {savingDefault ? 'Saving…' : `Save default from ${fmtDay(defaultFrom)}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div role="status" className={`fixed bottom-20 left-1/2 z-30 -translate-x-1/2 rounded-full px-4 py-2 text-sm font-semibold shadow-lg ${toast.kind === 'ok' ? 'bg-text-primary text-bg-primary' : 'bg-tag-red-text text-white'}`}>
          {toast.text}
        </div>
      )}
    </div>
  );
};

export default MySchedulePage;
