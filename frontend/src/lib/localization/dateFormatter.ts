/**
 * Date and number formatting with locale support.
 * Uses dayjs for date operations and Intl API for number formatting.
 */

import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/ar';
import 'dayjs/locale/ko';
import 'dayjs/locale/tr';
import 'dayjs/locale/zh-cn';

export type SupportedLocale = 'en' | 'ko' | 'zh' | 'tr' | 'ar' | 'rr';

dayjs.extend(relativeTime);

/**
 * Map language codes to dayjs locale identifiers.
 */
const localeMap: Record<SupportedLocale, string> = {
  en: 'en',
  ko: 'ko',
  zh: 'zh-cn',
  tr: 'tr',
  ar: 'ar',
  rr: 'en',
};

/**
 * Map language codes to Intl locale strings.
 */
const intlLocaleMap: Record<SupportedLocale, string> = {
  en: 'en-US',
  ko: 'ko-KR',
  zh: 'zh-CN',
  tr: 'tr-TR',
  ar: 'ar-SA',
  rr: 'en-US',
};

function toDayjs(date: Date | string | number) {
  if (typeof date === 'string') {
    return dayjs(date);
  }

  return dayjs(date);
}

/**
 * Format a date/time for display.
 *
 * @param date Date object, ISO string, or timestamp
 * @param pattern dayjs format pattern (e.g., 'YYYY-MM-DD HH:mm')
 * @param locale Language code
 * @returns Formatted string
 */
export function formatDate(date: Date | string | number, pattern: string, locale: SupportedLocale = 'en'): string {
  try {
    const dateObj = toDayjs(date);
    if (!dateObj.isValid()) return '';
    return dateObj.locale(localeMap[locale]).format(pattern);
  } catch {
    return '';
  }
}

/**
 * Common date format presets for each locale.
 */
export const dateFormats = {
  // Date only
  dateShort: (date: Date | string | number, locale: SupportedLocale = 'en') =>
    formatDate(date, 'MMM D, YYYY', locale),
  dateLong: (date: Date | string | number, locale: SupportedLocale = 'en') =>
    formatDate(date, 'dddd, MMMM D, YYYY', locale),

  // Time only
  timeShort: (date: Date | string | number, locale: SupportedLocale = 'en') =>
    formatDate(date, 'HH:mm', locale),
  timeMedium: (date: Date | string | number, locale: SupportedLocale = 'en') =>
    formatDate(date, 'HH:mm:ss', locale),

  // Date + Time
  dateTimeShort: (date: Date | string | number, locale: SupportedLocale = 'en') =>
    formatDate(date, 'MMM D, YYYY HH:mm', locale),
  dateTimeLong: (date: Date | string | number, locale: SupportedLocale = 'en') =>
    formatDate(date, 'dddd, MMMM D, YYYY HH:mm:ss', locale),

  // Relative time (e.g., "2 hours ago")
  relative: (date: Date | string | number, locale: SupportedLocale = 'en') => {
    try {
      const dateObj = toDayjs(date);
      if (!dateObj.isValid()) return '';
      return dateObj.locale(localeMap[locale]).fromNow();
    } catch {
      return '';
    }
  },
};

/**
 * Format a number for display with locale-specific formatting.
 * Handles thousands separators, decimal points, currency, etc.
 *
 * @param num Number to format
 * @param options Intl.NumberFormat options
 * @param locale Language code
 * @returns Formatted string
 */
export function formatNumber(num: number, options: Intl.NumberFormatOptions = {}, locale: SupportedLocale = 'en'): string {
  try {
    return new Intl.NumberFormat(intlLocaleMap[locale], options).format(num);
  } catch {
    return String(num);
  }
}

/**
 * Common number format presets.
 */
export const numberFormats = {
  // Integer (no decimals)
  integer: (num: number, locale: SupportedLocale = 'en') =>
    formatNumber(num, { minimumFractionDigits: 0, maximumFractionDigits: 0 }, locale),

  // Decimal (1-2 places)
  decimal: (num: number, locale: SupportedLocale = 'en') =>
    formatNumber(num, { minimumFractionDigits: 0, maximumFractionDigits: 2 }, locale),

  // Percentage
  percent: (num: number, locale: SupportedLocale = 'en') =>
    formatNumber(num / 100, { style: 'percent' }, locale),

  // Currency (USD default)
  currency: (num: number, currencyCode: string = 'USD', locale: SupportedLocale = 'en') =>
    formatNumber(num, { style: 'currency', currency: currencyCode }, locale),

  // Compact notation (e.g., 1.5K, 2.3M)
  compact: (num: number, locale: SupportedLocale = 'en') =>
    formatNumber(num, { notation: 'compact' }, locale),
};

/**
 * Parse an ISO date string to a Date object.
 * Safely handles parsing errors.
 */
export function parseDate(dateString: string): Date | null {
  const date = new Date(dateString);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Get the current date/time.
 */
export function getCurrentDate(): Date {
  return new Date();
}

/**
 * Check if a date is in the past.
 */
export function isPast(date: Date | string | number): boolean {
  try {
    const dateObj = new Date(date);
    return !Number.isNaN(dateObj.getTime()) && dateObj < new Date();
  } catch {
    return false;
  }
}

/**
 * Check if a date is in the future.
 */
export function isFuture(date: Date | string | number): boolean {
  try {
    const dateObj = new Date(date);
    return !Number.isNaN(dateObj.getTime()) && dateObj > new Date();
  } catch {
    return false;
  }
}

/**
 * Get time remaining until a future date (as a readable string).
 */
export function getTimeRemaining(futureDate: Date | string | number, locale: SupportedLocale = 'en'): string {
  if (!isFuture(futureDate)) return '';
  return dateFormats.relative(futureDate, locale);
}
