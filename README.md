# Whiteout Survival - Ministry Management System

A web application for managing ministry assignments during State vs State (SVS) events in Whiteout Survival. Features a dark navy and gold themed interface, automatic point-based player assignment, drag-and-drop scheduling, and multi-language support.

## Features

### Player Features
- **Player Submission Form** - 3-step form for players to submit speedups, resources, and time preferences (FID required)
- **WOS API Integration** - "Load from WOS" button auto-fills player name, avatar, and furnace level from FID
- **Alliance Tag** - 3-character alliance tag (required) displayed as `[TAG]` next to player names
- **Player Updates** - Players update their submissions anytime using their FID
- **Heat Map on Time Slots** - Color-coded time slot selection showing demand (blue=low, yellow=medium, red=high)
- **"Select ALL Available Times" Guidance** - Notes on time selection pages encourage broad availability
- **Assignment Disclaimer** - Players see "Assignments subject to change" and "+/-20 min tolerance" notes
- **Unsaved Changes Warning** - "Are you sure?" confirmation before leaving the form with unsaved changes
- **Player Guide** (`/guide`) - Comprehensive in-app guide accessible from the home page
- **Published Schedule** - Players can view their assigned schedule once published by an admin

### Admin Features
- **Admin Dashboard** - Password-protected interface with three tabs: **Players**, **Assignments**, **Settings**
  - **Players tab**: View, sort, search, edit, delete, remove all players
  - **Assignments tab**: Auto-assignment, drag-and-drop scheduling, sticky/locked assignments, per-day publishing, Excel export
  - **Settings tab**: State number, application closing time, research day toggle, fire crystal fields toggle
- **Application Closing Time** - Set a deadline after which new submissions are blocked (existing players can still update)
- **Sticky (Locked) Assignments** - Lock icon on player cards; locked players are preserved during auto-assign
- **Multi-day Publishing** - Publish and unpublish schedules independently per day (Monday, Tuesday/Friday, Thursday)
- **Heat Map Visualization** - Color-coded time slots showing player demand across the schedule
- **Export/Import Players (JSON)** - Backup and restore all player data
- **Multi-day Excel Export** - Workbook with Monday, Tuesday/Friday, Thursday tabs + Unassigned tab
- **Configurable State Number** - Dynamic "Welcome, State {N}" message on the home page
- **Research Day Toggle** - Switch research day between Tuesday and Friday
- **Show/Hide Fire Crystal Fields** - Toggle visibility of fire crystal resource fields in the player form
- **Admin Guide** (`/admin/guide`) - Comprehensive in-app guide accessible from the admin dashboard
- **LootBar Affiliate Integration** - Contextual affiliate banners on the home page, post-submission, near speedup fields, and on the update page

### General
- **5 Languages** - English, Korean, Chinese, Turkish, Arabic (with RTL support)
- **Dark Theme** - Navy and gold themed UI
- **Dockerized** - Multi-stage Docker build for easy deployment

## Point Calculation System

### Monday - Construction
- 1 point per minute of construction or general speedups
- 30,000 points per refined fire crystal
- 2,000 points per fire crystal

### Tuesday - Research
- 1 point per minute of research or general speedups
- 1,000 points per fire crystal shard

### Thursday - Troop Training
- 1 point per day of troop training speedups

## Quick Start

### Option A: Docker Compose (easiest)

```bash
cp .env.example .env
# Edit .env with your passwords
docker compose up --build
# Open http://localhost:8080
```

### Option B: Local Development (bare metal)

**Terminal 1 - Backend:**
```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
# Create .env with DATABASE_PATH=./data/minister.db
python app.py
# Backend runs on http://localhost:8080
```

**Terminal 2 - Frontend (hot reload):**
```bash
cd frontend
npm install
npm run dev
# Frontend runs on http://localhost:5173 (proxies API to :8080)
```

### Option C: Production Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for Docker, Google Cloud Run, and other platform instructions.

