import { vi } from 'vitest'

export const playerFormTimeMock = {
  getSavedTimezone: vi.fn(() => 'UTC'),
  saveTimezone: vi.fn(),
  generatePlayerTimeSlots: vi.fn(() => []),
  formatTimeInTimezone: vi.fn((time: string) => time),
  getTimezoneAbbr: vi.fn(() => 'UTC'),
}

vi.mock('@/lib/playerFormTime', () => ({
  ...playerFormTimeMock,
  TIMEZONES: [],
}))

