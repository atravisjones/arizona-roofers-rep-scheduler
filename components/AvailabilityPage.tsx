import React, { useCallback, useEffect, useMemo, useState } from 'react';
import AvailabilityRepDrawer from './AvailabilityRepDrawer';
import { HoldRuleChip } from './AvailabilityHoldRule';
import {
  AvailabilityData,
  Exception,
  Profile,
  Resolved,
  Section,
  Slot,
  loadAvailability,
  saveAvailability,
} from '../services/availabilityApi';
import {
  SLOTS,
  SLOT_LABELS,
  WEEKDAYS,
  addWeeks,
  dateKey,
  displayDate,
  heldFor,
  mondayOf,
  netBookable,
  weekDays,
} from '../utils/availability';
import { useAppContext } from '../context/AppContext';

const SELLING_SECTIONS: Section[] = ['PHX', 'NORTH', 'SOUTH', 'COMMERCIAL'];
const HATCHED =
  'bg-[repeating-linear-gradient(135deg,rgb(var(--border-secondary)/.28)_0px,rgb(var(--border-secondary)/.28)_3px,transparent_3px,transparent_6px)]';
const FOCUS =
  'transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary';
const today = dateKey(new Date());

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2);
const sourceLabel = (item?: Resolved) => {
  if (item?.source === 'meeting') return 'Meeting';
  if (item?.source === 'manager') return 'Manager exception';
  return 'Standing pattern';
};

interface WeekNavProps {
  monday: string;
  days: string[];
  onMove: (amount: number) => void;
  onToday: () => void;
  onDate: (date: string) => void;
}
const WeekNav: React.FC<WeekNavProps> = ({ monday, days, onMove, onToday, onDate }) => (
  <div className="flex flex-wrap items-center gap-2">
    <button
      type="button"
      onClick={() => onMove(-1)}
      className={`${FOCUS} rounded-md border border-border-secondary bg-bg-primary px-3 py-2 text-sm text-text-secondary`}
      aria-label="Previous week"
    >
      ‹
    </button>
    <span className="min-w-[170px] text-center text-xs font-semibold tabular-nums text-text-secondary">
      Week of {displayDate(monday)} – {displayDate(days[6])}
    </span>
    <button
      type="button"
      onClick={() => onMove(1)}
      className={`${FOCUS} rounded-md border border-border-secondary bg-bg-primary px-3 py-2 text-sm text-text-secondary`}
      aria-label="Next week"
    >
      ›
    </button>
    <button
      type="button"
      onClick={onToday}
      className={`${FOCUS} rounded-md border border-border-secondary bg-bg-primary px-3 py-2 text-[11px] font-semibold text-text-secondary`}
    >
      Today
    </button>
    <input
      type="date"
      aria-label="Jump to date"
      value={monday}
      onChange={(event) => onDate(event.target.value)}
      className="rounded-md border border-border-secondary bg-bg-primary px-2 py-2 text-[11px] text-text-secondary"
    />
  </div>
);

interface PolicyChipsProps {
  policy: AvailabilityData['policy'][string];
  editable: boolean;
  onChange: (field: string, value: boolean | string) => void;
}
const PolicyChips: React.FC<PolicyChipsProps> = ({ policy, editable, onChange }) => (
  <section className="flex flex-wrap items-center gap-2 rounded-lg border border-border-secondary bg-bg-primary px-4 py-3">
    <span className="mr-1 text-[10px] font-bold uppercase tracking-wider text-text-quaternary">
      Week policy
    </span>
    {(
      [
        ['sales_meeting_mon', 'Sales meeting Mon'],
        ['company_meeting_fri', 'Company meeting Fri'],
      ] as const
    ).map(([field, label]) => {
      const active = Boolean(policy[field]);
      return (
        <button
          key={field}
          type="button"
          disabled={!editable}
          onClick={() => onChange(field, !active)}
          className={`${FOCUS} rounded-full border px-3 py-1.5 text-[11px] font-semibold ${active ? 'border-tag-amber-border bg-tag-amber-bg text-tag-amber-text' : 'border-border-secondary bg-bg-secondary text-text-tertiary'}`}
        >
          {label} <span className="ml-1">{active ? 'ON' : 'OFF'}</span>
        </button>
      );
    })}
    <div className="flex rounded-md border border-border-secondary bg-bg-secondary p-0.5">
      {(['standard', 'storm'] as const).map((kind) => (
        <button
          key={kind}
          type="button"
          disabled={!editable}
          onClick={() => onChange('template_kind', kind)}
          className={`rounded px-2.5 py-1 text-[10px] font-bold capitalize ${policy.template_kind === kind ? 'bg-brand-primary text-brand-text-on-primary' : 'text-text-tertiary'}`}
        >
          {kind}
        </button>
      ))}
    </div>
    <span className="ml-auto text-[10px] text-text-quaternary">
      {editable ? 'Manager editing enabled' : 'Read-only view'}
    </span>
  </section>
);

