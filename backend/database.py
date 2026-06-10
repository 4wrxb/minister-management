import sqlite3
import os
from flask import g

# Database path - set via DATABASE_PATH env var
DB_PATH = os.environ.get('DATABASE_PATH', '/data/minister.db')


def get_db():
    """Get database connection using Flask g context (matches tyrant-poll pattern)."""
    if 'db' not in g:
        os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
        # Use unix-dotfile VFS so SQLite uses on-disk lock files instead of
        # POSIX fcntl locks. Required on network filesystems (SMB/CIFS like
        # Azure Files) that don't honor fcntl byte-range locks reliably.
        vfs = os.environ.get('SQLITE_VFS')
        if vfs:
            g.db = sqlite3.connect(f"file:{DB_PATH}?vfs={vfs}", uri=True)
        else:
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
            'ALTER TABLE assignments ADD COLUMN is_sticky BOOLEAN DEFAULT 0',
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


def get_time_preference_counts():
    """Get count of players preferring each time slot, grouped by day_type.
    Returns: { 'construction': {'00:00': 3, ...}, 'research': {...}, 'troop': {...} }
    """
    db = get_db()
    cursor = db.cursor()
    cursor.execute('''
        SELECT day_type, time_slot, COUNT(*) as count
        FROM time_preferences
        GROUP BY day_type, time_slot
    ''')
    result = {'construction': {}, 'research': {}, 'troop': {}}
    for row in cursor.fetchall():
        day_type = row['day_type']
        if day_type in result:
            result[day_type][row['time_slot']] = row['count']
    return result


def delete_player(player_id):
    """Delete a player and all related data."""
    db = get_db()
    cursor = db.cursor()
    cursor.execute('DELETE FROM players WHERE id = ?', (player_id,))
    db.commit()
