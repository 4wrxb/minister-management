"""
tests/backend/test_migration.py — schema migration from the legacy
time_slot TEXT layout to the numerical hour_index / slot_index columns.

The migration is wired into ``database.init_db()`` and runs after main's
existing day_type migration. These tests:

1. Drop the new schema.
2. Recreate the legacy time_slot TEXT tables and insert representative rows.
3. Call ``database.init_db(flask_app)`` to drive the migration.
4. Assert the resulting schema is the new one and data was preserved.
"""
import logging

import pytest


# ── Helpers ──────────────────────────────────────────────────────────────────

LEGACY_TIME_PREFERENCES_SCHEMA = """
    CREATE TABLE time_preferences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        player_id INTEGER NOT NULL,
        time_slot TEXT NOT NULL,
        day_type TEXT NOT NULL DEFAULT 'construction',
        FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
        UNIQUE(player_id, time_slot, day_type)
    )
"""

LEGACY_ASSIGNMENTS_SCHEMA = """
    CREATE TABLE assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        player_id INTEGER NOT NULL,
        day TEXT NOT NULL,
        time_slot TEXT NOT NULL,
        position INTEGER DEFAULT 0,
        is_assigned BOOLEAN DEFAULT 1,
        is_sticky BOOLEAN DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
        UNIQUE(day, time_slot, position)
    )
"""


def _drop_and_recreate_legacy(flask_app):
    """Drop the new schema and recreate the legacy time_slot TEXT tables."""
    with flask_app.app_context():
        from database import get_db

        db = get_db()
        cursor = db.cursor()
        cursor.execute("DROP TABLE IF EXISTS time_preferences")
        cursor.execute("DROP TABLE IF EXISTS assignments")
        cursor.execute(LEGACY_TIME_PREFERENCES_SCHEMA)
        cursor.execute(LEGACY_ASSIGNMENTS_SCHEMA)
        db.commit()


def _table_columns(flask_app, table):
    with flask_app.app_context():
        from database import get_db

        cursor = get_db().cursor()
        cursor.execute(f"PRAGMA table_info({table})")
        return [c["name"] for c in cursor.fetchall()]


def _insert_player(flask_app, player_id=1, fid="legacy01"):
    with flask_app.app_context():
        from database import get_db

        db = get_db()
        cursor = db.cursor()
        # Make sure players table has the row referenced by FKs.
        cursor.execute(
            "INSERT OR IGNORE INTO players (id, fid, game_name) VALUES (?, ?, ?)",
            (player_id, fid, "Legacy"),
        )
        db.commit()


def _run_init_db(flask_app):
    """Run the migration steps directly.

    We can't re-invoke ``init_db(app)`` after Flask has handled a request
    (teardown_appcontext is locked), so we replay the same migration logic
    on the existing connection instead.
    """
    with flask_app.app_context():
        from database import (
            get_db,
            get_time_slot_offset,
            _migrate_time_preferences_to_hour_index,
            _migrate_assignments_to_slot_index,
        )

        db = get_db()
        cursor = db.cursor()
        current_offset = get_time_slot_offset()
        _migrate_time_preferences_to_hour_index(cursor)
        _migrate_assignments_to_slot_index(cursor, current_offset)
        db.commit()


# ── Tests ─────────────────────────────────────────────────────────────────────

def test_migration_from_legacy_time_slot_text_schema_preserves_preferences(flask_app):
    _drop_and_recreate_legacy(flask_app)
    _insert_player(flask_app, player_id=1)
    _insert_player(flask_app, player_id=2, fid="legacy02")

    with flask_app.app_context():
        from database import get_db

        db = get_db()
        cursor = db.cursor()
        rows = [
            (1, "00:00", "construction"),
            (1, "13:00", "research"),
            (1, "23:00", "troop"),
            (2, "06:00", "construction"),
            (2, "06:00", "research"),
        ]
        for row in rows:
            cursor.execute(
                "INSERT INTO time_preferences (player_id, time_slot, day_type) VALUES (?, ?, ?)",
                row,
            )
        db.commit()

    _run_init_db(flask_app)

    columns = _table_columns(flask_app, "time_preferences")
    assert "hour_index" in columns
    assert "time_slot" not in columns

    with flask_app.app_context():
        from database import get_db

        cursor = get_db().cursor()
        cursor.execute(
            "SELECT player_id, hour_index, day_type FROM time_preferences ORDER BY player_id, hour_index, day_type"
        )
        rows = [tuple(r) for r in cursor.fetchall()]
        assert rows == [
            (1, 0, "construction"),
            (1, 13, "research"),
            (1, 23, "troop"),
            (2, 6, "construction"),
            (2, 6, "research"),
        ]


