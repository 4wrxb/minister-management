"""
tests/backend/helpers.py

Fluent Scenario runner for defining readable API test sequences:

    (Scenario(client)
        .post('/api/player/submit', json=payload)
        .get('/api/player/p001')
        .assert_json_contains(game_name='Player1'))

Initial state is established by calling seed helpers before constructing the scenario,
or by chaining .post() calls as the first steps.
"""
from __future__ import annotations

from typing import Any


class Scenario:
    """
    Chainable helper:  initial state → sequence of HTTP steps → assertions.

    Each step method asserts the expected HTTP status code immediately, so
    failures pinpoint the exact failing step without further debugging.
    """

    def __init__(self, client, *, headers: dict | None = None):
        self._client = client
        self._headers = headers or {}
        self._results: list = []

    # ── HTTP step methods ─────────────────────────────────────────────────────

    def get(self, url: str, expected_status: int = 200, **kw) -> "Scenario":
        return self._step("get", url, expected_status, **kw)

    def post(self, url: str, json: Any = None, expected_status: int = 200, **kw) -> "Scenario":
        return self._step("post", url, expected_status, json=json, **kw)

    def put(self, url: str, json: Any = None, expected_status: int = 200, **kw) -> "Scenario":
        return self._step("put", url, expected_status, json=json, **kw)

    def delete(self, url: str, expected_status: int = 200, **kw) -> "Scenario":
        return self._step("delete", url, expected_status, **kw)

    def _step(self, method: str, url: str, expected_status: int, **kw) -> "Scenario":
        headers = {**self._headers, **kw.pop("headers", {})}
        if headers:
            kw["headers"] = headers
        resp = getattr(self._client, method)(url, **kw)
        assert resp.status_code == expected_status, (
            f"{method.upper()} {url} → {resp.status_code} (expected {expected_status})\n"
            f"Body: {resp.get_data(as_text=True)}"
        )
        self._results.append(resp)
        return self

    # ── Assertions on the latest response ────────────────────────────────────

    def assert_json_contains(self, **expected) -> "Scenario":
        """Assert that the last response JSON contains all key=value pairs."""
        data = self.last.get_json()
        for key, value in expected.items():
            assert key in data, f"Key {key!r} not found in response: {data}"
            assert data[key] == value, f"Expected {key}={value!r}, got {data[key]!r}"
        return self

    def assert_json_list_length(self, length: int) -> "Scenario":
        """Assert that the last response is a JSON list of exactly `length` items."""
        data = self.last.get_json()
        assert isinstance(data, list), f"Expected list, got {type(data).__name__}: {data}"
        assert len(data) == length, f"Expected list of length {length}, got {len(data)}"
        return self

    def assert_json_key_exists(self, *keys: str) -> "Scenario":
        """Assert that all given keys exist in the last response JSON."""
        data = self.last.get_json()
        for key in keys:
            assert key in data, f"Key {key!r} not found in response: {data}"
        return self

    def assert_json_truthy(self, key: str) -> "Scenario":
        """Assert that `key` in the last response JSON is truthy."""
        data = self.last.get_json()
        assert data.get(key), f"Expected {key!r} to be truthy, got {data.get(key)!r}"
        return self

    def assert_json_list_contains(self, **match) -> "Scenario":
        """Assert that the last response is a list containing at least one item matching all key=value pairs."""
        data = self.last.get_json()
        assert isinstance(data, list), f"Expected list, got {type(data).__name__}"
        matches = [item for item in data if all(item.get(k) == v for k, v in match.items())]
        assert matches, f"No item matching {match} found in list of {len(data)} items"
        return self

    # ── Result accessors ──────────────────────────────────────────────────────

    @property
    def last(self):
        """The most recent step response."""
        assert self._results, "No steps have been executed yet"
        return self._results[-1]

    def result(self, index: int):
        """Get the response at 0-based step index."""
        return self._results[index]
