"""tests/backend/test_url_prefix.py

Verify that the URL_PREFIX env var mounts the Flask app at the configured
sub-path via DispatcherMiddleware, while keeping /health reachable at the
root so platform health probes don't need to be prefix-aware.

These tests use importlib.reload because URL_PREFIX is read at module-load
time in backend/app.py (the dispatcher wiring runs only once). The conftest
fixtures don't reload the module, so we own the lifecycle here.
"""
import importlib
import os
import sys

import pytest


_BACKEND = os.path.join(os.path.dirname(__file__), "..", "..", "backend")
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)


def _reload_app_with_prefix(prefix: str):
    """Reload the backend.app module with URL_PREFIX set to `prefix`.

    Returns the reloaded module so callers can grab `.app` for a test client.
    Caller is responsible for restoring state via _reload_app_with_prefix("").
    """
    if prefix:
        os.environ["URL_PREFIX"] = prefix
    else:
        os.environ.pop("URL_PREFIX", None)
    import app as app_module
    importlib.reload(app_module)
    app_module.app.config["TESTING"] = True
    return app_module


@pytest.fixture
def prefixed_app():
    """Reload backend.app with URL_PREFIX=/ministry, yield the Flask app, then restore."""
    module = _reload_app_with_prefix("/ministry")
    try:
        yield module.app
    finally:
        _reload_app_with_prefix("")


@pytest.fixture
def prefixed_client(prefixed_app):
    with prefixed_app.test_client() as c:
        yield c


def test_api_mounted_under_prefix(prefixed_client):
    """The API is reachable at /ministry/api/..."""
    resp = prefixed_client.get("/ministry/api/settings/research-day")
    assert resp.status_code == 200, resp.get_data(as_text=True)


def test_prefixed_health_works(prefixed_client):
    """/ministry/health works (Flask /health route under the prefix)."""
    resp = prefixed_client.get("/ministry/health")
    assert resp.status_code == 200


def test_root_health_proxy_still_works(prefixed_client):
    """/health works at the root via the dispatcher's tiny root app — this is
    what lets platform health probes function without knowing the prefix."""
    resp = prefixed_client.get("/health")
    assert resp.status_code == 200
    assert b"healthy" in resp.data


def test_root_api_returns_404_when_prefix_set(prefixed_client):
    """Without the prefix, the API is gone (the dispatcher's root app 404s)."""
    resp = prefixed_client.get("/api/settings/research-day")
    assert resp.status_code == 404


def test_spa_fallback_under_prefix_does_not_crash(prefixed_client):
    """An SPA route under the prefix is handled by serve(); in test env there
    is no built index.html so we accept 200 or 404, just not 500."""
    resp = prefixed_client.get("/ministry/some/spa/route")
    assert resp.status_code in (200, 404), f"Unexpected status: {resp.status_code}"


def test_no_prefix_default_behavior_unchanged():
    """With URL_PREFIX unset (the default), routes behave exactly as before."""
    module = _reload_app_with_prefix("")
    try:
        with module.app.test_client() as c:
            assert c.get("/health").status_code == 200
            assert c.get("/api/settings/research-day").status_code == 200
    finally:
        _reload_app_with_prefix("")
