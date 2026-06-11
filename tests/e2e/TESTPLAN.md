# E2E / Integration Test Plan

## Overview

**Framework:** Playwright (Chromium)  
**Location:** `tests/e2e/`  
**Target:** The running Docker container (`http://localhost:8080` by default)  
**Speed:** ~1–3 minutes for the full suite (includes real browser interactions and Docker startup)

E2E tests verify the full system: browser ↔ frontend ↔ backend ↔ database. They run against
the built Docker image, so both the bundled React frontend and the Flask API are exercised
together in production-like conditions.

> **Production isolation:** `tests/e2e/` is never copied into the Docker image. The
> `Dockerfile` only `COPY`s `backend/` and `frontend/dist/`. `tests/` is also listed in
> `.dockerignore` as an explicit safeguard.

---

## Running Manually

### Prerequisites

```bash
# 1. The Docker container must be running
docker compose up -d --build

# 2. Wait for it to be healthy
curl http://localhost:8080/health   # should return {"status":"healthy"}

# 3. Install Playwright and its Chromium browser
cd tests/e2e
npm install
npx playwright install --with-deps chromium
```

### Run all E2E tests

```bash
cd tests/e2e
npx playwright test
```

### Run a specific spec file

```bash
npx playwright test tests/player-flow.spec.ts
```

### Run a single test by name

```bash
npx playwright test --grep "correct password navigates to dashboard"
```

### Run in headed mode (watch the browser)

```bash
npx playwright test --headed
```

### Run against a different URL (e.g. a staging environment)

```bash
BASE_URL=https://my-staging-app.run.app npx playwright test
```

### View the HTML report from the last run

```bash
npx playwright show-report
```

### Stop the container when done

```bash
cd ../..
docker compose down -v
```

---

## CI Workflow

**File:** `.github/workflows/docker-integration.yml`  
**Triggers:** push or PR to `main`, manual `workflow_dispatch`  
**Runner:** `ubuntu-latest`

Steps:
1. Checkout code
2. Build Docker image with `docker/build-push-action` using BuildKit cache (`cache-from/cache-to: type=gha`)
3. Start container with `docker compose up -d --no-build` (reuses the already-built image)
4. Poll `GET /health` every 3 s until healthy (60 s timeout)
5. Run smoke checks (`/health`, SPA root/deep links, container log crash scan)
6. Set up Node.js 18
7. `cd tests/e2e && npm install`
8. `npx playwright install --with-deps chromium`
9. `npx playwright test`
10. On failure: upload `playwright-report/` as a GitHub Actions artifact (7-day retention)
11. On failure: `docker compose logs` dumped to console
12. Always: `docker compose down -v`

---

## Infrastructure Files

| File | Purpose |
|---|---|
| `playwright.config.ts` | `baseURL`, headless Chromium, 30 s timeout, `workers: 1` (serial — shared container), screenshots/video/trace on failure |
| `fixtures.ts` | API-based seed helpers + extended test fixture |
| `package.json` | `@playwright/test` only — no production dependencies |

### Fixtures & Seed Helpers (`fixtures.ts`)

Initial state is set via **direct API calls** before any browser interaction. This is faster and
more reliable than using the browser to navigate forms.

| Helper | What it does |
|---|---|
| `seedPlayer(request, payload)` | `POST /api/player/submit` — creates a player record |
| `getAdminToken(request, password?)` | `POST /api/admin/login` — returns the token string |
| `runAutoAssign(request, day, token)` | `POST /api/admin/assignments/auto-assign` — triggers assignment algorithm |
| `publishSchedule(request, day, token)` | `PUT /api/admin/settings/publish` — makes a day's schedule publicly visible |

The extended `test` fixture provides `adminToken` pre-wired so tests that need admin access
don't need to repeat the login API call.

### Pattern: Initial State → Steps → Expected Result

