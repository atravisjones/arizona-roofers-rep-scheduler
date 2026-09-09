import React, { useMemo, useState } from 'react';
import { Exception, Pattern, Profile, saveAvailability } from '../services/availabilityApi';
import { SLOT_LABELS, SLOTS, WEEKDAYS, dateKey, mondayOf, nextMonday } from '../utils/availability';

interface Props {
  profile: Profile;
  exceptions: Exception[];
  pattern?: Pattern;
  isManager: boolean;
  editable: boolean;
  onClose: () => void;
  onSaved: (effectiveFrom?: string) => void;
}
type PatternState = Record<number, Record<string, boolean>>;
const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
// Skills are flat columns on rep_profiles (0-3 grades plus a few flags).
const SKILL_FIELDS: Array<[string, string]> = [
  ['tile', 'Tile'],
  ['shingle', 'Shingle'],
  ['flat', 'Flat'],
  ['metal', 'Metal'],
  ['insurance', 'Insurance'],
  ['commercial', 'Commercial'],
  ['two_story_ladder', '2-story ladder'],
  ['spanish', 'Spanish'],
  ['veteran', 'Veteran'],
];
const skillLabels = (profile: Profile) =>
  SKILL_FIELDS.flatMap(([field, label]) => {
    const value = (profile as unknown as Record<string, unknown>)[field];
    if (value === true) return [label];
    if (typeof value === 'number' && value > 0) return [`${label} ${value}`];
    if (typeof value === 'string' && value.trim()) return [`${label}: ${value}`];
    return [];
  });
const patternDefaults = (pattern?: Pattern): PatternState =>
  Object.fromEntries(
    WEEKDAYS.map((_, weekday) => [
      weekday,
      Object.fromEntries(
        SLOTS.map((slot) => [
          slot,
          pattern?.slots.find((item) => item.weekday === weekday && item.slot === slot)
            ?.available ?? false,
        ]),
      ),
    ]),
  ) as PatternState;

