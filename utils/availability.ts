import { HoldRule } from '../services/availabilityApi';

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export const SLOTS = ['s1', 's2', 's3', 's4', 's5'] as const;
export const SLOT_LABELS: Record<string, string> = {
  s1: '8am – 10am',
  s2: '11am – 1pm',
  s3: '2pm – 4pm',
  s4: '5pm – 7pm',
  s5: 'Storm / flex',
};
// Short start-time labels that fit inside a board cell.
export const SLOT_START: Record<string, string> = {
  s1: '8a',
  s2: '11a',
  s3: '2p',
  s4: '5p',
  s5: '5p',
};
export const SLOT_START_FULL: Record<string, string> = {
  s1: '8am',
  s2: '11am',
  s3: '2pm',
  s4: '5pm',
  s5: '5pm',
};

function fromKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}

export function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function mondayOf(date: Date): Date {
  const result = new Date(date);
  const day = result.getDay();
  result.setDate(result.getDate() - (day === 0 ? 6 : day - 1));
  result.setHours(12, 0, 0, 0);
  return result;
}

export function weekDays(mondayKey: string): string[] {
  return Array.from({ length: 7 }, (_, index) => {
    const day = fromKey(mondayKey);
    day.setDate(day.getDate() + index);
    return dateKey(day);
  });
}

export function addWeeks(mondayKey: string, amount: number): string {
  const date = fromKey(mondayKey);
  date.setDate(date.getDate() + amount * 7);
  return dateKey(date);
}

export function displayDate(
  key: string,
  options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' },
): string {
  return fromKey(key).toLocaleDateString(undefined, options);
}

export function nextMonday(): string {
  return addWeeks(dateKey(mondayOf(new Date())), 1);
}

export function heldFor(available: number, rule: HoldRule): number {
  if (available <= rule.min_reps || rule.per <= 0) return 0;
  return Math.min(rule.cap, Math.floor(available / rule.per));
}

export function netBookable(available: number, rule: HoldRule): number {
  return Math.max(0, available - heldFor(available, rule));
}

export function holdRuleLabel(rule: HoldRule): string {
  return `Hold rule: 1 per ${rule.per} · cap ${rule.cap} · none ≤ ${rule.min_reps}`;
}