interface CapacityStripProps {
  days: string[];
  section: string;
  profiles: Profile[];
  resolved: Map<string, Resolved>;
  rule: AvailabilityData['hold_rule'];
  editable: boolean;
  onSection: (section: string) => void;
  onSaveRule: (rule: AvailabilityData['hold_rule']) => Promise<void>;
}
const CapacityStrip: React.FC<CapacityStripProps> = ({
  days,
  section,
  profiles,
  resolved,
  rule,
  editable,
  onSection,
  onSaveRule,
}) => {
  const inSection = (profile: Profile) =>
    section === 'All' ||
    profile.section === section ||
    (section === 'Commercial' && profile.section === 'COMMERCIAL');
  const count = (day: string, slot: string) =>
    profiles.filter((rep) => inSection(rep) && resolved.get(`${rep.id}:${day}:${slot}`)?.available)
      .length;
  return (
    <section>
      <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-text-primary">Bookable capacity</h2>
          <p className="text-[11px] text-text-tertiary">
            Net after the hold rule · {section} coverage
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <HoldRuleChip rule={rule} editable={editable} onSave={onSaveRule} />
          <select
            value={section}
            onChange={(event) => onSection(event.target.value)}
            aria-label="Capacity section"
            className="rounded-md border border-border-secondary bg-bg-primary px-2 py-1.5 text-[11px] font-semibold text-text-secondary"
          >
            <option>PHX</option>
            <option>NORTH</option>
            <option>SOUTH</option>
            <option>Commercial</option>
            <option>All</option>
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-7">
        {days.map((day, index) => {
          const total = SLOTS.slice(0, 4).reduce(
            (sum, slot) => sum + netBookable(count(day, slot), rule),
            0,
          );
          return (
            <DayCard
              key={day}
              day={day}
              index={index}
              total={total}
              rule={rule}
              count={(slot) => count(day, slot)}
            />
          );
        })}
      </div>
    </section>
  );
};

interface DayCardProps {
  day: string;
  index: number;
  total: number;
  rule: AvailabilityData['hold_rule'];
  count: (slot: string) => number;
}
const DayCard: React.FC<DayCardProps> = ({ day, index, total, rule, count }) => (
  <article
    className={`rounded-lg border bg-bg-primary p-3 ${day === today ? 'border-brand-primary ring-2 ring-brand-primary/20' : 'border-border-secondary'} ${index === 6 ? 'opacity-60' : ''}`}
  >
    <div className="flex items-start justify-between">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wider text-text-tertiary">
          {WEEKDAYS[index]}
        </p>
        <p className="text-[11px] tabular-nums text-text-secondary">{displayDate(day)}</p>
      </div>
      {day === today && (
        <span className="rounded-full bg-brand-bg-light px-1.5 py-0.5 text-[9px] font-bold text-brand-text-light">
          TODAY
        </span>
      )}
    </div>
    <p className="mt-3 text-2xl font-bold tabular-nums text-text-primary">{total}</p>
    <p className="text-[10px] text-text-quaternary">bookable slots</p>
    <div className="mt-3 space-y-2">
      {SLOTS.slice(0, 4).map((slot) => {
        const available = count(slot);
        const held = heldFor(available, rule);
        const net = available - held;
        const width = `${Math.min(100, available * 12.5)}%`;
        const heldWidth = available ? `${(held / available) * 100}%` : '0%';
        return (
          <div key={slot} className="flex items-center gap-2">
            <span className="w-7 text-[9px] text-text-quaternary">{slot.toUpperCase()}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-tertiary">
              <div className="relative h-full rounded-full bg-tag-green-text" style={{ width }}>
                <span
                  className="absolute right-0 top-0 h-full bg-tag-amber-text/70"
                  style={{ width: heldWidth }}
                />
              </div>
            </div>
            <span className="w-4 text-right text-[10px] font-semibold tabular-nums text-text-secondary">
              {net}
            </span>
          </div>
        );
      })}
    </div>
  </article>
);

