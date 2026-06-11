"""tests/backend/test_health.py — smoke tests for health and static serving."""
from helpers import Scenario


def test_health_endpoint_returns_healthy(client):
    (Scenario(client)
        .get("/health")
        .assert_json_contains(status="healthy"))


def test_root_path_does_not_crash(client):
    """/ should return either 200 (SPA served) or 404 (no static build in test env).
    Full SPA serving is verified by the docker-integration.yml CI workflow and E2E tests."""
    resp = client.get("/")
    assert resp.status_code in (200, 404), f"Unexpected status: {resp.status_code}"
