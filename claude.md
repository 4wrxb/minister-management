# Claude Context: Ministry Management System

## Project Overview

This is a **Ministry Management System** for Whiteout Survival game, specifically for managing State vs State (SVS) ministry assignments. The application automates the process of assigning ministry positions to players based on their resources (speedups, fire crystals) and time availability.

## Tech Stack

**Backend:**
- Python 3.11+ with Flask 3.0
- SQLite database
- Location: `backend/`
- Entry point: `backend/app.py`
- Database logic: `backend/database.py`

**Frontend:**
- React 18 with TypeScript
- Vite (build tool)
- Tailwind CSS (styling)
- react-i18next (internationalization)
- @dnd-kit (drag and drop)
- Location: `frontend/`
- Entry point: `frontend/src/main.tsx`

**Deployment:**
- Docker + Docker Compose for local development
- Google Cloud Run for production
- SQLite database with persistent storage

## Project Structure

```
minister_management/
├── backend/
│   ├── app.py              # Main Flask application, API endpoints
│   ├── database.py         # Database schema, queries, point calculations
│   ├── requirements.txt    # Python dependencies
│   └── .env               # Environment variables (gitignored)
├── frontend/
│   ├── src/
│   │   ├── pages/         # Main page components
│   │   │   ├── Home.tsx              # Landing page
│   │   │   ├── PlayerForm.tsx        # 3-page submission form
│   │   │   ├── UpdateSubmission.tsx  # Update existing submission
│   │   │   ├── AdminLogin.tsx        # Admin authentication
│   │   │   └── AdminDashboard.tsx    # Admin main interface
│   │   ├── components/
│   │   │   ├── LanguageSelector.tsx  # Language switcher
│   │   │   └── admin/
│   │   │       ├── PlayerManagement.tsx      # CRUD table for players
│   │   │       └── AssignmentManagement.tsx  # Drag-drop assignments
│   │   ├── i18n.ts        # Translations (EN, KO, ZH, TR, AR)
│   │   ├── App.tsx        # Main app with routing
│   │   └── main.tsx       # Entry point
│   ├── package.json
│   └── vite.config.ts
├── data/                  # SQLite database (created at runtime)
├── Dockerfile
├── docker-compose.yml
├── .env.example
└── Documentation files (.md)
```

## Important Business Logic

### Point Calculation System

Located in: `backend/database.py` → `calculate_points()` function

**Monday (Construction Day):**
```python
points = (construction_speedups_days * 1440) + (general_speedups_days * 1440)
         + (refined_fire_crystals * 30000) + (fire_crystals * 2000)
```

**Tuesday (Research Day):**
```python
points = (research_speedups_days * 1440) + (general_speedups_days * 1440)
         + (fire_crystal_shards * 1000)
```

**Thursday (Troop Training Day):**
```python
points = troop_training_speedups_days  # 1 point per day
```

Note: 1 day = 1440 minutes

### Auto-Assignment Algorithm

Located in: `backend/app.py` → `/api/admin/assignments/auto-assign`

1. Calculates points for all players for the selected day
2. Sorts players by points (descending)
3. Reads the configured slot offset (`-20`, `-15`, `-10`, or `0`) and generates the matching 30-minute slots. Offset `0` → 48 aligned slots (`00:00, 00:30, …`); any other offset → 49 slots, including a `23:MM-1` pre-day entry that runs past midnight.
4. Matches each player hourly preference to every slot whose window overlaps that hour by ≥ 10 minutes
5. Assigns highest-point players first to their preferred slots
6. Tracks unassigned players

### Database Schema

**players:**
- `id`, `fid` (unique player identifier, REQUIRED)
- `game_name`, `alliance` (3-char tag, optional)
- Speedups: `construction_speedups_days`, `research_speedups_days`, `troop_training_speedups_days`, `general_speedups_days`
- Resources: `fire_crystals`, `refined_fire_crystals`, `fire_crystal_shards`
- WOS API data: `avatar_image` (URL), `stove_lv` (furnace level int), `stove_lv_content` (furnace icon URL)
- Timestamps: `created_at`, `updated_at`

**time_preferences:**
- `id`, `player_id`, `time_slot`
- One row per time slot preference

**assignments:**
- `id`, `player_id`, `day`, `time_slot`, `position`, `is_assigned`
- Stores final ministry assignments per day

## Key Design Decisions

### 1. Player ID (FID) is Required
- Players MUST provide their own FID
- No auto-generation
- Used for updating submissions
- Validation enforced on both frontend and backend

### 2. Time Slot Granularity
- Players select preferences in 1-hour increments (00:00 to 23:00)
- System assigns in 30-minute increments at an admin-configurable offset (`-20`, `-15`, `-10`, or `0`) from each half-hour boundary
- Each hourly preference covers 2 slots (offset `0`) or 3 slots (any non-zero offset)
- Pre-day slot IDs carry a `-1` suffix (e.g. `23:50-1`); end-of-day slot IDs remain plain (`23:50`)

