"""
tests/backend/test_assignments.py — auto-assign and manual assignment scenarios.

Each test seeds its own initial state then drives the assignment API.
"""
from conftest import player_payload, seed_player, seed_players
from helpers import Scenario


# ── Auto-assign ───────────────────────────────────────────────────────────────

def test_auto_assign_with_no_players_returns_empty(client, admin_headers):
    resp = client.post(
        "/api/admin/assignments/auto-assign",
        json={"day": "monday"},
        headers=admin_headers,
    )
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["success"] is True
    # All slots should be empty
    assert all(len(players) == 0 for players in data["assignments"].values())
    assert data["unassigned"] == []


def test_auto_assign_invalid_day_returns_400(client, admin_headers):
    (Scenario(client, headers=admin_headers)
        .post("/api/admin/assignments/auto-assign", json={"day": "wednesday"}, expected_status=400))


def test_auto_assign_unauthenticated_returns_401(client):
    (Scenario(client)
        .post("/api/admin/assignments/auto-assign", json={"day": "monday"}, expected_status=401))


def test_auto_assign_player_with_no_preferences_goes_to_unassigned(client, admin_headers):
    """A player with no time preferences cannot be placed and lands in unassigned."""
    seed_player(client, fid="p001", time_slots=[])

    resp = client.post(
        "/api/admin/assignments/auto-assign",
        json={"day": "monday"},
        headers=admin_headers,
    )
    assert resp.status_code == 200
    data = resp.get_json()
    assert len(data["unassigned"]) == 1
    assert data["unassigned"][0]["fid"] == "p001"


def test_auto_assign_places_player_in_preferred_slot(client, admin_headers):
    """A player who prefers 01:00 should land in a slot near that hour."""
    seed_player(client, fid="p001", time_slots=["01:00"])

    resp = client.post(
        "/api/admin/assignments/auto-assign",
        json={"day": "monday"},
        headers=admin_headers,
    )
    assert resp.status_code == 200
    data = resp.get_json()
    assert len(data["unassigned"]) == 0

    # The player should be in one of the slots near 01:00
    # With ±20 min tolerance: 00:50, 01:20, or 01:50
    near_slots = {"00:50", "01:20", "01:50"}
    assigned_slots = {slot for slot, players in data["assignments"].items() if players}
    assert assigned_slots & near_slots, (
        f"Player was not placed in a slot near 01:00. Assigned slots: {assigned_slots}"
    )


def test_highest_point_player_gets_preferred_slot_over_lower(client, admin_headers):
    """When two players prefer the same hour, the highest-points player gets the first matching slot."""
    # p001: high points (30 days construction → 30*1440 = 43200)
    seed_player(client, fid="p001", game_name="High", construction_speedups_days=30, time_slots=["02:00"])
    # p002: low points (1 day construction → 1440)
    seed_player(client, fid="p002", game_name="Low", construction_speedups_days=1, time_slots=["02:00"])

    resp = client.post(
        "/api/admin/assignments/auto-assign",
        json={"day": "monday"},
        headers=admin_headers,
    )
    assert resp.status_code == 200
    data = resp.get_json()

    # Both can be assigned because each preferred hour maps to multiple 30-min slots.
    assert len(data["unassigned"]) == 0

    assigned_slots_by_fid = {}
    for slot, players in data["assignments"].items():
        for player in players:
            assigned_slots_by_fid[player["fid"]] = slot

    # Highest-points player should claim the first matching slot for 02:00.
    assert assigned_slots_by_fid["p001"] == "01:50"
    assert assigned_slots_by_fid["p002"] in {"02:20", "02:50"}


def test_auto_assign_twice_replaces_first_run(client, admin_headers):
    """Running auto-assign a second time clears and replaces previous results."""
    seed_player(client, fid="p001", time_slots=["03:00"])

    client.post(
        "/api/admin/assignments/auto-assign",
        json={"day": "monday"},
        headers=admin_headers,
    )
    resp2 = client.post(
        "/api/admin/assignments/auto-assign",
        json={"day": "monday"},
        headers=admin_headers,
    )
    assert resp2.status_code == 200
    # Player should still be assigned after the second run
    data = resp2.get_json()
    assigned_count = sum(len(p) for p in data["assignments"].values())
    assert assigned_count == 1


# ── GET assignments ───────────────────────────────────────────────────────────

def test_get_assignments_empty_before_auto_assign(client, admin_headers):
    (Scenario(client, headers=admin_headers)
        .get("/api/admin/assignments/monday"))
    # Response is a dict of slots → players; empty dict is fine


def test_get_assignments_reflects_auto_assign_results(client, admin_headers):
    seed_player(client, fid="p001", time_slots=["04:00"])

    client.post(
        "/api/admin/assignments/auto-assign",
        json={"day": "monday"},
        headers=admin_headers,
    )

    resp = client.get("/api/admin/assignments/monday", headers=admin_headers)
    assert resp.status_code == 200
    assignments = resp.get_json()
    assigned_players = [p for slot_players in assignments.values() for p in slot_players]
    assert len(assigned_players) == 1
    assert assigned_players[0]["fid"] == "p001"


# ── Manual update ─────────────────────────────────────────────────────────────

def test_manual_update_then_get(client, admin_headers):
    """After a manual assignment update, GET should return the new layout."""
    payload = seed_player(client, fid="m001")

    # Get the player's db id
    players = client.get("/api/admin/players", headers=admin_headers).get_json()
    player_id = players[0]["id"]

    manual_assignments = {
        "06:20": [{"player_id": player_id, "fid": "m001", "game_name": "Player1", "is_assigned": True}]
    }

    (Scenario(client, headers=admin_headers)
        .post(
            "/api/admin/assignments/update",
            json={"day": "monday", "assignments": manual_assignments},
        )
        .assert_json_contains(success=True)
        .get("/api/admin/assignments/monday"))

    # Verify the slot has our player
    assignments = client.get("/api/admin/assignments/monday", headers=admin_headers).get_json()
    assert "06:20" in assignments
    assert assignments["06:20"][0]["fid"] == "m001"
