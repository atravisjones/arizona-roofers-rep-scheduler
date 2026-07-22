import { TIME_SLOTS, TIME_SLOT_DISPLAY_LABELS } from '../constants';
import { TimeSlot } from '../types';

export interface TimeSlotWindow {
  start: number;
  end: number;
}

const parseTimePart = (value: string): number | null => {
  const match = value.trim().match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const period = match[3].toLowerCase();
  if (period === 'pm' && hour < 12) hour += 12;
  if (period === 'am' && hour === 12) hour = 0;
  return hour * 60 + minute;
};

export const parseTimeSlotWindow = (label: string): TimeSlotWindow | null => {
  const parts = label.split(/\s*-\s*/);
  if (parts.length !== 2) return null;
  const start = parseTimePart(parts[0]);
  const end = parseTimePart(parts[1]);
  return start === null || end === null ? null : { start, end };
};

export const getTimeSlotDisplayLabel = (slot: TimeSlot, timeSlots: TimeSlot[]): string =>
  timeSlots.length === 4 ? (TIME_SLOT_DISPLAY_LABELS[slot.id] || slot.label) : slot.label;

export const mapMinutesToActiveSlotId = (minutes: number, timeSlots: TimeSlot[]): string => {
  if (timeSlots.length === 4) {
    if (minutes < 600) return 'ts-1';
    if (minutes < 780) return 'ts-2';
    if (minutes < 960) return 'ts-3';
    return 'ts-4';
  }

  const windows = timeSlots
    .map(slot => ({ slot, window: parseTimeSlotWindow(slot.label) }))
    .filter((entry): entry is { slot: TimeSlot; window: TimeSlotWindow } => entry.window !== null);
  const containing = windows.find(({ window }) => minutes >= window.start && minutes < window.end);
  if (containing) return containing.slot.id;
  return windows.reduce((best, current) =>
    Math.abs(current.window.start - minutes) < Math.abs(best.window.start - minutes) ? current : best,
  windows[0])?.slot.id || timeSlots[0]?.id || TIME_SLOTS[0].id;
};
