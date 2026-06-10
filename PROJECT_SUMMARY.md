# Ministry Management System - Project Summary

## Overview

A full-stack web application for managing Whiteout Survival SVS (State vs State) ministry assignments. Players submit their speedup resources and time availability; ministers use an auto-assignment algorithm and drag-and-drop interface to schedule ministry positions. Features a dark navy and gold themed UI with 5-language support.

## Features

### Player Features
- 3-page submission form (Information > Time Preferences > Review)
- **WOS API integration** - "Load from WOS" button auto-fills game name, avatar, and furnace level
- **Alliance tag** - 3-character tag displayed as `[TAG]` next to player names
- Update submission using FID lookup (allowed even after applications close)
- FID required for all submissions
- **Application closing time** — new submissions are blocked after the deadline; existing players can still update
- **Per-day time preferences** — separate hourly availability for construction / research / troop days
- **Time-preference heat map** on slot selection (blue=low → red=high demand)
- **Published Schedule** page — players see their assigned slot once an admin publishes the day
- **Player Guide** in-app at `/guide`
- Support for all speedup types and (optionally hidden) fire crystal resources
- Multi-language support (5 languages)

### Admin Features
- Password-protected admin/minister access
- **3-tab admin dashboard**: Players, Assignments, **Settings**
- Player management table with sort, search, edit, delete, **remove all**
- Player avatars and furnace level icons displayed in tables and assignment cards
- Point calculation for all three days (Monday/Tuesday or Friday/Thursday)
- Auto-assignment algorithm based on points and time preferences
- **Sticky (locked) assignments** preserved across re-runs
- **Time-preference heat map** for visualizing player demand
- Drag-and-drop interface for manual adjustments with avatar + alliance display
- **Multi-day Excel export** (3 day tabs + unassigned tab, includes alliance column)
- **JSON export / import** for full-database backup and restore
- **Multi-day publishing** — independently publish/unpublish per day to a public read-only page
- **Settings tab** — state number, application closing time, research-day toggle (Tuesday/Friday), fire-crystal field visibility

### Technical Features
- SQLite database with persistent storage
- Docker multi-stage build (Node frontend + Python backend)
- Multiple deployment options (bare metal, Docker, Cloud Run)
- Multi-language i18n (English, Korean, Chinese, Turkish, Arabic)
- RTL support for Arabic
- Responsive design
- Dark navy/gold themed UI
- RESTful API architecture

## Technology Stack

### Backend
- **Runtime**: Python 3.11
- **Framework**: Flask 3.0
- **Database**: SQLite 3 (`PRAGMA journal_mode=DELETE` for network-FS safety)
- **Production Server**: gunicorn (single worker for SQLite safety)
- **Excel Export**: openpyxl
- **HTTP Client (WOS API)**: requests
- **CORS**: Flask-CORS
- **Environment**: python-dotenv

### Frontend
- **Framework**: React 18
- **Language**: TypeScript
- **Build Tool**: Vite
- **Styling**: Tailwind CSS (dark theme with custom color tokens)
- **Routing**: react-router-dom v6
- **Internationalization**: react-i18next + i18next (5 languages)
- **Drag-and-Drop**: @dnd-kit/core, @dnd-kit/sortable, @dnd-kit/utilities
- **Icons**: lucide-react
- **Class Utility**: clsx
- **HTTP Client**: axios

### DevOps
- **Containerization**: Docker, Docker Compose
- **Cloud Platform**: Google Cloud Run (with GCS FUSE for SQLite persistence)
- **CI/CD**: Google Cloud Build

## Project Structure

