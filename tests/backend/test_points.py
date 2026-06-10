"""tests/backend/test_points.py — unit tests for the canonical point formula.

`calculate_points()` in `backend/database.py` is the single source of truth
for SVS ministry-day scoring. These tests pin the per-day formula and the
edge-case behaviour described in its docstring so any future change to the
formula must be made deliberately (the test fails) and reflected in the
docs (USER_GUIDE.md, RECREATION_GUIDE.md, and the link-out summaries).

Pure-function tests: no Flask client and no HTTP needed.
"""
import pytest

from database import calculate_points


# ── Helpers ───────────────────────────────────────────────────────────────────

def _player(**fields) -> dict:
    """Build a player dict with all required fields, zeroed by default."""
    base = {
        "construction_speedups_days": 0,
        "research_speedups_days": 0,
        "troop_training_speedups_days": 0,
        "general_speedups_days": 0,
        "fire_crystals": 0,
        "refined_fire_crystals": 0,
        "fire_crystal_shards": 0,
    }
    base.update(fields)
    return base


MINUTES_PER_DAY = 1440  # documented unit convention: 1 day = 24 * 60 minutes


# ── Monday — Construction Day ─────────────────────────────────────────────────

def test_monday_construction_speedup_is_one_point_per_minute():
    p = _player(construction_speedups_days=1)
    assert calculate_points(p, "monday") == MINUTES_PER_DAY  # 1440


def test_monday_general_speedup_is_one_point_per_minute():
    p = _player(general_speedups_days=1)
    assert calculate_points(p, "monday") == MINUTES_PER_DAY


def test_monday_research_speedup_is_ignored():
    p = _player(research_speedups_days=10)
    assert calculate_points(p, "monday") == 0


def test_monday_troop_speedup_is_ignored():
    p = _player(troop_training_speedups_days=10)
    assert calculate_points(p, "monday") == 0


def test_monday_refined_fire_crystal_is_thirty_thousand_each():
    p = _player(refined_fire_crystals=1)
    assert calculate_points(p, "monday") == 30_000


def test_monday_fire_crystal_is_two_thousand_each():
    p = _player(fire_crystals=1)
    assert calculate_points(p, "monday") == 2_000


def test_monday_fire_crystal_shards_are_ignored():
    p = _player(fire_crystal_shards=999)
    assert calculate_points(p, "monday") == 0


def test_monday_combines_all_relevant_inputs():
    p = _player(
        construction_speedups_days=10,
        general_speedups_days=2,
        refined_fire_crystals=3,
        fire_crystals=5,
        # Ignored on Monday:
        research_speedups_days=7,
        troop_training_speedups_days=4,
        fire_crystal_shards=11,
    )
    expected = (
        (10 + 2) * MINUTES_PER_DAY  # construction + general
        + 3 * 30_000                # refined crystals
        + 5 * 2_000                 # fire crystals
    )
    assert calculate_points(p, "monday") == expected


def test_monday_fractional_days_are_supported():
    # Speedup columns are REAL — a player with half a day should get 720 pts.
    p = _player(construction_speedups_days=0.5)
    assert calculate_points(p, "monday") == 720


# ── Tuesday / Friday — Research Day ───────────────────────────────────────────

@pytest.mark.parametrize("day", ["tuesday", "friday"])
def test_research_day_speedup_is_one_point_per_minute(day):
    p = _player(research_speedups_days=1)
    assert calculate_points(p, day) == MINUTES_PER_DAY


@pytest.mark.parametrize("day", ["tuesday", "friday"])
def test_research_day_general_speedup_is_one_point_per_minute(day):
    p = _player(general_speedups_days=1)
    assert calculate_points(p, day) == MINUTES_PER_DAY


@pytest.mark.parametrize("day", ["tuesday", "friday"])
def test_research_day_construction_speedup_is_ignored(day):
    p = _player(construction_speedups_days=10)
    assert calculate_points(p, day) == 0


