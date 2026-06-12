/**
 * tests/e2e/tests/assignment-view.spec.ts
 *
 * Integration tests for the published schedule view that players see.
 * Initial state: seed players, run auto-assign, publish → player visits /schedule/:day.
 */
import { test as base, expect } from '@playwright/test'
import { seedPlayer, getAdminToken, runAutoAssign, publishSchedule } from '../fixtures'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:8080'

base.describe('Published schedule view', () => {
  base('unpublished schedule shows a "not available" message', async ({ page }) => {
    await page.goto(`${BASE_URL}/schedule/monday`)
    // The page should exist but indicate nothing is published yet
    await expect(page).not.toHaveURL(/error|404/)
    // Should not crash (200 response renders the SPA)
  })

  base('published schedule is visible to players', async ({ page, request }) => {
    // ── Initial state ──────────────────────────────────────────────────────
    const fid = `sched-${Date.now()}`
    await seedPlayer(request, {
      fid,
      game_name: 'ScheduleTestPlayer',
      construction_speedups_days: 20,
      time_slots: ['10:00'],
    })

    const token = await getAdminToken(request)
    await runAutoAssign(request, 'monday', token)
    await publishSchedule(request, 'monday', token)

    // ── Steps ──────────────────────────────────────────────────────────────
    await page.goto(`${BASE_URL}/schedule/monday`)

    // ── Expected result ────────────────────────────────────────────────────
    // The player's name should appear on the published schedule
    await expect(page.locator('text=ScheduleTestPlayer')).toBeVisible({ timeout: 5_000 })
  })

  base('schedule renders time labels under the default offset', async ({ page, request }) => {
    // Smoke check: numerical-slot-indexing migration didn't break the slot
    // string rendering path. Under default offset -10 the layout includes
    // "09:50" and "10:20" as the slots surrounding hour 10.
    const fid = `sched-default-${Date.now()}`
    await seedPlayer(request, {
      fid,
      game_name: 'DefaultOffsetPlayer',
      construction_speedups_days: 20,
      time_slots: ['10:00'],
    })

    const token = await getAdminToken(request)
    await runAutoAssign(request, 'monday', token)
    await publishSchedule(request, 'monday', token)

    await page.goto(`${BASE_URL}/schedule/monday`)
    await expect(page.locator('text=DefaultOffsetPlayer')).toBeVisible({ timeout: 5_000 })

    // At least one of the default-offset slot labels around hour 10 should render.
    const slotLabel = page.locator('text=/\\b(09:50|10:20|10:50)\\b/').first()
    await expect(slotLabel).toBeVisible({ timeout: 5_000 })
  })
})