const PatternEditor: React.FC<{
  pattern?: Pattern;
  repId: string;
  onSaved: (effectiveFrom?: string) => void;
  editable: boolean;
}> = ({ pattern, repId, onSaved, editable }) => {
  const [effectiveFrom, setEffectiveFrom] = useState(nextMonday());
  const [slots, setSlots] = useState(() => patternDefaults(pattern));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  // Grid orientation: horizontal = days across the top like the sheet (default); vertical = days down.
  const [orientation, setOrientation] = useState<'horizontal' | 'vertical'>(() => {
    try {
      return localStorage.getItem('availability.patternLayout') === 'vertical' ? 'vertical' : 'horizontal';
    } catch {
      return 'horizontal';
    }
  });
  const pickOrientation = (value: 'horizontal' | 'vertical') => {
    setOrientation(value);
    try {
      localStorage.setItem('availability.patternLayout', value);
    } catch {
      // storage unavailable; keep the in-memory choice
    }
  };
  const toggle = (weekday: number, slot: string) =>
    setSlots((current) => ({
      ...current,
      [weekday]: { ...current[weekday], [slot]: !current[weekday][slot] },
    }));
  const slotLabel = (slot: string) => (slot === 's5' ? 'Storm' : SLOT_LABELS[slot].split(' ')[0]);
  const cellClass = (available: boolean) =>
    `h-7 w-full rounded border text-[9px] font-bold disabled:cursor-default disabled:opacity-60 ${available ? 'border-tag-green-border bg-tag-green-bg text-tag-green-text' : 'border-border-secondary bg-bg-tertiary text-text-quaternary'}`;
  // Patterns start on a Monday; any picked date snaps to the Monday of its week.
  const pickDate = (value: string) => {
    if (!value) return;
    setEffectiveFrom(dateKey(mondayOf(new Date(`${value}T12:00:00`))));
  };
  const savePattern = async () => {
    setSaving(true);
    setStatus(null);
    try {
      await saveAvailability({
        action: 'set_pattern',
        rep_id: repId,
        effective_from: effectiveFrom,
        slots: Object.entries(slots).flatMap(([weekday, daySlots]) =>
          Object.entries(daySlots).map(([slot, available]) => ({
            weekday: Number(weekday),
            slot,
            available,
          })),
        ),
      });
      setStatus({ kind: 'ok', text: `Saved. Applies from ${effectiveFrom}.` });
      onSaved(effectiveFrom);
    } catch (error) {
      setStatus({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Pattern did not save',
      });
    } finally {
      setSaving(false);
    }
  };
  const copyDay = (targets: number[]) =>
    setSlots((current) => {
      const monday = current[0];
      return {
        ...current,
        ...Object.fromEntries(targets.map((weekday) => [weekday, { ...monday }])),
      };
    });
  const copyRowToAll = (weekday: number) =>
    setSlots((current) => {
      const row = current[weekday];
      return {
        ...current,
        ...Object.fromEntries(WEEKDAYS.map((_, target) => [target, { ...row }])),
      };
    });
  return (
    <section className="rounded-md border border-border-secondary bg-bg-secondary p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">Standing pattern</h3>
          <p className="text-[10px] text-text-tertiary">Set the weekly default from a Monday.</p>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex rounded border border-border-secondary bg-bg-primary p-0.5" role="group" aria-label="Pattern grid layout">
            {(['horizontal', 'vertical'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => pickOrientation(option)}
                aria-pressed={orientation === option}
                title={option === 'horizontal' ? 'Days across' : 'Days down'}
                className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${orientation === option ? 'bg-brand-primary text-brand-text-on-primary' : 'text-text-tertiary'}`}
              >
                {option === 'horizontal' ? '\u2194' : '\u2195'}
              </button>
            ))}
          </div>
          <input
            type="date"
            value={effectiveFrom}
            onChange={(event) => pickDate(event.target.value)}
            aria-label="Pattern effective date (snaps to Monday)"
            className="w-[126px] rounded border border-border-secondary bg-bg-primary px-2 py-1 text-[10px] text-text-secondary"
          />
        </div>
      </div>
      {!pattern && (
        <p className="mb-2 text-[10px] text-text-tertiary">
          No standing pattern yet - all slots start OFF (Mon and Fri 8am stay off for company meetings)
        </p>
      )}
      {orientation === 'horizontal' ? (
        <div className="space-y-1">
          <div className="grid grid-cols-[40px_repeat(7,minmax(0,1fr))] items-center gap-1 text-center text-[10px] font-bold text-text-tertiary">
            <span />
            {WEEKDAYS.map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          {SLOTS.map((slot) => (
            <div key={slot} className="grid grid-cols-[40px_repeat(7,minmax(0,1fr))] items-center gap-1">
              <span className="text-[10px] font-bold text-text-tertiary">{slotLabel(slot)}</span>
              {WEEKDAYS.map((day, weekday) => {
                const available = slots[weekday][slot];
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggle(weekday, slot)}
                    disabled={!editable}
                    className={cellClass(available)}
                    aria-label={`${day} ${SLOT_LABELS[slot]} ${available ? 'available' : 'off'}`}
                  >
                    {available ? 'ON' : 'OFF'}
                  </button>
                );
              })}
            </div>
          ))}
          {editable && (
            <div className="grid grid-cols-[40px_repeat(7,minmax(0,1fr))] items-center gap-1">
              <span className="text-[9px] text-text-quaternary">copy</span>
              {WEEKDAYS.map((day, weekday) => (
                <button
                  key={day}
                  type="button"
                  onClick={() => copyRowToAll(weekday)}
                  className="rounded py-0.5 text-[10px] text-text-tertiary hover:bg-bg-tertiary"
                  aria-label={`Copy ${day} to all days`}
                  title={`Copy ${day} to all days`}
                >
                  {'\u29c9'}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
      <div className="space-y-1.5">
        <div className="grid grid-cols-[28px_repeat(5,minmax(0,1fr))_28px] items-center gap-1 text-center text-[10px] font-bold text-text-tertiary">
          <span className="text-left">Day</span>
          {SLOTS.map((slot) => (
            <span key={slot}>{slotLabel(slot)}</span>
          ))}
          <span>copy</span>
        </div>
        {WEEKDAYS.map((day, weekday) => (
          <div key={day} className="grid grid-cols-[28px_repeat(5,minmax(0,1fr))_28px] items-center gap-1">
            <span className="w-7 text-[10px] font-bold text-text-tertiary">{day}</span>
            {SLOTS.map((slot) => {
              const available = slots[weekday][slot];
              return (
                <button
                  key={slot}
                  type="button"
                  onClick={() => toggle(weekday, slot)}
                  disabled={!editable}
                  className={cellClass(available)}
                  aria-label={`${day} ${SLOT_LABELS[slot]} ${available ? 'available' : 'off'}`}
                >
                  {available ? 'ON' : 'OFF'}
                </button>
              );
            })}
            {editable && (
              <button
                type="button"
                onClick={() => copyRowToAll(weekday)}
                className="rounded px-1.5 py-1 text-[10px] text-text-tertiary hover:bg-bg-tertiary"
                aria-label={`Copy ${day} to all weekdays`}
                title={`Copy ${day} to all weekdays`}
              >
                ⧉
              </button>
            )}
          </div>
        ))}
      </div>
      )}
      {editable && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => copyDay([1, 2, 3, 4])}
            className="rounded border border-border-secondary bg-bg-primary px-2 py-1.5 text-[10px] font-semibold text-text-secondary"
          >
            Copy Mon → Tue-Fri
          </button>
          <button
            type="button"
            onClick={() => copyDay([1, 2, 3, 4, 5])}
            className="rounded border border-border-secondary bg-bg-primary px-2 py-1.5 text-[10px] font-semibold text-text-secondary"
          >
            Copy Mon → Mon-Sat
          </button>
        </div>
      )}
      <button
        type="button"
        onClick={() => void savePattern()}
        disabled={saving || !editable}
        className="mt-3 w-full rounded-md bg-brand-primary px-3 py-2 text-xs font-semibold text-brand-text-on-primary disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save standing pattern'}
      </button>
      {status && (
        <p
          role={status.kind === 'error' ? 'alert' : 'status'}
          className={`mt-2 rounded border px-2 py-1.5 text-[11px] font-semibold ${status.kind === 'error' ? 'border-tag-red-border bg-tag-red-bg text-tag-red-text' : 'border-tag-green-border bg-tag-green-bg text-tag-green-text'}`}
        >
          {status.text}
        </p>
      )}
    </section>
  );
};

const AvailabilityRepDrawer: React.FC<Props> = ({
  profile,
  exceptions,
  pattern,
  isManager,
  editable,
  onClose,
  onSaved,
}) => {
  const [error, setError] = useState<string | null>(null);
  const history = useMemo(
    () =>
      [...exceptions].sort((a, b) =>
        `${b.exception_date}${b.slot}`.localeCompare(`${a.exception_date}${a.slot}`),
      ),
    [exceptions],
  );
  const deleteException = async (item: Exception) => {
    setError(null);
    try {
      await saveAvailability({
        action: 'set_exception',
        rep_id: profile.id,
        date: item.exception_date,
        slot: item.slot,
        available: null,
      });
      onSaved();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not revert to pattern');
    }
  };
  return (
    <>
      <button
        type="button"
        onClick={onClose}
        className="fixed inset-0 z-40 bg-bg-primary/50"
        aria-label="Close rep details"
      />
      <aside
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[390px] flex-col border-l border-border-primary bg-bg-primary shadow-2xl motion-safe:animate-[slide-in_200ms_ease-out]"
        aria-label={`${profile.display_name} availability details`}
      >
        <div className="flex items-start justify-between border-b border-border-secondary px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-full bg-brand-primary text-xs font-bold text-brand-text-on-primary">
              {initials(profile.display_name)}
            </div>
            <div>
              <h2 className="text-base font-bold text-text-primary">{profile.display_name}</h2>
              <p className="text-[11px] uppercase tracking-wider text-text-tertiary">
                {profile.section}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-xl text-text-tertiary hover:bg-bg-tertiary"
            aria-label="Close drawer"
          >
            ×
          </button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {error && (
            <p
              role="alert"
              className="mt-2 rounded border border-tag-red-border bg-tag-red-bg px-2 py-1.5 text-[11px] font-semibold text-tag-red-text"
            >
              {error}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3 text-[11px]">
            <div className="rounded-md bg-bg-secondary p-3">
              <span className="block text-text-quaternary">Home zip</span>
              <strong className="text-text-primary">{profile.home_zip || '-'}</strong>
            </div>
            <div className="rounded-md bg-bg-secondary p-3">
              <span className="block text-text-quaternary">Roofr ID</span>
              <strong className="text-text-primary">{profile.roofr_user_id || 'Not linked'}</strong>
            </div>
          </div>
          <div>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-text-quaternary">
              Skills
            </p>
            <div className="flex flex-wrap gap-1.5">
              {skillLabels(profile).map((skill) => (
                <span
                  key={skill}
                  className="rounded border border-border-secondary bg-bg-secondary px-2 py-1 text-[10px] capitalize text-text-secondary"
                >
                  {skill}
                </span>
              ))}
            </div>
          </div>
          {editable && !profile.is_placeholder && (
            <RemoveRep profile={profile} onSaved={onSaved} onClose={onClose} onError={setError} />
          )}
          {isManager && (
            <PatternEditor
              pattern={pattern}
              repId={profile.id}
              onSaved={onSaved}
              editable={editable}
            />
          )}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-text-primary">Exceptions history</h3>
              <span className="text-[10px] tabular-nums text-text-quaternary">
                {history.length} changes
              </span>
            </div>
            {history.length === 0 ? (
              <div className="rounded-md border border-dashed border-border-secondary p-4 text-center text-[11px] text-text-tertiary">
                No dated exceptions for this rep.
              </div>
            ) : (
              <div className="space-y-1.5">
                {history.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between rounded-md border border-border-secondary px-3 py-2"
                  >
                    <div>
                      <p className="text-[11px] font-semibold text-text-secondary">
                        {item.exception_date} · {SLOT_LABELS[item.slot] || item.slot}
                      </p>
                      <p className="text-[10px] text-text-tertiary">
                        {item.available ? '+' : '×'} {item.note || 'No note'} ·{' '}
                        {item.created_by || 'manager'}
                      </p>
                    </div>
                    {editable && (
                      <button
                        type="button"
                        onClick={() => void deleteException(item)}
                        className="rounded px-2 py-1 text-[10px] font-semibold text-text-quaternary hover:bg-tag-red-bg hover:text-tag-red-text"
                      >
                        Revert to pattern
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </aside>
    </>
  );
};

// Two-step "Remove from schedule": deactivates the rep (history is kept; bring them back with
// Restore under "Removed reps" - "+ Add rep" is create-only and rejects an existing name).
const RemoveRep: React.FC<{
  profile: Profile;
  onSaved: () => void;
  onClose: () => void;
  onError: (error: string | null) => void;
}> = ({
  profile,
  onSaved,
  onClose,
  onError,
}) => {
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const remove = async () => {
    setSaving(true);
    onError(null);
    try {
      await saveAvailability({ action: 'set_rep_active', rep_id: profile.id, active: false });
      onSaved();
      onClose();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Could not remove rep');
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="border-t border-border-secondary pt-4">
      {confirming ? (
        <div className="rounded-md border border-tag-red-border bg-tag-red-bg p-3 text-[11px] text-tag-red-text">
          <p className="font-semibold">Remove {profile.display_name} from the schedule?</p>
          <p className="mt-1">
            They disappear from the board and the generated sheet tabs. Their pattern and history
            are kept, and adding the same name again brings them back.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => void remove()}
              className="rounded-md bg-tag-red-text px-3 py-1.5 text-[11px] font-semibold text-bg-primary"
            >
              {saving ? 'Removing…' : 'Yes, remove'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-md border border-border-secondary px-3 py-1.5 text-[11px] font-semibold text-text-secondary"
            >
              Keep
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="rounded-md border border-border-secondary px-3 py-1.5 text-[11px] font-semibold text-text-tertiary hover:border-tag-red-border hover:text-tag-red-text"
        >
          Remove from schedule
        </button>
      )}
    </section>
  );
};
export default AvailabilityRepDrawer;
