"""tests/backend/test_database_vfs.py

Verify that the SQLITE_VFS env var is correctly threaded into sqlite3.connect.
Documents the production use case: SQLITE_VFS=unix-dotfile makes SQLite use
dotfile-based locking instead of fcntl byte-range locks, which is required on
SMB/CIFS network filesystems like Azure Files.

These tests build their own Flask app rather than reusing the conftest fixtures
because they need to monkeypatch database.DB_PATH to a per-test temp file.
"""
import os
import sqlite3
import sys

import pytest
from flask import Flask

# database is already importable via the conftest's sys.path manipulation,
# but make the import explicit for readability.
_BACKEND = os.path.join(os.path.dirname(__file__), "..", "..", "backend")
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)
import database  # noqa: E402


def _make_app(database_path: str) -> Flask:
    """Build a minimal Flask app that uses our database module for connections."""
    app = Flask(__name__)
    app.teardown_appcontext(database.close_db)
    return app


@pytest.mark.skipif(
    sys.platform == "win32",
    reason="The unix-dotfile VFS is only available on Unix builds of SQLite",
)
def test_sqlite_vfs_unix_dotfile_accepted(monkeypatch, tmp_path):
    """Setting SQLITE_VFS=unix-dotfile produces a working connection.

    Proves that the new branch in get_db() correctly opens the database via
    URI mode with the vfs= parameter applied.
    """
    db_file = tmp_path / "vfs.db"
    monkeypatch.setenv("SQLITE_VFS", "unix-dotfile")
    monkeypatch.setattr(database, "DB_PATH", str(db_file))

    app = _make_app(str(db_file))
    with app.app_context():
        db = database.get_db()
        db.execute("CREATE TABLE t (x INTEGER)")
        db.execute("INSERT INTO t VALUES (1)")
        db.commit()
        rows = db.execute("SELECT x FROM t").fetchall()
        assert [tuple(r) for r in rows] == [(1,)]


def test_sqlite_vfs_invalid_value_raises(monkeypatch, tmp_path):
    """SQLITE_VFS=<nonsense> raises OperationalError.

    This is the strongest signal that the vfs= argument is actually being
    passed to sqlite3.connect — if the code accidentally dropped the
    parameter, this test would pass without raising.
    """
    db_file = tmp_path / "bad.db"
    monkeypatch.setenv("SQLITE_VFS", "this-vfs-does-not-exist")
    monkeypatch.setattr(database, "DB_PATH", str(db_file))

    app = _make_app(str(db_file))
    with app.app_context():
        with pytest.raises(sqlite3.OperationalError):
            database.get_db()


def test_sqlite_vfs_unset_uses_default(monkeypatch, tmp_path):
    """Control: SQLITE_VFS unset → default connection succeeds (no URI mode)."""
    db_file = tmp_path / "default.db"
    monkeypatch.delenv("SQLITE_VFS", raising=False)
    monkeypatch.setattr(database, "DB_PATH", str(db_file))

    app = _make_app(str(db_file))
    with app.app_context():
        db = database.get_db()
        db.execute("CREATE TABLE t (x INTEGER)")
        db.execute("INSERT INTO t VALUES (42)")
        db.commit()
        rows = db.execute("SELECT x FROM t").fetchall()
        assert [tuple(r) for r in rows] == [(42,)]