def test_migration_from_legacy_time_slot_text_schema_preserves_assignments(flask_app):
    _drop_and_recreate_legacy(flask_app)
    _insert_player(flask_app, player_id=1)

    with flask_app.app_context():
        from database import get_db

        db = get_db()
        cursor = db.cursor()
        rows = [
            # (player_id, day, time_slot, position, is_assigned, is_sticky)
            (1, "monday", "23:50", 0, 1, 0),   # pre-day slot
            (1, "monday", "23:50+", 0, 1, 0),  # end-of-day slot — distinct!
            (1, "monday", "06:20", 0, 1, 0),
            (1, "tuesday", "13:20", 0, 1, 1),  # sticky
        ]
        for row in rows:
            cursor.execute(
                "INSERT INTO assignments (player_id, day, time_slot, position, is_assigned, is_sticky) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                row,
            )
        db.commit()

    _run_init_db(flask_app)

    columns = _table_columns(flask_app, "assignments")
    assert "slot_index" in columns
    assert "time_slot" not in columns

    with flask_app.app_context():
        from database import get_db
        from slots import slot_index_to_id

        cursor = get_db().cursor()
        cursor.execute(
            "SELECT day, slot_index, is_sticky FROM assignments ORDER BY day, slot_index"
        )
        rows = cursor.fetchall()
        # Default offset is -10. Decode the indices back to ensure correctness.
        decoded = [(r["day"], slot_index_to_id(r["slot_index"], -10), r["is_sticky"]) for r in rows]
        assert ("monday", "23:50", 0) in decoded   # pre-day slot
        assert ("monday", "23:50+", 0) in decoded  # end-of-day slot
        assert ("monday", "06:20", 0) in decoded
        # Sticky preserved
        assert ("tuesday", "13:20", 1) in decoded


def test_migration_is_idempotent(flask_app):
    """Running init_db twice on an already-migrated schema is a no-op."""
    _drop_and_recreate_legacy(flask_app)
    _run_init_db(flask_app)

    # Capture schema state after first migration
    before = _table_columns(flask_app, "time_preferences")
    assert "hour_index" in before

    # Second run should not change anything (no errors, schema unchanged)
    _run_init_db(flask_app)
    after = _table_columns(flask_app, "time_preferences")
    assert after == before

    # Marker should still be set
    with flask_app.app_context():
        from database import get_setting

        assert get_setting("numerical_slot_indexing_v1") == "1"


def test_migration_under_offset_zero_remaps_correctly(flask_app):
    """When the configured offset is 0, legacy rows whose times only exist
    under offset 0 (e.g. '06:00', '06:30') are mapped correctly."""
    _drop_and_recreate_legacy(flask_app)
    _insert_player(flask_app, player_id=1)

    # Set the offset BEFORE running migration so the assignments table is
    # interpreted under offset 0.
    with flask_app.app_context():
        from database import set_setting

        set_setting("time_slot_offset", "0")

        from database import get_db

        cursor = get_db().cursor()
        for row in [
            (1, "monday", "06:00", 0, 1, 0),
            (1, "monday", "06:30", 0, 1, 0),
            (1, "monday", "00:00", 0, 1, 0),
            (1, "monday", "23:30", 0, 1, 0),
        ]:
            cursor.execute(
                "INSERT INTO assignments (player_id, day, time_slot, position, is_assigned, is_sticky) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                row,
            )
        get_db().commit()

    _run_init_db(flask_app)

    with flask_app.app_context():
        from database import get_db
        from slots import slot_id_to_index

        cursor = get_db().cursor()
        cursor.execute("SELECT slot_index FROM assignments ORDER BY slot_index")
        indices = [r["slot_index"] for r in cursor.fetchall()]
        expected = sorted([
            slot_id_to_index("00:00", 0),
            slot_id_to_index("06:00", 0),
            slot_id_to_index("06:30", 0),
            slot_id_to_index("23:30", 0),
        ])
        assert indices == expected


