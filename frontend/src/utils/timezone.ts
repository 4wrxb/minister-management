// Timezone utilities for the Ministry Management System
// All internal storage is UTC; display can be converted to any timezone.

export interface TimezoneOption {
  id: string;
  label: string;
  offset: string;
}

export const TIMEZONES: TimezoneOption[] = [
  { id: 'UTC', label: 'UTC', offset: '+0' },
  { id: 'Asia/Seoul', label: 'KST (Korea)', offset: '+9' },
  { id: 'Asia/Shanghai', label: 'CST (China)', offset: '+8' },
  { id: 'America/New_York', label: 'ET (US East)', offset: '-5/-4' },
  { id: 'America/Chicago', label: 'CT (US Central)', offset: '-6/-5' },
  { id: 'America/Los_Angeles', label: 'PT (US West)', offset: '-8/-7' },
  { id: 'Europe/Istanbul', label: 'TRT (Turkey)', offset: '+3' },
  { id: 'Asia/Riyadh', label: 'AST (Arabia)', offset: '+3' },
];

const TZ_STORAGE_KEY = 'preferred_timezone';

export function getSavedTimezone(): string {
  try {
    return localStorage.getItem(TZ_STORAGE_KEY) || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function saveTimezone(tz: string): void {
  try {
    localStorage.setItem(TZ_STORAGE_KEY, tz);
  } catch {
    // localStorage not available
  }
}

/**
 * Convert a UTC time string (HH:MM) to the given IANA timezone.
 * Tolerates slot IDs decorated with "+", "-1", or similar day-shift
 * suffixes by stripping them before parsing.
 */
export function formatTimeInTimezone(utcHHMM: string, timezone: string): string {
  const clean = utcHHMM.replace(/(\+|-1)$/, '');
  if (timezone === 'UTC') return clean;
  const [h, m] = clean.split(':').map(Number);
  // Use July 15 to be in summer (DST-aware for northern hemisphere)
  const date = new Date(Date.UTC(2024, 6, 15, h, m));
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
    hour12: false,
  }).format(date);
}

/**
 * Generate the assignment time slots for the configured offset (minutes
 * from each half-hour boundary). Offset 0 yields 48 cleanly-aligned slots;
 * any other offset yields 49 — the previous day's later slot still runs
 * past midnight and is included as a "23:MM-1" pre-day entry.
 */
export function generateAssignmentSlots(offsetMin: number = 0): string[] {
  const base = ((offsetMin % 30) + 30) % 30;
  const minutes = [base, base + 30];
  const slots: string[] = [];
  if (offsetMin !== 0) {
    const preMin = Math.max(...minutes);
    slots.push(`23:${preMin.toString().padStart(2, '0')}-1`);
  }
  for (let h = 0; h < 24; h++) {
    for (const m of minutes) {
      slots.push(`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`);
    }
  }
  return slots;
}

/**
 * Get display label for a slot ID, optionally converted to a timezone.
 * Handles "23:50+" by displaying as the same time but can add context.
 */
export function getSlotDisplayTime(slotId: string, timezone: string): string {
  return formatTimeInTimezone(slotId, timezone);
}

/**
 * Generate 24 hourly player-facing time slots.
 * Returns display time (in chosen timezone) paired with UTC value (for storage).
 * Kept in UTC order so switching timezones visually shifts the displayed times.
 */
export function generatePlayerTimeSlots(timezone: string): { display: string; utcValue: string }[] {
  const result: { display: string; utcValue: string }[] = [];
  for (let utcH = 0; utcH < 24; utcH++) {
    const utc = `${utcH.toString().padStart(2, '0')}:00`;
    const display = formatTimeInTimezone(utc, timezone);
    result.push({ display, utcValue: utc });
  }
  return result;
}

/**
 * Get the timezone abbreviation for display.
 */
export function getTimezoneAbbr(timezoneId: string): string {
  const tz = TIMEZONES.find((t) => t.id === timezoneId);
  return tz ? tz.label.split(' ')[0] : timezoneId;
}
