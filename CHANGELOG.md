# Changelog

All notable changes to the Ministry Management System are documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `tests/backend/test_points.py` — pure-function unit tests pinning the canonical formula in `calculate_points()` against its docstring (per-day inputs, unit conversion, Tuesday/Friday equivalence, case-insensitive day names, int return type, unknown-day fallback).

### Changed
- **Point calculation docs consolidated to a single canonical source.** The `calculate_points()` function in `backend/database.py` is now the single source of truth — its docstring carries the per-day formulas, unit convention (1 day = 1440 minutes), and exact input fields. `USER_GUIDE.md` keeps the canonical player-facing prose (now correctly noting the Tuesday-or-Friday research-day toggle), and `RECREATION_GUIDE.md` keeps the canonical technical restatement. The duplicated formulas in `README.md`, `PROJECT_SUMMARY.md`, and `claude.md` are replaced with short 2–3 sentence summaries that link back to the canonical sources. Drift fixed along the way: `PROJECT_SUMMARY.md` had used non-existent condensed field names (`construction_days`, `refined_crystals`, `crystal_shards`); `README.md`, `USER_GUIDE.md`, and `claude.md` had omitted the Tuesday-or-Friday research-day toggle.

### Fixed

## [1.5.0] — 2026-06-12

### Added
- **Comprehensive maintenance and security workflows**:
  - **Dependabot auto-updates** (`.github/dependabot.yml`): Weekly automated PRs for npm, pip, and GitHub Actions dependencies. Semver-major updates for React, TypeScript, and Flask are ignored by Dependabot and require manual review to upgrade.
  - **Nightly security scanning** (`.github/workflows/security-scan.yml`): CodeQL static analysis, Safety vulnerability checks, and npm audit. Runs nightly at 02:00 UTC; the workflow run fails when vulnerabilities are detected (does not block merges because it's scheduled).
  - **Daily maintenance checks** were evaluated and intentionally removed because they overlapped with Dependabot coverage or lacked a low-noise path to become a useful gating signal.
  - **Documentation guide** (`.github/MAINTENANCE.md`): Complete reference for workflow strategy, configuration, and troubleshooting.
- `time_slot_offset` admin-configurable setting (allowed values: `-20`, `-15`, `-10`, `0`; default `-10`). Drives the 30-minute assignment slot layout: non-zero offsets produce 49 end-of-day-anchored slots, offset `0` produces 48 aligned half-hour slots.
- Public endpoint `GET /api/settings/time-slot-offset` (returns current offset + valid choices).
- Admin endpoint `PUT /api/admin/settings/time-slot-offset` (updates the offset; rejects invalid values with 400).
- Auto-assign and assignment payloads now include a `slot_mapping` companion (index -> display string) so clients can resolve slot indices without re-deriving the layout.

### Changed
- **Workflow optimization to eliminate duplication and improve feedback speed**:
  - `backend-tests.yml`: Added fast Python syntax check (1s) before pytest to fail early on import/syntax errors.
  - `frontend-tests.yml`: Added fast TypeScript type-check (10-30s) before linting to fail early on type errors.
  - `security-scan.yml`: Moved from PR-blocking to nightly schedule to save GitHub runner resources while maintaining security coverage.
  - Removed redundant `validate-build.yml` workflow; Docker integration test is now the single source of truth for build validation.
  - New PR feedback timeline: <2 min for syntax/type checks, ~5 min for unit tests, ~25 min for full Docker integration test. Total: ~30 min.
- Copilot/Claude guidance now requires future changes to finish the related user-facing docs, internal docs/changelog, and the best-fit unit or Playwright E2E tests before the work is considered complete.
- `claude.md` remains the detailed project primer, while `.github/copilot-instructions.md` is the repo-level source of truth for validation and completion rules.
- **Azure Container Apps deployment workflow (`deploy-aca.yml`) now follows a manual-first staged lifecycle**:
  - Staging deploy seeds `minister.db` from a production snapshot before deploying.
  - Production deploy now creates and logs a rollback backup blob, then can tear down staging to a zero-cost state (`teardown_staging_on_production=true` by default).
  - Added explicit `rollback`, `destroy`, and `cleanup` action paths:
    - `rollback` restores production DB from a named backup blob (`backup_blob_name`).
    - `destroy` deletes staging resource group.
    - `cleanup` prunes old production backup blobs (`backup_retention_days`).
  - Deployment docs were aligned in `.github/DEPLOYMENT_WORKFLOW.md`, `DEPLOYMENT.md`, and `README.md`.
  - Follow-up deploy workflow refinements from PR review:
    - `build-image` and GHCR visibility checks now run only for `action=deploy`.
    - Staging now runs a storage-only Bicep bootstrap before DB seed, so seed no longer depends on pre-existing staging storage.
    - When production deploy requests staging teardown, teardown failure now fails the overall run.
  - **Critical fix: First-time production deploy now works correctly**:
    - Backup step detects if `main-deployment` exists before attempting backup; skips gracefully on first deploy.
    - Added comprehensive troubleshooting guide in `DEPLOYMENT.md` for state progression and recovery scenarios.
  - Removed `force_bootstrap` workflow input and guardrails; bootstrap now runs only for `action=deploy`.
  - Staging DB seed is now automatic best-effort behavior: it warns and exits successfully when production RG, production `main-deployment`, or production `minister.db` is missing.
  - Production deploy Bicep parameters now use valid `minReplicas`/`maxReplicas` names.
- Fixed Azure storage account naming in Bicep so production names always satisfy the 24-character limit while preserving staging naming behavior.
- Production cleanup now resolves storage accounts deterministically from `main-deployment` outputs (no fallback to listing storage accounts).
- Slot-model description corrected across all docs. The default `time_slot_offset` of `-10` preserves the legacy 49-slot, end-of-day-anchored cadence (`23:50, 00:20, 00:50, ..., 23:20, 23:50+`) instead of "00:00 through 23:30"; other offsets now drive the layout. Player-facing tolerance copy updated in all five languages to describe the offset-dependent window rather than a hardcoded "+/-20 minutes".
- `time_preferences.time_slot TEXT` column replaced by `hour_index INTEGER` (hour 0-23). The old "HH:MM" strings are migrated automatically on startup; only the hour portion is preserved (minutes were always ignored for hourly preferences).
- `assignments.time_slot TEXT` column replaced by `slot_index INTEGER` (numerical index into the slot layout under the current offset). Existing rows are migrated automatically on startup using the offset that was active at migration time. Legacy rows whose `time_slot` does not decode under that offset are dropped with a warning.
- Migrations are wrapped in a single transaction; the `numerical_slot_indexing_v1` marker is only persisted when the transaction commits, so a crash mid-migration is recoverable on next boot.
- Slot read paths now skip rows whose `slot_index` is out of range for the currently configured offset (e.g. a `slot_index=48` row left over from offset `-10` after the admin switches to offset `0`) instead of returning a 500. The orphaned rows remain in storage so reverting the offset restores them.

### Fixed
- `POST /api/admin/assignments/update` now validates every incoming slot ID up front and returns 400 with the list of `invalid_slots` before deleting the day's rows, so a stale or malformed client payload can no longer wipe a day's schedule.

## [1.4.0] — 2026-06-11

### Added
- **Sub-path hosting via `URL_PREFIX`** with runtime `<base href>` injection. Set `URL_PREFIX=/ministry` on the backend to host the app at a sub-path behind a path-based reverse proxy (e.g. a Cloudflare Tunnel route). `/health` stays at the root so platform health probes don't need to be prefix-aware. Backend mount uses `werkzeug.middleware.dispatcher.DispatcherMiddleware`. The frontend bundle is built with `base: './'` (relative asset URLs); `backend/app.py` splices a `<base href="${URL_PREFIX}/">` and `<meta name="app-base">` tag into the served `index.html` (cached per `request.script_root`), so the same Docker image works at any prefix without a rebuild. A new `getAppBase()` helper (`frontend/src/utils/appBase.ts`) reads the meta tag and feeds the result to `<BrowserRouter basename>` and `axios.defaults.baseURL`.
- **`SQLITE_VFS` env var** threaded into `sqlite3.connect` in `backend/database.py`. Set to `unix-dotfile` when `DATABASE_PATH` lives on SMB/CIFS (e.g. Azure Files) so SQLite uses on-disk lock files instead of POSIX `fcntl` byte-range locks.
- **Three-layer test framework:**
  - **Layer 1 — Backend unit tests** (`tests/backend/`): pytest + Flask test client with a temp SQLite DB. Covers health, auth, players, assignments, settings, URL_PREFIX injection, and SQLITE_VFS. CI: `.github/workflows/pytest.yml`.
  - **Layer 2 — Frontend unit tests** (`frontend/src/__tests__/`): Vitest + `@testing-library/react`. Covers `AdminLogin`, `PlayerForm`, and `appBase` helper. CI: `.github/workflows/frontend-tests.yml`.
  - **Layer 3 — E2E tests** (`tests/e2e/`): Playwright (Chromium) against a live Docker container. Covers player submission flow, admin login/dashboard/assignment flow, and published-schedule view — including a prefixed-restart phase validating `URL_PREFIX=/ministry`. CI: `.github/workflows/e2e.yml`.
  - Test plan docs added at `tests/TESTPLAN.md`, `tests/backend/TESTPLAN.md`, `frontend/src/__tests__/TESTPLAN.md`, `tests/e2e/TESTPLAN.md`.
- **Frontend deprecation CI gate**: `frontend/scripts/check-deprecations.mjs` detects deprecated `npm` packages and fails CI on non-allowlisted entries; `frontend/deprecations-allowlist.json` carries explicit, reviewable exceptions. Runs in the lint job via `npm run check:deprecations`.
- **Copilot cloud-agent setup**: `.github/workflows/copilot-setup-steps.yml` preinstalls backend and frontend dependencies in the Copilot cloud-agent environment. `.github/copilot-instructions.md` defines validation commands and repository guardrails for future Copilot-driven changes.
- **Deployment guide rewrite** in `DEPLOYMENT.md`:
  - Full **Azure App Service + Cloudflare Tunnel sidecar** walkthrough (multi-container compose, Azure Files SMB persistence, Cloudflare IP allowlist, sub-path `/ministry` worked example).
  - New platform-agnostic **Putting Cloudflare in Front of Any Deployment** section covering both proxy and tunnel modes for Bare Metal / Cloud Run / App Service / AWS.
- This `CHANGELOG.md`.

### Fixed
- Latent TypeScript and ESLint errors that had accumulated without a lint gate.

### Changed
- Documentation aligned with the current codebase: `claude.md` rewritten end-to-end, `PROJECT_SUMMARY.md` schema and API tables completed, README project structure and tech stack tables refreshed.
- `WOS_API_SECRET` constant documented as a public community-extracted client-side salt (not a private credential); misleading "move to env var for security" comment replaced with accurate context.
- Slot-model description corrected across all docs. The auto-assigner uses a fixed 49-slot, end-of-day-anchored cadence (`23:50, 00:20, 00:50, ..., 23:20, 23:50+`) with a ±20 minute tolerance window — not "00:00 through 23:30".
- Default `admin123` / `minister123` passwords are now called out with explicit ⚠️ warnings in `README.md`, `DEPLOYMENT.md`, and `.env.example`.
- Hardcoded personal domain replaced with a `<your-domain.example.com>` placeholder in `DEPLOYMENT.md`.
- `.github/copilot-instructions.md` now requires future agents to update `claude.md`, `PROJECT_SUMMARY.md`, and `RECREATION_GUIDE.md` whenever API endpoints, DB columns, or env vars change.
- `claude.md`, `PROJECT_SUMMARY.md`, and `RECREATION_GUIDE.md` env-var sections, code snippets, and deployment lessons updated to cover `URL_PREFIX` / `SQLITE_VFS` and the Azure App Service deployment story.
- Frontend vitest config widened to `*.test.{ts,tsx}` so pure-TypeScript test files are collected.

## [1.3.0] — 2026-03-18

### Added
- Structured logging across the backend (logins, FID-tagged submissions, admin destructive actions, errors with stack traces).

### Changed
- Hardened input validation on `POST /api/player/submit`: required-field enforcement, numeric range checks (no negatives, max `99999`), better error messages.
- Centralized admin auth via `check_admin_auth()` helper.

### Security
- Failed login attempts are now logged.
- "Remove All Players" admin action is logged at warning level.

## [1.2.0] — 2026-03-18

### Added
- **Admin Settings tab** with four configurable options:
  - State number (drives the `Welcome, State {N}` banner; default `2694`).
  - Application closing time — once the deadline passes, new submissions are blocked but existing players can still update via FID.
  - Research-day toggle (Tuesday ⇄ Friday).
  - Show / hide fire-crystal fields on the player form.
- New backend endpoints:
  - `PUT /api/admin/settings/research-day`
  - `PUT /api/admin/settings/show-fire-crystals`
  - `PUT /api/admin/settings/application-closing-time`
  - `PUT /api/admin/settings/state-number`
  - `GET /api/settings/research-day`
  - `GET /api/settings/show-fire-crystals`
  - `GET /api/settings/application-closing-time`
  - `GET /api/settings/state-number`
- LootBar affiliate links surfaced on the home page, after submission success, near the speedup fields, and on the update page.
- New `settings` table (key-value) in the SQLite schema.

### Changed
- Research day selection now propagates everywhere: point calculations, auto-assign valid-day list, Excel export tabs, and published-schedule labels.
- All user-facing docs (`README.md`, `USER_GUIDE.md`, `PROJECT_SUMMARY.md`, `RECREATION_GUIDE.md`) updated.

## [1.1.5] — 2026-03-17

### Added
- **Time-preference heat map** — color-coded slot grid (blue=low → red=high) visible on the player form and the admin assignments view, backed by `GET /api/time-preferences/heatmap`.
- **Sticky / locked assignments** — `is_sticky` column on the `assignments` table and a lock icon in the UI. Locked players are preserved across `auto-assign` runs.
- **JSON export / import** for full player backup & restore:
  - `GET /api/admin/players/export-json`
  - `POST /api/admin/players/import` (upserts by FID)
- **In-app guides** — `/guide` for players, `/admin/guide` for admins.
- **"Select all available times" guidance** and **unsaved-changes** confirmation on the player form.
- **±20 minute tolerance disclaimer** surfaced to players.

### Changed
- Auto-assign now reads sticky assignments first and preserves them in their slot.
- Player form and admin views display the heat map.

## [1.1.2] — 2026-03-16

### Added
- **Per-day time preferences** — `day_type` column on `time_preferences` so a player can have different availability for construction / research / troop days. Backed by an idempotent migration that backfills existing rows.
- **Player timezone** — optional `timezone` column on `players` (IANA tz string) used for display-only conversion.
- **Public schedule publishing** — independently publish/unpublish per day:
  - `PUT /api/admin/settings/publish`
  - `PUT /api/admin/settings/unpublish`
  - `GET /api/published-schedule/<day>` (returns only `game_name`, `alliance`, `time_slot` — no points or resources)
  - `GET /api/settings/published-days`
- `GET /api/player/<fid>/assignments` — players can query their own assignments after the day is published.
- `PublishedSchedule.tsx` page and `TimezoneSelector.tsx` component on the frontend.
- `RECREATION_GUIDE.md` — comprehensive from-scratch rebuild document.

### Changed
- 49 fixed 30-minute assignment slots, anchored at end-of-day (23:50): `23:50, 00:20, 00:50, ..., 23:20, 23:50+`. Player hourly preferences match within ±20 min.

## [1.1.1] — 2026-03-07

### Fixed
- Language selector no longer overlaps page content on smaller screens.

### Changed
- All translations completed across the five supported languages.

## [1.1.0] — 2026-03-06

### Added
- **WOS API integration** — `POST /api/player/wos-lookup` proxies an MD5-signed call to the Whiteout Survival player API; "Load from WOS" button auto-fills nickname, avatar, and furnace level from a FID.
- **Alliance tag** — 3-character alliance field on players, displayed as `[TAG]` next to the player name everywhere.
- **Avatars and furnace-level icons** on assignment cards and the admin player table.
- **Multi-day Excel export** (`GET /api/admin/export`) — one tab per ministry day plus an Unassigned section, with alliance as a separate column.
- **"Remove All Players"** admin action — `DELETE /api/admin/players/delete-all` with confirm-by-typing-`DELETE` in the UI.
- New player columns: `avatar_image`, `stove_lv`, `stove_lv_content`, `alliance` (added via idempotent `ALTER TABLE` migrations).

## [1.0.2] — 2026-03-06

### Added
- Admin "Edit Player" modal now lets ministers edit a player's time preferences too.

### Fixed
- Drag-and-drop assignment now persists `player_id` in the auto-assign response so subsequent moves work without a refresh.
- SPA routing: Flask now serves `index.html` for all non-API paths so React Router deep links survive page reloads.

## [1.0.0] — 2026-03-06

### Added
- Initial release of the Ministry Management System.
- **Player flow:** 3-page submission form (Information → Time Preferences → Review), update-by-FID flow, English / Korean / Chinese / Turkish / Arabic with RTL.
- **Admin flow:** password-protected dashboard with Players and Assignments tabs, point calculation per ministry day, points-based auto-assignment algorithm, drag-and-drop manual scheduling, Excel export.
- **Backend:** Flask 3.0 + SQLite, gunicorn single-worker, `PRAGMA journal_mode=DELETE` for GCS FUSE compatibility, public/admin endpoint split.
- **Frontend:** React 18 + TypeScript + Vite + Tailwind, react-i18next, @dnd-kit drag-and-drop.
- **Deployment:** multi-stage Dockerfile, `docker-compose.yml`, Google Cloud Run reference deployment with GCS FUSE.

[Unreleased]: https://github.com/4wrxb/minister-management/compare/v1.5.0...HEAD
[1.5.0]: https://github.com/4wrxb/minister-management/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/4wrxb/minister-management/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/4wrxb/minister-management/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/4wrxb/minister-management/compare/v1.1.5...v1.2.0
[1.1.5]: https://github.com/4wrxb/minister-management/compare/v1.1.2...v1.1.5
[1.1.2]: https://github.com/4wrxb/minister-management/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/4wrxb/minister-management/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/4wrxb/minister-management/compare/v1.0.2...v1.1.0
[1.0.2]: https://github.com/4wrxb/minister-management/compare/v1.0.0...v1.0.2
[1.0.0]: https://github.com/4wrxb/minister-management/releases/tag/v1.0.0
