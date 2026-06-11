/**
 * frontend/src/__tests__/PlayerForm.test.tsx
 *
 * Unit tests for PlayerForm step-1 validation and initial render.
 * Mocks: axios (all API calls), react-i18next, react-router-dom, timezone/affiliate utils.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import axios from 'axios'

import PlayerForm from '@/pages/PlayerForm'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('axios')

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async (importActual) => {
  const actual = await importActual<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => mockNavigate }
})

vi.mock('@/utils/timezone', () => ({
  getSavedTimezone: () => 'UTC',
  saveTimezone: vi.fn(),
  generatePlayerTimeSlots: () => [],
  formatTimeInTimezone: (t: string) => t,
  getTimezoneAbbr: () => 'UTC',
  TIMEZONES: [],
}))

vi.mock('@/utils/affiliate', () => ({ LOOTBAR_URL: 'https://example.com' }))

// ── Startup API mock ───────────────────────────────────────────────────────────

function setupStartupMocks() {
  vi.mocked(axios.get).mockImplementation((url: string) => {
    const responses: Record<string, unknown> = {
      '/api/settings/show-fire-crystals': { show_fire_crystals: false },
      '/api/settings/research-day': { research_day: 'tuesday' },
      '/api/time-preferences/heatmap': {},
      '/api/settings/application-closing-time': { is_closed: false },
    }
    const data = responses[url as string]
    if (data !== undefined) return Promise.resolve({ data })
    return Promise.reject(new Error(`Unexpected GET: ${url}`))
  })
}

function getFidInput(): HTMLInputElement {
  return document.querySelector('input[name="fid"]') as HTMLInputElement
}

function getGameNameInput(): HTMLInputElement {
  return document.querySelector('input[name="game_name"]') as HTMLInputElement
}

function getAllianceInput(): HTMLInputElement {
  return document.querySelector('input[name="alliance"]') as HTMLInputElement
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function renderForm() {
  return render(
    <MemoryRouter>
      <PlayerForm />
    </MemoryRouter>
  )
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('PlayerForm — step 1 (Player Information)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupStartupMocks()
    // Mock the duplicate-check so we don't need an API call for the happy path
    vi.mocked(axios.post).mockResolvedValue({ data: { fid_exists: false, name_exists: false } })
  })

  it('renders the FID, game name and alliance inputs on step 1', async () => {
    renderForm()
    await waitFor(() => {
      expect(getFidInput()).toBeInTheDocument()
      expect(getGameNameInput()).toBeInTheDocument()
      expect(getAllianceInput()).toBeInTheDocument()
    })
  })

  it('shows an error when game_name is empty and Next is clicked', async () => {
    renderForm()
    await waitFor(() => expect(getFidInput()).toBeInTheDocument())

    // Fill fid and alliance but leave game_name empty
    await userEvent.type(getFidInput(), '12345')
    await userEvent.type(getAllianceInput(), 'TST')

    const nextBtn = screen.getByRole('button', { name: /form\.next/i })
    await userEvent.click(nextBtn)

    await waitFor(() => {
      expect(screen.getByText('form.required')).toBeInTheDocument()
    })
  })

  it('shows an error when FID is empty and Next is clicked', async () => {
    renderForm()
    await waitFor(() => expect(getGameNameInput()).toBeInTheDocument())

    await userEvent.type(getGameNameInput(), 'Hero1')
    await userEvent.type(getAllianceInput(), 'TST')

    const nextBtn = screen.getByRole('button', { name: /form\.next/i })
    await userEvent.click(nextBtn)

    await waitFor(() => {
      expect(screen.getByText('form.fidRequired')).toBeInTheDocument()
    })
  })

  it('shows an error when alliance is empty and Next is clicked', async () => {
    renderForm()
    await waitFor(() => expect(getFidInput()).toBeInTheDocument())

    await userEvent.type(getFidInput(), '12345')
    await userEvent.type(getGameNameInput(), 'Hero1')
    // Leave alliance empty

    const nextBtn = screen.getByRole('button', { name: /form\.next/i })
    await userEvent.click(nextBtn)

    await waitFor(() => {
      expect(screen.getByText('form.allianceRequired')).toBeInTheDocument()
    })
  })

  it('advances to step 2 when all required fields are filled', async () => {
    // Mock duplicate check: no existing player
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: { fid_exists: false, name_exists: false },
    })

    renderForm()
    await waitFor(() => expect(getFidInput()).toBeInTheDocument())

    await userEvent.type(getFidInput(), '12345')
    await userEvent.type(getGameNameInput(), 'Hero1')
    await userEvent.type(getAllianceInput(), 'TST')

    const nextBtn = screen.getByRole('button', { name: /form\.next/i })
    await userEvent.click(nextBtn)

    // Step 2 should show a different heading (construction times)
    await waitFor(() => {
      // The step-1 FID input should no longer be in the document
      expect(getFidInput()).not.toBeInTheDocument()
    })
  })
})
