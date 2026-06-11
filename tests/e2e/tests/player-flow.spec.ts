/**
 * tests/e2e/tests/player-flow.spec.ts
 *
 * Integration tests for the player submission flow.
 * Initial state: empty database (each test uses a unique FID).
 */
import { test, expect, type Dialog } from '@playwright/test'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:8080'

test.describe('Player submission flow', () => {
  test('homepage loads and shows the submit link', async ({ page }) => {
    await page.goto(BASE_URL)
    await expect(page).toHaveTitle(/minister|ministry|whiteout/i)
    // The home page should offer a visible CTA to open the submission form
    const submitCta = page.getByRole('button', { name: /submit|application|register|join/i }).first()
    await expect(submitCta).toBeVisible()
  })

  test('submit form reachable via /submit route', async ({ page }) => {
    await page.goto(`${BASE_URL}/submit`)
    await expect(page.locator('input[name="fid"]')).toBeVisible()
    await expect(page.locator('input[name="game_name"]')).toBeVisible()
  })

  test('step 1 blocks progress with empty FID', async ({ page }) => {
    await page.goto(`${BASE_URL}/submit`)

    // Fill game_name and alliance, leave FID empty
    await page.fill('input[name="game_name"]', 'TestHero')
    await page.fill('input[name="alliance"]', 'TST')

    // Click next (find a button with 'next' or arrow-forward in it)
    const nextBtn = page.getByRole('button').filter({ hasText: /next|→|›/i }).first()
    await nextBtn.click()

    // Should still be on step 1 (fid input still visible)
    await expect(page.locator('input[name="fid"]')).toBeVisible()
  })

  test('step 1 blocks progress with empty game_name', async ({ page }) => {
    await page.goto(`${BASE_URL}/submit`)

    await page.fill('input[name="fid"]', `e2e-test-${Date.now()}`)
    await page.fill('input[name="alliance"]', 'TST')
    // Leave game_name empty

    const nextBtn = page.getByRole('button').filter({ hasText: /next|→|›/i }).first()
    await nextBtn.click()

    // Should still be on step 1
    await expect(page.locator('input[name="fid"]')).toBeVisible()
  })

  test('full 3-step submit completes and shows success screen', async ({ page, request }) => {
    const uniqueFid = `e2e-submit-${Date.now()}`
    const autoAcceptDialog = async (dialog: Dialog) => {
      await dialog.accept()
    }
    page.on('dialog', autoAcceptDialog)

    await page.goto(`${BASE_URL}/submit`)

    // Step 1: fill required fields
    await page.fill('input[name="fid"]', uniqueFid)
    await page.fill('input[name="game_name"]', 'E2ETestPlayer')
    await page.fill('input[name="alliance"]', 'E2E')

    try {
      // Advance through steps 1→2→3→4→5 (or until submit button appears)
      for (let step = 1; step <= 4; step++) {
        const nextBtn = page.getByRole('button').filter({ hasText: /next|→|›/i }).first()
        if (await nextBtn.isVisible()) {
          await nextBtn.click()
          await page.waitForTimeout(300)
        }
      }

      // Click the final submit button
      const submitBtn = page.getByRole('button').filter({ hasText: /submit|send|confirm/i }).first()
      if (await submitBtn.isVisible()) {
        await submitBtn.click()
      }

      // Wait for success screen
      await expect(
        page.locator('text=/success|submitted|saved/i').first()
      ).toBeVisible({ timeout: 10_000 })

      // Clean up: verify the player exists via API
      const resp = await request.get(`${BASE_URL}/api/player/${uniqueFid}`)
      expect(resp.status()).toBe(200)
      const player = await resp.json()
      expect(player.game_name).toBe('E2ETestPlayer')
    } finally {
      page.off('dialog', autoAcceptDialog)
    }
  })
})
