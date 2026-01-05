import { parseTimeRange } from '../../utils/timeUtils';
import { DAY_VIEW_CELL_HEIGHT, DAY_VIEW_START_HOUR, DAY_VIEW_END_HOUR } from '../../constants';

export interface DayViewTimeSlot {
  id: string;
  startMinutes: number;
  label: string;
}

/**
 * Generate array of 30-minute time slots from 6am to 8pm
 */
export const generateDayViewSlots = (): DayViewTimeSlot[] => {
  const slots: DayViewTimeSlot[] = [];
  const startMinutes = DAY_VIEW_START_HOUR * 60; // 6am = 360 minutes
  const endMinutes = DAY_VIEW_END_HOUR * 60;     // 8pm = 1200 minutes

  for (let minutes = startMinutes; minutes < endMinutes; minutes += 30) {
    const hour = Math.floor(minutes / 60);
    const min = minutes % 60;
    const hour12 = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
    const period = hour >= 12 ? 'PM' : 'AM';
    const label = `${hour12}:${min.toString().padStart(2, '0')} ${period}`;

    slots.push({
      id: `dv-${minutes}`,
      startMinutes: minutes,
      label,
    });
  }
  return slots;
};

// Pre-generated slots for performance
export const DAY_VIEW_SLOTS = generateDayViewSlots();

/**
 * Calculate job block position and height in pixels based on time
 * @param originalTimeframe - The original timeframe string from the job
 * @param fallbackSlotId - The slot ID to use as fallback
 * @param cellHeight - The height of each 30-min cell in pixels (default: DAY_VIEW_CELL_HEIGHT)
 */
export const calculateJobPosition = (
  originalTimeframe: string | undefined,
  fallbackSlotId?: string,
  cellHeight: number = DAY_VIEW_CELL_HEIGHT
): { top: number; height: number; startMinutes: number; endMinutes: number } => {
  const gridStartMinutes = DAY_VIEW_START_HOUR * 60; // 6am = 360 minutes
  const DEFAULT_DURATION = 120; // 2 hours default
  const minHeight = cellHeight; // minimum 30 min (1 cell)

  // Try to parse the originalTimeframe
  const timeRange = parseTimeRange(originalTimeframe);

  if (timeRange && timeRange.start > 0) {
    const startMinutes = timeRange.start;
    const endMinutes = timeRange.end;
    const duration = endMinutes - startMinutes;

    // Calculate position from top of grid
    const topOffset = startMinutes - gridStartMinutes;
    const top = (topOffset / 30) * cellHeight;

    // Calculate height
    const height = Math.max((duration / 30) * cellHeight, minHeight);

    return {
      top: Math.max(0, top),
      height,
      startMinutes,
      endMinutes
    };
  }

  // Handle vague timeframes
  if (originalTimeframe) {
    const lower = originalTimeframe.toLowerCase();
    if (lower.includes('morning') || lower === 'am') {
      // Morning: 7:30am - 10am
      return {
        top: (450 - gridStartMinutes) / 30 * cellHeight, // 7:30am
        height: 5 * cellHeight, // 2.5 hours
        startMinutes: 450,
        endMinutes: 600
      };
    }
    if (lower.includes('afternoon') || (lower === 'pm' && !lower.includes('evening'))) {
      // Afternoon: 1pm - 4pm
      return {
        top: (780 - gridStartMinutes) / 30 * cellHeight, // 1pm
        height: 6 * cellHeight, // 3 hours
        startMinutes: 780,
        endMinutes: 960
      };
    }
    if (lower.includes('evening')) {
      // Evening: 4pm - 7pm
      return {
        top: (960 - gridStartMinutes) / 30 * cellHeight, // 4pm
        height: 6 * cellHeight, // 3 hours
        startMinutes: 960,
        endMinutes: 1140
      };
    }
  }

  // Fallback: use existing slot ID to determine position
  if (fallbackSlotId) {
    const slotPositions: Record<string, { top: number; height: number; startMinutes: number; endMinutes: number }> = {
      'ts-1': {
        top: (450 - gridStartMinutes) / 30 * cellHeight, // 7:30am
        height: 5 * cellHeight, // 2.5 hours to 10am
        startMinutes: 450,
        endMinutes: 600
      },
      'ts-2': {
        top: (600 - gridStartMinutes) / 30 * cellHeight, // 10am
        height: 6 * cellHeight, // 3 hours to 1pm
        startMinutes: 600,
        endMinutes: 780
      },
      'ts-3': {
        top: (780 - gridStartMinutes) / 30 * cellHeight, // 1pm
        height: 6 * cellHeight, // 3 hours to 4pm
        startMinutes: 780,
        endMinutes: 960
      },
      'ts-4': {
        top: (960 - gridStartMinutes) / 30 * cellHeight, // 4pm
        height: 6 * cellHeight, // 3 hours to 7pm
        startMinutes: 960,
        endMinutes: 1140
      },
    };
    return slotPositions[fallbackSlotId] || {
      top: 0,
      height: DEFAULT_DURATION / 30 * cellHeight,
      startMinutes: gridStartMinutes,
      endMinutes: gridStartMinutes + DEFAULT_DURATION
    };
  }

  // Ultimate fallback: position at start of day with 2-hour duration
  return {
    top: 0,
    height: DEFAULT_DURATION / 30 * cellHeight,
    startMinutes: gridStartMinutes,
    endMinutes: gridStartMinutes + DEFAULT_DURATION
  };
};

/**
 * Map minutes from midnight to the closest traditional slot ID (ts-1 through ts-4)
 * Used when dropping a job on a specific time cell
 */
export const mapMinutesToSlotId = (minutes: number): string => {
  if (minutes < 600) return 'ts-1';      // Before 10am -> ts-1 (7:30am-10am)
  if (minutes < 780) return 'ts-2';      // Before 1pm -> ts-2 (10am-1pm)
  if (minutes < 960) return 'ts-3';      // Before 4pm -> ts-3 (1pm-4pm)
  return 'ts-4';                          // 4pm onwards -> ts-4 (4pm-7pm)
};

/**
 * Format minutes as a time string (e.g., 600 -> "10:00 AM")
 */
export const formatMinutesAsTime = (minutes: number): string => {
  const hour = Math.floor(minutes / 60);
  const min = minutes % 60;
  const hour12 = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  const period = hour >= 12 ? 'PM' : 'AM';
  return `${hour12}:${min.toString().padStart(2, '0')} ${period}`;
};

/**
 * Get the total grid height in pixels
 */
export const getTotalGridHeight = (): number => {
  return DAY_VIEW_SLOTS.length * DAY_VIEW_CELL_HEIGHT;
};