### Copilot Cloud Agent Configuration (for future changes)

This repository includes Copilot cloud-agent setup and instruction files:

- `.github/workflows/copilot-setup-steps.yml` - preinstalls backend/frontend dependencies in the cloud agent environment
- `.github/copilot-instructions.md` - defines validation commands and repository guardrails for future changes

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.11 / Flask 3.0 / SQLite |
| Frontend | React 18 / TypeScript / Vite |
| Styling | Tailwind CSS |
| Routing | react-router-dom v6 |
| i18n | react-i18next + i18next (5 languages) |
| Drag & Drop | @dnd-kit (core / sortable / utilities) |
| HTTP Client | axios |
| Icons | lucide-react |
| Class Utility | clsx |
| Production Server | gunicorn (single worker for SQLite) |
| Containerization | Docker (multi-stage build) |

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `FLASK_ENV` | `development` or `production` | `production` |
| `SECRET_KEY` | Flask session secret | `dev-secret-key` |
| `ADMIN_PASSWORD` | Admin login password | `admin123` ⚠️ **change before any non-trivial deployment** |
| `MINISTER_PASSWORD` | Minister login password | `minister123` ⚠️ **change before any non-trivial deployment** |
| `DATABASE_PATH` | Path to SQLite database file | `/data/minister.db` |
| `PORT` | Server port | `8080` |

> ⚠️ **Security:** The defaults `admin123` / `minister123` exist only to make the very first `docker compose up` work. Anyone with the admin password can edit and delete every player and publish/unpublish schedules. **Override these in `.env` (or your secret store) before deploying to any environment that isn't your laptop.**

## Project Structure

```
minister_management/
├── backend/
│   ├── app.py              # Flask app + API routes
│   ├── database.py         # Schema, migrations, settings helpers, point calculations
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Home.tsx
│   │   │   ├── PlayerForm.tsx
│   │   │   ├── UpdateSubmission.tsx
│   │   │   ├── PublishedSchedule.tsx
│   │   │   ├── PlayerGuide.tsx
│   │   │   ├── AdminLogin.tsx
│   │   │   ├── AdminDashboard.tsx
│   │   │   └── AdminGuide.tsx
│   │   ├── components/
│   │   │   ├── LanguageSelector.tsx
│   │   │   ├── TimezoneSelector.tsx
│   │   │   └── admin/
│   │   │       ├── PlayerManagement.tsx
│   │   │       ├── AssignmentManagement.tsx
│   │   │       └── AdminSettings.tsx
│   │   ├── utils/
│   │   │   ├── timezone.ts      # 30-min slot generator + tz helpers
│   │   │   └── affiliate.ts     # LootBar affiliate links
│   │   ├── i18n.ts              # All translations (en, ko, zh, tr, ar)
│   │   ├── App.tsx              # Routing
│   │   ├── main.tsx
│   │   └── index.css
│   ├── package.json
│   └── vite.config.ts
├── Dockerfile              # Multi-stage build (Node + Python)
├── docker-compose.yml      # Local development
├── .env.example            # Environment template
├── start.sh                # Docker quick-start script
├── README.md
├── QUICK_START.md
├── USER_GUIDE.md
├── DEPLOYMENT.md
├── PROJECT_SUMMARY.md
├── RECREATION_GUIDE.md
└── CHANGELOG.md
```

## Documentation

- [Quick Start Guide](QUICK_START.md) - Get running in 5 minutes
- [Deployment Guide](DEPLOYMENT.md) - Bare metal, Docker, Cloud Run, and more
- [User Guide](USER_GUIDE.md) - For players and ministers
- [Project Summary](PROJECT_SUMMARY.md) - Technical overview
- [Recreation Guide](RECREATION_GUIDE.md) - Full from-scratch rebuild reference
- [Changelog](CHANGELOG.md) - Release history

## License

Private - For Whiteout Survival State Management Only