interface CellProps {
  profile: Profile;
  day: string;
  slot: string;
  item?: Resolved;
  exception?: Exception;
  pending: boolean;
  editable: boolean;
  onCycle: () => void;
}
const Cell: React.FC<CellProps> = ({
  profile,
  day,
  slot,
  item,
  exception,
  pending,
  editable,
  onCycle,
}) => {
  const meeting = item?.source === 'meeting';
  const available = exception?.available ?? item?.available ?? false;
  const stateClass = meeting
    ? `${HATCHED} border-border-secondary text-text-tertiary`
    : exception?.available === false
      ? 'border-tag-amber-border bg-tag-amber-bg text-tag-amber-text'
      : exception?.available === true
        ? 'border-tag-blue-border bg-tag-blue-bg text-tag-blue-text'
        : available
          ? 'border-tag-green-border bg-tag-green-bg text-tag-green-text'
          : 'border-border-secondary bg-bg-tertiary text-text-quaternary';
  const label = `${profile.display_name}, ${displayDate(day)}, ${SLOT_LABELS[slot] || slot}, ${available ? 'available' : 'off'}, ${sourceLabel(item)}`;
  return (
    <button
      type="button"
      disabled={!editable || meeting}
      onClick={onCycle}
      className={`${FOCUS} m-0.5 h-6 rounded border text-[10px] font-bold ${stateClass} ${pending ? 'ring-2 ring-tag-amber-border ring-offset-1 ring-offset-bg-primary' : ''} hover:brightness-110`}
      aria-label={label}
      title={`${label}${exception?.note ? `\n${exception.note}` : ''}${exception?.created_by ? ` · set by ${exception.created_by}` : ''}`}
    >
      {meeting
        ? 'M'
        : exception?.available === false
          ? '×'
          : exception?.available === true
            ? '+'
            : available
              ? '•'
              : ''}
    </button>
  );
};