### 3. Multi-Language Support
- 5 languages: English, Korean, Chinese, Turkish, Arabic
- RTL support for Arabic
- All UI text in `frontend/src/i18n.ts`
- Language state managed via react-i18next

### 4. Authentication
- Simple password-based auth for admin/minister
- Two passwords (same permissions): ADMIN_PASSWORD, MINISTER_PASSWORD
- Tokens stored in localStorage
- Not production-grade security - meant for trusted users

## Environment Variables

Located in: `.env` (created from `.env.example`)

Required variables:
```env
FLASK_ENV=development|production
SECRET_KEY=flask-secret-key
ADMIN_PASSWORD=admin-password
MINISTER_PASSWORD=minister-password
DATABASE_PATH=/path/to/minister.db
PORT=8080
```

## Running Locally

### Quick Start
```bash
# Backend
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python app.py
# Runs on http://localhost:8080

# Frontend (new terminal)
cd frontend
npm install
npm run dev
# Runs on http://localhost:5173
```

### With Docker
```bash
docker compose up --build
# Runs on http://localhost:8080
```

## API Endpoints

### Public Endpoints
- `POST /api/player/submit` - Submit/update player info
- `GET /api/player/<fid>` - Get player by FID
- `POST /api/player/wos-lookup` - Lookup player from WOS API (returns nickname, avatar, furnace level)
- `GET /health` - Health check

### Admin Endpoints (require Authorization header)
- `POST /api/admin/login` - Authenticate
- `GET /api/admin/players` - Get all players with calculated points
- `PUT /api/admin/player/<id>` - Update player
- `DELETE /api/admin/player/<id>` - Delete player
- `DELETE /api/admin/players/delete-all` - Delete all players
- `POST /api/admin/assignments/auto-assign` - Run auto-assignment
- `GET /api/admin/assignments/<day>` - Get assignments for day
- `POST /api/admin/assignments/update` - Save manual assignments
- `GET /api/admin/export` - Export all-day Excel workbook (Monday, Tuesday, Thursday tabs + Unassigned)

## Common Tasks

### Adding a New Language
1. Edit `frontend/src/i18n.ts`
2. Add new language code to resources
3. Add translation keys matching existing structure
4. Update `languages` array in `LanguageSelector.tsx`

### Modifying Point Calculation
1. Edit `backend/database.py` → `calculate_points()` function
2. Update documentation in README.md and USER_GUIDE.md
3. No database migration needed (calculated on-the-fly)

### Adding New Resource Types
1. Add column to players table in `backend/database.py` → `init_db()`
2. Add to form in `frontend/src/pages/PlayerForm.tsx`
3. Update point calculation if needed
4. Add translations to `frontend/src/i18n.ts`

### Changing Time Slot Granularity
1. Admins pick the offset from the Settings tab (`AdminSettings.tsx`); valid values: `-20`, `-15`, `-10`, `0`
2. Backend slot generation + matching: `app.py` → `generate_time_slots()` / `matching_slots_for_hour()`
3. Frontend shared slot generator: `frontend/src/utils/timezone.ts` → `generateAssignmentSlots(offset)`
4. To change the set of allowed offsets, update validation in `database.py` (`get_time_slot_offset`) and the PUT endpoint in `app.py`

## Testing Guidelines

### Manual Testing Checklist
- [ ] Submit player with all fields
- [ ] Submit player without FID (should fail)
- [ ] Update existing player via FID
- [ ] Admin login with correct password
- [ ] Admin login with wrong password (should fail)
- [ ] View all players in admin table
- [ ] Sort players by different columns
- [ ] Edit player information
- [ ] Delete player
- [ ] Auto-assign for Monday
- [ ] Auto-assign for Tuesday
- [ ] Auto-assign for Thursday
- [ ] Drag-drop player between time slots
- [ ] Export to Excel
- [ ] Switch languages
- [ ] Test Arabic RTL layout

### Edge Cases to Consider
- Player with no time preferences
- Player with 0 points
- Multiple players wanting same time slot
- Very large numbers of speedups
- Empty database state
- Browser refresh during form submission

## Known Limitations

1. **Authentication**: Simple password-based, not production-grade
2. **SQLite Limitations**: Not ideal for high concurrency; use single gunicorn worker
3. **No Email Notifications**: Players must manually check assignments
4. **Single State Only**: No multi-state/multi-organization support
5. **No Audit Log**: Changes aren't tracked historically
6. **Browser Storage**: Admin tokens in localStorage (not secure for production)

## Development Workflow

### Making Changes
1. Backend changes: Flask auto-reloads in development mode
2. Frontend changes: Vite hot-reloads automatically
3. Database changes: Delete `data/minister.db` to recreate schema
4. Translation changes: Edit `i18n.ts`, Vite hot-reloads