```typescript
test('published schedule visible to player', async ({ page, request }) => {
  // ── Initial state (via API) ──────────────────────────────────────────────
  const fid = `sched-${Date.now()}`
  await seedPlayer(request, { fid, game_name: 'TestPlayer', time_slots: ['10:00'] })
  const token = await getAdminToken(request)
  await runAutoAssign(request, 'monday', token)
  await publishSchedule(request, 'monday', token)

  // ── Steps (browser) ──────────────────────────────────────────────────────
  await page.goto(`${BASE_URL}/schedule/monday`)

  // ── Expected result ──────────────────────────────────────────────────────
  await expect(page.locator('text=TestPlayer')).toBeVisible({ timeout: 5_000 })
})
```

---

## Test Categories

### 1. Player Submission Flow (`tests/player-flow.spec.ts`)

**Initial state:** Empty database (tests use unique `Date.now()`-based FIDs to avoid collisions).

| Test | Steps | Expected |
|---|---|---|
| `homepage loads and shows the submit link` | Navigate to `/` | Page has a title matching `/minister\|ministry\|whiteout/i`; a submit/register link is visible |
| `submit form reachable via /submit route` | Navigate to `/submit` | `input[name="fid"]` and `input[name="game_name"]` are visible |
| `step 1 blocks progress with empty FID` | Go to `/submit`, fill game_name + alliance, click Next | Still on step 1 (`input[name="fid"]` still visible) |
| `step 1 blocks progress with empty game_name` | Go to `/submit`, fill FID + alliance, click Next | Still on step 1 |
| `full 3-step submit completes and shows success screen` | Fill all fields, click Next through all steps (accepting empty-time-slot dialogs), click Submit | Success message visible; `GET /api/player/{fid}` returns 200 with correct `game_name` |

---

### 2. Admin Flow (`tests/admin-flow.spec.ts`)

**Initial state:** Varies per test; players seeded via API where needed.

#### Login Flow

| Test | Steps | Expected |
|---|---|---|
| `admin login page is reachable` | Navigate to `/admin` | Password input visible |
| `wrong password shows an error` | Enter `definitely-wrong`, click Login | Error message containing "invalid/incorrect/wrong/unauthorized" is visible; URL still contains `/admin` (not `/dashboard`) |
| `correct password navigates to dashboard` | Enter `ADMIN_PASSWORD`, click Login | URL changes to `/admin/dashboard` |

#### Dashboard — Player Management

| Test | Steps | Expected |
|---|---|---|
| `dashboard shows player table after login` | Login, land on dashboard | A `<table>` or element with `role="table"` is visible |
| `seeded player appears in player table` | Seed player via API, login, view dashboard | `"AdminTestPlayer"` text visible on the page |

#### Auto-Assign

| Test | Steps | Expected |
|---|---|---|
| `auto-assign populates the assignment view` | Seed 2 players via API with different points + time preferences, run auto-assign via API, login, switch to Assignments tab | Both player names visible in the assignments view |

---

### 3. Published Schedule View (`tests/assignment-view.spec.ts`)

**Initial state:** Varies; some tests require seeded players + published schedule.

| Test | Steps | Expected |
|---|---|---|
| `unpublished schedule shows a "not available" message` | Navigate to `/schedule/monday` (no publish step) | Page returns 200 (SPA renders), no crash |
| `published schedule is visible to players` | Seed player, auto-assign, publish (all via API), navigate to `/schedule/monday` | `"ScheduleTestPlayer"` visible on the page |

---

## Configuration & Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `BASE_URL` | `http://localhost:8080` | Override to test staging or production |
| `ADMIN_PASSWORD` | `admin123` | Must match the running container's `ADMIN_PASSWORD` env var |

To run against a different environment:
```bash
BASE_URL=https://staging.example.com ADMIN_PASSWORD=myrealpassword npx playwright test
```

---

## Artifacts on Failure

When tests fail in CI, Playwright uploads:
- **`playwright-report/`** — HTML report with screenshot, video, and trace for each failed test
- **Container logs** — dumped to the Actions log via `docker compose logs`

To download and inspect the report locally:
1. Go to the GitHub Actions run
2. Download the `playwright-report` artifact
3. Unzip and open `index.html`

Or replay a trace locally:
```bash
npx playwright show-trace trace.zip
```
