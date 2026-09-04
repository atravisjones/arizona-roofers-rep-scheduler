import React, { useMemo, useState } from 'react';
import { Exception, Pattern, Profile, saveAvailability } from '../services/availabilityApi';
import { SLOT_LABELS, SLOTS, WEEKDAYS, nextMonday } from '../utils/availability';

interface Props {
  profile: Profile;
  exceptions: Exception[];
  pattern?: Pattern;
  isManager: boolean;
  editable: boolean;
  onClose: () => void;
  onSaved: () => void;
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
        SLOTS.slice(0, 4).map((slot) => [
          slot,
          pattern?.slots.find((item) => item.weekday === weekday && item.slot === slot)
            ?.available ?? true,
        ]),
      ),
    ]),
  ) as PatternState;

const PatternEditor: React.FC<{
  pattern?: Pattern;
  repId: string;
  onSaved: () => void;
  editable: boolean;
}> = ({ pattern, repId, onSaved, editable }) => {
  const [effectiveFrom, setEffectiveFrom] = useState(nextMonday());
  const [slots, setSlots] = useState(() => patternDefaults(pattern));
  const [saving, setSaving] = useState(false);
  const savePattern = async () => {
    setSaving(true);
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
      onSaved();
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
        <input
          type="date"
          value={effectiveFrom}
          onChange={(event) => setEffectiveFrom(event.target.value)}
          aria-label="Pattern effective date"
          className="w-[126px] rounded border border-border-secondary bg-bg-primary px-2 py-1 text-[10px] text-text-secondary"
        />
      </div>
      <div className="space-y-1.5">
        {WEEKDAYS.map((day, weekday) => (
          <div key={day} className="flex items-center gap-2">
            <span className="w-7 text-[10px] font-bold text-text-tertiary">{day}</span>
            {SLOTS.slice(0, 4).map((slot) => {
              const available = slots[weekday][slot];
              return (
                <button
                  key={slot}
                  type="button"
                  onClick={() =>
                    setSlots((current) => ({
                      ...current,
                      [weekday]: { ...current[weekday], [slot]: !available },
                    }))
                  }
                  disabled={!editable}
                  className={`h-7 flex-1 rounded border text-[9px] font-bold disabled:cursor-default disabled:opacity-60 ${available ? 'border-tag-green-border bg-tag-green-bg text-tag-green-text' : 'border-border-secondary bg-bg-tertiary text-text-quaternary'}`}
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
      {editable && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => copyDay([1, 2, 3, 4])}
            className="rounded border border-border-secondary bg-bg-primary px-2 py-1.5 text-[10px] font-semibold text-text-secondary"
          >
            Copy Mon → Tue–Fri
          </button>
          <button
            type="button"
            onClick={() => copyDay([1, 2, 3, 4, 5])}
            className="rounded border border-border-secondary bg-bg-primary px-2 py-1.5 text-[10px] font-semibold text-text-secondary"
          >
            Copy Mon → Mon–Sat
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
  const history = useMemo(
    () =>
      [...exceptions].sort((a, b) =>
        `${b.exception_date}${b.slot}`.localeCompare(`${a.exception_date}${a.slot}`),
      ),
    [exceptions],
  );
  const deleteException = async (item: Exception) => {
    await saveAvailability({
      action: 'set_exception',
      rep_id: profile.id,
      date: item.exception_date,
      slot: item.slot,
      available: null,
    });
    onSaved();
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
          <div className="grid grid-cols-2 gap-3 text-[11px]">
            <div className="rounded-md bg-bg-secondary p-3">
              <span className="block text-text-quaternary">Home zip</span>
              <strong className="text-text-primary">{profile.home_zip || '—'}</strong>
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
                        Delete
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
export default AvailabilityRepDrawer;
