"""tests/backend/test_base_injection.py

Verify the inject_base_tag helper and the serve() route's per-request <base>
injection, which together let one bundle work under any URL_PREFIX without
rebuilding the frontend.
"""
import os
import sys

import pytest


_BACKEND = os.path.join(os.path.dirname(__file__), "..", "..", "backend")
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)
import app as app_module  # noqa: E402
from app import inject_base_tag  # noqa: E402


SAMPLE_HTML = """<!doctype html>
<html><head>
<meta charset="UTF-8">
<title>Test</title>
</head><body><div id="root"></div></body></html>"""


# ── inject_base_tag — pure-function unit tests ────────────────────────────────

def test_inject_with_prefix():
    out = inject_base_tag(SAMPLE_HTML, "/ministry")
    assert '<base href="/ministry/">' in out
    assert '<meta name="app-base" content="/ministry">' in out


def test_inject_with_root_prefix():
    out = inject_base_tag(SAMPLE_HTML, "")
    assert '<base href="/">' in out
    assert '<meta name="app-base" content="/">' in out


def test_inject_strips_trailing_slash_from_prefix():
    """Input prefix '/ministry/' produces the same output as '/ministry'."""
    out = inject_base_tag(SAMPLE_HTML, "/ministry/")
    assert '<base href="/ministry/">' in out
    assert '<meta name="app-base" content="/ministry">' in out


def test_inject_is_idempotent():
    """Re-injecting on already-injected HTML doesn't duplicate the tags."""
    once = inject_base_tag(SAMPLE_HTML, "/ministry")
    twice = inject_base_tag(once, "/ministry")
    assert once == twice
    assert once.count('<meta name="app-base"') == 1


def test_inject_inserts_immediately_after_head_open():
    """Injected tags come first inside <head>, so they take effect before
    any other head content is parsed by the browser."""
    out = inject_base_tag(SAMPLE_HTML, "/ministry")
    head_idx = out.lower().index("<head>") + len("<head>")
    assert out[head_idx:].lstrip().startswith("<base ")


def test_inject_handles_head_with_attributes():
    html = '<html><head lang="en"><title>x</title></head></html>'
    out = inject_base_tag(html, "/ministry")
    assert '<base href="/ministry/">' in out


def test_inject_returns_original_when_no_head():
    no_head = "<html><body></body></html>"
    assert inject_base_tag(no_head, "/ministry") == no_head


# ── serve() route — integration test ──────────────────────────────────────────

def test_serve_route_injects_base_tag(monkeypatch, tmp_path, client):
    """A GET / against a working index.html returns HTML with <base> injected."""
    static_dir = tmp_path / "static"
    static_dir.mkdir()
    (static_dir / "index.html").write_text(SAMPLE_HTML, encoding="utf-8")

    monkeypatch.setattr(app_module, "STATIC_DIR", str(static_dir))
    # Reset the per-prefix cache so this test sees a fresh injection
    monkeypatch.setattr(app_module, "_INDEX_HTML_CACHE", {})

    resp = client.get("/")
    assert resp.status_code == 200
    body = resp.get_data(as_text=True)
    # The conftest doesn't set URL_PREFIX, so script_root is "" → root injection.
    assert '<base href="/">' in body
    assert '<meta name="app-base" content="/">' in body


def test_serve_route_returns_404_when_index_missing(monkeypatch, tmp_path, client):
    """No index.html on disk → 404 (matches historical behavior in tests)."""
    static_dir = tmp_path / "static"
    static_dir.mkdir()
    monkeypatch.setattr(app_module, "STATIC_DIR", str(static_dir))
    monkeypatch.setattr(app_module, "_INDEX_HTML_CACHE", {})

    resp = client.get("/")
    assert resp.status_code == 404


def test_serve_route_serves_real_static_assets(monkeypatch, tmp_path, client):
    """Existing asset files under STATIC_DIR are served directly (bypass injection)."""
    static_dir = tmp_path / "static"
    static_dir.mkdir()
    (static_dir / "index.html").write_text(SAMPLE_HTML, encoding="utf-8")
    assets_dir = static_dir / "assets"
    assets_dir.mkdir()
    (assets_dir / "main.js").write_text("console.log(1)", encoding="utf-8")

    monkeypatch.setattr(app_module, "STATIC_DIR", str(static_dir))
    monkeypatch.setattr(app_module, "_INDEX_HTML_CACHE", {})

    resp = client.get("/assets/main.js")
    assert resp.status_code == 200
    assert b"console.log(1)" in resp.data
