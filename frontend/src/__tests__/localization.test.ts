import { describe, expect, it } from 'vitest';
import {
  TIMEZONES,
  dateFormats,
  formatTimeInTimezone,
  generateAssignmentSlots,
  generatePlayerTimeSlots,
  getTimezoneAbbr,
  numberFormats,
} from '../lib/localization';

describe('localization library', () => {
  it('exposes the expected timezone catalog', () => {
    expect(TIMEZONES[0]?.id).toBe('UTC');
    expect(TIMEZONES.some((tz) => tz.id === 'Asia/Seoul')).toBe(true);
    expect(TIMEZONES.length).toBeGreaterThan(10);
  });

  it('formats numbers by locale', () => {
    expect(numberFormats.integer(1250, 'en')).toBe('1,250');
    expect(numberFormats.integer(1250, 'tr')).toBe('1.250');
  });

  it('formats UTC times for the selected timezone', () => {
    expect(formatTimeInTimezone('00:00', 'UTC')).toBe('00:00');
    expect(formatTimeInTimezone('00:00', 'Asia/Seoul')).toBe('09:00');
    expect(formatTimeInTimezone('23:50+', 'UTC')).toBe('23:50');
    expect(
      formatTimeInTimezone('12:00', 'America/New_York', '2024-01-15T00:00:00Z')
    ).toBe('07:00');
    expect(
      formatTimeInTimezone('12:00', 'America/New_York', '2024-07-15T00:00:00Z')
    ).toBe('08:00');
  });

  it('generates player and assignment slots', () => {
    const playerSlots = generatePlayerTimeSlots('UTC');
    expect(playerSlots).toHaveLength(24);
    expect(playerSlots[0]).toEqual({ display: '00:00', utcValue: '00:00' });
    expect(playerSlots[23]).toEqual({ display: '23:00', utcValue: '23:00' });

    const assignmentSlots = generateAssignmentSlots();
    expect(assignmentSlots).toHaveLength(49);
    expect(assignmentSlots[0]).toBe('23:50');
    expect(assignmentSlots[assignmentSlots.length - 1]).toBe('23:50+');

    const alignedSlots = generateAssignmentSlots(0);
    expect(alignedSlots).toHaveLength(48);
    expect(alignedSlots[0]).toBe('00:00');
    expect(alignedSlots[alignedSlots.length - 1]).toBe('23:30');
  });

  it('derives timezone abbreviations', () => {
    expect(getTimezoneAbbr('Asia/Seoul')).toBe('KST');
    expect(getTimezoneAbbr('Not/AZone')).toBe('Not/AZone');
  });

  it('formats localized date text', () => {
    const sample = '2024-03-01T12:34:56Z';
    expect(dateFormats.dateShort(sample, 'en')).not.toBe('');
    expect(dateFormats.dateLong(sample, 'en')).not.toBe(dateFormats.dateLong(sample, 'tr'));
  });
});