def test_migration_skips_unmappable_legacy_rows_and_logs(flask_app, caplog):
    """An invalid time_slot string is dropped and warned about, not crashed on."""
    _drop_and_recreate_legacy(flask_app)
    _insert_player(flask_app, player_id=1)

    with flask_app.app_context():
        from database import get_db

        cursor = get_db().cursor()
        cursor.execute(
            "INSERT INTO assignments (player_id, day, time_slot, position, is_assigned, is_sticky) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (1, "monday", "99:99", 0, 1, 0),
        )
        cursor.execute(
            "INSERT INTO time_preferences (player_id, time_slot, day_type) VALUES (?, ?, ?)",
            (1, "garbage", "construction"),
        )
        get_db().commit()

    with caplog.at_level(logging.WARNING, logger="database"):
        _run_init_db(flask_app)

    with flask_app.app_context():
        from database import get_db

        cursor = get_db().cursor()
        cursor.execute("SELECT COUNT(*) FROM assignments")
        assert cursor.fetchone()[0] == 0
        cursor.execute("SELECT COUNT(*) FROM time_preferences")
        assert cursor.fetchone()[0] == 0

    # At least one "unmappable" warning was logged
    assert any("unmappable" in r.getMessage().lower() for r in caplog.records), (
        f"Expected an unmappable-row warning; got: {[r.getMessage() for r in caplog.records]}"
    )


def test_full_init_db_then_api_roundtrip_after_migration(flask_app, client):
    """End-to-end: legacy data → init_db migrates → API returns the players
    with their preferences intact (as HH:00 hour strings)."""
    _drop_and_recreate_legacy(flask_app)
    _insert_player(flask_app, player_id=1, fid="legacy42")

    with flask_app.app_context():
        from database import get_db

        cursor = get_db().cursor()
        for row in [
            (1, "00:00", "construction"),
            (1, "13:00", "research"),
            (1, "23:00", "troop"),
        ]:
            cursor.execute(
                "INSERT INTO time_preferences (player_id, time_slot, day_type) VALUES (?, ?, ?)",
                row,
            )
        get_db().commit()

    _run_init_db(flask_app)

    # API should now return the migrated player with the same hour preferences
    resp = client.get("/api/admin/players", headers={"Authorization": "admin-token"})
    assert resp.status_code == 200
    players = resp.get_json()
    legacy = next(p for p in players if p["fid"] == "legacy42")
    by_day = legacy["time_slots_by_day"]
    assert sorted(by_day["construction"]) == ["00:00"]
    assert sorted(by_day["research"]) == ["13:00"]
    assert sorted(by_day["troop"]) == ["23:00"]


def test_migration_helpers_do_not_commit_mid_transaction(flask_app, monkeypatch):
    """The migration helpers must not call ``set_setting`` mid-migration —
    ``set_setting`` itself calls ``db.commit()``, which would break the
    single-transaction guarantee. The marker must only become durable when
    ``init_db()``'s final ``db.commit()`` runs. This way, if migration
    fails or the process crashes mid-way, no partial-state marker is left
    behind to skip the migration on the next boot.
    """
    _drop_and_recreate_legacy(flask_app)
    _insert_player(flask_app, player_id=1)

    with flask_app.app_context():
        import database as database_module
        from database import get_db

        db = get_db()
        cursor = db.cursor()
        cursor.execute(
            "INSERT INTO time_preferences (player_id, time_slot, day_type) VALUES (?, ?, ?)",
            (1, "10:00", "construction"),
        )
        cursor.execute(
            "INSERT INTO assignments (player_id, day, time_slot, position, is_assigned, is_sticky) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (1, "monday", "10:20", 0, 1, 0),
        )
        db.commit()

        # Track set_setting calls. set_setting is the route through which
        # the helpers could accidentally commit mid-migration.
        set_setting_calls = []
        original_set_setting = database_module.set_setting

        def tracked_set_setting(key, value):
            set_setting_calls.append((key, value))
            return original_set_setting(key, value)

        monkeypatch.setattr(database_module, "set_setting", tracked_set_setting)

        try:
            database_module._migrate_time_preferences_to_hour_index(cursor)
            database_module._migrate_assignments_to_slot_index(cursor, -10)
        finally:
            # Always commit so the schema lands cleanly even if assertions
            # are about to fail; otherwise subsequent tests inherit a
            # half-migrated schema.
            db.commit()

    assert set_setting_calls == [], (
        f"Migration helpers called set_setting (commits mid-migration): {set_setting_calls}"
    )

    # And confirm the marker DID get written (by the cursor.execute paths,
    # then made durable by the explicit commit above).
    with flask_app.app_context():
        from database import get_setting

        assert get_setting("numerical_slot_indexing_v1") == "1"
