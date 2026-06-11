"""tests/backend/test_settings.py — settings / configuration scenarios."""
from helpers import Scenario


# ── Research day ──────────────────────────────────────────────────────────────

def test_research_day_default_is_tuesday(client):
    (Scenario(client)
        .get("/api/settings/research-day")
        .assert_json_contains(research_day="tuesday"))


def test_admin_can_change_research_day_to_friday(client, admin_headers):
    (Scenario(client, headers=admin_headers)
        .put("/api/admin/settings/research-day", json={"research_day": "friday"})
        .assert_json_contains(success=True))

    (Scenario(client)
        .get("/api/settings/research-day")
        .assert_json_contains(research_day="friday"))


def test_changing_research_day_requires_auth(client):
    (Scenario(client)
        .put("/api/admin/settings/research-day", json={"research_day": "friday"}, expected_status=401))


# ── Show fire crystals ────────────────────────────────────────────────────────

def test_show_fire_crystals_default_is_false(client):
    resp = client.get("/api/settings/show-fire-crystals")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["show_fire_crystals"] is False


def test_admin_can_enable_show_fire_crystals(client, admin_headers):
    (Scenario(client, headers=admin_headers)
        .put("/api/admin/settings/show-fire-crystals", json={"show_fire_crystals": True})
        .assert_json_contains(success=True))

    resp = client.get("/api/settings/show-fire-crystals")
    assert resp.get_json()["show_fire_crystals"] is True


def test_changing_show_fire_crystals_requires_auth(client):
    (Scenario(client)
        .put("/api/admin/settings/show-fire-crystals", json={"show_fire_crystals": True}, expected_status=401))


# ── Application closing time ──────────────────────────────────────────────────

def test_closing_time_endpoint_returns_not_closed_by_default(client):
    resp = client.get("/api/settings/application-closing-time")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data.get("is_closed") is False


def test_admin_can_set_closing_time(client, admin_headers):
    closing_time = "2099-12-31T23:59:59Z"
    (Scenario(client, headers=admin_headers)
        .put(
            "/api/admin/settings/application-closing-time",
            json={"closing_time": closing_time},
        )
        .assert_json_contains(success=True))

    resp = client.get("/api/settings/application-closing-time")
    assert resp.status_code == 200


def test_setting_closing_time_requires_auth(client):
    (Scenario(client)
        .put(
            "/api/admin/settings/application-closing-time",
            json={"closing_time": "2099-01-01T00:00:00Z"},
            expected_status=401,
        ))


# ── State number ──────────────────────────────────────────────────────────────

def test_state_number_default_is_empty(client):
    resp = client.get("/api/settings/state-number")
    assert resp.status_code == 200


def test_admin_can_set_state_number(client, admin_headers):
    (Scenario(client, headers=admin_headers)
        .put("/api/admin/settings/state-number", json={"state_number": "42"})
        .assert_json_contains(success=True))
