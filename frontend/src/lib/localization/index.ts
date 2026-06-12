/**
 * Centralized localization library.
 * Exports timezone management, date formatting, and i18n utilities.
 */

// Timezone utilities
export {
  TIMEZONES,
  getSavedTimezone,
  saveTimezone,
  formatTimeInTimezone,
  getTimezoneAbbr,
  convertUTCToTimezone,
  convertTimezoneToUTC,
  getNowInTimezone,
  generatePlayerTimeSlots,
  generateAssignmentSlots,
  displaySlotId,
  getSlotDisplayTime,
  VALID_SLOT_OFFSETS,
  DEFAULT_SLOT_OFFSET,
  type TimezoneOption,
  type SlotOffset,
} from './timezones';

// Date/time formatting utilities
export {
  formatDate,
  formatNumber,
  dateFormats,
  numberFormats,
  parseDate,
  getCurrentDate,
  isPast,
  isFuture,
  getTimeRemaining,
  type SupportedLocale,
} from './dateFormatter';
