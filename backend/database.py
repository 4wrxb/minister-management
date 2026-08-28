import sqlite3
import os
import logging
from flask import g

from slots import (
    VALID_SLOT_OFFSETS,
    DEFAULT_SLOT_OFFSET,
    hour_to_index,
    index_to_hour_str,
    slot_id_to_index,
)

logger = logging.getLogger(__name__)

# Database path - set via DATABASE_PATH env var
DB_PATH = os.environ.get('DATABASE_PATH', '/data/minister.db')


def get_db():
    """Get database connection using Flask g context (matches tyrant-poll pattern)."""
    if 'db' not in g:
        os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
        # Optional SQLite VFS override. Set SQLITE_VFS=unix-dotfile when the
        # database lives on a network filesystem that doesn't honour POSIX
        # fcntl byte-range locks reliably (e.g. SMB/CIFS, Azure Files). The
        # unix-dotfile VFS uses on-disk lock files instead of fcntl.
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

        # Time preferences table
        #
        # Stores each player's preferred hour as a 0..23 integer (``hour_index``)
        # rather than a "HH:MM" string so the schema stays stable regardless of
        # which slot offset is configured. Older databases that still have a
        # ``time_slot TEXT`` column are migrated below.
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS time_preferences (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                player_id INTEGER NOT NULL,
                hour_index INTEGER NOT NULL,
                day_type TEXT NOT NULL DEFAULT 'construction',
                FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
                UNIQUE(player_id, hour_index, day_type)
            )
        ''')

        # Assignments table
        #
        # Stores each placement as a numerical ``slot_index`` into the slot grid
        # produced by ``slot_ids(time_slot_offset)``. Older databases that still
        # have a ``time_slot TEXT`` column are migrated below.
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS assignments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                player_id INTEGER NOT NULL,
                day TEXT NOT NULL,
                slot_index INTEGER NOT NULL,
                position INTEGER DEFAULT 0,
                is_assigned BOOLEAN DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
                UNIQUE(day, slot_index, position)
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
        if 'day_type' not in columns and 'time_slot' in columns:
            # Legacy schema (pre-day_type) — recreate with day_type and new unique constraint
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
        elif 'time_slot' in columns:
            # day_type already present; fix unique constraint if it predates day_type.
            # (Skip entirely on the new hour_index schema — there is no time_slot
            # column to project.)
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

        # === Numerical slot indexing migration ===
        #
        # Convert legacy schemas that still store time slots as "HH:MM" strings
        # into integer-indexed columns. Run AFTER the day_type / unique-rebuild
        # migrations above so the source table has the expected shape.
        current_offset = get_time_slot_offset()
        _migrate_time_preferences_to_hour_index(cursor)
        _migrate_assignments_to_slot_index(cursor, current_offset)

        db.commit()


def _migrate_time_preferences_to_hour_index(cursor):
    """Convert ``time_preferences.time_slot TEXT`` to ``hour_index INTEGER``."""
    cursor.execute("PRAGMA table_info(time_preferences)")
    columns = [c['name'] for c in cursor.fetchall()]
    if 'hour_index' in columns or 'time_slot' not in columns:
        return  # already migrated or schema is unrelated

    logger.info("Migrating time_preferences.time_slot → hour_index")
    cursor.execute('ALTER TABLE time_preferences RENAME TO time_preferences_old_numidx')
    cursor.execute('''
        CREATE TABLE time_preferences (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            player_id INTEGER NOT NULL,
            hour_index INTEGER NOT NULL,
            day_type TEXT NOT NULL DEFAULT 'construction',
            FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
            UNIQUE(player_id, hour_index, day_type)
        )
    ''')

    cursor.execute('SELECT player_id, time_slot, day_type FROM time_preferences_old_numidx')
    skipped = 0
    for row in cursor.fetchall():
        idx = hour_to_index(row['time_slot'])
        if idx is None:
            logger.warning(
                "Skipping unmappable time_preferences row: player_id=%s time_slot=%r day_type=%s",
                row['player_id'], row['time_slot'], row['day_type'],
            )
            skipped += 1
            continue
        cursor.execute(
            'INSERT OR IGNORE INTO time_preferences (player_id, hour_index, day_type) VALUES (?, ?, ?)',
            (row['player_id'], idx, row['day_type']),
        )

    cursor.execute('DROP TABLE time_preferences_old_numidx')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_time_prefs_player ON time_preferences(player_id)')
    # NOTE: use the cursor directly rather than set_setting() — set_setting
    # calls db.commit(), which would break the single-transaction guarantee
    # of the migration. The marker becomes durable when init_db() commits.
    cursor.execute(
        'INSERT INTO settings (key, value) VALUES (?, ?) '
        'ON CONFLICT(key) DO UPDATE SET value = ?',
        ('numerical_slot_indexing_v1', '1', '1'),
    )
    if skipped:
        logger.warning("Skipped %d unmappable time_preferences rows during migration", skipped)


def _migrate_assignments_to_slot_index(cursor, offset):
    """Convert ``assignments.time_slot TEXT`` to ``slot_index INTEGER``."""
    cursor.execute("PRAGMA table_info(assignments)")
    columns = [c['name'] for c in cursor.fetchall()]
    if 'slot_index' in columns or 'time_slot' not in columns:
        return  # already migrated or schema is unrelated

    logger.info("Migrating assignments.time_slot → slot_index (offset=%s)", offset)
    cursor.execute('ALTER TABLE assignments RENAME TO assignments_old_numidx')
    cursor.execute('''
        CREATE TABLE assignments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            player_id INTEGER NOT NULL,
            day TEXT NOT NULL,
            slot_index INTEGER NOT NULL,
            position INTEGER DEFAULT 0,
            is_assigned BOOLEAN DEFAULT 1,
            is_sticky BOOLEAN DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
            UNIQUE(day, slot_index, position)
        )
    ''')

    # Old schema may or may not have is_sticky depending on which migration was
    # last applied — read with a defensive COALESCE.
    cursor.execute("PRAGMA table_info(assignments_old_numidx)")
    old_cols = {c['name'] for c in cursor.fetchall()}
    sticky_expr = 'is_sticky' if 'is_sticky' in old_cols else '0 AS is_sticky'
    cursor.execute(
        f'SELECT player_id, day, time_slot, position, is_assigned, {sticky_expr} '
        'FROM assignments_old_numidx'
    )
    skipped = 0
    for row in cursor.fetchall():
        idx = slot_id_to_index(row['time_slot'], offset)
        if idx is None:
            logger.warning(
                "Skipping unmappable assignments row: player_id=%s day=%s time_slot=%r (offset=%s has no such slot)",
                row['player_id'], row['day'], row['time_slot'], offset,
            )
            skipped += 1
            continue
        cursor.execute(
            'INSERT OR IGNORE INTO assignments (player_id, day, slot_index, position, is_assigned, is_sticky) '
            'VALUES (?, ?, ?, ?, ?, ?)',
            (row['player_id'], row['day'], idx, row['position'],
             row['is_assigned'], row['is_sticky']),
        )

    cursor.execute('DROP TABLE assignments_old_numidx')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_assignments_day ON assignments(day)')
    # NOTE: use the cursor directly rather than set_setting() — set_setting
    # calls db.commit(), which would break the single-transaction guarantee
    # of the migration. The marker becomes durable when init_db() commits.
    cursor.execute(
        'INSERT INTO settings (key, value) VALUES (?, ?) '
        'ON CONFLICT(key) DO UPDATE SET value = ?',
        ('numerical_slot_indexing_v1', '1', '1'),
    )
    if skipped:
        logger.warning("Skipped %d unmappable assignments rows during migration", skipped)


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


def get_time_slot_offset():
    """Get the configured slot offset in minutes (one of VALID_SLOT_OFFSETS).

    Returns DEFAULT_SLOT_OFFSET if the setting is missing or stored as an
    unsupported value (e.g. a leftover from a misconfigured deployment).
    """
    raw = get_setting('time_slot_offset', None)
    if raw is None:
        return DEFAULT_SLOT_OFFSET
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return DEFAULT_SLOT_OFFSET
    if value not in VALID_SLOT_OFFSETS:
        return DEFAULT_SLOT_OFFSET
    return value


def set_time_slot_offset(value):
    """Persist the slot offset setting. Raises ValueError on invalid input."""
    try:
        value = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(
            f"time_slot_offset must be an integer in {VALID_SLOT_OFFSETS}"
        ) from exc
    if value not in VALID_SLOT_OFFSETS:
        raise ValueError(
            f"time_slot_offset must be one of {VALID_SLOT_OFFSETS}"
        )
    set_setting('time_slot_offset', str(value))
    return value


def calculate_points(player, day):
    """
    Calculate a player's contribution points for a given SVS ministry day.

    This function is the **single source of truth** for the point calculation
    formula. All documentation (USER_GUIDE.md, RECREATION_GUIDE.md, README.md,
    PROJECT_SUMMARY.md, claude.md) should describe — and link back to — this
    implementation rather than restate the formula independently.

    Unit convention:
        - Speedup fields are stored in **days** (REAL) on the ``players`` table.
        - 1 day = 24 * 60 = **1440 minutes**.
        - For Monday/Tuesday/Friday, speedups are converted to minutes and
          contribute 1 point per minute. Thursday is the only day that keeps
          the raw "days" value (1 point per day of troop training).

    Formulas (by ``day``):

        Monday — Construction Day
            points = (construction_speedups_days + general_speedups_days) * 1440
                   + refined_fire_crystals * 30000
                   + fire_crystals       * 2000
            Inputs: construction_speedups_days, general_speedups_days,
                    refined_fire_crystals, fire_crystals

        Tuesday or Friday — Research Day
            (The state chooses one of these two via the ``research_day``
            setting; the formula is identical either way.)
            points = (research_speedups_days + general_speedups_days) * 1440
                   + fire_crystal_shards * 1000
            Inputs: research_speedups_days, general_speedups_days,
                    fire_crystal_shards

        Thursday — Troop Training Day
            points = troop_training_speedups_days   # 1 point per day, raw
            Inputs: troop_training_speedups_days

        Any other ``day`` value returns 0.

    Args:
        player: dict-like row from the ``players`` table. Must contain the
            speedup and resource fields referenced above.
        day: case-insensitive day name. One of ``'monday'``, ``'tuesday'``,
            ``'friday'``, ``'thursday'``.

    Returns:
        int: the calculated points (truncated to an integer).
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
    """Get all players with their time preferences per day type.

    The DB stores ``hour_index`` integers but the API contract returns
    ``time_slots`` as ``"HH:00"`` strings, so we project on read.
    """
    db = get_db()
    cursor = db.cursor()
    cursor.execute('SELECT * FROM players ORDER BY created_at DESC')
    players = []
    for row in cursor.fetchall():
        player = dict(row)
        # Get time preferences grouped by day_type
        cursor2 = db.cursor()
        cursor2.execute('SELECT hour_index, day_type FROM time_preferences WHERE player_id = ?', (player['id'],))
        time_prefs = {'construction': [], 'research': [], 'troop': []}
        all_slots = set()
        for tp in cursor2.fetchall():
            day_type = tp['day_type']
            time_str = index_to_hour_str(tp['hour_index'])
            if day_type in time_prefs:
                time_prefs[day_type].append(time_str)
            all_slots.add(time_str)
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
        cursor.execute('SELECT hour_index, day_type FROM time_preferences WHERE player_id = ?', (player['id'],))
        time_prefs = {'construction': [], 'research': [], 'troop': []}
        all_slots = set()
        for tp in cursor.fetchall():
            day_type = tp['day_type']
            time_str = index_to_hour_str(tp['hour_index'])
            if day_type in time_prefs:
                time_prefs[day_type].append(time_str)
            all_slots.add(time_str)
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

    # Insert time preferences. We accept either string ("HH:00") or integer
    # hour values from callers; everything is normalized to hour_index on
    # write so the storage layer is offset-independent.
    def _insert_pref(pid, raw, day_type):
        idx = hour_to_index(raw)
        if idx is None:
            return
        cursor.execute('''
            INSERT OR IGNORE INTO time_preferences (player_id, hour_index, day_type)
            VALUES (?, ?, ?)
        ''', (pid, idx, day_type))

    if isinstance(time_slots, dict):
        # Per-day time slots: {'construction': [...], 'research': [...], 'troop': [...]}
        for day_type, slots in time_slots.items():
            for time_slot in slots:
                _insert_pref(player_id, time_slot, day_type)
    else:
        # Legacy: same slots for all day types
        for time_slot in time_slots:
            for day_type in ('construction', 'research', 'troop'):
                _insert_pref(player_id, time_slot, day_type)

    db.commit()
    return player_id


def get_time_preference_counts():
    """Get count of players preferring each time slot, grouped by day_type.
    Returns: { 'construction': {'00:00': 3, ...}, 'research': {...}, 'troop': {...} }

    Counts are stored against ``hour_index`` and projected back to ``"HH:00"``
    strings for backward compatibility with the heatmap UI.
    """
    db = get_db()
    cursor = db.cursor()
    cursor.execute('''
        SELECT day_type, hour_index, COUNT(*) as count
        FROM time_preferences
        GROUP BY day_type, hour_index
    ''')
    result = {'construction': {}, 'research': {}, 'troop': {}}
    for row in cursor.fetchall():
        day_type = row['day_type']
        if day_type in result:
            result[day_type][index_to_hour_str(row['hour_index'])] = row['count']
    return result


def delete_player(player_id):
    """Delete a player and all related data."""
    db = get_db()
    cursor = db.cursor()
    cursor.execute('DELETE FROM players WHERE id = ?', (player_id,))
    db.commit()
