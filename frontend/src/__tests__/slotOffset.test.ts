import { describe, it, expect } from 'vitest'

import { getToleranceMinutes } from '@/utils/slotOffset'

describe('getToleranceMinutes', () => {
  it('returns null for offset 0 (no disclaimer needed)', () => {
    expect(getToleranceMinutes(0)).toBeNull()
  })

  it('returns 20 for offsets -10 and -20', () => {
    expect(getToleranceMinutes(-10)).toBe(20)
    expect(getToleranceMinutes(-20)).toBe(20)
  })

  it('returns 15 for offset -15', () => {
    expect(getToleranceMinutes(-15)).toBe(15)
  })

  it('returns null for null/undefined (offset not yet loaded)', () => {
    expect(getToleranceMinutes(null)).toBeNull()
    expect(getToleranceMinutes(undefined)).toBeNull()
  })

  it('returns null for unexpected offsets (defensive)', () => {
    expect(getToleranceMinutes(-5)).toBeNull()
    expect(getToleranceMinutes(7)).toBeNull()
  })
})
