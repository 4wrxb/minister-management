// Global test setup: extend Vitest's expect with @testing-library/jest-dom matchers
import '@testing-library/jest-dom'
import { vi } from 'vitest'
import { mockNavigate } from './helpers/mockCommon'

vi.mock('axios')

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}))

vi.mock('react-router-dom', async (importActual) => {
  const actual = await importActual<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => mockNavigate }
})
