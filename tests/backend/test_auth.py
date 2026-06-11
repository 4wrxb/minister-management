"""tests/backend/test_auth.py — authentication flow scenarios."""
from helpers import Scenario


# ── Login endpoint ─────────────────────────────────────────────────────────────

def test_wrong_password_returns_401(client):
    (Scenario(client)
        .post("/api/admin/login", json={"password": "wrong-password"}, expected_status=401))


def test_admin_password_returns_token(client):
    (Scenario(client)
        .post("/api/admin/login", json={"password": "testadmin"})
        .assert_json_contains(success=True, role="admin")
        .assert_json_key_exists("token"))


def test_minister_password_returns_token(client):
    (Scenario(client)
        .post("/api/admin/login", json={"password": "testminister"})
        .assert_json_contains(success=True, role="minister")
        .assert_json_key_exists("token"))


# ── Token enforcement on protected endpoints ───────────────────────────────────

def test_unauthenticated_players_request_returns_401(client):
    (Scenario(client)
        .get("/api/admin/players", expected_status=401))


def test_admin_token_grants_access_to_players(client, admin_headers):
    (Scenario(client, headers=admin_headers)
        .get("/api/admin/players"))


def test_minister_token_grants_access_to_players(client, minister_headers):
    (Scenario(client, headers=minister_headers)
        .get("/api/admin/players"))


def test_invalid_token_returns_401(client):
    (Scenario(client, headers={"Authorization": "not-a-real-token"})
        .get("/api/admin/players", expected_status=401))


# ── Full login → use token round-trip ─────────────────────────────────────────

def test_login_then_use_token(client):
    """Obtain a token via login and immediately use it on a protected endpoint."""
    scenario = (Scenario(client)
        .post("/api/admin/login", json={"password": "testadmin"}))

    token = scenario.last.get_json()["token"]

    (Scenario(client, headers={"Authorization": token})
        .get("/api/admin/players"))