### Before Committing
- Update relevant documentation (.md files)
- Test both English and one RTL language (Arabic)
- Verify both admin and player flows
- Check mobile responsiveness

### Deploying to Cloud Run
See `DEPLOYMENT.md` for full instructions covering bare metal, Docker, Cloud Run, and other platforms.

## Deployment Lessons Learned (Cloud Run + GCS FUSE)

These were discovered during production deployment and are critical knowledge:

### GCS FUSE Requires journal_mode=DELETE
SQLite WAL mode creates `-shm` and `-wal` sidecar files. GCS FUSE cannot handle out-of-order writes to these files, producing `BufferedWriteHandler.OutOfOrderError`. The fix is `PRAGMA journal_mode=DELETE` (set in `database.py` → `init_db()`). If you see this error, delete the database from the GCS bucket and let it recreate.

### Cloud Run Needs min-instances=1
Without `--min-instances 1`, Cloud Run aggressively scales to zero. On cold start, the container crash-loops (starts, runs ~90 seconds, gets SIGTERM, restarts). This produces 429 "Rate Exceeded" errors for users. Setting min-instances=1 keeps one warm instance and prevents this.

### Single Gunicorn Worker for SQLite
Multiple gunicorn workers cause concurrent SQLite writes. On GCS FUSE this produces `OutOfOrderError` on journal files. On local filesystems it can cause database lock errors. The Dockerfile uses `--workers 1 --threads 2` which is safe.

### Cloud Run gen2 Required
GCS FUSE volume mounts require `--execution-environment gen2`. Gen1 does not support volume mounts.

## Troubleshooting

### Backend won't start
- Check `.env` file exists and has DATABASE_PATH
- Verify virtual environment is activated
- Check port 8080 is not in use: `lsof -i :8080`

### Frontend won't start
- Clear npm cache if permission errors
- Check node version (need 18+)
- Port 5173 conflict: change in `vite.config.ts`

### Database errors
- Path doesn't exist: Check DATABASE_PATH in .env
- Permission denied: Ensure write access to data directory
- Locked database: Close other connections

### Drag-drop not working
- Check @dnd-kit packages installed
- Verify browser JavaScript enabled
- Check console for errors

## File Conventions

### Code Style
- **Backend**: Python PEP 8, 4-space indentation
- **Frontend**: TypeScript, 2-space indentation, functional components
- **CSS**: Tailwind utility classes, avoid custom CSS

### Naming Conventions
- **Components**: PascalCase (e.g., `PlayerForm.tsx`)
- **Functions**: camelCase (e.g., `handleSubmit()`)
- **API routes**: kebab-case (e.g., `/api/admin/auto-assign`)
- **Database**: snake_case (e.g., `construction_speedups_days`)

### File Organization
- Pages: Top-level routes (`pages/`)
- Components: Reusable UI (`components/`)
- Admin-specific: In `components/admin/`
- Types: Inline in TypeScript files
- Translations: Centralized in `i18n.ts`

## Security Considerations

⚠️ **This application is designed for trusted users within a game state**

### Current Security
- Password-based admin access
- CORS enabled for frontend
- SQL injection prevention (parameterized queries)
- Input validation

### NOT Included
- Rate limiting
- CSRF protection
- XSS sanitization (React provides basic protection)
- Encryption at rest
- Session management
- Password hashing for admin passwords
- Audit logging

### For Production
- Use Google Secret Manager for passwords
- Implement proper authentication (OAuth, JWT)
- Add rate limiting
- Enable HTTPS only
- Implement audit logging
- Add data backup strategy

## Support & Resources

- **Main Docs**: README.md
- **Quick Start**: QUICK_START.md
- **User Guide**: USER_GUIDE.md
- **Deployment**: DEPLOYMENT.md
- **Technical Overview**: PROJECT_SUMMARY.md
- **This File**: claude.md (AI assistant context)

## Version History

- **v1.1.0** (March 2026): WOS API Integration & Enhancements
  - "Load from WOS" button auto-fills player name, avatar, and furnace level from FID
  - Alliance tag field (3 chars max, displayed as `[TAG]` next to player names)
  - Player avatars and furnace level icons on assignment cards and player table
  - Multi-day Excel export (Monday/Tuesday/Thursday tabs + Unassigned tab)
  - Alliance as separate column in Excel export
  - "Remove All Players" button with confirmation
  - New API endpoints: `POST /api/player/wos-lookup`, `DELETE /api/admin/players/delete-all`
  - New DB columns: `avatar_image`, `stove_lv`, `stove_lv_content`, `alliance`

- **v1.0.0** (March 2026): Initial release
  - 3-page player submission form
  - Admin panel with auto-assignment
  - Drag-and-drop manual assignment
  - 5-language support
  - Excel export
  - FID now required (no auto-generation)

---

**Last Updated**: March 6, 2026
**Maintained By**: State Technical Administrator
**Purpose**: Ministry assignment automation for Whiteout Survival SVS events
