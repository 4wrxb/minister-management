"""
tests/backend/test_slot_offset.py — configurable time_slot_offset setting.
"""
from conftest import seed_player


def test_time_slot_offset_default_is_minus_ten(client):
    resp = client.get("/api/settings/time-slot-offset")
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["time_slot_offset"] == -10
    assert set(body["valid_offsets"]) == {-20, -15, -10, 0}


def test_admin_can_change_time_slot_offset(client, admin_headers):
    resp = client.put(
        "/api/admin/settings/time-slot-offset",
        json={"time_slot_offset": 0},
        headers=admin_headers,
    )
    assert resp.status_code == 200
    assert resp.get_json()["time_slot_offset"] == 0

    # Subsequent GET should reflect the new value
    assert client.get("/api/settings/time-slot-offset").get_json()["time_slot_offset"] == 0


def test_admin_can_change_offset_to_minus_fifteen(client, admin_headers):
    resp = client.put(
        "/api/admin/settings/time-slot-offset",
        json={"time_slot_offset": -15},
        headers=admin_headers,
    )
    assert resp.status_code == 200
    assert client.get("/api/settings/time-slot-offset").get_json()["time_slot_offset"] == -15


def test_changing_time_slot_offset_requires_auth(client):
    resp = client.put(
        "/api/admin/settings/time-slot-offset",
        json={"time_slot_offset": 0},
    )
    assert resp.status_code == 401


def test_invalid_offset_value_returns_400(client, admin_headers):
    resp = client.put(
        "/api/admin/settings/time-slot-offset",
        json={"time_slot_offset": 7},
        headers=admin_headers,
    )
    assert resp.status_code == 400


def test_offset_change_reflected_in_auto_assign_slot_set(client, admin_headers):
    """At offset 0 the slot grid is the 48 aligned half-hour slots — no '23:50' or '+' suffixes."""
    client.put(
        "/api/admin/settings/time-slot-offset",
        json={"time_slot_offset": 0},
        headers=admin_headers,
    )
    seed_player(client, fid="p001", time_slots=["10:00"])

    resp = client.post(
        "/api/admin/assignments/auto-assign",
        json={"day": "monday"},
        headers=admin_headers,
    )
    assert resp.status_code == 200
    data = resp.get_json()

    slot_keys = set(data["assignments"].keys())
    assert len(slot_keys) == 48
    # Aligned half-hour slots
    assert "00:00" in slot_keys
    assert "23:30" in slot_keys
    # No pre-day or end-of-day variants at offset 0
    assert "23:50" not in slot_keys
    assert not any(s.endswith("+") for s in slot_keys)


def test_auto_assign_response_includes_slot_mapping(client, admin_headers):
    """Auto-assign responses include a slot_mapping companion so clients can
    resolve indices to display strings independently."""
    seed_player(client, fid="p001", time_slots=["05:00"])
    resp = client.post(
        "/api/admin/assignments/auto-assign",
        json={"day": "monday"},
        headers=admin_headers,
    )
    assert resp.status_code == 200
    mapping = resp.get_json().get("slot_mapping")
    assert isinstance(mapping, dict)
    # Default offset -10 gives 49 slots indexed 0..48
    assert {int(k) for k in mapping} == set(range(49))
    # Index 0 is the pre-day "23:50" slot, index 48 is the end-of-day "23:50+"
    assert mapping[str(0) if "0" in mapping else 0] == "23:50"
    assert mapping[str(48) if "48" in mapping else 48] == "23:50+"


def test_auto_assign_with_offset_zero_places_player_in_aligned_slot(client, admin_headers):
    """A player preferring 01:00 at offset 0 lands in 01:00 or 01:30."""
    client.put(
        "/api/admin/settings/time-slot-offset",
        json={"time_slot_offset": 0},
        headers=admin_headers,
    )
    seed_player(client, fid="p001", time_slots=["01:00"])

    resp = client.post(
        "/api/admin/assignments/auto-assign",
        json={"day": "monday"},
        headers=admin_headers,
    )
    assert resp.status_code == 200
    data = resp.get_json()
    assert len(data["unassigned"]) == 0

    assigned = {slot for slot, players in data["assignments"].items() if players}
    assert assigned & {"01:00", "01:30"}, f"Player not placed near 01:00. Assigned: {assigned}"


def test_manual_update_with_offset_zero_round_trips(client, admin_headers):
    """Manual assignment + GET round-trips correctly at offset 0."""
    client.put(
        "/api/admin/settings/time-slot-offset",
        json={"time_slot_offset": 0},
        headers=admin_headers,
    )
    seed_player(client, fid="m001")
    players = client.get("/api/admin/players", headers=admin_headers).get_json()
    player_id = players[0]["id"]

    manual = {
        "06:00": [{"player_id": player_id, "fid": "m001", "game_name": "Player1", "is_assigned": True}]
    }
    resp = client.post(
        "/api/admin/assignments/update",
        json={"day": "monday", "assignments": manual},
        headers=admin_headers,
    )
    assert resp.status_code == 200

    assignments = client.get("/api/admin/assignments/monday", headers=admin_headers).get_json()
    assert "06:00" in assignments
    assert assignments["06:00"][0]["fid"] == "m001"


# ── Regression: shrinking the offset must not 500 read paths ──────────────────

def test_shrinking_offset_does_not_500_endpoints_with_orphaned_rows(client, admin_headers):
    """If the admin changes from offset -10 (49 slots, indices 0..48) to
    offset 0 (48 slots, indices 0..47), any existing slot_index=48 rows
    become orphaned for the new offset. Read endpoints must skip those
    rows instead of crashing with ValueError → HTTP 500.
    """
    # Assign a player at index 48 (the end-of-day "23:50+" slot under -10).
    seed_player(client, fid="x001")
    players = client.get("/api/admin/players", headers=admin_headers).get_json()
    player_id = players[0]["id"]

    manual = {
        "23:50+": [{
            "player_id": player_id, "fid": "x001",
            "game_name": "Player1", "is_assigned": True, "is_sticky": True,
        }]
    }
    resp = client.post(
        "/api/admin/assignments/update",
        json={"day": "monday", "assignments": manual},
        headers=admin_headers,
    )
    assert resp.status_code == 200

    # Shrink the offset — slot_index=48 is now orphaned.
    client.put(
        "/api/admin/settings/time-slot-offset",
        json={"time_slot_offset": 0},
        headers=admin_headers,
    )

    # All five read paths must return 200 (orphaned row skipped, not crash).
    r1 = client.get("/api/admin/assignments/monday", headers=admin_headers)
    assert r1.status_code == 200, f"get_assignments crashed: {r1.get_data(as_text=True)}"
    assert "23:50+" not in r1.get_json()  # orphaned row not exposed

    r2 = client.post(
        "/api/admin/assignments/auto-assign",
        json={"day": "monday"},
        headers=admin_headers,
    )
    assert r2.status_code == 200, f"auto-assign crashed: {r2.get_data(as_text=True)}"

    # Publish so the public endpoint will return data.
    client.put(
        "/api/admin/settings/publish",
        json={"day": "monday"},
        headers=admin_headers,
    )
    r3 = client.get("/api/published-schedule/monday")
    assert r3.status_code == 200, f"published_schedule crashed: {r3.get_data(as_text=True)}"

    r4 = client.get("/api/player/x001/assignments")
    assert r4.status_code == 200, f"player_assignments crashed: {r4.get_data(as_text=True)}"

    r5 = client.get("/api/admin/export", headers=admin_headers)
    assert r5.status_code == 200, f"export crashed: {r5.get_data(as_text=True)}"
