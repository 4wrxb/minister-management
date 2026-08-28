/**
 * frontend/src/__tests__/AdminLogin.test.tsx
 *
 * Unit tests for the AdminLogin page component.
 * Mocks: axios (API calls), react-i18next (translations), react-router-dom (navigation).
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import axios from 'axios'
import { mockNavigate } from '@/__tests__/helpers/mockCommon'

import AdminLogin from '@/pages/AdminLogin'

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderLogin() {
  return render(
    <MemoryRouter>
      <AdminLogin />
    </MemoryRouter>
  )
}

function getPasswordInput(): HTMLInputElement {
  return document.querySelector('input[type="password"]') as HTMLInputElement
}

function getSubmitButton(): HTMLElement {
  return screen.getByRole('button', { name: /admin\.login/i })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AdminLogin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders a password input and a submit button', () => {
    renderLogin()
    expect(getPasswordInput()).toBeInTheDocument()
    expect(getSubmitButton()).toBeInTheDocument()
  })

  it('shows an error message when the login API returns 401', async () => {
    vi.mocked(axios.post).mockRejectedValueOnce({
      response: { data: { error: 'Invalid password' } },
    })

    renderLogin()
    await userEvent.type(getPasswordInput(), 'wrong')
    await userEvent.click(getSubmitButton())

    await waitFor(() => {
      expect(screen.getByText('admin.invalidPassword')).toBeInTheDocument()
    })
  })

  it('navigates to /admin/dashboard after a successful login', async () => {
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: { token: 'admin-token', role: 'admin' },
    })

    renderLogin()
    await userEvent.type(getPasswordInput(), 'testadmin')
    await userEvent.click(getSubmitButton())

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/admin/dashboard')
    })
  })

  it('stores the token in localStorage after a successful login', async () => {
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: { token: 'admin-token', role: 'admin' },
    })

    renderLogin()
    await userEvent.type(getPasswordInput(), 'testadmin')
    await userEvent.click(getSubmitButton())

    await waitFor(() => {
      expect(localStorage.getItem('adminToken')).toBe('admin-token')
    })
  })

  it('disables the submit button while the request is in flight', async () => {
    // Never resolves so button stays disabled
    vi.mocked(axios.post).mockReturnValue(new Promise(() => {}))

    renderLogin()
    await userEvent.type(getPasswordInput(), 'testadmin')
    // Store reference before click — after click the button text changes to
    // 'form.loading', so getSubmitButton() would fail to re-find it by name.
    const btn = getSubmitButton()
    await userEvent.click(btn)

    expect(btn).toBeDisabled()
  })
})
