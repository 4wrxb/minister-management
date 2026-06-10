/**
 * frontend/src/__tests__/appBase.test.ts
 *
 * Unit tests for getAppBase() — the helper that reads the runtime URL sub-path
 * the SPA is hosted at from <meta name="app-base"> (injected by the Flask
 * backend based on URL_PREFIX).
 */
import { describe, it, expect, afterEach } from 'vitest'

import { getAppBase } from '@/utils/appBase'

function setMetaAppBase(value: string | null) {
  document.head.querySelectorAll('meta[name="app-base"]').forEach((m) => m.remove())
  if (value !== null) {
    const meta = document.createElement('meta')
    meta.name = 'app-base'
    meta.content = value
    document.head.appendChild(meta)
  }
}

describe('getAppBase', () => {
  afterEach(() => setMetaAppBase(null))

  it('returns empty string when no meta tag is present', () => {
    setMetaAppBase(null)
    expect(getAppBase()).toBe('')
  })

  it('returns empty string when meta tag content is exactly "/"', () => {
    setMetaAppBase('/')
    expect(getAppBase()).toBe('')
  })

  it('returns empty string when meta tag content is empty', () => {
    setMetaAppBase('')
    expect(getAppBase()).toBe('')
  })

  it('returns "/ministry" when meta tag content is "/ministry"', () => {
    setMetaAppBase('/ministry')
    expect(getAppBase()).toBe('/ministry')
  })

  it('strips a single trailing slash', () => {
    setMetaAppBase('/ministry/')
    expect(getAppBase()).toBe('/ministry')
  })

  it('strips multiple trailing slashes', () => {
    setMetaAppBase('/ministry///')
    expect(getAppBase()).toBe('/ministry')
  })

  it('trims surrounding whitespace before normalizing', () => {
    setMetaAppBase('  /ministry  ')
    expect(getAppBase()).toBe('/ministry')
  })

  it('preserves nested sub-paths', () => {
    setMetaAppBase('/apps/ministry')
    expect(getAppBase()).toBe('/apps/ministry')
  })
})
