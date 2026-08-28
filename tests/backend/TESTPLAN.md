# Backend Test Plan

## Overview

**Framework:** `pytest` + Flask test client  
**Location:** `tests/backend/`  
**Database:** Temporary SQLite file (`tests/backend/.test_minister.db`), wiped between every test  
**Network:** None — all calls go through Flask's in-process test client, no HTTP port opened  
**Speed:** ~1–5 seconds for the full suite

The backend test suite validates the Flask API in isolation. Each test starts with a clean
database, seeds any required state via helper functions, then makes a sequence of API calls
and asserts on the responses.

---

## Running Manually

### Prerequisites

```bash
# From repo root — install backend runtime deps + test-only deps
pip install -r backend/requirements.txt -r tests/backend/requirements.txt
```

### Run all backend tests

```bash
pytest tests/backend/ -v
```

### Run a single test file

```bash
pytest tests/backend/test_players.py -v
```

### Run a specific test

```bash
pytest tests/backend/test_assignments.py::test_highest_point_player_gets_preferred_slot_over_lower -v
```

### Run with short traceback (CI-style output)

```bash
pytest tests/backend/ -v --tb=short
```

### Clean up the test database after a run

```bash
rm tests/backend/.test_minister.db   # macOS / Linux
del tests\backend\.test_minister.db  # Windows
```

---

## CI Workflow

**File:** `.github/workflows/backend-tests.yml`  
**Triggers:** push or PR to `main`, manual `workflow_dispatch`  
**Runner:** `ubuntu-latest`, Python 3.11

Steps:
1. Checkout code
2. Set up Python 3.11 with pip caching
3. `pip install -r backend/requirements.txt -r tests/backend/requirements.txt`
4. `pytest tests/backend/ -v --tb=short`
5. Delete test DB (always runs, even on failure)

> Docker is **not** required. The suite runs in the raw GitHub Actions runner.

---

## Infrastructure Files

| File | Purpose |
|---|---|
| `conftest.py` | Sets env vars, adds `backend/` to `sys.path`, declares `flask_app` / `client` / `admin_headers` / `minister_headers` fixtures, provides `seed_player()` and `seed_players()` helpers |
| `helpers.py` | `Scenario` class — fluent chainable runner: `.post().get().assert_json_contains()` |
| `requirements.txt` | `pytest>=8.0`, `pytest-flask>=1.3` — never referenced by `backend/requirements.txt` or `Dockerfile` |

### Scenario Runner Pattern

```python
# Initial state
seed_player(client, fid="p001", construction_speedups_days=30, time_slots=["06:00"])

# Sequence of steps → expected results at each step
(Scenario(client)
    .post("/api/admin/assignments/auto-assign", json={"day": "monday"}, headers=admin_headers)
    .assert_json_contains(success=True)
    .get("/api/admin/assignments/monday", headers=admin_headers))
```

---

## Test Categories

### 1. Health & Smoke (`test_health.py`)

| Test | Description | Expected |
|---|---|---|
| `test_health_endpoint_returns_healthy` | `GET /health` | 200 `{"status": "healthy"}` |
| `test_root_path_does_not_crash` | `GET /` | 200 (SPA) or 404 (no static build in unit-test env) — never 500 |

> Full SPA serving is verified by `docker-integration.yml` and the E2E suite, which run against the built container.

---

### 2. Authentication (`test_auth.py`)

| Test | Description | Expected |
|---|---|---|
| `test_wrong_password_returns_401` | `POST /api/admin/login` wrong password | 401 |
| `test_admin_password_returns_token` | Login with `ADMIN_PASSWORD` | 200 with `token`, `role=admin` |
| `test_minister_password_returns_token` | Login with `MINISTER_PASSWORD` | 200 with `token`, `role=minister` |
| `test_unauthenticated_players_request_returns_401` | `GET /api/admin/players` no header | 401 |
| `test_admin_token_grants_access_to_players` | Valid `admin-token` header | 200 |
| `test_minister_token_grants_access_to_players` | Valid `minister-token` header | 200 |
| `test_invalid_token_returns_401` | Random string as token | 401 |
| `test_login_then_use_token` | Full round-trip: login → extract token → use token | 200 on protected endpoint |

