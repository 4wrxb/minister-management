"""
tests/backend/conftest.py

Configure the test environment BEFORE importing any app code.
Module-level os.environ assignments run first, so database.DB_PATH
picks up the test path when app.py is imported inside the flask_app fixture.
"""
import os
import sys

# ── Environment must be set BEFORE any app import ────────────────────────────
_HERE = os.path.dirname(os.path.abspath(__file__))
_TEST_DB = os.path.join(_HERE, ".test_minister.db")

os.environ["DATABASE_PATH"] = _TEST_DB
os.environ["ADMIN_PASSWORD"] = "testadmin"
os.environ["MINISTER_PASSWORD"] = "testminister"
os.environ["SECRET_KEY"] = "test-secret-key"

# Make backend and this directory importable
sys.path.insert(0, _HERE)  # for: from helpers import Scenario
sys.path.insert(0, os.path.join(_HERE, "..", "..", "backend"))  # for: from app import app

import pytest


# ── Core fixtures ─────────────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def flask_app():
    """Single Flask app instance for the entire test session."""
    from app import app as _app  # imported here so env vars are already set

    _app.config["TESTING"] = True
    return _app


@pytest.fixture(autouse=True)
def reset_db(flask_app):
    """Wipe all data rows before every test, keeping the schema intact."""
    with flask_app.app_context():
        from database import get_db

        db = get_db()
        for table in ("assignments", "time_preferences", "players", "settings", "admin_users"):
            db.execute(f"DELETE FROM {table}")  # noqa: S608 — safe: table names are literals
        db.commit()


@pytest.fixture
def client(flask_app):
    """Flask test client. Each test gets a fresh client."""
    with flask_app.test_client() as c:
        yield c


@pytest.fixture
def admin_headers():
    """Authorization header for the admin token."""
    return {"Authorization": "admin-token"}


@pytest.fixture
def minister_headers():
    """Authorization header for the minister token."""
    return {"Authorization": "minister-token"}


# ── Seed helpers (importable by test files via `from conftest import …`) ──────

def player_payload(fid: str = "p001", game_name: str = "Player1", **overrides) -> dict:
    """Return a fully valid player payload."""
    data = {
        "fid": fid,
        "game_name": game_name,
        "alliance": "TST",
        "construction_speedups_days": 10,
        "research_speedups_days": 5,
        "troop_training_speedups_days": 3,
        "general_speedups_days": 2,
        "fire_crystals": 100,
        "refined_fire_crystals": 10,
        "fire_crystal_shards": 50,
        "time_slots": ["00:00", "01:00", "02:00"],
    }
    data.update(overrides)
    return data


def seed_player(client, fid: str = "p001", game_name: str = "Player1", **overrides) -> dict:
    """Submit a single player and return the payload used."""
    payload = player_payload(fid, game_name, **overrides)
    resp = client.post("/api/player/submit", json=payload)
    assert resp.status_code == 200, f"seed_player failed ({resp.status_code}): {resp.get_json()}"
    return payload


def seed_players(client, count: int = 3) -> list:
    """Seed `count` players with descending construction points and return their payloads."""
    return [
        seed_player(
            client,
            fid=f"p{i + 1:03d}",
            game_name=f"Player{i + 1}",
            # Descending so p001 has highest points
            construction_speedups_days=10 * (count - i),
        )
        for i in range(count)
    ]