```
minister_management/
├── backend/
│   ├── app.py                 # Flask application + API routes
│   ├── database.py            # Database schema, queries, point calculations
│   └── requirements.txt       # Python dependencies
│
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Home.tsx              # Landing page
│   │   │   ├── PlayerForm.tsx        # 3-step submission form
│   │   │   ├── UpdateSubmission.tsx  # Update player data via FID
│   │   │   ├── PublishedSchedule.tsx # Public read-only schedule
│   │   │   ├── PlayerGuide.tsx       # In-app player guide at /guide
│   │   │   ├── AdminLogin.tsx        # Admin authentication
│   │   │   ├── AdminDashboard.tsx    # Admin main page (3 tabs)
│   │   │   └── AdminGuide.tsx        # In-app admin guide at /admin/guide
│   │   ├── components/
│   │   │   ├── LanguageSelector.tsx        # Language switcher
│   │   │   ├── TimezoneSelector.tsx        # UTC ↔ local conversion
│   │   │   └── admin/
│   │   │       ├── PlayerManagement.tsx        # Player CRUD table
│   │   │       ├── AssignmentManagement.tsx    # Drag-drop assignments
│   │   │       └── AdminSettings.tsx           # Settings tab content
│   │   ├── utils/
│   │   │   ├── timezone.ts                 # 30-min slot generator + tz helpers
│   │   │   └── affiliate.ts                # LootBar affiliate link helpers
│   │   ├── i18n.ts            # Translations for 5 languages
│   │   ├── App.tsx            # Main app component with routing
│   │   └── main.tsx           # Entry point
│   ├── package.json
│   └── vite.config.ts
│
├── Dockerfile                 # Multi-stage build (Node + Python)
├── docker-compose.yml         # Local development
├── .env.example              # Environment variable template
├── start.sh                  # Docker quick-start script
├── README.md                 # Project overview
├── QUICK_START.md            # 5-minute setup guide
├── USER_GUIDE.md             # End-user documentation
├── DEPLOYMENT.md             # Multi-platform deployment guide
└── PROJECT_SUMMARY.md        # This file
```

## Point Calculation System

### Monday - Construction
```
Points = (construction_days * 1440) + (general_days * 1440)
         + (refined_crystals * 30000) + (fire_crystals * 2000)
```

### Tuesday - Research
```
Points = (research_days * 1440) + (general_days * 1440)
         + (crystal_shards * 1000)
```

### Thursday - Troop Training
```
Points = troop_training_days
```

Note: 1 day = 1440 minutes

## API Endpoints

### Public
| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| POST | `/api/player/submit` | Submit or update player info (blocked for new FIDs after closing time) |
| POST | `/api/player/check-duplicate` | Check whether a FID or game name already exists |
| GET | `/api/player/:fid` | Get player by FID |
| POST | `/api/player/wos-lookup` | Lookup player from WOS API (returns name, avatar, furnace level) |
| GET | `/api/player/:fid/assignments` | Get a player's current assignments across all days |
| GET | `/api/settings/research-day` | Get the configured research day (`tuesday` or `friday`) |
| GET | `/api/settings/show-fire-crystals` | Whether fire-crystal fields are shown on the player form |
| GET | `/api/settings/published-days` | List of currently-published days |
| GET | `/api/settings/application-closing-time` | `{ closing_time, is_closed }` for the new-submission deadline |
| GET | `/api/settings/state-number` | State number used in the welcome banner (default `2694`) |
| GET | `/api/published-schedule/:day` | Public read-only schedule for a day (no resources/points) |
| GET | `/api/time-preferences/heatmap` | Player-demand counts per hour per day type |

### Admin (require Authorization header)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/admin/login` | Authenticate admin/minister, returns role + token |
| GET | `/api/admin/players` | Get all players with calculated points for each day |
| PUT | `/api/admin/player/:id` | Update player |
| DELETE | `/api/admin/player/:id` | Delete player |
| DELETE | `/api/admin/players/delete-all` | Delete all players, time preferences, and assignments |
| POST | `/api/admin/assignments/auto-assign` | Run auto-assignment for a day |
| GET | `/api/admin/assignments/:day` | Get assignments for a day (admin view, includes points) |
| POST | `/api/admin/assignments/update` | Persist manual drag-and-drop edits |
| GET | `/api/admin/export` | Export all assignments to multi-tab Excel workbook |
| GET | `/api/admin/players/export-json` | Download full player backup as JSON |
| POST | `/api/admin/players/import` | Restore players from a JSON backup (upserts by FID) |
| PUT | `/api/admin/settings/research-day` | Set research day to `tuesday` or `friday` |
| PUT | `/api/admin/settings/show-fire-crystals` | Toggle fire-crystal field visibility |
| PUT | `/api/admin/settings/application-closing-time` | Set or clear the new-submission deadline |
| PUT | `/api/admin/settings/state-number` | Set the welcome banner state number |
| PUT | `/api/admin/settings/publish` | Publish a day's schedule to the public page |
| PUT | `/api/admin/settings/unpublish` | Unpublish a day's schedule |