@pytest.mark.parametrize("day", ["tuesday", "friday"])
def test_research_day_shard_is_one_thousand_each(day):
    p = _player(fire_crystal_shards=1)
    assert calculate_points(p, day) == 1_000


@pytest.mark.parametrize("day", ["tuesday", "friday"])
def test_research_day_fire_crystals_are_ignored(day):
    p = _player(fire_crystals=999, refined_fire_crystals=999)
    assert calculate_points(p, day) == 0


@pytest.mark.parametrize("day", ["tuesday", "friday"])
def test_research_day_combines_all_relevant_inputs(day):
    p = _player(
        research_speedups_days=10,
        general_speedups_days=2,
        fire_crystal_shards=7,
        # Ignored on research day:
        construction_speedups_days=4,
        troop_training_speedups_days=3,
        fire_crystals=11,
        refined_fire_crystals=5,
    )
    expected = (
        (10 + 2) * MINUTES_PER_DAY  # research + general
        + 7 * 1_000                 # crystal shards
    )
    assert calculate_points(p, day) == expected


def test_tuesday_and_friday_produce_identical_points():
    """The Tue/Fri toggle picks which day SVS runs; the formula is identical."""
    p = _player(
        research_speedups_days=8,
        general_speedups_days=1,
        fire_crystal_shards=4,
    )
    assert calculate_points(p, "tuesday") == calculate_points(p, "friday")


# ── Thursday — Troop Training Day ─────────────────────────────────────────────

def test_thursday_is_one_point_per_day_raw():
    """Thursday is the only day that does NOT convert days to minutes."""
    p = _player(troop_training_speedups_days=7)
    assert calculate_points(p, "thursday") == 7


def test_thursday_ignores_every_other_field():
    p = _player(
        troop_training_speedups_days=3,
        construction_speedups_days=10,
        research_speedups_days=10,
        general_speedups_days=10,
        fire_crystals=100,
        refined_fire_crystals=100,
        fire_crystal_shards=100,
    )
    assert calculate_points(p, "thursday") == 3


def test_thursday_truncates_fractional_days_to_int():
    """`int(2.9) == 2` — the function returns int(); document the truncation."""
    p = _player(troop_training_speedups_days=2.9)
    assert calculate_points(p, "thursday") == 2


# ── Edge cases ────────────────────────────────────────────────────────────────

def test_unknown_day_returns_zero():
    p = _player(construction_speedups_days=10, fire_crystals=100)
    assert calculate_points(p, "wednesday") == 0
    assert calculate_points(p, "saturday") == 0
    assert calculate_points(p, "sunday") == 0


@pytest.mark.parametrize("day", ["Monday", "MONDAY", "Tuesday", "FRIDAY", "Thursday"])
def test_day_argument_is_case_insensitive(day):
    """The docstring promises case-insensitive day names."""
    p = _player(
        construction_speedups_days=1,
        research_speedups_days=1,
        troop_training_speedups_days=1,
    )
    expected = calculate_points(p, day.lower())
    assert calculate_points(p, day) == expected


def test_all_zero_player_scores_zero_on_every_day():
    p = _player()
    for day in ("monday", "tuesday", "friday", "thursday"):
        assert calculate_points(p, day) == 0, f"expected 0 on {day}"


def test_return_type_is_int_on_every_day():
    """Docstring guarantees an int return — important for downstream sorting/JSON."""
    p = _player(
        construction_speedups_days=1.5,
        research_speedups_days=1.5,
        troop_training_speedups_days=1.5,
        general_speedups_days=0.5,
        fire_crystals=1,
        refined_fire_crystals=1,
        fire_crystal_shards=1,
    )
    for day in ("monday", "tuesday", "friday", "thursday", "wednesday"):
        result = calculate_points(p, day)
        assert isinstance(result, int), f"{day} returned {type(result).__name__}, expected int"
