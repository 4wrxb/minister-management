# Ministry Management System - Project Summary

## Overview

A full-stack web application for managing Whiteout Survival SVS (State vs State) ministry assignments. Players submit their speedup resources and time availability; ministers use an auto-assignment algorithm and drag-and-drop interface to schedule ministry positions. Features a dark navy and gold themed UI with 5-language support.

## Features

### Player Features
- 3-page submission form (Information > Time Preferences > Review)
- **WOS API integration** - "Load from WOS" button auto-fills game name, avatar, and furnace level
- **Alliance tag** - 3-character tag displayed as `[TAG]` next to player names
- Update submission using FID lookup
- FID required for all submissions
- Support for all speedup types and fire crystal resources
- Multi-language support (5 languages)

### Admin Features
- Password-protected admin/minister access
- Player management table with sort, search, edit, delete, **remove all**
- Player avatars and furnace level icons displayed in tables and assignment cards
- Point calculation for all three days (Monday/Tuesday/Thursday)
- Auto-assignment algorithm based on points and time preferences
- Drag-and-drop interface for manual adjustments with avatar + alliance display
- **Multi-day Excel export** (3 day tabs + unassigned tab, includes alliance column)

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
- **Database**: SQLite 3
- **Production Server**: gunicorn (single worker for SQLite safety)
- **Excel Export**: openpyxl
- **CORS**: Flask-CORS
- **Environment**: python-dotenv

### Frontend
- **Framework**: React 18
- **Language**: TypeScript
- **Build Tool**: Vite
- **Styling**: Tailwind CSS (dark theme with custom color tokens)
- **Routing**: React Router v6
- **Internationalization**: react-i18next
- **Drag-and-Drop**: @dnd-kit
- **Icons**: lucide-react
- **HTTP Client**: Axios

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
│   │   │   ├── AdminLogin.tsx        # Admin authentication
│   │   │   └── AdminDashboard.tsx    # Admin main page
│   │   ├── components/
│   │   │   ├── LanguageSelector.tsx      # Language switcher (pill buttons)
│   │   │   └── admin/
│   │   │       ├── PlayerManagement.tsx      # Player CRUD table
│   │   │       └── AssignmentManagement.tsx  # Drag-drop assignments
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
| POST | `/api/player/submit` | Submit or update player info |
| GET | `/api/player/:fid` | Get player by FID |
| POST | `/api/player/wos-lookup` | Lookup player from WOS API (returns name, avatar, furnace level) |
| GET | `/health` | Health check |

### Admin (require Authorization header)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/admin/login` | Authenticate admin/minister |
| GET | `/api/admin/players` | Get all players with calculated points |
| PUT | `/api/admin/player/:id` | Update player |
| DELETE | `/api/admin/player/:id` | Delete player |
| DELETE | `/api/admin/players/delete-all` | Delete all players |
| POST | `/api/admin/assignments/auto-assign` | Run auto-assignment |
| GET | `/api/admin/assignments/:day` | Get assignments for a day |
| POST | `/api/admin/assignments/update` | Save manual assignments |
| GET | `/api/admin/export` | Export all assignments to multi-tab Excel workbook |

## Database Schema

### players
`id`, `fid` (unique, required), `game_name`, `alliance` (3-char tag), `construction_speedups_days`, `research_speedups_days`, `troop_training_speedups_days`, `general_speedups_days`, `fire_crystals`, `refined_fire_crystals`, `fire_crystal_shards`, `avatar_image` (URL from WOS API), `stove_lv` (furnace level), `stove_lv_content` (furnace icon URL), `created_at`, `updated_at`

### time_preferences
`id`, `player_id` (FK → players), `time_slot`

### assignments
`id`, `player_id` (FK → players), `day`, `time_slot`, `position`, `is_assigned`, `created_at`

### admin_users
`id`, `username`, `password_hash`, `role`, `created_at`
*(Placeholder table — authentication currently uses environment variable passwords)*

## Key Algorithms

### Auto-Assignment
1. Calculate points for all players for the selected day
2. Sort players by points (descending — highest priority first)
3. Generate 30-minute time slots at the admin-configured offset (`-20`, `-15`, `-10`, or `0` min from each half-hour). Offset `0` gives 48 aligned slots; non-zero gives 49 (one pre-day slot, suffixed `-1`, runs past midnight).
4. Match each player's hourly time preferences to 30-minute slots
5. Assign highest-point players first to their preferred slots
6. Track unassigned players (no matching open slots)

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

**Version**: 1.1.0
**Last Updated**: March 2026
**Status**: Production