## Database Schema

### players
`id`, `fid` (unique, required), `game_name`, `alliance` (3-char tag), `construction_speedups_days`, `research_speedups_days`, `troop_training_speedups_days`, `general_speedups_days`, `fire_crystals`, `refined_fire_crystals`, `fire_crystal_shards`, `avatar_image` (URL from WOS API), `stove_lv` (furnace level int), `stove_lv_content` (furnace icon URL), `timezone` (IANA tz string, optional — display only), `created_at`, `updated_at`

### time_preferences
`id`, `player_id` (FK → players), `time_slot` (hourly, e.g. `14:00`), `day_type` (`construction` | `research` | `troop`)
UNIQUE(`player_id`, `time_slot`, `day_type`)

### assignments
`id`, `player_id` (FK → players), `day`, `time_slot` (30-min slot), `position`, `is_assigned`, `is_sticky` (lock flag for auto-assign), `created_at`

### settings
`key` (PRIMARY KEY), `value` (TEXT)
Known keys:
- `research_day` — `tuesday` or `friday`
- `show_fire_crystals` — `true` or `false`
- `application_closing_time` — ISO 8601 UTC datetime (or empty)
- `state_number` — string (default `2694`)
- `published_days` — comma-separated list of day names

### admin_users
`id`, `username`, `password_hash`, `role`, `created_at`
*(Placeholder table — authentication currently uses environment variable passwords. Reserved for future migration to real accounts.)*

## Key Algorithms

### Auto-Assignment
1. Calculate points for all players for the selected day
2. Sort players by points (descending — highest priority first)
3. Generate the fixed list of **49 thirty-minute candidate slots anchored at end-of-day (23:50)**:
   `23:50, 00:20, 00:50, 01:20, ..., 23:20, 23:50+`
   (`23:50` is the pre-midnight slot, `23:50+` is the end-of-day slot.)
4. Pre-fill **sticky / locked assignments** (`is_sticky = 1`) so they survive the run.
5. Map each player's hourly preferences to candidate slots with a **±20 minute tolerance window**:
   hour `H` → `(H-1):50`, `H:20`, `H:50` (hour 23's `:50` slot maps to `23:50+`).
6. Walk players in descending point order; assign to the first empty matching slot.
7. Track unassigned players (no empty matching slot) — they're returned to the UI and exported to a separate Excel tab.

### Drag-and-Drop
- Uses @dnd-kit for drag operations
- Players can be moved between time slots
- Players can be moved to/from the unassigned area
- Changes auto-save to backend on drop
- Enforces one player per time slot

## Supported Languages

1. **English** (en) - Default
2. **Korean** (ko) - 한국어
3. **Chinese** (zh) - 中文
4. **Turkish** (tr) - Türkce
5. **Arabic** (ar) - العربية (with RTL support)

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for complete instructions covering:
- Bare metal (gunicorn + nginx/Caddy)
- Docker / Docker Compose
- Google Cloud Run (with GCS FUSE)
- AWS, Azure, DigitalOcean, and PaaS platforms

## Security

- Password-protected admin panel (environment variable credentials)
- CORS protection
- SQL injection prevention (parameterized queries)
- Input validation on all API endpoints

> **Note:** This application is designed for trusted users within a game state. It does not include production-grade security features like rate limiting, CSRF protection, OAuth, or audit logging.

## Testing Checklist

### Player Flow
- [ ] Submit new application with all fields
- [ ] Submit without FID (should fail validation)
- [ ] Update existing player via FID lookup
- [ ] Switch languages, verify translations
- [ ] Test Arabic RTL layout

### Admin Flow
- [ ] Login with correct/incorrect password
- [ ] View, sort, search player list
- [ ] Edit and delete players
- [ ] Auto-assign for Monday, Tuesday, Thursday
- [ ] Drag-and-drop between time slots
- [ ] Export to Excel

### Deployment
- [ ] Docker build and run
- [ ] Database persistence across restarts
- [ ] Health check endpoint
- [ ] Mobile responsiveness

---

**Version**: See [CHANGELOG.md](CHANGELOG.md) for the full release history.
**Last Updated**: June 2026
**Status**: Production
