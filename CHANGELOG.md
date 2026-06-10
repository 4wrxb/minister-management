# Changelog

All notable changes to the Ministry Management System are documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- Documentation aligned with the current codebase: `claude.md` rewritten end-to-end, `PROJECT_SUMMARY.md` schema and API tables completed, README project structure and tech stack tables refreshed.
- Slot-model description corrected across all docs. The auto-assigner uses a fixed 49-slot, end-of-day-anchored cadence (`23:50, 00:20, 00:50, ..., 23:20, 23:50+`) with a ±20 minute tolerance window — not "00:00 through 23:30".
- Default `admin123` / `minister123` passwords are now called out with explicit ⚠️ warnings in `README.md`, `DEPLOYMENT.md`, and `.env.example`.
- Hardcoded personal domain replaced with a `<your-domain.example.com>` placeholder in `DEPLOYMENT.md`.
- `.github/copilot-instructions.md` now requires future agents to update `claude.md`, `PROJECT_SUMMARY.md`, and `RECREATION_GUIDE.md` whenever API endpoints, DB columns, or env vars change.

### Added
- This `CHANGELOG.md`.

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

[Unreleased]: https://github.com/4wrxb/minister-management/compare/v1.3.0...HEAD
[1.3.0]: https://github.com/4wrxb/minister-management/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/4wrxb/minister-management/compare/v1.1.5...v1.2.0
[1.1.5]: https://github.com/4wrxb/minister-management/compare/v1.1.2...v1.1.5
[1.1.2]: https://github.com/4wrxb/minister-management/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/4wrxb/minister-management/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/4wrxb/minister-management/compare/v1.0.2...v1.1.0
[1.0.2]: https://github.com/4wrxb/minister-management/compare/v1.0.0...v1.0.2
[1.0.0]: https://github.com/4wrxb/minister-management/releases/tag/v1.0.0
