/**
 * Week Schedule Parser
 * Parses a full week's schedule and splits it into individual days
 */

export interface DaySchedule {
  dayName: string; // e.g., "Sunday", "Monday"
  date: string; // e.g., "Dec 7, 2025"
  fullDate: string; // e.g., "Sunday, Dec 7, 2025"
  content: string; // The full text content for that day
}

/**
 * Parses a date string like "Dec 7, 2025" into a Date object
 */
function parseDateString(dateStr: string): Date | null {
  try {
    const monthMap: { [key: string]: number } = {
      'jan': 0, 'january': 0,
      'feb': 1, 'february': 1,
      'mar': 2, 'march': 2,
      'apr': 3, 'april': 3,
      'may': 4,
      'jun': 5, 'june': 5,
      'jul': 6, 'july': 6,
      'aug': 7, 'august': 7,
      'sep': 8, 'september': 8,
      'oct': 9, 'october': 9,
      'nov': 10, 'november': 10,
      'dec': 11, 'december': 11
    };

    // Parse "Dec 7, 2025" or "December 7, 2025"
    const match = dateStr.match(/([A-Za-z]+)\s+(\d+),\s+(\d{4})/);
    if (!match) return null;

    const monthStr = match[1].toLowerCase();
    const day = parseInt(match[2], 10);
    const year = parseInt(match[3], 10);

    const month = monthMap[monthStr];
    if (month === undefined) return null;

    return new Date(year, month, day);
  } catch {
    return null;
  }
}

/**
 * Parses a weekly schedule text and splits it into individual day schedules
 * Filters out past days (only includes today and future days)
 */
export function parseWeekSchedule(weekText: string): DaySchedule[] {
  const days: DaySchedule[] = [];

  // Day header pattern: e.g., "Sunday, Dec 7, 2025" or "Monday, Dec 8, 2025"
  const dayHeaderPattern = /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday),\s+([A-Za-z]+\s+\d+,\s+\d{4})$/gim;

  const lines = weekText.split('\n');
  let currentDay: DaySchedule | null = null;
  let currentContent: string[] = [];

  // Get today's date at midnight for comparison
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Check if this line is a day header
    const headerMatch = line.match(/^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday),\s+([A-Za-z]+\s+\d+,\s+\d{4})$/i);

    if (headerMatch) {
      // Save the previous day if it exists
      if (currentDay) {
        currentDay.content = currentContent.join('\n').trim();
        if (currentDay.content) {
          days.push(currentDay);
        }
      }

      // Start a new day
      const dayName = headerMatch[1];
      const date = headerMatch[2];
      currentDay = {
        dayName,
        date,
        fullDate: `${dayName}, ${date}`,
        content: ''
      };
      currentContent = [line]; // Include the header in the content
    } else if (currentDay) {
      // Add content to the current day
      currentContent.push(line);
    }
  }

  // Don't forget to save the last day
  if (currentDay) {
    currentDay.content = currentContent.join('\n').trim();
    if (currentDay.content) {
      days.push(currentDay);
    }
  }

  // Filter out past days - only keep today and future days
  const filteredDays = days.filter(day => {
    const dayDate = parseDateString(day.date);
    if (!dayDate) return true; // If we can't parse the date, keep it to be safe

    // Keep if the day is today or in the future
    return dayDate >= today;
  });

  return filteredDays;
}

/**
 * Validates if the text appears to be a weekly schedule
 */
export function isWeekSchedule(text: string): boolean {
  const dayHeaderPattern = /(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday),\s+[A-Za-z]+\s+\d+,\s+\d{4}/i;
  const matches = text.match(new RegExp(dayHeaderPattern, 'gi'));

  // If we find at least 2 day headers, it's likely a week schedule
  return matches !== null && matches.length >= 2;
}

/**
 * Gets a summary of the week schedule
 */
export function getWeekSummary(days: DaySchedule[]): string {
  if (days.length === 0) return 'No days found';

  const firstDay = days[0];
  const lastDay = days[days.length - 1];

  return `${firstDay.dayName} ${firstDay.date} - ${lastDay.dayName} ${lastDay.date} (${days.length} days)`;
}
