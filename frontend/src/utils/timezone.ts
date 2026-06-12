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

export const VALID_SLOT_OFFSETS = [-20, -15, -10, 0] as const;
export const DEFAULT_SLOT_OFFSET = -10;
export type SlotOffset = (typeof VALID_SLOT_OFFSETS)[number];

/**
 * Generate the ordered list of assignment slot identifiers for the given offset
 * in minutes from each half-hour boundary.
 *
 *   offset  0 → 48 slots aligned to the hour: 00:00, 00:30, ..., 23:30
 *   offset -10 → 49 slots: 23:50 (pre-day), 00:20, ..., 23:20, 23:50+ (end-of-day)
 *   offset -15 → 49 slots: 23:45, 00:15, ..., 23:15, 23:45+
 *   offset -20 → 49 slots: 23:40, 00:10, ..., 23:10, 23:40+
 *
 * End-of-day slots carry a trailing "+" so they don't collide with the pre-day
 * slot, which has the same HH:MM but logically belongs to the previous day.
 */
export function generateAssignmentSlots(offsetMin: number = DEFAULT_SLOT_OFFSET): string[] {
  const pad = (n: number) => n.toString().padStart(2, '0');

  if (offsetMin === 0) {
    const slots: string[] = [];
    for (let h = 0; h < 24; h++) {
      slots.push(`${pad(h)}:00`);
      slots.push(`${pad(h)}:30`);
    }
    return slots;
  }

  const base = ((offsetMin % 30) + 30) % 30;
  const second = base + 30;

  const slots: string[] = [`23:${pad(second)}`];
  for (let h = 0; h < 23; h++) {
    slots.push(`${pad(h)}:${pad(base)}`);
    slots.push(`${pad(h)}:${pad(second)}`);
  }
  slots.push(`23:${pad(base)}`);
  slots.push(`23:${pad(second)}+`);
  return slots;
}

/**
 * Render the user-facing label for a slot ID. End-of-day slots stored with a
 * trailing "+" become "HH:MM (+1d)" so the cross-midnight nature is visible.
 */
export function displaySlotId(slotId: string): string {
  if (slotId.endsWith('+')) {
    return `${slotId.slice(0, -1)} (+1d)`;
  }
  return slotId;
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
