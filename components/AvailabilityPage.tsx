import React, { useCallback, useEffect, useMemo, useState } from 'react';
import AvailabilityRepDrawer from './AvailabilityRepDrawer';
import { HoldRuleChip } from './AvailabilityHoldRule';
import {
  AvailabilityData,
  Exception,
  Holiday,
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
  SLOT_START,
  SLOT_START_FULL,
  WEEKDAYS,
  addWeeks,
  dateKey,
  displayDate,
  heldFor,
  mondayOf,
  netBookable,
  weekDays,
} from '../utils/availability';
import { getHolidayTheme, HOLIDAY_GLYPH } from '../utils/holidayThemes';
import { useAppContext } from '../context/AppContext';

const SELLING_SECTIONS: Section[] = ['PHX', 'NORTH', 'SOUTH', 'COMMERCIAL', 'INSURANCE'];
const HATCHED =
  'bg-[repeating-linear-gradient(135deg,rgb(var(--border-secondary)/.28)_0px,rgb(var(--border-secondary)/.28)_3px,transparent_3px,transparent_6px)]';
const FOCUS =
  'transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary';
const today = dateKey(new Date());
type AvailabilityFilters = {
  section: 'All' | Section;
  hasException: boolean;
  pendingRequest: boolean;
  noAvailability: boolean;
  search: string;
};
const DEFAULT_FILTERS: AvailabilityFilters = {
  section: 'All',
  hasException: false,
  pendingRequest: false,
  noAvailability: false,
  search: '',
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2);
const sourceLabel = (item?: Resolved) => {
  if (item?.source === 'meeting') return 'Meeting';
  if (item?.source === 'holiday') return 'Company holiday';
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
  holidays: AvailabilityData['holidays'];
  editable: boolean;
  onChange: (field: string, value: boolean | string) => void;
}
const PolicyChips: React.FC<PolicyChipsProps> = ({ policy, holidays, editable, onChange }) => (
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
    {holidays.map((holiday) => (
      <span
        key={holiday.date}
        className="rounded-full border px-3 py-1.5 text-[11px] font-semibold"
        style={(() => {
          const theme = getHolidayTheme(holiday.name);
          return { backgroundColor: theme.bg, borderColor: theme.border, color: theme.text };
        })()}
      >
        {new Date(`${holiday.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' })} ·{' '}
        {holiday.name}
      </span>
    ))}
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
  exceptions: Map<string, Exception>;
  rule: AvailabilityData['hold_rule'];
  editable: boolean;
  onSection: (section: string) => void;
  onSaveRule: (rule: AvailabilityData['hold_rule']) => Promise<void>;
  sundayCollapsed: boolean;
  holidays: Map<string, Holiday>;
}
interface CapacityBreakdown {
  standing: number;
  exception: number;
  meeting: number;
  holiday: number;
  added: number;
  available: number;
}
const CapacityStrip: React.FC<CapacityStripProps> = ({
  days,
  section,
  profiles,
  resolved,
  exceptions,
  rule,
  editable,
  onSection,
  onSaveRule,
  sundayCollapsed,
  holidays,
}) => {
  const inSection = (profile: Profile) =>
    section === 'All' ||
    profile.section === section ||
    (section === 'Commercial' && profile.section === 'COMMERCIAL') ||
    (section === 'Insurance' && profile.section === 'INSURANCE');
  const breakdown = (day: string, slot: string): CapacityBreakdown =>
    profiles.reduce(
      (result, rep) => {
        if (!inSection(rep)) return result;
        const key = `${rep.id}:${day}:${slot}`;
        const item = resolved.get(key);
        const exception = exceptions.get(key);
        const available = exception?.available ?? item?.available ?? false;
        if (exception?.available === true) result.added += 1;
        else if (exception?.available === false) result.exception += 1;
        else if (item?.source === 'meeting') result.meeting += 1;
        else if (item?.source === 'holiday') result.holiday += 1;
        else if (available) result.standing += 1;
        result.available += available ? 1 : 0;
        return result;
      },
      { standing: 0, exception: 0, meeting: 0, holiday: 0, added: 0, available: 0 },
    );
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
            <option>Insurance</option>
            <option>All</option>
          </select>
        </div>
      </div>
      <div
        className={`grid grid-cols-2 gap-2 md:grid-cols-4 ${sundayCollapsed ? 'lg:grid-cols-[repeat(6,minmax(0,1fr))_28px]' : 'lg:grid-cols-7'}`}
      >
        {days.map((day, index) => {
          const total = SLOTS.slice(0, 4).reduce(
            (sum, slot) => sum + netBookable(breakdown(day, slot).available, rule),
            0,
          );
          if (sundayCollapsed && index === 6) {
            return (
              <article
                key={day}
                className="flex min-h-[142px] min-w-[28px] flex-col items-center justify-center rounded-lg border border-border-secondary bg-bg-tertiary px-1 text-center opacity-60"
                aria-label="Sunday compact stub"
              >
                <span className="text-[11px] font-bold uppercase text-text-tertiary">Sun</span>
                <span className="mt-1 text-[10px] text-text-quaternary">No coverage</span>
              </article>
            );
          }
          return (
            <DayCard
              key={day}
              day={day}
              index={index}
              total={total}
              rule={rule}
              breakdown={(slot) => breakdown(day, slot)}
              holiday={holidays.get(day)}
            />
          );
        })}
      </div>
    </section>
  );
};

// A slot blocked for everyone by a meeting or holiday is not "low coverage"; it is closed.
const isLowCoverage = (d: CapacityBreakdown, rule: AvailabilityData['hold_rule']) =>
  !(d.available === 0 && (d.meeting > 0 || d.holiday > 0)) &&
  netBookable(d.available, rule) < rule.warn_below;

interface DayCardProps {
  day: string;
  index: number;
  total: number;
  rule: AvailabilityData['hold_rule'];
  breakdown: (slot: string) => CapacityBreakdown;
  holiday?: Holiday;
}
const DayCard: React.FC<DayCardProps> = ({ day, index, total, rule, breakdown, holiday }) => {
  const theme = getHolidayTheme(holiday?.name);
  return (
    <article
      tabIndex={0}
      className={`group relative rounded-lg border bg-bg-primary p-3 ${day === today ? 'border-brand-primary ring-2 ring-brand-primary/20' : 'border-border-secondary'} ${index === 6 ? 'opacity-60' : ''}`}
    >
      {holiday && (
        <div
          className="absolute inset-x-0 top-0 h-1 rounded-t-lg"
          style={{ backgroundColor: theme.stripe }}
        />
      )}
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
      {holiday && (
        <span
          className="mt-2 inline-flex max-w-full truncate rounded border px-1.5 py-0.5 text-[9px] font-semibold"
          style={{ backgroundColor: theme.bg, borderColor: theme.border, color: theme.text }}
          title={holiday.name}
        >
          {holiday.name}
        </span>
      )}
      <p className="mt-3 text-2xl font-bold tabular-nums text-text-primary">{total}</p>
      <p className="text-[10px] text-text-quaternary">bookable slots</p>
      {SLOTS.slice(0, 4).some((slot) => isLowCoverage(breakdown(slot), rule)) && (
        <span className="mt-1 inline-flex rounded-full border border-tag-red-border bg-tag-red-bg px-1.5 py-0.5 text-[9px] font-semibold text-tag-red-text">
          Low coverage
        </span>
      )}
      <div className="mt-3 space-y-2">
        {SLOTS.slice(0, 4).map((slot) => {
          const details = breakdown(slot);
          const available = details.available;
          const held = heldFor(available, rule);
          const net = available - held;
          const low = isLowCoverage(details, rule);
          const width = `${Math.min(100, available * 12.5)}%`;
          const heldWidth = available ? `${(held / available) * 100}%` : '0%';
          return (
            <div key={slot} className="flex items-center gap-2">
              <span className="w-7 text-[11px] text-text-quaternary">{slot.toUpperCase()}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-tertiary">
                <div
                  className={`relative h-full rounded-full ${low ? 'bg-tag-red-text' : 'bg-tag-green-text'}`}
                  style={{ width }}
                >
                  <span
                    className="absolute right-0 top-0 h-full bg-tag-amber-text/70"
                    style={{ width: heldWidth }}
                  />
                </div>
              </div>
              <span
                className={`w-4 text-right text-xs font-semibold tabular-nums ${low ? 'text-tag-red-text' : 'text-text-secondary'}`}
              >
                {net}
              </span>
            </div>
          );
        })}
      </div>
      <div className="pointer-events-none invisible absolute left-2 right-2 top-full z-20 mt-2 rounded-md border border-border-secondary bg-bg-primary p-3 text-[10px] shadow-xl group-hover:visible group-focus-within:visible">
        <p className="mb-2 font-semibold text-text-primary">Capacity breakdown</p>
        <table className="w-full tabular-nums">
          <thead>
            <tr className="text-left text-text-quaternary">
              <th>Slot</th>
              <th>Standing</th>
              <th>− Off</th>
              <th>− Meeting</th>
              <th>− Holiday</th>
              <th>+ Added</th>
              <th>− Hold</th>
              <th>= Bookable</th>
            </tr>
          </thead>
          <tbody>
            {SLOTS.slice(0, 4).map((slot) => {
              const d = breakdown(slot);
              const hold = heldFor(d.available, rule);
              return (
                <tr key={slot} className="border-t border-border-secondary text-text-secondary">
                  <td className="py-1 pr-1">{slot.toUpperCase()}</td>
                  <td>{d.standing}</td>
                  <td>{d.exception}</td>
                  <td>{d.meeting}</td>
                  <td>{d.holiday}</td>
                  <td>{d.added}</td>
                  <td>{hold}</td>
                  <td className="font-semibold">{d.available - hold}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-border-secondary font-semibold text-text-primary">
              <td className="pt-1">Total</td>
              <td colSpan={6} />
              <td>{total}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </article>
  );
};

interface CellProps {
  profile: Profile;
  day: string;
  slot: string;
  item?: Resolved;
  exception?: Exception;
  pending: boolean;
  editable: boolean;
  onCycle: () => void;
  className?: string;
  holidayInfo?: Holiday;
  layout?: 'wide' | 'stacked';
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
  className: rowClassName = '',
  holidayInfo,
  layout = 'wide',
}) => {
  // Meeting and holiday overlays win visually unless a manager added the rep back.
  const meeting = item?.source === 'meeting' && exception?.available !== true;
  const holiday =
    item?.source === 'holiday' && exception?.source !== undefined && exception?.available === true
      ? false
      : item?.source === 'holiday' && exception?.available !== true;
  const available = exception?.available ?? item?.available ?? false;
  const stateClass = meeting
    ? 'border-text-primary bg-text-primary text-bg-primary' // solid ink block, like the sheet
    : holiday
      ? `${HATCHED} border-border-secondary text-text-tertiary`
      : exception?.available === false
        ? 'border-tag-amber-border bg-tag-amber-bg text-tag-amber-text'
        : exception?.available === true
          ? 'border-tag-blue-border bg-tag-blue-bg text-tag-blue-text'
          : available
            ? 'border border-tag-green-text/60 bg-tag-green-text/30 text-tag-green-text'
            : 'border-border-secondary bg-bg-tertiary text-text-quaternary';
  const label = `${profile.display_name}, ${displayDate(day)}, ${SLOT_LABELS[slot] || slot}, ${available ? 'available' : 'off'}, ${sourceLabel(item)}`;
  // Every cell shows its start time; state is carried by fill, border and text style.
  const start = (layout === 'stacked' ? SLOT_START_FULL : SLOT_START)[slot] || '';
  const contents = meeting ? (
    'M'
  ) : holiday ? (
    'H'
  ) : exception?.available === false ? (
    <span className="line-through decoration-2">{start}</span>
  ) : exception?.available === true ? (
    <span className="underline decoration-2 underline-offset-2">{start}</span>
  ) : (
    start
  );
  const cellClass = `${layout === 'stacked' ? 'mx-0.5 my-px flex h-[22px] w-[calc(100%-4px)] justify-start px-2 text-left text-[10px]' : 'm-0.5 flex h-6 justify-center'} items-center rounded border font-bold tabular-nums ${stateClass} ${pending ? 'ring-2 ring-tag-amber-border ring-offset-1 ring-offset-bg-primary' : ''} ${editable ? 'hover:brightness-110' : ''} ${rowClassName}`;
  const holidayStyle =
    holiday && holidayInfo
      ? (() => {
          const theme = getHolidayTheme(holidayInfo.name);
          return { backgroundColor: theme.bg, borderColor: theme.border, color: theme.text };
        })()
      : undefined;
  const title = `${label}${exception?.note ? `\n${exception.note}` : ''}${exception?.created_by ? ` · set by ${exception.created_by}` : ''}`;
  if (editable && !meeting) {
    return (
      <button
        type="button"
        onClick={onCycle}
        className={`${FOCUS} ${cellClass}`}
        aria-label={label}
        title={title}
        style={holiday ? holidayStyle : undefined}
      >
        {holiday ? HOLIDAY_GLYPH : contents}
      </button>
    );
  }
  return (
    <div
      className={cellClass}
      aria-label={label}
      title={title}
      style={holiday ? holidayStyle : undefined}
    >
      {holiday ? HOLIDAY_GLYPH : contents}
    </div>
  );
};

const SundayStub: React.FC<{ stacked?: boolean }> = ({ stacked = false }) => (
  <div
    className={`${stacked ? 'm-0.5 h-[98px]' : 'm-0.5 h-6'} rounded border border-border-secondary bg-bg-tertiary opacity-60`}
    aria-label="Sunday has no availability"
  />
);

// Consecutive days where every slot is a time-off exception, with the reason (exception note).
interface OffRun {
  start: number;
  length: number;
  reason: string;
}
const offRuns = (
  profile: Profile,
  days: string[],
  resolved: Map<string, Resolved>,
  exceptions: Map<string, Exception>,
  holidays: Map<string, Holiday>,
): OffRun[] => {
  const runs: OffRun[] = [];
  let current: OffRun | null = null;
  days.forEach((day, index) => {
    const cells = SLOTS.slice(0, 4).map((slot) => exceptions.get(`${profile.id}:${day}:${slot}`));
    // Fully off = nothing resolves available that day AND at least one slot is a time-off exception.
    const nothingAvailable = SLOTS.slice(0, 4).every(
      (slot) => !resolved.get(`${profile.id}:${day}:${slot}`)?.available,
    );
    const allOff =
      !holidays.get(day) &&
      nothingAvailable &&
      cells.some((cell) => cell && cell.available === false);
    if (allOff) {
      const note = cells
        .map((cell) => (cell?.note || '').trim())
        .find((text) => text && !/^imported from/i.test(text));
      const reason = note || 'Time off';
      if (current && current.start + current.length === index && current.reason === reason) {
        current.length += 1;
      } else {
        current = { start: index, length: 1, reason };
        runs.push(current);
      }
    } else {
      current = null;
    }
  });
  return runs;
};

const isZeroAvailability = (
  profile: Profile,
  days: string[],
  resolved: Map<string, Resolved>,
  exceptions: Map<string, Exception>,
) =>
  !days.some((day) =>
    SLOTS.slice(0, 4).some((slot) => {
      const key = `${profile.id}:${day}:${slot}`;
      return Boolean(resolved.get(key)?.available) || exceptions.has(key);
    }),
  );
const exceptionsForProfile = (
  profile: Profile,
  days: string[],
  exceptions: Map<string, Exception>,
) =>
  days.some((day) =>
    SLOTS.slice(0, 4).some((slot) => exceptions.has(`${profile.id}:${day}:${slot}`)),
  );

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
  sundayCollapsed: boolean;
  editing: boolean;
  filters: AvailabilityFilters;
  onFilters: (filters: AvailabilityFilters) => void;
  holidays: Map<string, Holiday>;
  layout: 'wide' | 'stacked';
  onLayout: (layout: 'wide' | 'stacked') => void;
}
const FilterBar: React.FC<{
  filters: AvailabilityFilters;
  total: number;
  shown: number;
  onChange: (filters: AvailabilityFilters) => void;
}> = ({ filters, total, shown, onChange }) => {
  const set = (patch: Partial<AvailabilityFilters>) => onChange({ ...filters, ...patch });
  const clear = () => onChange(DEFAULT_FILTERS);
  const active =
    filters.hasException ||
    filters.pendingRequest ||
    filters.noAvailability ||
    filters.search ||
    filters.section !== 'All';
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border-secondary bg-bg-secondary/40 px-4 py-2.5">
      <span className="text-[10px] font-bold uppercase tracking-wide text-text-tertiary">
        Filters
      </span>
      <select
        value={filters.section}
        onChange={(event) => set({ section: event.target.value as AvailabilityFilters['section'] })}
        aria-label="Filter by section"
        className="rounded border border-border-secondary bg-bg-primary px-2 py-1 text-[10px] text-text-secondary"
      >
        {['All', ...SELLING_SECTIONS].map((value) => (
          <option key={value}>{value}</option>
        ))}
      </select>
      {(
        [
          ['hasException', 'Has exception'],
          ['pendingRequest', 'Pending request'],
          ['noAvailability', 'No availability'],
        ] as const
      ).map(([field, label]) => (
        <button
          key={field}
          type="button"
          onClick={() => set({ [field]: !filters[field] })}
          className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${filters[field] ? 'border-brand-primary bg-brand-primary/10 text-brand-primary' : 'border-border-secondary bg-bg-primary text-text-tertiary'}`}
        >
          {label}
        </button>
      ))}
      <input
        value={filters.search}
        onChange={(event) => set({ search: event.target.value })}
        placeholder="Search reps"
        aria-label="Search reps"
        className="min-w-[130px] rounded border border-border-secondary bg-bg-primary px-2.5 py-1 text-[10px] text-text-secondary"
      />
      <span className="ml-auto text-[10px] tabular-nums text-text-tertiary">
        {shown} of {total} reps
      </span>
      {active && (
        <button
          type="button"
          onClick={clear}
          className="text-[10px] font-semibold text-brand-primary"
        >
          Clear all
        </button>
      )}
    </div>
  );
};
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
  sundayCollapsed,
  editing,
  filters,
  onFilters,
  holidays,
  layout,
  onLayout,
}) => {
  const groups = showNonSelling ? [...SELLING_SECTIONS, 'MANAGEMENT', 'D2D'] : SELLING_SECTIONS;
  const eligibleProfiles = profiles.filter(
    (profile) => showNonSelling || SELLING_SECTIONS.includes(profile.section as Section),
  );
  const filteredProfiles = eligibleProfiles.filter((profile) => {
    const matchesSection = filters.section === 'All' || profile.section === filters.section;
    const matchesSearch =
      !filters.search.trim() ||
      profile.display_name.toLowerCase().includes(filters.search.trim().toLowerCase());
    const hasException = exceptionsForProfile(profile, days, exceptions);
    const pending = requests.some(
      (request) => request.rep_id === profile.id && request.status === 'pending',
    );
    const noAvailability = isZeroAvailability(profile, days, resolved, exceptions);
    return (
      matchesSection &&
      matchesSearch &&
      (!filters.hasException || hasException) &&
      (!filters.pendingRequest || pending) &&
      (!filters.noAvailability || noAvailability)
    );
  });
  const dayColumns = sundayCollapsed ? 25 : 28;
  const gridTemplateColumns =
    layout === 'stacked'
      ? `190px repeat(6, minmax(64px, 1fr)) ${sundayCollapsed ? '40px' : 'minmax(64px, 1fr)'}`
      : `190px repeat(${dayColumns}, minmax(34px, 1fr))`;
  const gridStyle = { gridTemplateColumns };
  return (
    <section
      className={`overflow-clip rounded-lg border border-border-secondary bg-bg-primary ${editing ? 'border-t-2 border-t-brand-primary' : ''}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-secondary px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-text-primary">Rep coverage board</h2>
          <p className="text-[11px] text-text-tertiary">
            Cells show the slot's start time. Struck = time off, underlined = added coverage. Select
            a rep for pattern details.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div
            className="flex overflow-hidden rounded-md border border-border-secondary bg-bg-secondary p-0.5"
            aria-label="Board layout"
          >
            {(['stacked', 'wide'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => onLayout(option)}
                aria-pressed={layout === option}
                className={`${FOCUS} rounded px-2.5 py-1 text-[10px] font-semibold capitalize ${layout === option ? 'bg-bg-primary text-text-primary shadow-sm' : 'text-text-tertiary'}`}
              >
                {option}
              </button>
            ))}
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
      </div>
      <Legend />
      <FilterBar
        filters={filters}
        total={eligibleProfiles.length}
        shown={filteredProfiles.length}
        onChange={onFilters}
      />
      {/* Stacked fits the page, so no horizontal scroll wrapper — that lets the day header stick. */}
      <div className={layout === 'wide' ? 'overflow-x-auto' : ''}>
        <div className="min-w-[1050px]">
          <div
            className={`grid border-b border-border-secondary bg-bg-secondary text-center ${layout === 'stacked' ? 'sticky -top-5 z-20 shadow-sm' : ''}`}
            style={gridStyle}
          >
            <div className="sticky left-0 z-10 bg-bg-secondary px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-text-quaternary">
              Rep / slot
            </div>
            {days.map((day, index) => {
              // A holiday colors its whole column, starting with the header.
              const dayHoliday = holidays.get(day);
              const theme = dayHoliday ? getHolidayTheme(dayHoliday.name) : null;
              return (
                <div
                  key={day}
                  className={`${layout === 'wide' ? (sundayCollapsed && index === 6 ? 'col-span-1' : 'col-span-4') : ''} border-l border-border-secondary px-1 py-2 ${day === today ? 'text-brand-primary' : 'text-text-tertiary'}`}
                  style={
                    theme
                      ? {
                          backgroundColor: theme.bg,
                          boxShadow: `inset 0 3px 0 ${theme.stripe}`,
                          color: theme.text,
                        }
                      : undefined
                  }
                >
                  <div className="text-[10px] font-bold uppercase">
                    {sundayCollapsed && index === 6 ? 'Sun' : WEEKDAYS[index]}
                  </div>
                  <div className="text-[10px] tabular-nums">{displayDate(day)}</div>
                  {theme && !(sundayCollapsed && index === 6) && (
                    <div className="text-[10px] font-semibold">{dayHoliday!.name}</div>
                  )}
                </div>
              );
            })}
          </div>
          {layout === 'wide' && (
            <div
              className="grid border-b border-border-secondary bg-bg-secondary/60 text-center"
              style={gridStyle}
            >
              <div className="sticky left-0 z-10 bg-bg-secondary/60" />
              {days.flatMap((day, index) =>
                sundayCollapsed && index === 6
                  ? [
                      <div
                        key={`${day}-stub`}
                        className="border-l border-border-secondary/60 py-1 text-[8px] font-bold text-text-quaternary"
                      >
                        —
                      </div>,
                    ]
                  : SLOTS.slice(0, 4).map((slot) => (
                      <div
                        key={`${day}-${slot}`}
                        className="border-l border-border-secondary/60 py-1 text-[9px] font-bold text-text-quaternary"
                      >
                        {SLOT_START[slot]}
                      </div>
                    )),
              )}
            </div>
          )}
          {groups.map((group) => {
            const reps = filteredProfiles.filter((profile) => profile.section === group);
            if (!reps.length) return null;
            return (
              <React.Fragment key={group}>
                <div className="border-y border-border-secondary bg-bg-secondary px-4 py-1.5 text-[9px] font-bold uppercase tracking-[.18em] text-text-quaternary">
                  {group === 'PHX'
                    ? 'Phoenix'
                    : group === 'SOUTH'
                      ? 'South / Tucson'
                      : group === 'INSURANCE'
                        ? 'Insurance'
                        : group}
                </div>
                {reps.map((profile) => (
                  <div
                    key={profile.id}
                    className="relative grid border-b-2 border-border-primary"
                    style={gridStyle}
                  >
                    <button
                      type="button"
                      onClick={() => onRep(profile)}
                      className={`${FOCUS} sticky left-0 z-10 flex min-h-[98px] min-w-0 items-center gap-2 bg-bg-primary px-4 py-2 text-left hover:bg-bg-tertiary`}
                    >
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-bg-light text-[9px] font-bold text-brand-text-light">
                        {initials(profile.display_name)}
                      </span>
                      <span className="flex min-w-0 flex-col items-start gap-0.5">
                        <span
                          className={`truncate text-[11px] font-semibold ${profile.is_placeholder || isZeroAvailability(profile, days, resolved, exceptions) ? 'text-text-tertiary' : 'text-text-secondary'}`}
                        >
                          {profile.display_name}
                        </span>
                        {profile.is_placeholder ? (
                          <span className="shrink-0 rounded border border-tag-blue-border bg-tag-blue-bg px-1 py-0.5 text-[9px] text-tag-blue-text">
                            coverage slot
                          </span>
                        ) : isZeroAvailability(profile, days, resolved, exceptions) ? (
                          <span className="shrink-0 rounded border border-border-secondary bg-bg-secondary px-1 py-0.5 text-[9px] text-text-quaternary">
                            no availability
                          </span>
                        ) : null}
                      </span>
                    </button>
                    {days.flatMap((day, index) =>
                      sundayCollapsed && index === 6
                        ? [
                            <SundayStub
                              key={`${profile.id}-${day}-stub`}
                              stacked={layout === 'stacked'}
                            />,
                          ]
                        : layout === 'stacked'
                          ? [
                              <div
                                key={`${profile.id}-${day}`}
                                className="min-w-0 border-l border-border-secondary/70 py-0.5"
                                style={
                                  holidays.get(day)
                                    ? {
                                        backgroundColor: getHolidayTheme(holidays.get(day)!.name)
                                          .bg,
                                      }
                                    : undefined
                                }
                              >
                                {SLOTS.slice(0, 4).map((slot) => {
                                  const key = `${profile.id}:${day}:${slot}`;
                                  const item = resolved.get(key);
                                  const exception = exceptions.get(key);
                                  const pending = requests.some(
                                    (request) =>
                                      request.rep_id === profile.id &&
                                      request.status === 'pending' &&
                                      (request.request_date === day ||
                                        request.dates?.includes(day)),
                                  );
                                  return (
                                    <Cell
                                      key={key}
                                      layout="stacked"
                                      profile={profile}
                                      day={day}
                                      slot={slot}
                                      item={item}
                                      exception={exception}
                                      pending={pending}
                                      editable={editable}
                                      onCycle={() => onCycle(profile, day, slot)}
                                      holidayInfo={holidays.get(day)}
                                      className={
                                        profile.is_placeholder ||
                                        isZeroAvailability(profile, days, resolved, exceptions)
                                          ? 'opacity-60'
                                          : ''
                                      }
                                    />
                                  );
                                })}
                              </div>,
                            ]
                          : SLOTS.slice(0, 4).map((slot) => {
                              const key = `${profile.id}:${day}:${slot}`;
                              const item = resolved.get(key);
                              const exception = exceptions.get(key);
                              const pending = requests.some(
                                (request) =>
                                  request.rep_id === profile.id &&
                                  request.status === 'pending' &&
                                  (request.request_date === day || request.dates?.includes(day)),
                              );
                              const dayHoliday = holidays.get(day);
                              return (
                                <div
                                  key={key}
                                  style={
                                    dayHoliday
                                      ? { backgroundColor: getHolidayTheme(dayHoliday.name).bg }
                                      : undefined
                                  }
                                >
                                  <Cell
                                    profile={profile}
                                    day={day}
                                    slot={slot}
                                    item={item}
                                    exception={exception}
                                    pending={pending}
                                    editable={editable}
                                    onCycle={() => onCycle(profile, day, slot)}
                                    holidayInfo={holidays.get(day)}
                                    className={
                                      profile.is_placeholder ||
                                      isZeroAvailability(profile, days, resolved, exceptions)
                                        ? 'opacity-60'
                                        : ''
                                    }
                                  />
                                </div>
                              );
                            }),
                    )}
                    {offRuns(profile, days, resolved, exceptions, holidays)
                      .filter((run) => !(sundayCollapsed && run.start === 6))
                      .map((run) => {
                        // Absolute overlay across the run; geometry mirrors gridTemplateColumns.
                        const span =
                          sundayCollapsed && run.start + run.length > 6
                            ? 6 - run.start
                            : run.length;
                        const trailing = sundayCollapsed
                          ? layout === 'stacked'
                            ? '40px'
                            : '34px'
                          : '0px';
                        const units =
                          layout === 'stacked'
                            ? sundayCollapsed
                              ? 6
                              : 7
                            : sundayCollapsed
                              ? 24
                              : 28;
                        const perDay = layout === 'stacked' ? 1 : 4;
                        const unit = `((100% - 190px - ${trailing}) / ${units})`;
                        return (
                          <div
                            key={`${profile.id}-off-${run.start}`}
                            className="pointer-events-none absolute z-[5] flex items-center justify-center rounded-md border border-tag-amber-border bg-bg-primary/70 px-2 text-center text-[11px] font-semibold text-tag-amber-text backdrop-blur-[1px]"
                            style={{
                              top: 6,
                              bottom: 6,
                              left: `calc(190px + ${run.start * perDay} * ${unit} + 4px)`,
                              width: `calc(${span * perDay} * ${unit} - 8px)`,
                            }}
                            aria-hidden="true"
                          >
                            {run.reason}
                            {span > 1 ? ` · ${span} days` : ''}
                          </div>
                        );
                      })}
                  </div>
                ))}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </section>
  );
};

const Legend: React.FC = () => {
  const sample = 'flex h-6 w-8 items-center justify-center rounded border-2 text-[11px] font-bold';
  const label = 'text-[11px] font-semibold';
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-border-secondary bg-bg-secondary/40 px-4 py-2.5">
      <span className="text-[10px] font-bold uppercase tracking-wide text-text-tertiary">
        Legend
      </span>
      <span className="flex items-center gap-2">
        <i className={`${sample} border-tag-green-text bg-tag-green-text/30 text-tag-green-text`}>
          8a
        </i>
        <span className={`${label} text-tag-green-text`}>Available</span>
      </span>
      <span className="flex items-center gap-2">
        <i className={`${sample} border-text-quaternary bg-bg-tertiary text-text-quaternary`}>8a</i>
        <span className={`${label} text-text-tertiary`}>Off (standing pattern)</span>
      </span>
      <span className="flex items-center gap-2">
        <i className={`${sample} border-text-primary bg-text-primary text-bg-primary`}>M</i>
        <span className={`${label} text-text-secondary`}>Company meeting</span>
      </span>
      <span className="flex items-center gap-2">
        <i className={`${sample} border-text-tertiary text-text-tertiary ${HATCHED}`}>H</i>
        <span className={`${label} text-text-tertiary`}>Company holiday (colored per holiday)</span>
      </span>
      <span className="flex items-center gap-2">
        <i
          className={`${sample} border-tag-amber-text bg-tag-amber-bg text-tag-amber-text line-through decoration-2`}
        >
          8a
        </i>
        <span className={`${label} text-tag-amber-text`}>Time off</span>
      </span>
      <span className="flex items-center gap-2">
        <i
          className={`${sample} border-tag-blue-text bg-tag-blue-bg text-tag-blue-text underline decoration-2 underline-offset-2`}
        >
          8a
        </i>
        <span className={`${label} text-tag-blue-text`}>Added coverage</span>
      </span>
      <span className="flex items-center gap-2">
        <i
          className={`${sample} border-tag-green-text bg-tag-green-text/30 ring-2 ring-tag-amber-text ring-offset-1 ring-offset-bg-primary`}
        />
        <span className={`${label} text-tag-amber-text`}>Pending request</span>
      </span>
    </div>
  );
};

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
  const [filters, setFilters] = useState<AvailabilityFilters>(() => {
    try {
      return {
        ...DEFAULT_FILTERS,
        ...JSON.parse(window.localStorage.getItem('availability.filters') || '{}'),
      };
    } catch {
      return DEFAULT_FILTERS;
    }
  });
  const [undo, setUndo] = useState<{ label: string; run: () => Promise<void> } | null>(null);
  const [editMode, setEditMode] = useState(() => {
    try {
      return window.localStorage.getItem('availability.editMode') === 'true';
    } catch {
      return false;
    }
  });
  const [layout, setLayout] = useState<'wide' | 'stacked'>(() => {
    try {
      return window.localStorage.getItem('availability.layout') === 'wide' ? 'wide' : 'stacked';
    } catch {
      return 'stacked';
    }
  });
  const days = useMemo(() => weekDays(monday), [monday]);
  const policy = data?.policy[monday] || {
    template_kind: 'standard',
    sales_meeting_mon: true,
    company_meeting_fri: true,
  };
  const isManager = Boolean(data?.me.is_manager);
  const editable = isManager && editMode;
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
  useEffect(() => {
    if (!isManager) setEditMode(false);
    try {
      window.localStorage.setItem('availability.editMode', String(isManager && editMode));
    } catch {
      // Storage can be unavailable in private browsing; editing still works for this session.
    }
  }, [editMode, isManager]);
  useEffect(() => {
    try {
      window.localStorage.setItem('availability.filters', JSON.stringify(filters));
    } catch {
      /* optional persistence */
    }
  }, [filters]);
  useEffect(() => {
    try {
      window.localStorage.setItem('availability.layout', layout);
    } catch {
      // Layout persistence is optional when storage is unavailable.
    }
  }, [layout]);
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
  const holidays = useMemo(
    () => new Map((data?.holidays || []).map((holiday) => [holiday.date, holiday] as const)),
    [data?.holidays],
  );
  const sundayCollapsed = useMemo(
    () =>
      !(data?.profiles || []).some((profile) =>
        SLOTS.slice(0, 4).some((slot) => {
          const key = `${profile.id}:${days[6]}:${slot}`;
          return (
            Boolean(maps.resolved.get(key)?.available) ||
            maps.exceptions.get(key)?.available === true
          );
        }),
      ),
    [data, days, maps.resolved],
  );
  const visibleProfiles = useMemo(
    () =>
      (data?.profiles || [])
        // The board always shows every selling section; the section selector
        // only drives the capacity strip.
        .filter(
          (profile) => showNonSelling || SELLING_SECTIONS.includes(profile.section as Section),
        ),
    [data, showNonSelling],
  );
  const runWrite = async (payload: Record<string, unknown>, success: string, after = true) => {
    await saveAvailability(payload);
    if (after) await fetchData();
    showToast(success, 'success');
  };
  const cycleCell = async (profile: Profile, day: string, slot: string) => {
    if (!editable) return;
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
          {isManager && (
            <label className="flex items-center gap-2 rounded-md border border-border-secondary bg-bg-primary px-3 py-2 text-[11px] font-semibold text-text-secondary">
              <input
                type="checkbox"
                checked={editMode}
                onChange={(event) => setEditMode(event.target.checked)}
                className="accent-brand-primary"
              />
              Edit mode
            </label>
          )}
        </header>
        <PolicyChips
          policy={policy}
          holidays={(data?.holidays || []).filter((holiday) => days.includes(holiday.date))}
          editable={editable}
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
            exceptions={maps.exceptions}
            rule={data.hold_rule}
            editable={editable}
            sundayCollapsed={sundayCollapsed}
            onSection={setSection}
            holidays={holidays}
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
            editable={editable}
            onRep={setDrawer}
            onCycle={(profile, day, slot) => void cycleCell(profile, day, slot)}
            onToggleNonSelling={() => setShowNonSelling((value) => !value)}
            layout={layout}
            onLayout={setLayout}
            sundayCollapsed={sundayCollapsed}
            editing={editable}
            filters={filters}
            onFilters={setFilters}
            holidays={holidays}
          />
        )}
        {editable &&
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
            isManager={isManager}
            editable={editable}
            onClose={() => setDrawer(null)}
            onSaved={() => void fetchData()}
          />
        )}
      </div>
    </main>
  );
};

export default AvailabilityPage;
