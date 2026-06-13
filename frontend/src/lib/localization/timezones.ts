/**
 * Centralized timezone management with IANA support.
 * All times stored internally as UTC; display converted per user preference.
 */

import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

export interface TimezoneOption {
  id: string;
  label: string;
  offset: string;
}

/**
 * Curated IANA timezone subset grouped by region.
 * Source: IANA Time Zone Database
 */
export const TIMEZONES: TimezoneOption[] = [
  // UTC
  { id: 'UTC', label: 'UTC (UTC+0)', offset: '+0' },

  // Asia/Pacific
  { id: 'Asia/Tokyo', label: 'JST - Japan (UTC+9)', offset: '+9' },
  { id: 'Asia/Seoul', label: 'KST - Korea (UTC+9)', offset: '+9' },
  { id: 'Asia/Shanghai', label: 'CST - China (UTC+8)', offset: '+8' },
  { id: 'Asia/Hong_Kong', label: 'HKT - Hong Kong (UTC+8)', offset: '+8' },
  { id: 'Asia/Singapore', label: 'SGT - Singapore (UTC+8)', offset: '+8' },
  { id: 'Asia/Bangkok', label: 'ICT - Thailand (UTC+7)', offset: '+7' },
  { id: 'Asia/Kolkata', label: 'IST - India (UTC+5:30)', offset: '+5:30' },
  { id: 'Asia/Riyadh', label: 'AST - Saudi Arabia (UTC+3)', offset: '+3' },
  { id: 'Europe/Istanbul', label: 'TRT - Turkey (UTC+3)', offset: '+3' },

  // Europe
  { id: 'Europe/London', label: 'GMT/BST - UK (UTC+0/+1)', offset: '+0/+1' },
  { id: 'Europe/Paris', label: 'CET/CEST - Central Europe (UTC+1/+2)', offset: '+1/+2' },
  { id: 'Europe/Berlin', label: 'CET/CEST - Germany (UTC+1/+2)', offset: '+1/+2' },
  { id: 'Europe/Moscow', label: 'MSK - Russia (UTC+3)', offset: '+3' },

  // Americas
  { id: 'America/New_York', label: 'EST/EDT - US East (UTC-5/-4)', offset: '-5/-4' },
  { id: 'America/Chicago', label: 'CST/CDT - US Central (UTC-6/-5)', offset: '-6/-5' },
  { id: 'America/Denver', label: 'MST/MDT - US Mountain (UTC-7/-6)', offset: '-7/-6' },
  { id: 'America/Los_Angeles', label: 'PST/PDT - US West (UTC-8/-7)', offset: '-8/-7' },
  { id: 'America/Toronto', label: 'EST/EDT - Canada (UTC-5/-4)', offset: '-5/-4' },
  { id: 'America/Sao_Paulo', label: 'BRT/BRST - Brazil (UTC-3/-2)', offset: '-3/-2' },

  // Africa
  { id: 'Africa/Cairo', label: 'EET - Egypt (UTC+2)', offset: '+2' },
  { id: 'Africa/Johannesburg', label: 'SAST - South Africa (UTC+2)', offset: '+2' },
];

const TZ_STORAGE_KEY = 'preferred_timezone';

export const VALID_SLOT_OFFSETS = [-20, -15, -10, 0] as const;
export const DEFAULT_SLOT_OFFSET = -10;
export type SlotOffset = (typeof VALID_SLOT_OFFSETS)[number];

/**
 * Get user's saved timezone preference, defaulting to UTC.
 */
