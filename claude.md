# Claude Context: Ministry Management System

> Purpose of this file: the single authoritative reference for this project — architecture, business logic, schema, API, development rules, and completion requirements. [`.github/copilot-instructions.md`](.github/copilot-instructions.md) is a short pointer to this file plus the CI validation commands.

## Project Overview

A web application that automates State vs State (SVS) ministry-position scheduling for the mobile game *Whiteout Survival*. Players submit their speedup resources, fire-crystal inventory, and hourly availability; an admin/minister runs a point-based auto-assignment, drags-and-drops players to fine-tune, and publishes the schedule to a public read-only page.

## Tech Stack

**Backend:**
- Python 3.11+ with Flask 3.0 (single-worker gunicorn in production)
- SQLite (via `sqlite3` stdlib) with `PRAGMA journal_mode=DELETE`
- `openpyxl` for Excel export, `requests` for the WOS API client, `python-dotenv` for config, `Flask-CORS`
- Location: `backend/` — entry point `backend/app.py`, schema/queries in `backend/database.py`

**Frontend:**
- React 18 + TypeScript + Vite
- Tailwind CSS (custom dark navy + gold theme)
- `react-router-dom` v6 for routing
- `react-i18next` + `i18next` for i18n (5 languages)
- `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` for drag-and-drop
- `axios` for HTTP, `lucide-react` for icons, `clsx` for class merging
- Location: `frontend/` — entry point `frontend/src/main.tsx`

**Deployment:**
- Docker + Docker Compose for local development
- Multi-stage Docker build (Node build → Python runtime serving built assets from `backend/static/`)
- Production target is cloud-agnostic; common targets include Google Cloud Run (with GCS FUSE), Azure App Service (multi-container with a Cloudflare Tunnel sidecar, Azure Files for SMB persistence), AWS ECS/Fargate (with EFS), and Azure Container Apps. See `DEPLOYMENT.md`.
- Azure Container Apps has an automated, config-driven GitHub Actions pipeline: workflow at `.github/workflows/deploy-aca.yml`, Bicep templates in `infra/`, operator guide in `.github/DEPLOYMENT_WORKFLOW.md`. Deploys are pinned to `:<github.sha>` so each commit on `main` produces a new revision; re-dispatching against the same SHA is a no-op.

## Project Structure

```
minister_management/
├── backend/
│   ├── app.py                          # Flask app + ALL API endpoints (~1100 lines)
│   ├── database.py                     # Schema, migrations, settings helpers, point calculation
│   ├── requirements.txt
│   └── static/                         # Built frontend (created by Docker build / `npm run build`)
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Home.tsx                # Landing page (welcome, status, links)
│   │   │   ├── PlayerForm.tsx          # 3-step new-submission flow
│   │   │   ├── UpdateSubmission.tsx    # Update by FID
│   │   │   ├── PublishedSchedule.tsx   # Public read-only schedule
│   │   │   ├── PlayerGuide.tsx         # In-app guide at /guide
│   │   │   ├── AdminLogin.tsx
│   │   │   ├── AdminDashboard.tsx      # Tabs: Players / Assignments / Settings
│   │   │   └── AdminGuide.tsx          # In-app guide at /admin/guide
│   │   ├── components/
│   │   │   ├── LanguageSelector.tsx
│   │   │   ├── TimezoneSelector.tsx    # Per-user UTC ↔ local conversion
│   │   │   └── admin/
│   │   │       ├── PlayerManagement.tsx
│   │   │       ├── AssignmentManagement.tsx
│   │   │       └── AdminSettings.tsx
│   │   ├── utils/
│   │   │   ├── timezone.ts             # generateAssignmentSlots(), formatTimeInTimezone()
│   │   │   └── affiliate.ts            # LootBar affiliate link helpers
│   │   ├── i18n.ts                     # Translations: en, ko, zh, tr, ar
│   │   ├── App.tsx                     # Router
│   │   ├── main.tsx
│   │   └── index.css
│   ├── package.json
│   └── vite.config.ts
├── data/                               # SQLite db (created at runtime; gitignored)
├── infra/                              # Bicep templates for Azure Container Apps deploy
│   ├── main.bicep                      # Top-level: RG-scoped wiring
│   ├── main.parameters.json            # Parameter contract (keys must match main.bicep)
│   ├── storage.bicep                   # Storage account + file share for SQLite
│   ├── aca.bicep                       # Container Apps env + Container App
│   └── README.md
├── .github/
│   ├── copilot-instructions.md         # Agent guardrails
│   ├── DEPLOYMENT_WORKFLOW.md          # Operator guide for deploy-aca.yml
│   └── workflows/
│       ├── copilot-setup-steps.yml
│       ├── deploy-aca.yml              # Staged Azure Container Apps deploy pipeline
│       ├── docker-integration.yml      # Required check: smoke + E2E + lint + tests
│       ├── backend-tests.yml
│       └── frontend-tests.yml
├── Dockerfile                          # Multi-stage: Node 18 → Python 3.11
├── docker-compose.yml
├── start.sh
├── .env.example
├── README.md
├── QUICK_START.md
├── USER_GUIDE.md
├── DEPLOYMENT.md
├── PROJECT_SUMMARY.md
├── RECREATION_GUIDE.md
├── CHANGELOG.md
└── claude.md                           # This file
```

