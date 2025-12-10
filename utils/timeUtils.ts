/**
 * Parses a time range string (e.g., "7:30am-9am") into start and end minutes from midnight.
 * @param timeStr The time range string to parse
 * @returns An object with start and end times in minutes, or null if parsing fails
 */
export const parseTimeRange = (timeStr: string | undefined): { start: number, end: number } | null => {
  if (!timeStr) return null;
  const parts = timeStr.split('-').map(s => s.trim());

  const parseTime = (t: string) => {
    const match = t.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (!match) return 0;
    let h = parseInt(match[1]);
    const m = parseInt(match[2] || '0');
    const p = match[3]?.toLowerCase();
    if (p === 'pm' && h < 12) h += 12;
    if (p === 'am' && h === 12) h = 0;
    if (!p && h >= 1 && h <= 6) h += 12;
    return h * 60 + m;
  };

  if (parts.length >= 2) {
    return { start: parseTime(parts[0]), end: parseTime(parts[1]) };
  }
  return null;
};

/**
 * Checks if two time ranges overlap.
 * @param t1 First time range string
 * @param t2 Second time range string
 * @returns True if the times overlap, false otherwise
 */
export const doTimesOverlap = (t1: string | undefined, t2: string | undefined): boolean => {
  const r1 = parseTimeRange(t1);
  const r2 = parseTimeRange(t2);
  if (!r1 || !r2) return true;
  return r1.start < r2.end && r2.start < r1.end;
};