interface BoardProps {
  days: string[];
  profiles: Profile[];
  resolved: Map<string, Resolved>;
  exceptions: Map<string, Exception>;
  requests: AvailabilityData['requests'];
  showNonSelling: boolean;
  editable: boolean;
  onRep: (profile: Profile) => void;
  onCycle: (profile: Profile, day: string, slot: string) => void;
  onToggleNonSelling: () => void;
}
const Board: React.FC<BoardProps> = ({
  days,
  profiles,
  resolved,
  exceptions,
  requests,
  showNonSelling,
  editable,
  onRep,
  onCycle,
  onToggleNonSelling,
}) => {
  const groups = showNonSelling ? [...SELLING_SECTIONS, 'MANAGEMENT', 'D2D'] : SELLING_SECTIONS;
  return (
    <section className="overflow-hidden rounded-lg border border-border-secondary bg-bg-primary">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-secondary px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-text-primary">Rep coverage board</h2>
          <p className="text-[11px] text-text-tertiary">
            Click a cell to cycle its dated exception. Select a rep for pattern details.
          </p>
        </div>
        <button
          type="button"
          onClick={onToggleNonSelling}
          className={`${FOCUS} rounded-md border border-border-secondary bg-bg-secondary px-3 py-1.5 text-[11px] font-semibold text-text-secondary`}
        >
          {showNonSelling ? 'Hide non-selling' : 'Show non-selling'}{' '}
          <span className="ml-1">{showNonSelling ? '−' : '+'}</span>
        </button>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[1050px]">
          <div className="grid grid-cols-[190px_repeat(28,minmax(28px,1fr))] border-b border-border-secondary bg-bg-secondary text-center">
            <div className="sticky left-0 z-10 bg-bg-secondary px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-text-quaternary">
              Rep / slot
            </div>
            {days.map((day, index) => (
              <div
                key={day}
                className={`col-span-4 border-l border-border-secondary px-1 py-2 ${day === today ? 'text-brand-primary' : 'text-text-tertiary'}`}
              >
                <div className="text-[10px] font-bold uppercase">{WEEKDAYS[index]}</div>
                <div className="text-[10px] tabular-nums">{displayDate(day)}</div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-[190px_repeat(28,minmax(28px,1fr))] border-b border-border-secondary bg-bg-secondary/60 text-center">
            <div className="sticky left-0 z-10 bg-bg-secondary/60" />
            {days.flatMap((day) =>
              SLOTS.slice(0, 4).map((slot) => (
                <div
                  key={`${day}-${slot}`}
                  className="border-l border-border-secondary/60 py-1 text-[8px] font-bold text-text-quaternary"
                >
                  {slot.slice(1)}
                </div>
              )),
            )}
          </div>
          {groups.map((group) => {
            const reps = profiles.filter((profile) => profile.section === group);
            if (!reps.length) return null;
            return (
              <React.Fragment key={group}>
                <div className="border-y border-border-secondary bg-bg-secondary px-4 py-1.5 text-[9px] font-bold uppercase tracking-[.18em] text-text-quaternary">
                  {group === 'PHX' ? 'Phoenix' : group === 'SOUTH' ? 'South / Tucson' : group}
                </div>
                {reps.map((profile) => (
                  <div
                    key={profile.id}
                    className="grid grid-cols-[190px_repeat(28,minmax(28px,1fr))] border-b border-border-secondary/70"
                  >
                    <button
                      type="button"
                      onClick={() => onRep(profile)}
                      className={`${FOCUS} sticky left-0 z-10 flex min-w-0 items-center gap-2 bg-bg-primary px-4 py-2 text-left hover:bg-bg-tertiary`}
                    >
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-bg-light text-[9px] font-bold text-brand-text-light">
                        {initials(profile.display_name)}
                      </span>
                      <span className="truncate text-[11px] font-semibold text-text-secondary">
                        {profile.display_name}
                      </span>
                    </button>
                    {days.flatMap((day) =>
                      SLOTS.slice(0, 4).map((slot) => {
                        const key = `${profile.id}:${day}:${slot}`;
                        const item = resolved.get(key);
                        const exception = exceptions.get(key);
                        const pending = requests.some(
                          (request) =>
                            request.rep_id === profile.id &&
                            request.status === 'pending' &&
                            (request.request_date === day || request.dates?.includes(day)),
                        );
                        return (
                          <Cell
                            key={key}
                            profile={profile}
                            day={day}
                            slot={slot}
                            item={item}
                            exception={exception}
                            pending={pending}
                            editable={editable}
                            onCycle={() => onCycle(profile, day, slot)}
                          />
                        );
                      }),
                    )}
                  </div>
                ))}
              </React.Fragment>
            );
          })}
        </div>
      </div>
      <Legend />
    </section>
  );
};

const Legend: React.FC = () => (
  <div className="flex flex-wrap items-center gap-4 border-t border-border-secondary px-4 py-3 text-[10px] text-text-tertiary">
    <span className="font-semibold text-text-secondary">Legend</span>
    <span className="flex items-center gap-1">
      <i className="h-3 w-3 rounded border border-tag-green-border bg-tag-green-bg" />
      Available
    </span>
    <span className="flex items-center gap-1">
      <i className={`h-3 w-3 rounded border border-border-secondary ${HATCHED}`} />
      Meeting
    </span>
    <span className="flex items-center gap-1">
      <i className="h-3 w-3 rounded border border-tag-amber-border bg-tag-amber-bg" />
      Time off ×
    </span>
    <span className="flex items-center gap-1">
      <i className="h-3 w-3 rounded border border-tag-blue-border bg-tag-blue-bg" />
      Added coverage +
    </span>
    <span className="text-text-quaternary">Amber ring = pending request</span>
  </div>
);

interface AddRepFormProps {
  onCancel: () => void;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
}
const AddRepForm: React.FC<AddRepFormProps> = ({ onCancel, onSave }) => {
  const [form, setForm] = useState({
    display_name: '',
    section: 'PHX',
    email: '',
    roofr_user_id: '',
  });
  const [saving, setSaving] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.display_name.trim()) return;
    setSaving(true);
    try {
      await onSave({ action: 'upsert_rep', ...form, active: true });
    } finally {
      setSaving(false);
    }
  };
  return (
    <form
      onSubmit={submit}
      className="grid gap-2 rounded-lg border border-border-secondary bg-bg-primary p-4 sm:grid-cols-2"
    >
      <h3 className="text-sm font-semibold text-text-primary sm:col-span-2">Add rep</h3>
      {(
        [
          ['display_name', 'Name'],
          ['email', 'Email'],
          ['roofr_user_id', 'Roofr ID'],
        ] as const
      ).map(([field, label]) => (
        <label key={field} className="text-[10px] text-text-tertiary">
          {label}
          <input
            required={field === 'display_name'}
            value={form[field]}
            onChange={(event) => setForm({ ...form, [field]: event.target.value })}
            className="mt-1 w-full rounded border border-border-secondary bg-bg-secondary px-2 py-2 text-xs text-text-primary"
          />
        </label>
      ))}
      <label className="text-[10px] text-text-tertiary">
        Section
        <select
          value={form.section}
          onChange={(event) => setForm({ ...form, section: event.target.value })}
          className="mt-1 w-full rounded border border-border-secondary bg-bg-secondary px-2 py-2 text-xs text-text-primary"
        >
          {SELLING_SECTIONS.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </label>
      <div className="flex items-end justify-end gap-2 sm:col-span-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-3 py-2 text-xs text-text-tertiary"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-brand-primary px-3 py-2 text-xs font-semibold text-brand-text-on-primary disabled:opacity-50"
        >
          {saving ? 'Adding…' : 'Add rep'}
        </button>
      </div>
    </form>
  );
};

const AvailabilityPage: React.FC = () => {
  const { showToast } = useAppContext();
  const [monday, setMonday] = useState(dateKey(mondayOf(new Date())));
  const [data, setData] = useState<AvailabilityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [section, setSection] = useState('PHX');
  const [showNonSelling, setShowNonSelling] = useState(false);
  const [drawer, setDrawer] = useState<Profile | null>(null);
  const [adding, setAdding] = useState(false);
  const [undo, setUndo] = useState<{ label: string; run: () => Promise<void> } | null>(null);
  const days = useMemo(() => weekDays(monday), [monday]);
  const policy = data?.policy[monday] || {
    template_kind: 'standard',
    sales_meeting_mon: true,
    company_meeting_fri: true,
  };
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await loadAvailability(monday, addWeeks(monday, 2)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load availability.');
    } finally {
      setLoading(false);
    }
  }, [monday]);
  useEffect(() => {
    void fetchData();
  }, [fetchData]);
  const maps = useMemo(() => {
    const resolved = new Map<string, Resolved>();
    const exceptions = new Map<string, Exception>();
    data?.resolved.forEach((item) =>
      resolved.set(`${item.rep_id}:${item.work_date}:${item.slot}`, item),
    );
    data?.exceptions.forEach((item) =>
      exceptions.set(`${item.rep_id}:${item.exception_date}:${item.slot}`, item),
    );
    return { resolved, exceptions };
  }, [data]);
  const visibleProfiles = useMemo(
    () =>
      (data?.profiles || [])
        .filter(
          (profile) => showNonSelling || SELLING_SECTIONS.includes(profile.section as Section),
        )
        .filter(
          (profile) =>
            section === 'All' ||
            profile.section === section ||
            (section === 'Commercial' && profile.section === 'COMMERCIAL'),
        ),
    [data, section, showNonSelling],
  );
  const runWrite = async (payload: Record<string, unknown>, success: string, after = true) => {
    await saveAvailability(payload);
    if (after) await fetchData();
    showToast(success, 'success');
  };
  const cycleCell = async (profile: Profile, day: string, slot: string) => {
    if (!data?.me.is_manager) return;
    const key = `${profile.id}:${day}:${slot}`;
    const current = maps.exceptions.get(key);
    const baseAvailable = maps.resolved.get(key)?.available ?? false;
    const next = current ? null : !baseAvailable;
    const previous = current?.available ?? null;
    setData((old) =>
      old
        ? {
            ...old,
            exceptions:
              next === null
                ? old.exceptions.filter(
                    (item) =>
                      item.rep_id !== profile.id ||
                      item.exception_date !== day ||
                      item.slot !== slot,
                  )
                : [
                    ...old.exceptions.filter(
                      (item) =>
                        item.rep_id !== profile.id ||
                        item.exception_date !== day ||
                        item.slot !== slot,
                    ),
                    {
                      id: `optimistic-${key}`,
                      rep_id: profile.id,
                      exception_date: day,
                      slot,
                      available: next,
                      note: 'Manager board edit',
                    },
                  ],
          }
        : old,
    );
    try {
      await runWrite(
        {
          action: 'set_exception',
          rep_id: profile.id,
          date: day,
          slot,
          available: next,
          note: next === null ? undefined : 'Manager board edit',
        },
        `${profile.display_name} ${next === null ? 'reverted to pattern' : next ? 'given added coverage' : 'marked off'}`,
        false,
      );
      setUndo({
        label: 'Undo',
        run: async () => {
          await runWrite(
            { action: 'set_exception', rep_id: profile.id, date: day, slot, available: previous },
            'Change undone',
          );
          setUndo(null);
        },
      });
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save exception', 'error');
      await fetchData();
    }
  };
  if (loading && !data)
    return (
      <div className="flex h-full items-center justify-center">
        <div className="w-full max-w-xl rounded-lg border border-border-secondary bg-bg-primary p-8 text-center">
          <div className="mx-auto h-3 w-32 animate-pulse rounded bg-bg-tertiary" />
          <p className="mt-3 text-sm text-text-tertiary">Loading the live availability board…</p>
        </div>
      </div>
    );
  if (error && !data)
    return (
      <div className="flex h-full items-center justify-center">
        <div className="max-w-md rounded-lg border border-tag-red-border bg-tag-red-bg p-6 text-center">
          <p className="text-sm font-semibold text-tag-red-text">Availability is unavailable</p>
          <p className="mt-2 text-xs text-text-secondary">{error}</p>
          <button
            type="button"
            onClick={() => void fetchData()}
            className="mt-4 rounded-md bg-brand-primary px-4 py-2 text-xs font-semibold text-brand-text-on-primary"
          >
            Try again
          </button>
        </div>
      </div>
    );
  return (
    <main className="h-full min-h-0 overflow-y-auto bg-bg-secondary px-4 py-5 lg:px-6">
      <div className="mx-auto max-w-[1600px] space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[.2em] text-brand-primary">
              Live capacity / manager view
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-text-primary">
              Availability
            </h1>
            <p className="mt-1 text-xs text-text-tertiary">
              See the week’s bookable coverage before the first appointment lands.
            </p>
          </div>
          <WeekNav
            monday={monday}
            days={days}
            onMove={(amount) => setMonday(addWeeks(monday, amount))}
            onToday={() => setMonday(dateKey(mondayOf(new Date())))}
            onDate={(date) => setMonday(dateKey(mondayOf(new Date(`${date}T12:00:00`))))}
          />
        </header>
        <PolicyChips
          policy={policy}
          editable={Boolean(data?.me.is_manager)}
          onChange={(field, value) =>
            void runWrite(
              { action: 'set_week_policy', monday, [field]: value },
              'Week policy updated',
            )
          }
        />
        {data && (
          <CapacityStrip
            days={days}
            section={section}
            profiles={data.profiles}
            resolved={maps.resolved}
            rule={data.hold_rule}
            editable={data.me.is_manager}
            onSection={setSection}
            onSaveRule={async (rule) => {
              await runWrite({ action: 'set_hold_rule', ...rule }, 'Hold rule updated');
            }}
          />
        )}
        {data && (
          <Board
            days={days}
            profiles={visibleProfiles}
            resolved={maps.resolved}
            exceptions={maps.exceptions}
            requests={data.requests}
            showNonSelling={showNonSelling}
            editable={data.me.is_manager}
            onRep={setDrawer}
            onCycle={(profile, day, slot) => void cycleCell(profile, day, slot)}
            onToggleNonSelling={() => setShowNonSelling((value) => !value)}
          />
        )}
        {data?.me.is_manager &&
          (adding ? (
            <AddRepForm
              onCancel={() => setAdding(false)}
              onSave={async (payload) => {
                await runWrite(payload, 'Rep added');
                setAdding(false);
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className={`${FOCUS} rounded-md border border-border-secondary bg-bg-primary px-3 py-2 text-xs font-semibold text-text-secondary`}
            >
              + Add rep
            </button>
          ))}
        {undo && (
          <div className="fixed bottom-5 right-5 z-50 flex items-center gap-3 rounded-lg border border-border-secondary bg-bg-primary px-4 py-3 text-xs text-text-secondary shadow-xl">
            <span>{undo.label}</span>
            <button
              type="button"
              onClick={() => void undo.run()}
              className="font-bold text-brand-primary"
            >
              Undo
            </button>
          </div>
        )}
        {drawer && data && (
          <AvailabilityRepDrawer
            profile={drawer}
            exceptions={data.exceptions.filter((item) => item.rep_id === drawer.id)}
            pattern={data.patterns.find((item) => item.rep_id === drawer.id)}
            isManager={data.me.is_manager}
            onClose={() => setDrawer(null)}
            onSaved={() => void fetchData()}
          />
        )}
      </div>
    </main>
  );
};

export default AvailabilityPage;
