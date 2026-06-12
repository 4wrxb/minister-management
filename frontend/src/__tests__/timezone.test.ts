/**
 * frontend/src/__tests__/timezone.test.ts
 *
 * Unit tests for the pure-function slot helpers in utils/timezone.ts —
 * specifically the offset-aware `generateAssignmentSlots` and the slot
 * display helper.
 */
import { describe, it, expect } from 'vitest'

import {
  generateAssignmentSlots,
  displaySlotId,
  VALID_SLOT_OFFSETS,
  DEFAULT_SLOT_OFFSET,
} from '@/utils/timezone'

describe('generateAssignmentSlots', () => {
  it('produces 48 aligned half-hour slots at offset 0', () => {
    const slots = generateAssignmentSlots(0)
    expect(slots).toHaveLength(48)
    expect(slots[0]).toBe('00:00')
    expect(slots[1]).toBe('00:30')
    expect(slots[slots.length - 1]).toBe('23:30')
    // No pre-day or end-of-day suffixes at offset 0
    expect(slots.some((s) => s.endsWith('+'))).toBe(false)
  })

  it('produces 49 slots at offset -10 (default) including a pre-day and end-of-day slot', () => {
    const slots = generateAssignmentSlots(-10)
    expect(slots).toHaveLength(49)
    // Pre-day slot is the first entry, bare (no + suffix)
    expect(slots[0]).toBe('23:50')
    // End-of-day slot is last and uses the + suffix
    expect(slots[slots.length - 1]).toBe('23:50+')
    // Second slot is the first slot of "today"
    expect(slots[1]).toBe('00:20')
  })

  it('produces 49 slots at offset -15', () => {
    const slots = generateAssignmentSlots(-15)
    expect(slots).toHaveLength(49)
    expect(slots[0]).toBe('23:45')
    expect(slots[1]).toBe('00:15')
    expect(slots[2]).toBe('00:45')
    expect(slots[slots.length - 1]).toBe('23:45+')
  })

  it('produces 49 slots at offset -20', () => {
    const slots = generateAssignmentSlots(-20)
    expect(slots).toHaveLength(49)
    expect(slots[0]).toBe('23:40')
    expect(slots[1]).toBe('00:10')
    expect(slots[2]).toBe('00:40')
    expect(slots[slots.length - 1]).toBe('23:40+')
  })

  it('defaults to the documented DEFAULT_SLOT_OFFSET when called without an argument', () => {
    const withDefault = generateAssignmentSlots()
    const explicit = generateAssignmentSlots(DEFAULT_SLOT_OFFSET)
    expect(withDefault).toEqual(explicit)
  })

  it('declares the four offsets we support', () => {
    expect([...VALID_SLOT_OFFSETS].sort((a, b) => a - b)).toEqual([-20, -15, -10, 0])
  })
})

describe('displaySlotId', () => {
  it('returns the slot unchanged when there is no end-of-day suffix', () => {
    expect(displaySlotId('00:20')).toBe('00:20')
    expect(displaySlotId('06:00')).toBe('06:00')
    expect(displaySlotId('23:50')).toBe('23:50') // pre-day slot, bare
  })

  it('appends "(+1d)" to end-of-day slots so they read as crossing midnight', () => {
    expect(displaySlotId('23:50+')).toBe('23:50 (+1d)')
    expect(displaySlotId('23:45+')).toBe('23:45 (+1d)')
    expect(displaySlotId('23:40+')).toBe('23:40 (+1d)')
  })
})
