"""tests/backend/test_players.py — player CRUD and validation scenarios."""
import pytest
from datetime import datetime, timezone, timedelta
from conftest import player_payload, seed_player, seed_players
from helpers import Scenario


# ── Submit + retrieve round-trip ───────────────────────────────────────────────

def test_submit_and_retrieve_by_fid(client):
    payload = player_payload("fid001", "Hero1", construction_speedups_days=20)
    (Scenario(client)
        .post("/api/player/submit", json=payload)
        .assert_json_contains(success=True)
        .get("/api/player/fid001")
        .assert_json_contains(fid="fid001", game_name="Hero1"))


def test_submit_duplicate_fid_updates_player(client):
    """Submitting with an existing FID should update rather than duplicate."""
    seed_player(client, fid="fid001", game_name="Original")
    updated = player_payload("fid001", "Updated", construction_speedups_days=99)

    (Scenario(client)
        .post("/api/player/submit", json=updated)
        .assert_json_contains(success=True)
        .get("/api/player/fid001")
        .assert_json_contains(game_name="Updated"))


def test_player_round_trip_preserves_hourly_preferences(client):
    """Hourly preferences round-trip through hour_index storage regardless of offset.

    The DB stores integer hour indices, but the API contract is hour strings
    like "00:00", "13:00", "23:00" — submit, retrieve, and assert the exact
    set comes back."""
    payload = player_payload(
        "fid007",
        "RoundTrip",
        time_slots=["00:00", "13:00", "23:00"],
    )
    resp = client.post("/api/player/submit", json=payload)
    assert resp.status_code == 200

    fetched = client.get("/api/player/fid007").get_json()
    assert set(fetched["time_slots"]) == {"00:00", "13:00", "23:00"}


# ── Validation ────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("missing_field", ["fid", "game_name", "alliance"])
def test_missing_required_field_returns_400(client, missing_field):
    payload = player_payload()
    del payload[missing_field]
    (Scenario(client)
        .post("/api/player/submit", json=payload, expected_status=400))


def test_empty_required_field_returns_400(client):
    payload = player_payload(fid="", game_name="Hero")
    (Scenario(client)
        .post("/api/player/submit", json=payload, expected_status=400))


def test_negative_speedup_returns_400(client):
    payload = player_payload(construction_speedups_days=-1)
    (Scenario(client)
        .post("/api/player/submit", json=payload, expected_status=400))


def test_over_max_speedup_returns_400(client):
    payload = player_payload(construction_speedups_days=100000)
    (Scenario(client)
        .post("/api/player/submit", json=payload, expected_status=400))


def test_unknown_fid_returns_404(client):
    (Scenario(client)
        .get("/api/player/does-not-exist", expected_status=404))


# ── Admin player list ─────────────────────────────────────────────────────────

def test_admin_players_list_is_empty_on_fresh_db(client, admin_headers):
    (Scenario(client, headers=admin_headers)
        .get("/api/admin/players")
        .assert_json_list_length(0))


def test_admin_players_list_includes_submitted_players(client, admin_headers):
    seed_players(client, count=3)
    (Scenario(client, headers=admin_headers)
        .get("/api/admin/players")
        .assert_json_list_length(3))


def test_admin_players_include_calculated_points(client, admin_headers):
    """Monday points for 10 days construction = 10 * 1440 = 14400 (no crystals)."""
    seed_player(
        client,
        construction_speedups_days=10,
        general_speedups_days=0,
        fire_crystals=0,
        refined_fire_crystals=0,
        fire_crystal_shards=0,
    )
    resp = client.get("/api/admin/players", headers=admin_headers)
    data = resp.get_json()
    assert len(data) == 1
    assert data[0]["monday_points"] == 10 * 1440


# ── Admin delete ──────────────────────────────────────────────────────────────

def test_admin_delete_player(client, admin_headers):
    seed_player(client, fid="del001")

    # Get the player id from the list
    players = client.get("/api/admin/players", headers=admin_headers).get_json()
    player_id = players[0]["id"]

    (Scenario(client, headers=admin_headers)
        .delete(f"/api/admin/player/{player_id}")
        .assert_json_contains(success=True)
        .get("/api/admin/players")
        .assert_json_list_length(0))


# ── Application closing time ──────────────────────────────────────────────────

def test_closing_time_blocks_new_submissions(client, admin_headers):
    """After the closing time passes, new players cannot submit."""
    past_dt = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
    client.put(
        "/api/admin/settings/application-closing-time",
        json={"closing_time": past_dt},
        headers=admin_headers,
    )

    payload = player_payload("new001", "NewPlayer")
    resp = client.post("/api/player/submit", json=payload)
    assert resp.status_code == 403
    data = resp.get_json()
    assert data.get("code") == "APPLICATIONS_CLOSED"


def test_closing_time_allows_existing_player_updates(client, admin_headers):
    """Existing players can still update after the closing time."""
    seed_player(client, fid="exist001", game_name="ExistingPlayer")

    past_dt = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
    client.put(
        "/api/admin/settings/application-closing-time",
        json={"closing_time": past_dt},
        headers=admin_headers,
    )

    updated = player_payload("exist001", "UpdatedName")
    resp = client.post("/api/player/submit", json=updated)
    assert resp.status_code == 200
