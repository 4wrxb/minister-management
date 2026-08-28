/**
 * frontend/src/__tests__/AdminSettings.test.tsx
 *
 * Tests for the Time Slot Offset dropdown in AdminSettings:
 *  - Loads the current offset on mount and pre-selects it.
 *  - PUTs the new value when the user changes the dropdown.
 *  - Reverts the selection and shows an error message on PUT failure.
 *
 * Other settings on the page are not under test here; their GET calls are
 * mocked to resolve with empty payloads so the component renders cleanly.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import axios from 'axios'

import AdminSettings from '@/components/admin/AdminSettings'

function mockAllGetCalls(timeSlotOffset: number) {
  vi.mocked(axios.get).mockImplementation((url: string) => {
    if (url === '/api/settings/time-slot-offset') {
      return Promise.resolve({ data: { time_slot_offset: timeSlotOffset } })
    }
    // Every other settings endpoint just needs to resolve with something
    return Promise.resolve({ data: {} })
  })
}

function getOffsetSelect(): HTMLSelectElement {
  // Component uses aria-label={t('admin.slotOffset')} which becomes the key
  return screen.getByLabelText('admin.slotOffset') as HTMLSelectElement
}

describe('AdminSettings — Time Slot Offset', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.setItem('adminToken', 'test-admin-token')
  })

  it('renders a dropdown listing all four supported offsets', async () => {
    mockAllGetCalls(-10)
    render(<AdminSettings />)

    const select = await waitFor(() => getOffsetSelect())
    const options = Array.from(select.querySelectorAll('option')).map((o) => o.value)
    expect(options.sort((a, b) => Number(a) - Number(b))).toEqual(['-20', '-15', '-10', '0'])
  })

  it('pre-selects the current offset returned by the API', async () => {
    mockAllGetCalls(-15)
    render(<AdminSettings />)

    await waitFor(() => {
      expect(getOffsetSelect().value).toBe('-15')
    })
  })

  it('PUTs the new offset when the user changes the dropdown', async () => {
    mockAllGetCalls(-10)
    vi.mocked(axios.put).mockResolvedValueOnce({
      data: { success: true, time_slot_offset: 0 },
    })

    render(<AdminSettings />)
    const select = await waitFor(() => getOffsetSelect())

    await userEvent.selectOptions(select, '0')

    await waitFor(() => {
      expect(axios.put).toHaveBeenCalledWith(
        '/api/admin/settings/time-slot-offset',
        { time_slot_offset: 0 },
        { headers: { Authorization: 'test-admin-token' } }
      )
    })
    expect(select.value).toBe('0')
  })

  it('reverts the selection and surfaces an error message when the PUT fails', async () => {
    mockAllGetCalls(-10)
    vi.mocked(axios.put).mockRejectedValueOnce(new Error('boom'))

    render(<AdminSettings />)
    const select = await waitFor(() => getOffsetSelect())

    await userEvent.selectOptions(select, '0')

    await waitFor(() => {
      expect(screen.getByText('admin.slotOffsetError')).toBeInTheDocument()
    })
    // Reverted back to the previous offset
    expect(select.value).toBe('-10')
  })
})
