/**
 * tests/e2e/tests/admin-flow.spec.ts
 *
 * Integration tests for the admin login and management flow.
 * Initial state for most tests is seeded via API helpers (no browser setup).
 */
import { test as base, expect } from '@playwright/test'
import { seedPlayer, getAdminToken, runAutoAssign } from '../fixtures'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:8080'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'admin123'

base.describe('Admin login flow', () => {
  base('admin login page is reachable', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin`)
    await expect(page.locator('input[type="password"]')).toBeVisible()
  })

  base('wrong password shows an error', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin`)
    await page.fill('input[type="password"]', 'definitely-wrong')
    await page.getByRole('button', { name: /login|sign.in/i }).click()

    // Error message should appear
    await expect(
      page.locator('text=/invalid|incorrect|wrong|unauthorized/i').first()
    ).toBeVisible({ timeout: 5_000 })

    // Should NOT have navigated away from /admin
    expect(page.url()).toContain('/admin')
    expect(page.url()).not.toContain('/dashboard')
  })

  base('correct password navigates to dashboard', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin`)
    await page.fill('input[type="password"]', ADMIN_PASSWORD)
    await page.getByRole('button', { name: /login|sign.in/i }).click()

    await expect(page).toHaveURL(/\/admin\/dashboard/, { timeout: 5_000 })
  })
})

base.describe('Admin dashboard — player management', () => {
  base('dashboard shows player table after login', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin`)
    await page.fill('input[type="password"]', ADMIN_PASSWORD)
    await page.getByRole('button', { name: /login|sign.in/i }).click()
    await page.waitForURL(/\/admin\/dashboard/)

    // The dashboard should show a table or list of players
    await expect(page.locator('table, [role="table"], [data-testid="player-table"]').first()).toBeVisible({
      timeout: 5_000,
    })
  })

  base('seeded player appears in player table', async ({ page, request }) => {
    // Initial state: seed a player via API
    await seedPlayer(request, { fid: `admin-e2e-${Date.now()}`, game_name: 'AdminTestPlayer' })

    // Login and navigate to dashboard
    await page.goto(`${BASE_URL}/admin`)
    await page.fill('input[type="password"]', ADMIN_PASSWORD)
    await page.getByRole('button', { name: /login|sign.in/i }).click()
    await page.waitForURL(/\/admin\/dashboard/)

    // Player name should appear somewhere on the page
    await expect(page.locator('text=AdminTestPlayer')).toBeVisible({ timeout: 5_000 })
  })
})

base.describe('Admin auto-assign flow', () => {
  base('auto-assign populates the assignment view', async ({ page, request }) => {
    // Initial state: seed players with time preferences
    const fid1 = `aa-${Date.now()}-1`
    const fid2 = `aa-${Date.now()}-2`
    await seedPlayer(request, {
      fid: fid1,
      game_name: 'HighPoints',
      construction_speedups_days: 50,
      time_slots: ['06:00'],
    })
    await seedPlayer(request, {
      fid: fid2,
      game_name: 'LowPoints',
      construction_speedups_days: 5,
      time_slots: ['08:00'],
    })

    // Run auto-assign via API (no browser needed for the setup step)
    const token = await getAdminToken(request)
    await runAutoAssign(request, 'monday', token)

    // Login and switch to Assignments tab
    await page.goto(`${BASE_URL}/admin`)
    await page.fill('input[type="password"]', ADMIN_PASSWORD)
    await page.getByRole('button', { name: /login|sign.in/i }).click()
    await page.waitForURL(/\/admin\/dashboard/)

    // Click on Assignments tab
    const assignmentsTab = page.getByRole('button', { name: /assignment|schedule/i }).first()
    await assignmentsTab.click()

    // Both player names should be visible somewhere in the assignments view
    await expect(page.locator('text=HighPoints')).toBeVisible({ timeout: 5_000 })
    await expect(page.locator('text=LowPoints')).toBeVisible({ timeout: 5_000 })
  })
})
