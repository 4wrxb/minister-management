/**
 * tests/e2e/fixtures.ts
 *
 * Playwright fixtures and helpers for setting up initial state before browser tests run.
 * State is seeded via direct API calls (no browser interaction needed for preconditions).
 */
import { test as base, type APIRequestContext } from '@playwright/test'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:8080'

// ── API seed helpers ──────────────────────────────────────────────────────────

export interface PlayerSeed {
  fid: string
  game_name: string
  alliance?: string
  construction_speedups_days?: number
  research_speedups_days?: number
  troop_training_speedups_days?: number
  general_speedups_days?: number
  fire_crystals?: number
  refined_fire_crystals?: number
  fire_crystal_shards?: number
  time_slots?: string[]
}

/** Submit a player directly via the API (no browser). */
export async function seedPlayer(request: APIRequestContext, seed: PlayerSeed): Promise<void> {
  const payload = {
    alliance: 'TST',
    construction_speedups_days: 10,
    research_speedups_days: 5,
    troop_training_speedups_days: 3,
    general_speedups_days: 2,
    fire_crystals: 0,
    refined_fire_crystals: 0,
    fire_crystal_shards: 0,
    time_slots: ['00:00', '01:00', '02:00'],
    ...seed,
  }
  const resp = await request.post(`${BASE_URL}/api/player/submit`, { data: payload })
  if (!resp.ok()) {
    throw new Error(`seedPlayer failed (${resp.status()}): ${await resp.text()}`)
  }
}

/** Obtain an admin token directly via the API (no browser login). */
export async function getAdminToken(request: APIRequestContext, password = 'admin123'): Promise<string> {
  const resp = await request.post(`${BASE_URL}/api/admin/login`, {
    data: { password },
  })
  if (!resp.ok()) throw new Error(`Admin login failed: ${await resp.text()}`)
  const body = await resp.json()
  return body.token as string
}

/** Run auto-assign for a given day directly via the API. */
export async function runAutoAssign(
  request: APIRequestContext,
  day: string,
  token: string
): Promise<void> {
  const resp = await request.post(`${BASE_URL}/api/admin/assignments/auto-assign`, {
    data: { day },
    headers: { Authorization: token },
  })
  if (!resp.ok()) throw new Error(`Auto-assign failed: ${await resp.text()}`)
}

/** Publish the schedule for a given day so players can view it. */
export async function publishSchedule(
  request: APIRequestContext,
  day: string,
  token: string
): Promise<void> {
  const resp = await request.put(`${BASE_URL}/api/admin/settings/publish`, {
    data: { day },
    headers: { Authorization: token },
  })
  if (!resp.ok()) throw new Error(`Publish failed: ${await resp.text()}`)
}

// ── Extended test fixture ─────────────────────────────────────────────────────

/** Extended Playwright test with `adminToken` and `seedPlayer` pre-wired. */
export const test = base.extend<{
  adminToken: string
}>({
  adminToken: async ({ request }, use) => {
    const token = await getAdminToken(request)
    await use(token)
  },
})

export { expect } from '@playwright/test'