## Important Business Logic

<!-- Point Calculation System content lives here; owned by point-calc PR -->

### Auto-Assignment Algorithm

Located in `backend/app.py` → `POST /api/admin/assignments/auto-assign`.

1. Look up the configured research day (`tuesday` or `friday`) and validate the requested `day` (`monday`, research day, or `thursday`).
2. Map the day to a `day_type` (`construction`, `research`, `troop`) and fetch each player's hourly time preferences for that day type from the `time_preferences` table.
3. Calculate points per player for the day (see Point Calculation section above) and sort descending.
4. Generate a **fixed list of 49 candidate 30-minute slots, anchored at end-of-day (23:50)** rather than midnight. The sequence is:

   ```
   23:50, 00:20, 00:50, 01:20, ..., 22:20, 22:50, 23:20, 23:50+
   ```

   - `23:50` = the pre-midnight slot (logically belongs to the previous day's tail).
   - `23:50+` = the end-of-day slot (logically the day's final slot).
   - The two are distinct identifiers stored in the DB; the UI renders `23:50+` as `23:50 (+1d)`.
5. **Match player hourly preferences with a ±20 minute tolerance window.** Each hour `H` selected by the player maps to three candidate slots:
   - `(H-1):50` — starts 10 minutes before the hour
   - `H:20` — starts 20 minutes after the hour
   - `H:50` — starts 50 minutes after the hour (for `H=23`, this maps to `23:50+`)
6. Walk players in points-descending order. For each, try their candidate slots and assign to the first empty one. Players with no matching free slot land in the unassigned list.
7. **Sticky (locked) assignments** (`assignments.is_sticky = 1`) are loaded first and pinned to their slot before the points-based pass runs; their players are skipped in step 6.
8. Persist by deleting existing rows for `day` and re-inserting the resulting assignments.

### Database Schema

> Single source of truth: `backend/database.py` (table creation + idempotent migrations).

**players**
- `id` INTEGER PK, `fid` TEXT UNIQUE NOT NULL, `game_name` TEXT NOT NULL
- `alliance` TEXT (3-char tag, e.g. `ABC`)
- Speedups (REAL, days): `construction_speedups_days`, `research_speedups_days`, `troop_training_speedups_days`, `general_speedups_days`
- Fire-crystal resources (INTEGER): `fire_crystals`, `refined_fire_crystals`, `fire_crystal_shards`
- WOS API enrichment: `avatar_image` (URL), `stove_lv` (furnace level int), `stove_lv_content` (furnace icon URL)
- User preference: `timezone` (IANA tz string, optional — used for display only)
- Timestamps: `created_at`, `updated_at`

**time_preferences**
- `id`, `player_id` FK, `time_slot` TEXT (hourly, e.g. `14:00`), `day_type` TEXT (`construction` | `research` | `troop`)
- UNIQUE(`player_id`, `time_slot`, `day_type`)

**assignments**
- `id`, `player_id` FK, `day` TEXT (`monday` | `tuesday`/`friday` | `thursday`), `time_slot` TEXT (30-min slot), `position` INTEGER, `is_assigned` BOOLEAN, `is_sticky` BOOLEAN, `created_at`
- UNIQUE(`day`, `time_slot`, `position`)

**settings** (key-value store)
- `key` PK, `value` TEXT
- Known keys: `research_day` (`tuesday`/`friday`), `show_fire_crystals` (`true`/`false`), `application_closing_time` (ISO 8601 UTC), `state_number` (string, default `2694`), `published_days` (comma-separated list of day names)

**admin_users**
- `id`, `username`, `password_hash`, `role`, `created_at`
- *Currently unused* — auth is by env-var passwords. Table is reserved for future migration to real accounts.

## Key Design Decisions

### 1. Player ID (FID) is Required
- FID is the WOS in-game player ID. The player provides it; the app never generates one.
- It is the upsert key for submissions and the lookup key for updates.
- Validated on both frontend and backend.

### 2. Time-Slot Model
- **Player preferences** are entered in **1-hour increments** (`00:00`–`23:00`).
- Preferences are stored **per day type** (`construction`, `research`, `troop`) so a player can have different availability per ministry.
- **Assignment slots** are **30-minute, end-of-day-anchored** — 49 fixed slots `23:50, 00:20, 00:50, ..., 23:20, 23:50+`.
- The matcher uses a **±20 min tolerance window** — a player who picks hour `H` is eligible for `(H-1):50`, `H:20`, and `H:50`. This is surfaced to players as the "+/- 20 min tolerance" disclaimer.

### 3. Multi-Language Support
- 5 languages: English (en), Korean (ko), Chinese (zh), Turkish (tr), Arabic (ar)
- RTL support for Arabic
- All UI text lives in `frontend/src/i18n.ts`
- Language state managed via `react-i18next`

### 4. Authentication
- Two passwords (`ADMIN_PASSWORD`, `MINISTER_PASSWORD`) compared in cleartext against env-var values.
- Login returns a fixed token (`admin-token` or `minister-token`) that must be sent as the `Authorization` header on admin endpoints.
- Both roles currently have identical permissions. Not production-grade — appropriate for a trusted-user game-state context.
- Tokens are kept in `localStorage`.

### 5. Settings Are App-Configurable, Not Just Env Vars
- Things admins can tune at runtime (research day, fire-crystal field visibility, application closing time, state number, published days) live in the `settings` table, not in environment variables.
- Helpers: `get_setting(key, default)` / `set_setting(key, value)` in `database.py`.

### 6. WOS API Integration
- `POST /api/player/wos-lookup` proxies an MD5-signed request to `https://wos-giftcode-api.centurygame.com/api/player` to fetch nickname, avatar, and furnace level by FID.
- The signing secret is read from `WOS_API_SECRET` env var (with a fallback constant — should be overridden in production).

### 7. Sticky / Locked Assignments
- The UI lock icon toggles `assignments.is_sticky` for a row.
- Auto-assign preserves sticky rows verbatim and only fills the remaining slots from the points-sorted player list.

### 8. Multi-Day Publishing
- Each day (`monday`, research day, `thursday`) is independently publishable.
- Stored as a comma-separated `published_days` setting.
- Public schedule endpoint exposes only `game_name`, `alliance`, and `time_slot` — never points or resources.

### 9. Heat Map
- The public `GET /api/time-preferences/heatmap` endpoint returns counts of how many players selected each hour per day type. Used by the player form to color the time-pref grid (blue=low → red=high) and by the admin assignments view.

### 10. Export / Import
- Excel export (`GET /api/admin/export`) builds a 3-tab `.xlsx` (one per ministry day), each with an "Unassigned Players" section appended.
- JSON export/import (`GET /api/admin/players/export-json`, `POST /api/admin/players/import`) is for full-database backup and migration. Import upserts by FID.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `FLASK_ENV` | `development` or `production` | `production` |
| `SECRET_KEY` | Flask secret key | `dev-secret-key` |
| `ADMIN_PASSWORD` | Admin login password | `admin123` ⚠️ change before deployment |
| `MINISTER_PASSWORD` | Minister login password | `minister123` ⚠️ change before deployment |
| `DATABASE_PATH` | Path to the SQLite file | `/data/minister.db` |
| `WOS_API_SECRET` | MD5 signing secret for WOS API calls | (hardcoded fallback — override in production) |
| `PORT` | HTTP listen port | `8080` |
| `URL_PREFIX` | Mount the Flask app under a sub-path (e.g. `/ministry`) when behind a path-based reverse proxy. `/health` stays at the root for platform health probes. Wired via `DispatcherMiddleware` at the bottom of `backend/app.py`. The frontend bundle is prefix-agnostic — `backend/app.py` injects a `<base href="${URL_PREFIX}/">` and `<meta name="app-base">` tag into `index.html` at request time (cached per prefix), so the same Docker image works at any prefix without a rebuild. | _(empty — serve at root)_ |
| `SQLITE_VFS` | SQLite VFS override threaded into `sqlite3.connect` in `backend/database.py`. Set to `unix-dotfile` when `DATABASE_PATH` lives on SMB/CIFS (e.g. Azure Files) so SQLite uses on-disk lock files instead of POSIX `fcntl` byte-range locks. Leave unset on local disks and GCS FUSE. | _(unset)_ |

## Running Locally

### Quick Start (Docker Compose)
```bash
cp .env.example .env
# Edit .env (change the two default passwords!)
docker compose up --build
# http://localhost:8080
```

### Bare-Metal Dev
```bash
# Backend
cd backend
python -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements.txt
python app.py                 # http://localhost:8080

# Frontend (separate terminal — proxies API to :8080)
cd frontend
npm install
npm run dev                   # http://localhost:5173
```

## API Endpoints

> Single source of truth: `backend/app.py`. If you add a route, list it here AND in `PROJECT_SUMMARY.md` AND in `RECREATION_GUIDE.md`.

### Public

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/` (and `/<path:path>`) | SPA fallback — serves the React app |
| POST | `/api/player/submit` | Submit/update player info (blocked for new FIDs after closing time) |
| POST | `/api/player/check-duplicate` | Check whether a FID or game name is already in use |
| GET | `/api/player/<fid>` | Get a player by FID |
| POST | `/api/player/wos-lookup` | Fetch nickname/avatar/furnace level from the WOS game API |
| GET | `/api/player/<fid>/assignments` | Get a player's current assignments across all days |
| GET | `/api/settings/research-day` | Returns `tuesday` or `friday` |
| GET | `/api/settings/show-fire-crystals` | Whether fire-crystal fields are shown to players |
| GET | `/api/settings/published-days` | List of currently-published days |
| GET | `/api/settings/application-closing-time` | `{ closing_time, is_closed }` |
| GET | `/api/settings/state-number` | State number (default `2694`) |
| GET | `/api/published-schedule/<day>` | Public read-only schedule for a day (no resources/points) |
| GET | `/api/time-preferences/heatmap` | Demand counts per hour per day type |

### Admin (require `Authorization: admin-token` or `minister-token`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/admin/login` | Authenticate, returns role + token |
| GET | `/api/admin/players` | All players with calculated points for each day |
| PUT | `/api/admin/player/<id>` | Update one player |
| DELETE | `/api/admin/player/<id>` | Delete one player |
| DELETE | `/api/admin/players/delete-all` | Delete all players, time prefs, and assignments |
| POST | `/api/admin/assignments/auto-assign` | Run the assignment algorithm for a day |
| GET | `/api/admin/assignments/<day>` | Get assignments for a day (admin view, includes points) |
| POST | `/api/admin/assignments/update` | Persist manual drag-and-drop edits |
| GET | `/api/admin/export` | Download multi-tab Excel workbook |
| GET | `/api/admin/players/export-json` | Download full player backup as JSON |
| POST | `/api/admin/players/import` | Restore players from a JSON backup (upserts by FID) |
| PUT | `/api/admin/settings/research-day` | Set research day to `tuesday` or `friday` |
| PUT | `/api/admin/settings/show-fire-crystals` | Toggle fire-crystal field visibility |
| PUT | `/api/admin/settings/application-closing-time` | Set/clear the new-submission deadline |
| PUT | `/api/admin/settings/state-number` | Set the welcome banner's state number |
| PUT | `/api/admin/settings/publish` | Publish a day's schedule to the public page |
| PUT | `/api/admin/settings/unpublish` | Unpublish a day's schedule |

## Common Tasks

### Adding a New Language
1. Add the language code and translation block in `frontend/src/i18n.ts`.
2. Add the language to the `languages` array in `frontend/src/components/LanguageSelector.tsx`.
3. If RTL, ensure `dir="rtl"` handling is consistent with Arabic.

### Modifying Point Calculation
1. Edit `calculate_points()` in `backend/database.py`.
2. Update the Point Calculation section of `README.md`, `PROJECT_SUMMARY.md`, `USER_GUIDE.md`, and `claude.md`.
3. No DB migration needed — points are calculated on the fly.

### Adding a New Resource / Player Field
1. Add the column to the `players` table in `backend/database.py` (use the idempotent migrations list).
2. Update `save_player()` and `get_player_by_fid()` / `get_all_players()` to read/write it.
3. Add the field to the form in `frontend/src/pages/PlayerForm.tsx` and admin edit modal in `PlayerManagement.tsx`.
4. Update `calculate_points()` if it affects points.
5. Add translation keys in `frontend/src/i18n.ts`.
6. Update `claude.md`, `PROJECT_SUMMARY.md`, and `RECREATION_GUIDE.md` to mention the new column.

### Adding an API Endpoint
1. Add the route in `backend/app.py`.
2. Update the API tables in `claude.md`, `PROJECT_SUMMARY.md`, and `RECREATION_GUIDE.md`.
3. Add the changelog entry to `CHANGELOG.md`.

### Changing Time-Slot Granularity
1. Backend: `generateTimeSlots`-style block at the top of `auto_assign()` in `backend/app.py` and the matching-window math beneath it.
2. Frontend: `generateAssignmentSlots()` in `frontend/src/utils/timezone.ts`.
3. Update USER_GUIDE.md "Time Slots" section and the slot-model section in `claude.md` / `PROJECT_SUMMARY.md` / `RECREATION_GUIDE.md`.

## Testing Guidelines

### Manual Checklist
- [ ] Submit player with all fields (including alliance tag and WOS lookup)
- [ ] Submit without FID → fails
- [ ] Update existing player by FID
- [ ] Auto-assign for Monday, Tuesday/Friday, Thursday
- [ ] Drag-drop players between slots; verify single-occupancy
- [ ] Lock a player (sticky); re-run auto-assign; verify they stay put
- [ ] Publish Monday only; check public page shows Monday, hides others
- [ ] Toggle research day Tuesday → Friday; re-run auto-assign
- [ ] Set application closing time in the past → new submissions blocked, updates still allowed
- [ ] Toggle fire-crystal fields off → player form hides those fields
- [ ] Excel export downloads with all three day tabs + Unassigned section
- [ ] JSON export → wipe DB → JSON import → players restored
- [ ] Switch languages (especially Arabic RTL)

### Edge Cases
- Player with no time preferences for a given day type
- Player with 0 points
- More players than slots
- Heat-map response with empty data
- Closing-time setting with bad ISO string (logged, not crashed)
- WOS API timeout / 4xx
- Database not yet created on first boot

## Known Limitations

1. **Authentication** — env-var passwords, no hashing, no session expiry.
2. **SQLite concurrency** — single gunicorn worker required.
3. **No notifications** — players check the published page manually.
4. **Single state** — no multi-tenant support.
5. **No audit log** — admin actions aren't tracked historically.
6. **`admin_users` table is unused** — reserved for future real-account auth.

## Development Workflow

### Making Changes
1. Backend changes: Flask auto-reloads when `FLASK_ENV=development`.
2. Frontend changes: Vite HMR.
3. Schema changes: append to the migrations list in `database.py` (idempotent `ALTER TABLE`).
4. Translations: edit `i18n.ts`; Vite hot-reloads.
5. For deployment options, see `DEPLOYMENT.md`.

### Before Committing
- Update **all** affected docs in the same change:
  - User-facing: `README.md`, `QUICK_START.md`, `USER_GUIDE.md`, `DEPLOYMENT.md`
  - Internal: `claude.md`, `PROJECT_SUMMARY.md`, `RECREATION_GUIDE.md`, `CHANGELOG.md`
- Add or update tests: backend unit tests for API/schema/logic changes, frontend unit tests for component/UI changes, Playwright E2E for user-visible or cross-page flows.
- Run the validation commands in [`.github/copilot-instructions.md`](.github/copilot-instructions.md) and confirm tests pass.
- Test in English plus one RTL language (Arabic).
- Verify mobile responsiveness for any UI change.

### Deployment
See `DEPLOYMENT.md` for bare metal, Docker, Cloud Run, Azure App Service (+ Cloudflare Tunnel sidecar), AWS, and PaaS options, plus a platform-agnostic Cloudflare integration guide.

## Deployment Lessons Learned

### GCS FUSE Requires `journal_mode=DELETE`
SQLite WAL mode creates `-shm` and `-wal` sidecar files. GCS FUSE cannot handle out-of-order writes to these files (`BufferedWriteHandler.OutOfOrderError`). Fix: `PRAGMA journal_mode=DELETE` in `database.py` → `init_db()`.

### Cloud Run Needs `--min-instances 1`
Without it, Cloud Run scales to zero, triggering crash loops on cold start with GCS FUSE and 429 "Rate Exceeded" responses to users. One warm instance avoids this.

### Single Gunicorn Worker for SQLite
The Dockerfile uses `--workers 1 --threads 2`. Multiple workers cause concurrent writes that break SQLite on networked filesystems.

### Cloud Run gen2 Required for GCS FUSE
Volume mounts require `--execution-environment gen2`. Gen1 won't work.

### Azure Files (SMB) Requires `SQLITE_VFS=unix-dotfile`
SMB/CIFS does not honour POSIX `fcntl` byte-range locks reliably. Without the override, the default SQLite VFS races on the lock bytes and produces `OperationalError: database is locked` and corrupted writes. Setting `SQLITE_VFS=unix-dotfile` (read by `get_db()` in `database.py`) makes SQLite use on-disk lock files instead. Pair this with `journal_mode=DELETE` (already set) on any network filesystem.

### Sub-path Hosting Uses Runtime `<base href>` Injection
When the app is hosted at e.g. `https://example.com/ministry/`, set `URL_PREFIX=/ministry` on the container. That's it — the same Docker image works at any prefix without a rebuild. Mechanism:

- The Vite bundle is built with `base: './'`, so emitted asset URLs are relative (`./assets/index-abc123.js`).
- `serve()` in `backend/app.py` reads `index.html` once, splices `<base href="/ministry/">` and `<meta name="app-base" content="/ministry">` into `<head>`, and caches the rewritten HTML per `request.script_root` (`_INDEX_HTML_CACHE`).
- HTML5 resolves the relative `./assets/…` URLs against `<base href>`, so they become `/ministry/assets/…` regardless of which SPA route served `index.html`.
- The frontend reads `<meta name="app-base">` via `getAppBase()` (`frontend/src/utils/appBase.ts`) and feeds the result to `<BrowserRouter basename>` (`App.tsx`) and `axios.defaults.baseURL` (`main.tsx`).
- `DispatcherMiddleware` (bottom of `app.py`) mounts the Flask app under `URL_PREFIX` while keeping `/health` at the root so platform health probes don't need to be prefix-aware.

If `URL_PREFIX` is empty, `<base href="/">` is injected and the app serves at the root unchanged.

## Troubleshooting

### Backend won't start
- `.env` missing / `DATABASE_PATH` not set
- Virtual environment not activated
- Port 8080 already in use

### Frontend won't start
- Clear npm cache (permissions issues on Windows)
- Node 18+ required
- Vite proxy expects backend on `:8080`

### Database errors
- Bad `DATABASE_PATH` (directory must exist or be creatable)
- Permission denied → check write access
- Locked database → close other connections, ensure single gunicorn worker

### Drag-drop not working
- All three `@dnd-kit/*` packages installed?
- Check the browser console for errors

## File Conventions

### Code Style
- **Backend:** PEP 8, 4-space indent.
- **Frontend:** TypeScript, 2-space indent, functional components with hooks.
- **CSS:** Tailwind utility classes. Avoid hand-written CSS.

### Naming
- **React components:** `PascalCase.tsx`
- **Functions:** `camelCase`
- **API routes:** kebab-case (`/api/admin/players/delete-all`)
- **DB columns:** `snake_case`

### File Organization
- Top-level routes → `pages/`
- Reusable UI → `components/`
- Admin-only UI → `components/admin/`
- Shared helpers → `utils/`
- Translations → `i18n.ts`

## Security Considerations

⚠️ **This application is designed for trusted users within a single game state.**

### Currently Implemented
- Password-based admin/minister access (env vars)
- CORS enabled for the frontend origin
- Parameterized SQL (no string concatenation)
- Numeric input validation with min/max bounds on submission
- Logging of login attempts and admin destructive actions

### NOT Implemented
- Rate limiting
- CSRF protection
- Password hashing
- Session expiry / refresh
- Audit log of admin changes
- Encryption at rest
- Multi-tenant isolation

### Before Public Production Use
- ⚠️ Change `ADMIN_PASSWORD` and `MINISTER_PASSWORD` away from the defaults (`admin123` / `minister123`).
- Use a real secret store (Cloud Secret Manager, Key Vault, etc.) for credentials.
- Add HTTPS at the edge (reverse proxy, Cloud Run domain mapping, etc.).
- Consider OAuth / SSO if exposing beyond a trusted group.

## Support & Resources

- **Main Docs:** [README.md](README.md)
- **Quick Start:** [QUICK_START.md](QUICK_START.md)
- **User Guide:** [USER_GUIDE.md](USER_GUIDE.md)
- **Deployment:** [DEPLOYMENT.md](DEPLOYMENT.md)
- **ACA Deploy Workflow:** [.github/DEPLOYMENT_WORKFLOW.md](.github/DEPLOYMENT_WORKFLOW.md)
- **Technical Overview:** [PROJECT_SUMMARY.md](PROJECT_SUMMARY.md)
- **From-Scratch Rebuild:** [RECREATION_GUIDE.md](RECREATION_GUIDE.md)
- **Change Log:** [CHANGELOG.md](CHANGELOG.md)
- **This File:** `claude.md` (AI assistant primer)

## Version History

See [CHANGELOG.md](CHANGELOG.md) for the full release history. Recent highlights:

- **v1.3.0 — Security hardening:** input validation, structured logging, FID-tagged actions, hardened defaults.
- **v1.2.0 — Settings & publishing:** Settings tab (state number, closing time, research-day toggle, fire-crystal visibility), application closing time, multi-day publish/unpublish, LootBar affiliate integration.
- **v1.1.5 — Heat map & UX:** time-preference heat map, sticky/locked assignments, JSON export/import, player & admin guides, "select all available times" guidance, unsaved-changes warnings.
- **v1.1.2 — Schedule visibility:** per-day time preferences (`day_type`), `timezone` column, public published-schedule pages, `/api/player/<fid>/assignments`.
- **v1.1.0 — WOS API:** `/api/player/wos-lookup`, alliance tag, avatars + furnace levels in admin views, multi-day Excel export, "Remove All Players".
- **v1.0.0 — Initial release:** 3-page submission form, admin dashboard, auto-assignment, drag-and-drop, Excel export, 5 languages.

---

**Last Updated:** June 2026
**Maintained By:** State Technical Administrator
**Purpose:** Ministry assignment automation for Whiteout Survival SVS events