export function getSavedTimezone(): string {
  try {
    return localStorage.getItem(TZ_STORAGE_KEY) || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Save user's timezone preference to localStorage.
 */
export function saveTimezone(tz: string): void {
  try {
    localStorage.setItem(TZ_STORAGE_KEY, tz);
  } catch {
    // localStorage not available in some environments
  }
}

/**
 * Convert UTC time (HH:MM) to display in specified timezone.
 * Handles slot IDs with '+' suffix (e.g., "23:50+").
 *
 * @param utcHHMM UTC time string in HH:MM or HH:MM+ format
 * @param timezone IANA timezone ID
 * @param referenceDateUTC Optional UTC date used to resolve DST offsets
 * @returns Formatted time string in specified timezone
 */
export function formatTimeInTimezone(
  utcHHMM: string,
  timezone: string,
  referenceDateUTC?: Date | string
): string {
  const clean = utcHHMM.replace('+', '');
  if (timezone === 'UTC') return clean;

  const [h, m] = clean.split(':').map(Number);

  const baseDate = referenceDateUTC ? dayjs.utc(referenceDateUTC) : dayjs.utc();
  const date = baseDate.startOf('day').hour(h).minute(m).second(0).millisecond(0);
  const localDate = date.tz(timezone);

  return localDate.format('HH:mm');
}

/**
 * Get timezone abbreviation for display purposes.
 */
export function getTimezoneAbbr(timezoneId: string): string {
  const tz = TIMEZONES.find((t) => t.id === timezoneId);
  if (!tz) return timezoneId;

  // Extract abbreviation from label (e.g., "KST" from "KST - Korea")
  const match = tz.label.match(/^([A-Z]+)/);
  return match ? match[1] : timezoneId;
}

/**
 * Convert UTC time to a specific timezone.
 * Useful for backend responses and calculations.
 *
 * @param utcDate JavaScript Date or ISO string in UTC
 * @param timezone IANA timezone ID
 * @returns dayjs object representing local time
 */
export function convertUTCToTimezone(utcDate: Date | string, timezone: string): dayjs.Dayjs {
  return dayjs.utc(utcDate).tz(timezone);
}

/**
 * Convert local time in a timezone back to UTC.
 * Useful for storing user input in UTC.
 *
 * @param localTime dayjs object in a specific timezone
 * @returns UTC dayjs object
 */
export function convertTimezoneToUTC(localTime: dayjs.Dayjs, timezone: string): dayjs.Dayjs {
  return localTime.tz(timezone).utc();
}

/**
 * Get current time in a specific timezone.
 */
export function getNowInTimezone(timezone: string): dayjs.Dayjs {
  return dayjs().tz(timezone);
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
 * Generate assignment slots (30-minute granularity) based on offsetMinutes.
 * For offset 0, returns 48 slots (00:00 through 23:30).
 * For non-zero offsets, returns 49 slots, anchored at the offset-specific
 * pre-midnight boundary (e.g. 23:50) through the same boundary with '+'.
 */
export function generateAssignmentSlots(offsetMinutes: number = DEFAULT_SLOT_OFFSET): string[] {
  const normalized = ((offsetMinutes % 30) + 30) % 30;
  const second = normalized + 30;
  const firstSlotMinute = second.toString().padStart(2, '0');
  const firstMinute = normalized.toString().padStart(2, '0');
  const secondMinute = second.toString().padStart(2, '0');

  if (offsetMinutes === 0) {
    const slots: string[] = [];
    for (let hour = 0; hour < 24; hour += 1) {
      const padded = hour.toString().padStart(2, '0');
      slots.push(`${padded}:00`);
      slots.push(`${padded}:30`);
    }
    return slots;
  }

  const slots: string[] = [`23:${firstSlotMinute}`];
  for (let hour = 0; hour < 23; hour += 1) {
    const padded = hour.toString().padStart(2, '0');
    slots.push(`${padded}:${firstMinute}`);
    slots.push(`${padded}:${secondMinute}`);
  }
  slots.push(`23:${firstMinute}`);
  slots.push(`23:${secondMinute}+`);
  return slots;
}

export function displaySlotId(slotId: string): string {
  if (slotId.endsWith('+')) {
    return `${slotId.slice(0, -1)} (+1d)`;
  }
  return slotId;
}

/**
 * Get display time for an assignment slot ID.
 */
export function getSlotDisplayTime(slotId: string, timezone: string): string {
  return formatTimeInTimezone(slotId, timezone);
}
