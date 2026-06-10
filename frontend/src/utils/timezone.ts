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
 * Handles slot IDs like "23:50+" by stripping the suffix.
 */
export function formatTimeInTimezone(utcHHMM: string, timezone: string): string {
  const clean = utcHHMM.replace('+', '');
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
 * Generate the 49 assignment time slots (23:50 through 23:50+).
 * These are 30-minute slots starting at 23:50 UTC (previous day)
 * through 23:50 UTC (end of day), covering ~24.5 hours.
 */
export function generateAssignmentSlots(): string[] {
  const slots: string[] = ['23:50'];
  let hour = 0;
  let minute = 20;
  // 49 total slots: leading '23:50' plus 48 half-hour entries from 00:20 to 23:50+.
  // The inner `break` is the real termination; the loop bound is a safety upper limit.
  while (slots.length < 49) {
    const slot = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    if (slot === '23:50') {
      slots.push('23:50+'); // End-of-day 23:50 slot (distinct from the pre-midnight one)
      break;
    }
    slots.push(slot);
    minute += 30;
    if (minute >= 60) {
      minute -= 60;
      hour += 1;
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
