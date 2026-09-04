import React, { FormEvent, useState } from 'react';
import { HoldRule } from '../services/availabilityApi';
import { heldFor, holdRuleLabel, netBookable } from '../utils/availability';

interface Props {
  rule: HoldRule;
  editable: boolean;
  onSave: (rule: HoldRule) => Promise<void>;
}

const EXAMPLES = [12, 10, 8, 6, 4, 3, 2];

export const HoldRulePopover: React.FC<Props & { onClose: () => void }> = ({
  rule,
  editable,
  onSave,
  onClose,
}) => {
  const [draft, setDraft] = useState(rule);
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (
      draft.per < 1 ||
      draft.cap < 0 ||
      draft.min_reps < 0 ||
      draft.warn_below < 0 ||
      draft.warn_below > 20
    )
      return;
    setSaving(true);
    try {
      await onSave(draft);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="absolute right-0 top-8 z-30 w-80 rounded-lg border border-border-secondary bg-bg-primary p-4 shadow-xl"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xs font-semibold text-text-primary">Edit hold rule</h3>
          <p className="mt-1 text-[10px] text-text-tertiary">
            Held reps stay available for urgent coverage.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-text-tertiary"
          aria-label="Close hold rule"
        >
          ×
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {(
          [
            ['per', '1 per'],
            ['cap', 'Cap'],
            ['min_reps', 'None ≤'],
            ['warn_below', 'Warn below'],
          ] as const
        ).map(([field, label]) => (
          <label key={field} className="text-[10px] text-text-tertiary">
            {label}
            <input
              type="number"
              min={field === 'per' ? 1 : 0}
              max={field === 'warn_below' ? 20 : undefined}
              value={draft[field]}
              onChange={(event) => setDraft({ ...draft, [field]: Number(event.target.value) })}
              className="mt-1 w-full rounded border border-border-secondary bg-bg-secondary px-2 py-1.5 text-xs text-text-primary"
              disabled={!editable}
            />
          </label>
        ))}
      </div>
      <table className="mt-4 w-full text-[10px] tabular-nums">
        <caption className="mb-1 text-left text-text-tertiary">Live bookable examples</caption>
        <tbody>
          {EXAMPLES.map((count) => (
            <tr key={count} className="border-t border-border-secondary">
              <td className="py-1 text-text-secondary">{count} reps</td>
              <td className="py-1 text-right font-semibold text-text-primary">
                {netBookable(count, draft)} bookable
                <span className="ml-2 text-text-quaternary">({heldFor(count, draft)} held)</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {editable && (
        <button
          type="submit"
          disabled={saving}
          className="mt-4 w-full rounded-md bg-brand-primary px-3 py-2 text-xs font-semibold text-brand-text-on-primary disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save hold rule'}
        </button>
      )}
    </form>
  );
};

export const HoldRuleChip: React.FC<Props> = ({ rule, editable, onSave }) => {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => editable && setOpen((value) => !value)}
        className="rounded-full border border-border-secondary bg-bg-secondary px-3 py-1.5 text-[10px] text-text-secondary"
        title={editable ? 'Edit hold rule' : holdRuleLabel(rule)}
      >
        {holdRuleLabel(rule)} {editable && <span aria-hidden="true">✎</span>}
      </button>
      {open && (
        <HoldRulePopover
          rule={rule}
          editable={editable}
          onSave={onSave}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
};
