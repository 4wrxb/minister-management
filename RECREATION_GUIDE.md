# Ministry Management System — Complete Recreation Guide

This document contains everything needed to recreate the Ministry Management System from scratch. It includes every file, every line of code, the full database schema, business logic, deployment configuration, and architectural decisions.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Project Structure](#project-structure)
3. [Environment Variables](#environment-variables)
4. [Backend (Python/Flask)](#backend)
5. [Frontend (React/TypeScript)](#frontend)
6. [Docker & Deployment](#docker--deployment)
7. [Business Logic Deep Dive](#business-logic-deep-dive)
8. [API Reference](#api-reference)
9. [Database Schema](#database-schema)
10. [Deployment Lessons Learned](#deployment-lessons-learned)

---

## Architecture Overview

**What it does:** Automates ministry position assignments for Whiteout Survival SVS (State vs State) events. Players submit their speedup resources and time availability. An admin auto-assigns ministry slots based on contribution points. The schedule can be published publicly.

**Tech Stack:**
- **Backend:** Python 3.11, Flask 3.0, SQLite, gunicorn
- **Frontend:** React 18, TypeScript, Vite, Tailwind CSS, react-i18next (5 languages), @dnd-kit (drag-and-drop)
- **Deployment:** Docker multi-stage build → Google Cloud Run with GCS FUSE for SQLite persistence

**Key Design Decisions:**
- Player FID (game ID) is **required** — used as the unique identifier for updates
- Time preferences are stored **per day type** (construction, research, troop) — not globally
- Players select hourly preferences (00:00–23:00); system assigns in 30-minute slots
- Assignment slot offset is an admin setting (`-20`, `-15`, `-10`, or `0` minutes from each half-hour). Offset `0` yields 48 aligned slots (`00:00, 00:30, …, 23:30`); any other offset yields 49 because one slot straddles midnight and appears as a pre-day `23:MM-1` entry alongside the natural end-of-day `23:MM`. Existing installs that ran on the legacy `-10` slots are migrated automatically (see `database.py` init).
- Simple password auth (not production-grade) — same permissions for admin and minister passwords
- SQLite with `journal_mode=DELETE` (required for GCS FUSE compatibility)
- Single gunicorn worker (required for SQLite on GCS FUSE)
- 5 languages: English, Korean, Chinese, Turkish, Arabic (with RTL support for Arabic)
- Settings stored as key-value pairs in SQLite `settings` table — configurable state number, application closing time, research day, fire crystal field visibility
- Application closing time blocks new submissions after deadline but allows existing player updates
- LootBar affiliate link integrated on home page, post-submission, and update page

---

## Project Structure

```
minister_management/
├── backend/
│   ├── app.py                  # Flask app — all API endpoints
│   ├── database.py             # SQLite schema, queries, point calculations
│   ├── requirements.txt        # Python dependencies
│   └── .env                    # Environment variables (gitignored)
├── frontend/
│   ├── index.html              # HTML entry point
│   ├── package.json            # Node dependencies
│   ├── vite.config.ts          # Vite config with API proxy
│   ├── tsconfig.json           # TypeScript config
│   ├── tsconfig.node.json      # TypeScript config for Vite
│   ├── tailwind.config.js      # Tailwind theme (dark game theme)
│   ├── postcss.config.js       # PostCSS with Tailwind
│   └── src/
│       ├── main.tsx            # React entry point
│       ├── App.tsx             # Router + layout
│       ├── index.css           # Global styles, dark theme, scrollbar
│       ├── i18n.ts             # All translations (EN/KO/ZH/TR/AR)
│       ├── utils/
│       │   ├── timezone.ts     # Timezone conversion utilities
│       │   └── affiliate.ts    # LootBar affiliate link helper
│       ├── components/
│       │   ├── LanguageSelector.tsx
│       │   ├── TimezoneSelector.tsx
│       │   └── admin/
│       │       ├── PlayerManagement.tsx
│       │       ├── AssignmentManagement.tsx
│       │       └── AdminSettings.tsx
│       └── pages/
│           ├── Home.tsx
│           ├── PlayerForm.tsx
│           ├── UpdateSubmission.tsx
│           ├── AdminLogin.tsx
│           ├── AdminDashboard.tsx
│           ├── PublishedSchedule.tsx
│           ├── PlayerGuide.tsx
│           └── AdminGuide.tsx
├── data/                       # SQLite DB (created at runtime)
├── Dockerfile                  # Multi-stage build
├── docker-compose.yml          # Local development
└── .env.example                # Environment template
```

---

## Environment Variables

Create a `.env` file in the `backend/` directory (or set via Docker/Cloud Run):

```env
FLASK_ENV=production
SECRET_KEY=your-secret-key-here-change-this
ADMIN_PASSWORD=your-admin-password-here
MINISTER_PASSWORD=your-minister-password-here
DATABASE_PATH=/data/minister.db
PORT=8080
```

**`.env.example`:**
```env
# Flask Configuration
FLASK_ENV=production
SECRET_KEY=your-secret-key-here-change-this

# Admin Credentials
ADMIN_PASSWORD=your-admin-password-here
MINISTER_PASSWORD=your-minister-password-here

# Database
# Docker Compose: /app/data/minister.db (default, volume-mounted)
# Bare metal dev: ./data/minister.db (relative to backend/)
# Cloud Run:      /data/minister.db (GCS FUSE mount)
DATABASE_PATH=/app/data/minister.db

# Server
PORT=8080
```

---

## Backend

### `backend/requirements.txt`

```
Flask==3.0.0
Flask-CORS==4.0.0
python-dotenv==1.0.0
openpyxl==3.1.2
gunicorn==23.0.0
requests==2.31.0
```

### `backend/database.py`

```python
import sqlite3
import os
from flask import g

# Database path - set via DATABASE_PATH env var
DB_PATH = os.environ.get('DATABASE_PATH', '/data/minister.db')


def get_db():
    """Get database connection using Flask g context (matches tyrant-poll pattern)."""
    if 'db' not in g:
        os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db


def close_db(exc=None):
    """Close database connection on teardown."""
    db = g.pop('db', None)
    if db:
        db.close()


def init_db(app):
    """Initialize the database with required tables."""
    app.teardown_appcontext(close_db)

    with app.app_context():
        db = get_db()
        # Force DELETE journal mode - WAL mode creates -shm/-wal files
        # that are incompatible with GCS FUSE (out-of-order writes)
        db.execute('PRAGMA journal_mode=DELETE')
        cursor = db.cursor()

        # Players table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS players (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                fid TEXT UNIQUE NOT NULL,
                game_name TEXT NOT NULL,
                construction_speedups_days REAL DEFAULT 0,
                research_speedups_days REAL DEFAULT 0,
                troop_training_speedups_days REAL DEFAULT 0,
                general_speedups_days REAL DEFAULT 0,
                fire_crystals INTEGER DEFAULT 0,
                refined_fire_crystals INTEGER DEFAULT 0,
                fire_crystal_shards INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        # Time preferences table (with day_type for per-day preferences)
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS time_preferences (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                player_id INTEGER NOT NULL,
                time_slot TEXT NOT NULL,
                day_type TEXT NOT NULL DEFAULT 'construction',
                FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
                UNIQUE(player_id, time_slot, day_type)
            )
        ''')

        # Assignments table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS assignments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                player_id INTEGER NOT NULL,
                day TEXT NOT NULL,
                time_slot TEXT NOT NULL,
                position INTEGER DEFAULT 0,
                is_assigned BOOLEAN DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
                UNIQUE(day, time_slot, position)
            )
        ''')

        # Admin users table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS admin_users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        # Settings table (key-value store for app configuration)
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        ''')

        # Create indexes for better performance
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_players_fid ON players(fid)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_time_prefs_player ON time_preferences(player_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_assignments_day ON assignments(day)')

        db.commit()

        # Schema migrations (idempotent - safe to re-run)
        migrations = [
            'ALTER TABLE players ADD COLUMN avatar_image TEXT DEFAULT NULL',
            'ALTER TABLE players ADD COLUMN stove_lv INTEGER DEFAULT NULL',
            'ALTER TABLE players ADD COLUMN stove_lv_content TEXT DEFAULT NULL',
            'ALTER TABLE players ADD COLUMN alliance TEXT DEFAULT NULL',
            'ALTER TABLE players ADD COLUMN timezone TEXT DEFAULT NULL',
        ]
        for migration in migrations:
            try:
                cursor.execute(migration)
            except Exception:
                pass  # Column already exists

        # Migrate time_preferences to support day_type column
        # Check if the day_type column exists
        cursor.execute("PRAGMA table_info(time_preferences)")
        columns = [col['name'] for col in cursor.fetchall()]
        if 'day_type' not in columns:
            # Recreate table with day_type and new unique constraint
            cursor.execute('ALTER TABLE time_preferences RENAME TO time_preferences_old')
            cursor.execute('''
                CREATE TABLE time_preferences (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    player_id INTEGER NOT NULL,
                    time_slot TEXT NOT NULL,
                    day_type TEXT NOT NULL DEFAULT 'construction',
                    FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
                    UNIQUE(player_id, time_slot, day_type)
                )
            ''')
            # Copy existing data as 'construction', then duplicate for research and troop
            cursor.execute('''
                INSERT INTO time_preferences (player_id, time_slot, day_type)
                SELECT player_id, time_slot, 'construction' FROM time_preferences_old
            ''')
            cursor.execute('''
                INSERT INTO time_preferences (player_id, time_slot, day_type)
                SELECT player_id, time_slot, 'research' FROM time_preferences_old
            ''')
            cursor.execute('''
                INSERT INTO time_preferences (player_id, time_slot, day_type)
                SELECT player_id, time_slot, 'troop' FROM time_preferences_old
            ''')
            cursor.execute('DROP TABLE time_preferences_old')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_time_prefs_player ON time_preferences(player_id)')
        else:
            # Fix unique constraint: ensure it includes day_type (not just player_id, time_slot)
            cursor.execute("SELECT sql FROM sqlite_master WHERE name='time_preferences'")
            create_sql = cursor.fetchone()
            if create_sql and 'UNIQUE(player_id, time_slot, day_type)' not in create_sql['sql']:
                cursor.execute('SELECT player_id, time_slot, day_type FROM time_preferences')
                existing_prefs = cursor.fetchall()
                cursor.execute('DROP TABLE time_preferences')
                cursor.execute('''
                    CREATE TABLE time_preferences (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        player_id INTEGER NOT NULL,
                        time_slot TEXT NOT NULL,
                        day_type TEXT NOT NULL DEFAULT 'construction',
                        FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
                        UNIQUE(player_id, time_slot, day_type)
                    )
                ''')
                for row in existing_prefs:
                    try:
                        cursor.execute(
                            'INSERT INTO time_preferences (player_id, time_slot, day_type) VALUES (?, ?, ?)',
                            (row['player_id'], row['time_slot'], row['day_type'])
                        )
                    except Exception:
                        pass  # Skip duplicates
                cursor.execute('CREATE INDEX IF NOT EXISTS idx_time_prefs_player ON time_preferences(player_id)')

        db.commit()


def get_setting(key, default=None):
    """Get a setting value by key."""
    db = get_db()
    cursor = db.cursor()
    cursor.execute('SELECT value FROM settings WHERE key = ?', (key,))
    row = cursor.fetchone()
    return row['value'] if row else default


def set_setting(key, value):
    """Set a setting value (upsert)."""
    db = get_db()
    cursor = db.cursor()
    cursor.execute('''
        INSERT INTO settings (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = ?
    ''', (key, value, value))
    db.commit()


def get_research_day():
    """Get the current research day setting ('tuesday' or 'friday')."""
    return get_setting('research_day', 'tuesday')


def get_show_fire_crystals():
    """Get whether fire crystal fields should be shown."""
    return get_setting('show_fire_crystals', 'false') == 'true'


def calculate_points(player, day):
    """
    Calculate points for a player based on the day type.

    Args:
        player: dict with player data
        day: 'monday' (construction), 'tuesday'/'friday' (research), or 'thursday' (troop)

    Returns:
        int: calculated points
    """
    construction_mins = player['construction_speedups_days'] * 24 * 60
    research_mins = player['research_speedups_days'] * 24 * 60
    troop_days = player['troop_training_speedups_days']
    general_mins = player['general_speedups_days'] * 24 * 60

    if day.lower() == 'monday':
        # Construction: 1 pt/min construction+general, 30k/refined crystal, 2k/fire crystal
        points = (construction_mins + general_mins)
        points += player['refined_fire_crystals'] * 30000
        points += player['fire_crystals'] * 2000
        return int(points)

    elif day.lower() in ('tuesday', 'friday'):
        # Research: 1 pt/min research+general, 1k/crystal shard
        points = (research_mins + general_mins)
        points += player['fire_crystal_shards'] * 1000
        return int(points)

    elif day.lower() == 'thursday':
        # Troop: 1 pt/day troop training
        return int(troop_days)

    return 0


def get_all_players():
    """Get all players with their time preferences per day type."""
    db = get_db()
    cursor = db.cursor()
    cursor.execute('SELECT * FROM players ORDER BY created_at DESC')
    players = []
    for row in cursor.fetchall():
        player = dict(row)
        # Get time preferences grouped by day_type
        cursor2 = db.cursor()
        cursor2.execute('SELECT time_slot, day_type FROM time_preferences WHERE player_id = ?', (player['id'],))
        time_prefs = {'construction': [], 'research': [], 'troop': []}
        all_slots = set()
        for tp in cursor2.fetchall():
            day_type = tp['day_type']
            if day_type in time_prefs:
                time_prefs[day_type].append(tp['time_slot'])
            all_slots.add(tp['time_slot'])
        player['time_slots'] = list(all_slots)  # backward compat
        player['time_slots_by_day'] = time_prefs
        players.append(player)
    return players


def get_player_by_fid(fid):
    """Get a player by their FID."""
    db = get_db()
    cursor = db.cursor()
    cursor.execute('SELECT * FROM players WHERE fid = ?', (fid,))
    row = cursor.fetchone()
    if row:
        player = dict(row)
        # Get time preferences grouped by day_type
        cursor.execute('SELECT time_slot, day_type FROM time_preferences WHERE player_id = ?', (player['id'],))
        time_prefs = {'construction': [], 'research': [], 'troop': []}
        all_slots = set()
        for tp in cursor.fetchall():
            day_type = tp['day_type']
            if day_type in time_prefs:
                time_prefs[day_type].append(tp['time_slot'])
            all_slots.add(tp['time_slot'])
        player['time_slots'] = list(all_slots)  # backward compat
        player['time_slots_by_day'] = time_prefs
        return player
    return None


def save_player(data, time_slots):
    """Save or update a player and their time preferences.

    time_slots can be:
      - A list of strings (legacy: same slots for all day types)
      - A dict with keys 'construction', 'research', 'troop' mapping to lists
    """
    db = get_db()
    cursor = db.cursor()

    # Check if player exists
    cursor.execute('SELECT id FROM players WHERE fid = ?', (data['fid'],))
    existing = cursor.fetchone()

    if existing:
        # Update existing player
        player_id = existing['id']
        cursor.execute('''
            UPDATE players SET
                game_name = ?,
                construction_speedups_days = ?,
                research_speedups_days = ?,
                troop_training_speedups_days = ?,
                general_speedups_days = ?,
                fire_crystals = ?,
                refined_fire_crystals = ?,
                fire_crystal_shards = ?,
                avatar_image = ?,
                stove_lv = ?,
                stove_lv_content = ?,
                alliance = ?,
                timezone = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE fid = ?
        ''', (
            data['game_name'],
            data['construction_speedups_days'],
            data['research_speedups_days'],
            data['troop_training_speedups_days'],
            data['general_speedups_days'],
            data['fire_crystals'],
            data['refined_fire_crystals'],
            data['fire_crystal_shards'],
            data.get('avatar_image'),
            data.get('stove_lv'),
            data.get('stove_lv_content'),
            data.get('alliance'),
            data.get('timezone'),
            data['fid']
        ))

        # Delete old time preferences
        cursor.execute('DELETE FROM time_preferences WHERE player_id = ?', (player_id,))
    else:
        # Insert new player
        cursor.execute('''
            INSERT INTO players (
                fid, game_name, construction_speedups_days, research_speedups_days,
                troop_training_speedups_days, general_speedups_days, fire_crystals,
                refined_fire_crystals, fire_crystal_shards,
                avatar_image, stove_lv, stove_lv_content, alliance, timezone
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            data['fid'],
            data['game_name'],
            data['construction_speedups_days'],
            data['research_speedups_days'],
            data['troop_training_speedups_days'],
            data['general_speedups_days'],
            data['fire_crystals'],
            data['refined_fire_crystals'],
            data['fire_crystal_shards'],
            data.get('avatar_image'),
            data.get('stove_lv'),
            data.get('stove_lv_content'),
            data.get('alliance'),
            data.get('timezone')
        ))
        player_id = cursor.lastrowid

    # Insert time preferences
    if isinstance(time_slots, dict):
        # Per-day time slots: {'construction': [...], 'research': [...], 'troop': [...]}
        for day_type, slots in time_slots.items():
            for time_slot in slots:
                cursor.execute('''
                    INSERT INTO time_preferences (player_id, time_slot, day_type)
                    VALUES (?, ?, ?)
                ''', (player_id, time_slot, day_type))
    else:
        # Legacy: same slots for all day types
        for time_slot in time_slots:
            for day_type in ('construction', 'research', 'troop'):
                cursor.execute('''
                    INSERT INTO time_preferences (player_id, time_slot, day_type)
                    VALUES (?, ?, ?)
                ''', (player_id, time_slot, day_type))

    db.commit()
    return player_id


def delete_player(player_id):
    """Delete a player and all related data."""
    db = get_db()
    cursor = db.cursor()
    cursor.execute('DELETE FROM players WHERE id = ?', (player_id,))
    db.commit()
```

### `backend/app.py`

```python
from flask import Flask, request, jsonify, send_from_directory, Response
from flask_cors import CORS
import os
import hashlib
import time as time_module
import requests as http_requests
from dotenv import load_dotenv
from datetime import datetime
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment
from io import BytesIO

# Load environment variables FIRST
load_dotenv()

from database import (
    init_db, get_all_players, get_player_by_fid,
    save_player, delete_player, calculate_points, get_db,
    get_research_day, get_show_fire_crystals, set_setting, get_setting
)

STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static')

app = Flask(__name__, static_folder=None)
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'dev-secret-key')
CORS(app)

# Admin credentials
ADMIN_PASSWORD = os.getenv('ADMIN_PASSWORD', 'admin123')
MINISTER_PASSWORD = os.getenv('MINISTER_PASSWORD', 'minister123')

# Initialize database (registers teardown handler)
init_db(app)

# Health check endpoint
@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'healthy'}), 200

# Serve React app - handles SPA routing for all non-API paths
@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve(path):
    if path and os.path.exists(os.path.join(STATIC_DIR, path)):
        return send_from_directory(STATIC_DIR, path)
    return send_from_directory(STATIC_DIR, 'index.html')

# API Routes

@app.route('/api/player/submit', methods=['POST'])
def submit_player():
    """Submit or update player information."""
    try:
        data = request.json

        # Validate required fields
        required_fields = ['fid', 'game_name']
        for field in required_fields:
            if field not in data or not data[field]:
                return jsonify({'error': f'Missing required field: {field}'}), 400

        # Extract time slots (supports both legacy list and per-day dict)
        time_slots_by_day = data.pop('time_slots_by_day', None)
        time_slots = data.pop('time_slots', [])
        if time_slots_by_day:
            time_slots = time_slots_by_day  # pass dict to save_player

        # Set defaults for numeric fields
        numeric_fields = [
            'construction_speedups_days', 'research_speedups_days',
            'troop_training_speedups_days', 'general_speedups_days',
            'fire_crystals', 'refined_fire_crystals', 'fire_crystal_shards'
        ]
        for field in numeric_fields:
            if field not in data:
                data[field] = 0
            else:
                data[field] = float(data[field]) if '.' in str(data[field]) or 'speedups' in field else int(data[field])

        # Save player
        player_id = save_player(data, time_slots)

        return jsonify({
            'success': True,
            'player_id': player_id,
            'message': 'Player information saved successfully'
        }), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/player/check-duplicate', methods=['POST'])
def check_duplicate():
    """Check if a player with the given FID or game name already exists."""
    try:
        data = request.json
        fid = data.get('fid', '').strip()
        game_name = data.get('game_name', '').strip()

        db = get_db()
        cursor = db.cursor()
        result = {'fid_exists': False, 'name_exists': False}

        if fid:
            cursor.execute('SELECT id FROM players WHERE fid = ?', (fid,))
            if cursor.fetchone():
                result['fid_exists'] = True

        if game_name:
            cursor.execute('SELECT id FROM players WHERE LOWER(game_name) = LOWER(?)', (game_name,))
            if cursor.fetchone():
                result['name_exists'] = True

        return jsonify(result), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/player/<fid>', methods=['GET'])
def get_player(fid):
    """Get player information by FID."""
    try:
        player = get_player_by_fid(fid)
        if player:
            return jsonify(player), 200
        return jsonify({'error': 'Player not found'}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/player/wos-lookup', methods=['POST'])
def wos_lookup():
    """Look up player info from the WOS game API."""
    try:
        data = request.json
        fid = data.get('fid', '').strip()

        if not fid:
            return jsonify({'error': 'FID is required'}), 400

        # Build signed request for WOS API
        secret = 'tB87#kPtkxqOS2'
        ts = str(int(time_module.time() * 1e9))
        form_data = f'fid={fid}&time={ts}'
        sign = hashlib.md5((form_data + secret).encode()).hexdigest()
        body = f'sign={sign}&{form_data}'

        response = http_requests.post(
            'https://wos-giftcode-api.centurygame.com/api/player',
            data=body,
            headers={
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Origin': 'https://wos-giftcode.centurygame.com',
                'Referer': 'https://wos-giftcode.centurygame.com/',
            },
            timeout=10
        )

        result = response.json()

        if result.get('code') != 0:
            return jsonify({'error': 'Player not found in WOS'}), 404

        wos_data = result['data']
        return jsonify({
            'success': True,
            'fid': str(wos_data['fid']),
            'nickname': wos_data.get('nickname', ''),
            'kid': wos_data.get('kid'),
            'stove_lv': wos_data.get('stove_lv'),
            'stove_lv_content': wos_data.get('stove_lv_content', ''),
            'avatar_image': wos_data.get('avatar_image', ''),
        }), 200

    except http_requests.exceptions.Timeout:
        return jsonify({'error': 'WOS API timed out'}), 504
    except http_requests.exceptions.RequestException as e:
        return jsonify({'error': f'Failed to reach WOS API: {str(e)}'}), 502
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/settings/research-day', methods=['GET'])
def get_research_day_setting():
    """Get the current research day setting (public endpoint)."""
    return jsonify({'research_day': get_research_day()}), 200

@app.route('/api/admin/settings/research-day', methods=['PUT'])
def set_research_day_setting():
    """Set the research day to 'tuesday' or 'friday'."""
    try:
        auth_header = request.headers.get('Authorization')
        if not auth_header or 'token' not in auth_header:
            return jsonify({'error': 'Unauthorized'}), 401

        data = request.json
        day = data.get('research_day', '').lower()
        if day not in ('tuesday', 'friday'):
            return jsonify({'error': 'Invalid value. Must be "tuesday" or "friday"'}), 400

        set_setting('research_day', day)
        return jsonify({'success': True, 'research_day': day}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/settings/show-fire-crystals', methods=['GET'])
def get_fire_crystals_setting():
    """Get whether fire crystal fields should be shown (public endpoint)."""
    return jsonify({'show_fire_crystals': get_show_fire_crystals()}), 200

@app.route('/api/admin/settings/show-fire-crystals', methods=['PUT'])
def set_fire_crystals_setting():
    """Toggle fire crystal fields visibility."""
    try:
        auth_header = request.headers.get('Authorization')
        if not auth_header or 'token' not in auth_header:
            return jsonify({'error': 'Unauthorized'}), 401

        data = request.json
        show = data.get('show_fire_crystals', False)
        set_setting('show_fire_crystals', 'true' if show else 'false')
        return jsonify({'success': True, 'show_fire_crystals': show}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/admin/login', methods=['POST'])
def admin_login():
    """Authenticate admin or minister user."""
    try:
        data = request.json
        password = data.get('password', '')

        if password == ADMIN_PASSWORD:
            return jsonify({
                'success': True,
                'role': 'admin',
                'token': 'admin-token'
            }), 200
        elif password == MINISTER_PASSWORD:
            return jsonify({
                'success': True,
                'role': 'minister',
                'token': 'minister-token'
            }), 200
        else:
            return jsonify({'error': 'Invalid password'}), 401

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/admin/players', methods=['GET'])
def get_players():
    """Get all players with calculated points."""
    try:
        # Simple auth check
        auth_header = request.headers.get('Authorization')
        if not auth_header or 'token' not in auth_header:
            return jsonify({'error': 'Unauthorized'}), 401

        players = get_all_players()

        # Add calculated points for each day
        research_day = get_research_day()
        for player in players:
            player['monday_points'] = calculate_points(player, 'monday')
            player['research_points'] = calculate_points(player, research_day)
            player['thursday_points'] = calculate_points(player, 'thursday')
            player['research_day'] = research_day

        return jsonify(players), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/admin/player/<int:player_id>', methods=['PUT'])
def update_player(player_id):
    """Update player information."""
    try:
        auth_header = request.headers.get('Authorization')
        if not auth_header or 'token' not in auth_header:
            return jsonify({'error': 'Unauthorized'}), 401

        data = request.json
        time_slots_by_day = data.pop('time_slots_by_day', None)
        time_slots = data.pop('time_slots', [])
        if time_slots_by_day:
            time_slots = time_slots_by_day

        save_player(data, time_slots)

        return jsonify({'success': True, 'message': 'Player updated'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/admin/player/<int:player_id>', methods=['DELETE'])
def remove_player(player_id):
    """Delete a player."""
    try:
        auth_header = request.headers.get('Authorization')
        if not auth_header or 'token' not in auth_header:
            return jsonify({'error': 'Unauthorized'}), 401

        delete_player(player_id)
        return jsonify({'success': True, 'message': 'Player deleted'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/admin/assignments/auto-assign', methods=['POST'])
def auto_assign():
    """Auto-assign players to time slots based on points."""
    try:
        auth_header = request.headers.get('Authorization')
        if not auth_header or 'token' not in auth_header:
            return jsonify({'error': 'Unauthorized'}), 401

        data = request.json
        day = data.get('day', '').lower()

        research_day = get_research_day()
        valid_days = ['monday', research_day, 'thursday']
        if day not in valid_days:
            return jsonify({'error': 'Invalid day'}), 400

        players = get_all_players()

        # Map day to day_type for time preferences
        day_type_map = {'monday': 'construction', 'thursday': 'troop'}
        day_type_map[research_day] = 'research'
        day_type = day_type_map.get(day, 'construction')

        # Calculate points for this day
        for player in players:
            player['points'] = calculate_points(player, day)

        # Sort by points (descending)
        players.sort(key=lambda p: p['points'], reverse=True)

        # Read configured offset (-20, -15, -10, or 0) and build slots.
        # See module-level generate_time_slots() / matching_slots_for_hour():
        # offset 0 → 48 aligned slots; non-zero → 49 with a "23:MM-1" pre-day
        # entry alongside the natural end-of-day "23:MM".
        offset_min = get_time_slot_offset()
        time_slots = generate_time_slots(offset_min)

        # Assignment logic
        assignments = {slot: [] for slot in time_slots}
        unassigned = []

        for player in players:
            # Use day-specific time preferences
            time_slots_by_day = player.get('time_slots_by_day', {})
            player_time_prefs = set(time_slots_by_day.get(day_type, player.get('time_slots', [])))

            # Map each hourly preference to every 30-min slot whose window
            # overlaps hour H by at least 10 minutes.
            matching_slots = []
            for pref in player_time_prefs:
                if ':' in pref:
                    h = int(pref.split(':')[0])
                    matching_slots.extend(matching_slots_for_hour(h, offset_min))

            assigned = False
            for slot in matching_slots:
                if slot in assignments and len(assignments[slot]) == 0:
                    assignments[slot].append({
                        'id': player['id'],
                        'player_id': player['id'],
                        'fid': player['fid'],
                        'game_name': player['game_name'],
                        'points': player['points'],
                        'avatar_image': player.get('avatar_image', ''),
                        'stove_lv': player.get('stove_lv'),
                        'stove_lv_content': player.get('stove_lv_content', ''),
                        'alliance': player.get('alliance', ''),
                    })
                    assigned = True
                    break

            if not assigned:
                unassigned.append({
                    'id': player['id'],
                    'player_id': player['id'],
                    'fid': player['fid'],
                    'game_name': player['game_name'],
                    'points': player['points'],
                    'preferred_times': list(player_time_prefs),
                    'avatar_image': player.get('avatar_image', ''),
                    'stove_lv': player.get('stove_lv'),
                    'stove_lv_content': player.get('stove_lv_content', ''),
                    'alliance': player.get('alliance', ''),
                })

        # Clear existing assignments for this day
        db = get_db()
        cursor = db.cursor()
        cursor.execute('DELETE FROM assignments WHERE day = ?', (day,))

        # Save new assignments
        for time_slot, slot_players in assignments.items():
            for position, player in enumerate(slot_players):
                cursor.execute('''
                    INSERT INTO assignments (player_id, day, time_slot, position, is_assigned)
                    VALUES (?, ?, ?, ?, 1)
                ''', (player['id'], day, time_slot, position))

        db.commit()

        return jsonify({
            'success': True,
            'assignments': assignments,
            'unassigned': unassigned
        }), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/admin/assignments/<day>', methods=['GET'])
def get_assignments(day):
    """Get assignments for a specific day."""
    try:
        auth_header = request.headers.get('Authorization')
        if not auth_header or 'token' not in auth_header:
            return jsonify({'error': 'Unauthorized'}), 401

        db = get_db()
        cursor = db.cursor()
        cursor.execute('''
            SELECT
                a.id, a.time_slot, a.position, a.is_assigned,
                p.id as player_id, p.fid, p.game_name,
                p.construction_speedups_days, p.research_speedups_days,
                p.troop_training_speedups_days, p.general_speedups_days,
                p.fire_crystals, p.refined_fire_crystals, p.fire_crystal_shards,
                p.avatar_image, p.stove_lv, p.stove_lv_content, p.alliance
            FROM assignments a
            JOIN players p ON a.player_id = p.id
            WHERE a.day = ?
            ORDER BY a.time_slot, a.position
        ''', (day.lower(),))

        rows = cursor.fetchall()
        assignments = {}
        for row in rows:
            slot = row['time_slot']
            if slot not in assignments:
                assignments[slot] = []
            row_dict = dict(row)
            row_dict['points'] = calculate_points(row_dict, day.lower())
            assignments[slot].append(row_dict)

        return jsonify(assignments), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/admin/assignments/update', methods=['POST'])
def update_assignments():
    """Update assignments after drag-and-drop."""
    try:
        auth_header = request.headers.get('Authorization')
        if not auth_header or 'token' not in auth_header:
            return jsonify({'error': 'Unauthorized'}), 401

        data = request.json
        day = data.get('day')
        assignments = data.get('assignments', {})

        db = get_db()
        cursor = db.cursor()

        # Clear existing assignments
        cursor.execute('DELETE FROM assignments WHERE day = ?', (day,))

        # Save new assignments (enforce max 1 player per slot)
        for time_slot, slot_players in assignments.items():
            if slot_players:
                player = slot_players[0]  # Only take first player per slot
                cursor.execute('''
                    INSERT INTO assignments (player_id, day, time_slot, position, is_assigned)
                    VALUES (?, ?, ?, ?, ?)
                ''', (player['player_id'], day, time_slot, 0, player.get('is_assigned', True)))

        db.commit()

        return jsonify({'success': True}), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/admin/export', methods=['GET'])
def export_assignments():
    """Export assignments for all days to a single Excel workbook."""
    try:
        auth_header = request.headers.get('Authorization')
        if not auth_header or 'token' not in auth_header:
            return jsonify({'error': 'Unauthorized'}), 401

        wb = openpyxl.Workbook()
        wb.remove(wb.active)  # Remove default sheet

        header_fill = PatternFill(start_color="4472C4", end_color="4472C4", fill_type="solid")
        header_font = Font(bold=True, color="FFFFFF")
        separator_fill = PatternFill(start_color="F4B942", end_color="F4B942", fill_type="solid")
        separator_font = Font(bold=True, color="000000")

        headers = [
            'Time Slot', 'FID', 'Alliance', 'Game Name',
            'Construction (days)', 'Research (days)',
            'Troop Training (days)', 'General (days)',
            'Fire Crystals', 'Refined Fire Crystals',
            'Crystal Shards', 'Points'
        ]

        col_widths = [15, 15, 10, 25, 18, 15, 20, 15, 13, 18, 14, 12]

        research_day = get_research_day()
        research_label = 'Tuesday - Research' if research_day == 'tuesday' else 'Friday - Research'
        days = [
            ('monday', 'Monday - Construction'),
            (research_day, research_label),
            ('thursday', 'Thursday - Troop Training'),
        ]

        db = get_db()
        cursor = db.cursor()

        for day_key, day_title in days:
            ws = wb.create_sheet(title=day_title)
            ws.append(headers)

            # Style headers
            for cell in ws[1]:
                cell.fill = header_fill
                cell.font = header_font
                cell.alignment = Alignment(horizontal='center')

            # Get assigned players
            cursor.execute('''
                SELECT a.time_slot, p.*
                FROM assignments a
                JOIN players p ON a.player_id = p.id
                WHERE a.day = ? AND a.is_assigned = 1
                ORDER BY a.time_slot, a.position
            ''', (day_key,))

            assigned_rows = cursor.fetchall()
            assigned_player_ids = set()

            for row in assigned_rows:
                player = dict(row)
                assigned_player_ids.add(player['id'])
                points = calculate_points(player, day_key)
                ws.append([
                    f"{row['time_slot'][:-2]} (-1d)" if row['time_slot'].endswith('-1') else row['time_slot'],
                    player['fid'],
                    player.get('alliance', ''),
                    player['game_name'],
                    player['construction_speedups_days'],
                    player['research_speedups_days'],
                    player['troop_training_speedups_days'],
                    player['general_speedups_days'],
                    player['fire_crystals'],
                    player['refined_fire_crystals'],
                    player['fire_crystal_shards'],
                    points,
                ])

            # Get all players to find unassigned ones
            cursor.execute('SELECT * FROM players ORDER BY id')
            all_players = [dict(r) for r in cursor.fetchall()]
            unassigned = [p for p in all_players if p['id'] not in assigned_player_ids]

            # Sort unassigned by points descending
            for p in unassigned:
                p['_points'] = calculate_points(p, day_key)
            unassigned.sort(key=lambda p: p['_points'], reverse=True)

            if unassigned:
                # Separator row
                sep_row_num = ws.max_row + 2  # skip a blank row
                ws.append([])  # blank row
                ws.append(['UNASSIGNED PLAYERS'] + [''] * (len(headers) - 1))
                for cell in ws[sep_row_num]:
                    cell.fill = separator_fill
                    cell.font = separator_font

                for player in unassigned:
                    ws.append([
                        'Unassigned',
                        player['fid'],
                        player.get('alliance', ''),
                        player['game_name'],
                        player['construction_speedups_days'],
                        player['research_speedups_days'],
                        player['troop_training_speedups_days'],
                        player['general_speedups_days'],
                        player['fire_crystals'],
                        player['refined_fire_crystals'],
                        player['fire_crystal_shards'],
                        player['_points'],
                    ])

            # Set column widths
            for i, width in enumerate(col_widths):
                ws.column_dimensions[chr(65 + i)].width = width

        # Save to BytesIO
        output = BytesIO()
        wb.save(output)
        output.seek(0)

        filename = f'ministry_assignments_{datetime.now().strftime("%Y%m%d")}.xlsx'
        return Response(
            output.getvalue(),
            mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            headers={'Content-Disposition': f'attachment; filename={filename}'}
        )

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/admin/settings/publish', methods=['PUT'])
def publish_schedule():
    """Publish assignments for a day so they appear on the public page.
    Supports multiple days — stores as comma-separated list.
    """
    try:
        auth_header = request.headers.get('Authorization')
        if not auth_header or 'token' not in auth_header:
            return jsonify({'error': 'Unauthorized'}), 401

        data = request.json
        day = data.get('day', '').lower()
        research_day = get_research_day()
        valid_days = ['monday', research_day, 'thursday']
        if day not in valid_days:
            return jsonify({'error': 'Invalid day'}), 400

        # Add to existing published days
        current = get_setting('published_days', '')
        days_set = set(d for d in current.split(',') if d)
        days_set.add(day)
        set_setting('published_days', ','.join(sorted(days_set)))
        return jsonify({'success': True, 'published_days': sorted(days_set)}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/admin/settings/unpublish', methods=['PUT'])
def unpublish_schedule():
    """Remove a specific day from published schedules."""
    try:
        auth_header = request.headers.get('Authorization')
        if not auth_header or 'token' not in auth_header:
            return jsonify({'error': 'Unauthorized'}), 401

        data = request.json
        day = data.get('day', '').lower()

        current = get_setting('published_days', '')
        days_set = set(d for d in current.split(',') if d)
        days_set.discard(day)
        set_setting('published_days', ','.join(sorted(days_set)))
        return jsonify({'success': True, 'published_days': sorted(days_set)}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/published-schedule/<day>', methods=['GET'])
def get_published_schedule(day):
    """Get the published schedule for a specific day (public endpoint).
    Returns only player name, alliance, and time slot — no points or resources.
    """
    try:
        published_days = get_setting('published_days', '')
        days_list = [d for d in published_days.split(',') if d]
        if day.lower() not in days_list:
            return jsonify({'published': False}), 200

        db = get_db()
        cursor = db.cursor()
        cursor.execute('''
            SELECT a.time_slot, p.game_name, p.alliance
            FROM assignments a
            JOIN players p ON a.player_id = p.id
            WHERE a.day = ? AND a.is_assigned = 1
            ORDER BY a.time_slot, a.position
        ''', (day.lower(),))

        rows = cursor.fetchall()
        assignments = {}
        for row in rows:
            slot = row['time_slot']
            if slot not in assignments:
                assignments[slot] = []
            assignments[slot].append({
                'game_name': row['game_name'],
                'alliance': row['alliance'] or '',
            })

        day_labels = {
            'monday': 'Monday - Construction',
            'tuesday': 'Tuesday - Research',
            'friday': 'Friday - Research',
            'thursday': 'Thursday - Troop Training',
        }

        return jsonify({
            'published': True,
            'day': day.lower(),
            'day_label': day_labels.get(day.lower(), day),
            'assignments': assignments,
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/settings/published-days', methods=['GET'])
def get_published_days_setting():
    """Get which days are currently published (public endpoint)."""
    published_days = get_setting('published_days', '')
    days_list = [d for d in published_days.split(',') if d]
    return jsonify({'published_days': days_list}), 200


@app.route('/api/admin/players/delete-all', methods=['DELETE'])
def delete_all_players():
    """Delete all players and their assignments."""
    try:
        auth_header = request.headers.get('Authorization')
        if not auth_header or 'token' not in auth_header:
            return jsonify({'error': 'Unauthorized'}), 401

        db = get_db()
        cursor = db.cursor()
        cursor.execute('DELETE FROM assignments')
        cursor.execute('DELETE FROM time_preferences')
        cursor.execute('DELETE FROM players')
        db.commit()

        return jsonify({'success': True, 'message': 'All players deleted'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    port = int(os.getenv('PORT', 8080))
    app.run(host='0.0.0.0', port=port, debug=os.getenv('FLASK_ENV') == 'development')
```

---

## Frontend

> **Note:** The frontend source files are extensive. Each file below is the complete source. When recreating, create the directory structure first, then populate each file.

### Configuration Files

**`frontend/package.json`:**
```json
{
  "name": "minister-management-frontend",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "lint": "eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.21.0",
    "react-i18next": "^14.0.0",
    "i18next": "^23.7.0",
    "@dnd-kit/core": "^6.1.0",
    "@dnd-kit/sortable": "^8.0.0",
    "@dnd-kit/utilities": "^3.2.2",
    "axios": "^1.6.2",
    "lucide-react": "^0.303.0",
    "clsx": "^2.1.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.43",
    "@types/react-dom": "^18.2.17",
    "@typescript-eslint/eslint-plugin": "^6.14.0",
    "@typescript-eslint/parser": "^6.14.0",
    "@vitejs/plugin-react": "^4.2.1",
    "autoprefixer": "^10.4.16",
    "eslint": "^8.55.0",
    "eslint-plugin-react-hooks": "^4.6.0",
    "eslint-plugin-react-refresh": "^0.4.5",
    "postcss": "^8.4.32",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.2.2",
    "vite": "^5.0.8"
  }
}
```

**`frontend/vite.config.ts`:**
```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true
      }
    }
  }
})
```

**`frontend/tsconfig.json`:**
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

**`frontend/tsconfig.node.json`:**
```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true
  },
  "include": ["vite.config.ts"]
}
```

**`frontend/tailwind.config.js`:**
```javascript
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        dark: {
          bg: '#0f1923',
          card: '#1a2733',
          'card-hover': '#1f3040',
          input: '#14202c',
        },
        accent: {
          DEFAULT: '#e8a639',
          dim: '#c98b2e',
          light: '#f0c060',
        },
        theme: {
          text: '#e0e6ed',
          dim: '#8899a6',
          border: '#2d3e4f',
        },
        success: {
          DEFAULT: '#2ecc71',
          dark: '#27ae60',
        },
        danger: {
          DEFAULT: '#e74c3c',
          dark: '#c0392b',
        },
        warning: {
          DEFAULT: '#f39c12',
          dark: '#d68910',
        },
      },
    },
  },
  plugins: [],
}
```

**`frontend/postcss.config.js`:**
```javascript
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
```

**`frontend/index.html`:**
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Ministry Management - Whiteout Survival</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

### Source Files

Due to the size of the frontend source files, they are provided as references to the actual files in the repository. Each file should be copied verbatim from the project:

| File | Purpose | Lines |
|------|---------|-------|
| `src/main.tsx` | React entry point, imports i18n | 11 |
| `src/App.tsx` | Router layout, language selector header, footer | 41 |
| `src/index.css` | Global dark theme, scrollbar, RTL support | 70 |
| `src/i18n.ts` | All 5 language translations (EN/KO/ZH/TR/AR) | 793 |
| `src/utils/timezone.ts` | Timezone conversion, slot generation | 112 |
| `src/components/LanguageSelector.tsx` | 5-language switcher with RTL toggle | 37 |
| `src/components/TimezoneSelector.tsx` | Timezone dropdown with Globe icon | 31 |
| `src/pages/Home.tsx` | Landing page with published schedule links | 117 |
| `src/pages/PlayerForm.tsx` | 5-step submission form with WOS lookup | 617 |
| `src/pages/UpdateSubmission.tsx` | FID-based update form with tabbed time prefs | 415 |
| `src/pages/AdminLogin.tsx` | Password login page | 88 |
| `src/pages/AdminDashboard.tsx` | Admin tabs (Players/Assignments) | 86 |
| `src/pages/PublishedSchedule.tsx` | Public read-only schedule view | 146 |
| `src/components/admin/PlayerManagement.tsx` | CRUD table, search, sort, edit modal | 517 |
| `src/components/admin/AssignmentManagement.tsx` | Drag-drop assignments, auto-assign, publish | 687 |
| `src/components/admin/AdminSettings.tsx` | Admin settings panel (state number, closing time, research day, fire crystals) | — |
| `src/pages/PlayerGuide.tsx` | Player-facing guide page | — |
| `src/pages/AdminGuide.tsx` | Admin-facing guide page | — |
| `src/utils/affiliate.ts` | LootBar affiliate link helper | — |

> **IMPORTANT:** The `i18n.ts` file is critical — it contains all translations for 5 languages across all UI elements. The complete file is 793 lines. Copy it exactly from the source.

### Frontend Routes

Defined in `src/App.tsx` via React Router:

| Path | Component | Description |
|------|-----------|-------------|
| `/` | `Home` | Landing page with published schedule links |
| `/submit` | `PlayerForm` | Player submission form |
| `/update` | `UpdateSubmission` | Update existing submission by FID |
| `/admin` | `AdminLogin` | Admin password login |
| `/admin/dashboard` | `AdminDashboard` | Admin panel (players, assignments, settings) |
| `/schedule/:day` | `PublishedSchedule` | Public read-only schedule for a day |
| `/guide` | `PlayerGuide` | Player-facing guide |
| `/admin/guide` | `AdminGuide` | Admin-facing guide |

---

## Docker & Deployment

### `Dockerfile`

```dockerfile
# Multi-stage build for optimized Cloud Run deployment

# Stage 1: Build frontend
FROM node:18-alpine AS frontend-builder

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# Stage 2: Backend with built frontend
FROM python:3.11-slim

WORKDIR /app

# Copy backend requirements and install
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY backend/ ./

# Copy built frontend
COPY --from=frontend-builder /app/frontend/dist ./static

# Create data directory for persistent storage
RUN mkdir -p /data

# Set environment variables
ENV FLASK_ENV=production
ENV PYTHONUNBUFFERED=1
ENV PORT=8080
ENV DATABASE_PATH=/data/minister.db

# Expose port
EXPOSE 8080

# Run with gunicorn - single worker to prevent concurrent SQLite writes on GCS FUSE
# Multiple workers cause journal file OutOfOrderError on GCS FUSE
CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--workers", "1", "--threads", "2", "--timeout", "120", "app:app"]
```

### `docker-compose.yml`

```yaml
version: '3.8'

services:
  app:
    build: .
    ports:
      - "8080:8080"
    volumes:
      - ./data:/app/data
    environment:
      - FLASK_ENV=development
      - SECRET_KEY=dev-secret-key-change-in-production
      - ADMIN_PASSWORD=admin123
      - MINISTER_PASSWORD=minister123
      - DATABASE_PATH=/app/data/minister.db
    restart: unless-stopped
```

---

## Business Logic Deep Dive

### Point Calculation System

Points are calculated differently per day type:

**Monday (Construction Day):**
```
points = (construction_speedups_days × 1440) + (general_speedups_days × 1440)
         + (refined_fire_crystals × 30,000) + (fire_crystals × 2,000)
```

**Tuesday/Friday (Research Day):**
```
points = (research_speedups_days × 1440) + (general_speedups_days × 1440)
         + (fire_crystal_shards × 1,000)
```

**Thursday (Troop Training Day):**
```
points = troop_training_speedups_days (raw value, 1 point per day)
```

> Note: 1 day = 1440 minutes. Speedup values are stored in days and converted to minutes for construction/research.

### Auto-Assignment Algorithm

1. Calculate points for all players for the selected day
2. Sort players by points descending (highest first)
3. Read the configured slot offset (`-20`, `-15`, `-10`, or `0`) and generate the 30-min slot list. Examples:
   - Offset `0`: 48 slots — `00:00, 00:30, …, 23:30`
   - Offset `-10`: 49 slots — `23:50-1, 00:20, 00:50, …, 23:20, 23:50`
   - Offset `-15`: 49 slots — `23:45-1, 00:15, 00:45, …, 23:15, 23:45`
   - Offset `-20`: 49 slots — `23:40-1, 00:10, 00:40, …, 23:10, 23:40`
4. For each player (highest points first):
   - Get their hourly time preferences for this day type
   - Map each preference H to every 30-min slot whose window overlaps hour H by ≥ 10 minutes (typically 2 slots at offset 0, 3 slots at any non-zero offset)
   - Assign to the first empty matching slot
   - If no empty slot found, add to unassigned list
5. Save assignments to database

### Slot ID Convention

- Plain `HH:MM` IDs (e.g. `12:30`, `23:50`) refer to slots starting in the current day.
- A `-1` suffix (e.g. `23:50-1`) marks the **pre-day** slot — the previous day's last slot still running past midnight into today. Only appears when offset ≠ 0.
- Excel export renders the pre-day slot as `23:MM (-1d)`.
- `formatTimeInTimezone()` strips the suffix before timezone conversion.
- The UI shows a small `(-1d)` badge next to pre-day slots in admin assignment, published schedule, and update-submission views.

### Application Closing Time

- Checked in `submit_player()`: if `application_closing_time` setting is set and the current UTC time is past the deadline, new FIDs are blocked with a 403 response
- Existing FID updates are still allowed after the deadline — only new submissions are blocked
- The closing time is stored and compared in UTC

### Settings Helpers

- `get_setting(key, default=None)` — retrieves a value from the `settings` table, returns `default` if not found
- `set_setting(key, value)` — upserts a value into the `settings` table using `INSERT OR REPLACE`

### Multi-Day Publishing

- Published days are stored as a comma-separated string in the `settings` table (key: `published_days`)
- Each day can be independently published/unpublished
- Public schedule endpoint returns only `game_name`, `alliance`, and `time_slot` — no points or resources
- Home page fetches the published days list and renders a link for each

---

## API Reference

### Public Endpoints (no auth required)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `POST` | `/api/player/submit` | Submit/update player info |
| `POST` | `/api/player/check-duplicate` | Check if FID/name exists |
| `GET` | `/api/player/<fid>` | Get player by FID |
| `POST` | `/api/player/wos-lookup` | Lookup player from WOS game API |
| `GET` | `/api/settings/research-day` | Get current research day |
| `GET` | `/api/settings/show-fire-crystals` | Get fire crystal visibility |
| `GET` | `/api/settings/time-slot-offset` | Get slot offset (-20, -15, -10, or 0) |
| `GET` | `/api/settings/published-days` | Get array of published days |
| `GET` | `/api/settings/application-closing-time` | Returns `{closing_time, is_closed}` |
| `GET` | `/api/settings/state-number` | Returns `{state_number}`, default '2694' |
| `GET` | `/api/published-schedule/<day>` | Get public schedule for a day |
| `GET` | `/api/time-preferences/heatmap` | Get time slot demand data for heat map |
| `GET` | `/api/player/<fid>/assignments` | Get a player's assignments across all days |

### Admin Endpoints (require `Authorization: Bearer <token>` header)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/admin/login` | Authenticate (returns token) |
| `GET` | `/api/admin/players` | Get all players with points |
| `PUT` | `/api/admin/player/<id>` | Update player |
| `DELETE` | `/api/admin/player/<id>` | Delete player |
| `DELETE` | `/api/admin/players/delete-all` | Delete all players |
| `POST` | `/api/admin/assignments/auto-assign` | Run auto-assignment |
| `GET` | `/api/admin/assignments/<day>` | Get assignments for day |
| `POST` | `/api/admin/assignments/update` | Save drag-drop changes |
| `GET` | `/api/admin/export` | Export Excel workbook |
| `PUT` | `/api/admin/settings/research-day` | Set Tuesday/Friday |
| `PUT` | `/api/admin/settings/show-fire-crystals` | Toggle fire crystal fields |
| `PUT` | `/api/admin/settings/time-slot-offset` | Set slot offset (-20, -15, -10, or 0) |
| `PUT` | `/api/admin/settings/application-closing-time` | Set/clear application deadline |
| `PUT` | `/api/admin/settings/state-number` | Set state number |
| `PUT` | `/api/admin/settings/publish` | Publish a day's schedule |
| `PUT` | `/api/admin/settings/unpublish` | Unpublish a day's schedule |
| `GET` | `/api/admin/players/export-json` | Export all players as JSON |
| `POST` | `/api/admin/players/import` | Import players from JSON |

---

## Database Schema

### `players`
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Auto-increment |
| fid | TEXT UNIQUE | Required, player's game ID |
| game_name | TEXT | Required |
| construction_speedups_days | REAL | Default 0 |
| research_speedups_days | REAL | Default 0 |
| troop_training_speedups_days | REAL | Default 0 |
| general_speedups_days | REAL | Default 0 |
| fire_crystals | INTEGER | Default 0 |
| refined_fire_crystals | INTEGER | Default 0 |
| fire_crystal_shards | INTEGER | Default 0 |
| avatar_image | TEXT | URL from WOS API |
| stove_lv | INTEGER | Furnace level from WOS API |
| stove_lv_content | TEXT | Furnace icon URL from WOS API |
| alliance | TEXT | 3-char max alliance tag |
| timezone | TEXT | Player's preferred timezone |
| created_at | TIMESTAMP | Auto |
| updated_at | TIMESTAMP | Auto |

### `time_preferences`
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Auto-increment |
| player_id | INTEGER FK | References players(id) |
| time_slot | TEXT | e.g., "14:00" |
| day_type | TEXT | 'construction', 'research', or 'troop' |
| | | UNIQUE(player_id, time_slot, day_type) |

### `assignments`
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Auto-increment |
| player_id | INTEGER FK | References players(id) |
| day | TEXT | 'monday', 'tuesday', 'friday', 'thursday' |
| time_slot | TEXT | e.g., "14:20"; pre-day slot uses "-1" suffix (e.g. "23:50-1") when offset ≠ 0 |
| position | INTEGER | Default 0 |
| is_assigned | BOOLEAN | Default 1 |
| created_at | TIMESTAMP | Auto |
| | | UNIQUE(day, time_slot, position) |

### `settings`
| Column | Type | Notes |
|--------|------|-------|
| key | TEXT PK | Setting name |
| value | TEXT | Setting value |

**Known settings keys:**
- `research_day` — `'tuesday'` or `'friday'`
- `show_fire_crystals` — `'true'` or `'false'`
- `published_days` — comma-separated list, e.g., `'monday,thursday'`
- `application_closing_time` — ISO 8601 UTC datetime string, or empty to disable
- `state_number` — state identifier string, default `'2694'`

### `admin_users`
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Auto-increment |
| username | TEXT UNIQUE | |
| password_hash | TEXT | |
| role | TEXT | |
| created_at | TIMESTAMP | Auto |

> Note: The `admin_users` table exists in the schema but is **not currently used** — authentication is done via environment variable passwords.

---

## Deployment Lessons Learned

### GCS FUSE Requires `journal_mode=DELETE`
SQLite WAL mode creates `-shm` and `-wal` sidecar files. GCS FUSE cannot handle out-of-order writes to these files, producing `BufferedWriteHandler.OutOfOrderError`. The fix is `PRAGMA journal_mode=DELETE` (set in `database.py` → `init_db()`). If you see this error, delete the database from the GCS bucket and let it recreate.

### Cloud Run Needs `--min-instances=1`
Without `--min-instances 1`, Cloud Run aggressively scales to zero. On cold start, the container crash-loops (starts, runs ~90 seconds, gets SIGTERM, restarts). This produces 429 "Rate Exceeded" errors for users.

### Single Gunicorn Worker for SQLite
Multiple gunicorn workers cause concurrent SQLite writes. On GCS FUSE this produces `OutOfOrderError` on journal files. The Dockerfile uses `--workers 1 --threads 2` which is safe.

### Cloud Run `gen2` Required
GCS FUSE volume mounts require `--execution-environment gen2`. Gen1 does not support volume mounts.

### Deploying to Cloud Run

```bash
# Build
gcloud builds submit --tag gcr.io/YOUR_PROJECT/ministry-management

# Deploy (first time — set up volume mount for SQLite persistence)
gcloud run deploy ministry-management \
  --image gcr.io/YOUR_PROJECT/ministry-management \
  --region us-central1 \
  --min-instances 1 \
  --execution-environment gen2 \
  --set-env-vars "SECRET_KEY=your-key,ADMIN_PASSWORD=your-pass,MINISTER_PASSWORD=your-pass,DATABASE_PATH=/data/minister.db" \
  --add-volume name=ministry-data,type=cloud-storage,bucket=YOUR_BUCKET \
  --add-volume-mount volume=ministry-data,mount-path=/data

# Subsequent deploys (image only)
gcloud run deploy ministry-management \
  --image gcr.io/YOUR_PROJECT/ministry-management \
  --region us-central1
```

### Running Locally

```bash
# Backend
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
DATABASE_PATH=./data/minister.db python app.py

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
# Opens at http://localhost:5173, proxies API to :8080
```

### With Docker
```bash
docker compose up --build
# Runs at http://localhost:8080
```

---

## WOS API Integration

The app integrates with the Whiteout Survival gift code API to auto-fill player information:

**Endpoint:** `POST https://wos-giftcode-api.centurygame.com/api/player`

**Authentication:**
- Uses a shared secret: `tB87#kPtkxqOS2`
- Request body: `sign=<md5>&fid=<fid>&time=<nanosecond_timestamp>`
- Sign is MD5 of `fid=<fid>&time=<ts>` + secret

**Returns:** nickname, avatar image URL, furnace level, furnace icon URL

---

*This document was generated on March 16, 2026. It contains everything needed to completely recreate the Ministry Management System from scratch.*