---

### 3. Player Management (`test_players.py`)

#### Submit & Retrieve

| Test | Description | Expected |
|---|---|---|
| `test_submit_and_retrieve_by_fid` | Submit full payload, retrieve by FID | 200; response contains correct `game_name` |
| `test_submit_duplicate_fid_updates_player` | Submit same FID twice with different `game_name` | Second submit 200; retrieve returns updated name |

#### Validation

| Test | Description | Expected |
|---|---|---|
| `test_missing_required_field_returns_400[fid]` | Submit without `fid` | 400 |
| `test_missing_required_field_returns_400[game_name]` | Submit without `game_name` | 400 |
| `test_missing_required_field_returns_400[alliance]` | Submit without `alliance` | 400 |
| `test_empty_required_field_returns_400` | Submit `fid=""` | 400 |
| `test_negative_speedup_returns_400` | `construction_speedups_days=-1` | 400 |
| `test_over_max_speedup_returns_400` | `construction_speedups_days=100000` | 400 |
| `test_unknown_fid_returns_404` | `GET /api/player/does-not-exist` | 404 |

#### Admin Player List & Points

| Test | Description | Expected |
|---|---|---|
| `test_admin_players_list_is_empty_on_fresh_db` | `GET /api/admin/players` on empty DB | 200 `[]` |
| `test_admin_players_list_includes_submitted_players` | Seed 3 players, list | 200 list of 3 |
| `test_admin_players_include_calculated_points` | 10 days construction, list | `monday_points == 14400` (10 × 1440 min/day) |

#### Delete

| Test | Description | Expected |
|---|---|---|
| `test_admin_delete_player` | Seed 1, delete by id, list | 200 on delete; list returns `[]` |

#### Application Closing Time

| Test | Description | Expected |
|---|---|---|
| `test_closing_time_blocks_new_submissions` | Set past closing time, new FID submits | 403 `APPLICATIONS_CLOSED` |
| `test_closing_time_allows_existing_player_updates` | Set past closing time, existing FID re-submits | 200 |

---

### 4. Assignments (`test_assignments.py`)

#### Auto-Assign

| Test | Description | Expected |
|---|---|---|
| `test_auto_assign_with_no_players_returns_empty` | Empty DB, auto-assign | All slots empty, no unassigned |
| `test_auto_assign_invalid_day_returns_400` | `day=wednesday` | 400 |
| `test_auto_assign_unauthenticated_returns_401` | No auth header | 401 |
| `test_auto_assign_player_with_no_preferences_goes_to_unassigned` | Player has no time slots | Player appears in `unassigned` list |
| `test_auto_assign_places_player_in_preferred_slot` | Player prefers 01:00 | Player lands in slot within ±20 min of 01:00 |
| `test_highest_point_player_gets_preferred_slot_over_lower` | Two players prefer same hour; high-points player has 30× more points | High-points player gets the first matching slot; both may still be assigned |
| `test_auto_assign_twice_replaces_first_run` | Run auto-assign twice for same day | Second run replaces first; player count unchanged |

#### Get Assignments

| Test | Description | Expected |
|---|---|---|
| `test_get_assignments_empty_before_auto_assign` | `GET /api/admin/assignments/monday` before any assign | 200 (empty dict) |
| `test_get_assignments_reflects_auto_assign_results` | Seed 1 player, auto-assign, GET | Player appears in returned assignments |

#### Manual Update

| Test | Description | Expected |
|---|---|---|
| `test_manual_update_then_get` | POST update with manual slot mapping, GET | Slot `06:20` contains the correct player |

---

### 5. Settings (`test_settings.py`)

| Test | Description | Expected |
|---|---|---|
| `test_research_day_default_is_tuesday` | `GET /api/settings/research-day` | `{"research_day": "tuesday"}` |
| `test_admin_can_change_research_day_to_friday` | PUT `friday`, then GET | Returns `friday` |
| `test_changing_research_day_requires_auth` | PUT without token | 401 |
| `test_show_fire_crystals_default_is_false` | `GET /api/settings/show-fire-crystals` | `{"show_fire_crystals": false}` |
| `test_admin_can_enable_show_fire_crystals` | PUT `true`, then GET | Returns `true` |
| `test_changing_show_fire_crystals_requires_auth` | PUT without token | 401 |
| `test_closing_time_endpoint_returns_not_closed_by_default` | `GET /api/settings/application-closing-time` | `{"is_closed": false}` |
| `test_admin_can_set_closing_time` | PUT future datetime | 200 |
| `test_setting_closing_time_requires_auth` | PUT without token | 401 |
| `test_state_number_default_is_empty` | `GET /api/settings/state-number` | 200 |
| `test_admin_can_set_state_number` | PUT `"42"` | 200 `{"success": true}` |

---

### 6. Point Calculation (`test_points.py`)

Pure-function unit tests for `calculate_points()` in `backend/database.py`.
That function is the **single source of truth** for the per-day scoring formula;
its docstring is the canonical reference and these tests pin every behaviour
claimed by the docstring so any future formula change must be deliberate.

These tests don't touch the Flask client or the DB — they call `calculate_points()`
directly with hand-built player dicts.

#### Monday — Construction

| Test | Description | Expected |
|---|---|---|
| `test_monday_construction_speedup_is_one_point_per_minute` | 1 day of construction | 1440 pts |
| `test_monday_general_speedup_is_one_point_per_minute` | 1 day of general | 1440 pts |
| `test_monday_research_speedup_is_ignored` | Research-only player on Monday | 0 |
| `test_monday_troop_speedup_is_ignored` | Troop-only player on Monday | 0 |
| `test_monday_refined_fire_crystal_is_thirty_thousand_each` | 1 refined crystal | 30,000 pts |
| `test_monday_fire_crystal_is_two_thousand_each` | 1 fire crystal | 2,000 pts |
| `test_monday_fire_crystal_shards_are_ignored` | Shards-only player on Monday | 0 |
| `test_monday_combines_all_relevant_inputs` | Full mixed player | Sum matches docstring formula |
| `test_monday_fractional_days_are_supported` | 0.5 days construction | 720 pts (REAL columns) |

#### Tuesday / Friday — Research

| Test | Description | Expected |
|---|---|---|
| `test_research_day_speedup_is_one_point_per_minute[tuesday/friday]` | 1 day research | 1440 pts each |
| `test_research_day_general_speedup_is_one_point_per_minute[tuesday/friday]` | 1 day general | 1440 pts each |
| `test_research_day_construction_speedup_is_ignored[tuesday/friday]` | Construction-only player | 0 each |
| `test_research_day_shard_is_one_thousand_each[tuesday/friday]` | 1 shard | 1,000 pts each |
| `test_research_day_fire_crystals_are_ignored[tuesday/friday]` | Fire/refined crystals on research day | 0 each |
| `test_research_day_combines_all_relevant_inputs[tuesday/friday]` | Full mixed player | Sum matches docstring formula |
| `test_tuesday_and_friday_produce_identical_points` | Same player, both days | Equal scores (toggle picks the day, not the formula) |

#### Thursday — Troop Training

| Test | Description | Expected |
|---|---|---|
| `test_thursday_is_one_point_per_day_raw` | 7 days troop training | 7 pts (no minutes conversion) |
| `test_thursday_ignores_every_other_field` | Loaded player with everything except troop=3 | 3 |
| `test_thursday_truncates_fractional_days_to_int` | 2.9 days troop | 2 (`int()` truncation) |

#### Edge cases

| Test | Description | Expected |
|---|---|---|
| `test_unknown_day_returns_zero` | Wed / Sat / Sun | 0 |
| `test_day_argument_is_case_insensitive[Monday/MONDAY/Tuesday/FRIDAY/Thursday]` | Mixed case day names | Same result as lowercase |
| `test_all_zero_player_scores_zero_on_every_day` | All fields = 0 | 0 on every day |
| `test_return_type_is_int_on_every_day` | Fractional inputs | Always `int` (for sort/JSON safety) |
