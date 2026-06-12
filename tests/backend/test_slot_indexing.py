"""
tests/backend/test_slot_indexing.py — pure-Python tests for the slot
identifier / hour index helpers in backend/slots.py.

These tests intentionally bypass the Flask client and exercise the
functions directly — they're the lowest layer of the time-slot stack
and need their own focused coverage.
"""
import pytest

from slots import (
    VALID_SLOT_OFFSETS,
    DEFAULT_SLOT_OFFSET,
    slot_ids,
    slot_count,
    slot_mapping,
    matching_slots_for_hour,
    display_slot_id,
    slot_index_to_id,
    slot_id_to_index,
    hour_to_index,
    index_to_hour_str,
)


# ── slot_ids ──────────────────────────────────────────────────────────────────

def test_slot_ids_default_offset_matches_legacy_49_slot_layout():
    ids = slot_ids(-10)
    assert len(ids) == 49
    assert ids[0] == "23:50"  # pre-day slot
    assert ids[1] == "00:20"
    assert ids[2] == "00:50"
    assert ids[-2] == "23:20"
    assert ids[-1] == "23:50+"  # end-of-day slot


def test_slot_ids_offset_zero_yields_48_aligned_half_hours():
    ids = slot_ids(0)
    assert len(ids) == 48
    assert ids[0] == "00:00"
    assert ids[1] == "00:30"
    assert ids[-1] == "23:30"
    assert not any(s.endswith("+") for s in ids)


def test_slot_ids_offset_minus_fifteen():
    ids = slot_ids(-15)
    assert len(ids) == 49
    assert ids[0] == "23:45"
    assert ids[1] == "00:15"
    assert ids[2] == "00:45"
    assert ids[-1] == "23:45+"


def test_slot_ids_offset_minus_twenty():
    ids = slot_ids(-20)
    assert len(ids) == 49
    assert ids[0] == "23:40"
    assert ids[1] == "00:10"
    assert ids[-1] == "23:40+"


def test_slot_ids_invalid_offset_raises():
    with pytest.raises(ValueError):
        slot_ids(7)


# ── slot_count / slot_mapping ─────────────────────────────────────────────────

@pytest.mark.parametrize("offset,expected", [(-20, 49), (-15, 49), (-10, 49), (0, 48)])
def test_slot_count_per_offset(offset, expected):
    assert slot_count(offset) == expected


def test_slot_mapping_round_trips_through_slot_ids():
    for offset in VALID_SLOT_OFFSETS:
        mapping = slot_mapping(offset)
        ids = slot_ids(offset)
        assert mapping == dict(enumerate(ids))


# ── matching_slots_for_hour ───────────────────────────────────────────────────

def test_matching_slots_default_offset_hour_one_has_three_candidates():
    matches = matching_slots_for_hour(1, -10)
    assert matches == ["00:50", "01:20", "01:50"]


def test_matching_slots_default_offset_hour_zero_uses_pre_day_slot():
    matches = matching_slots_for_hour(0, -10)
    assert matches == ["23:50", "00:20", "00:50"]  # 23:50 is the pre-day slot


def test_matching_slots_default_offset_hour_twenty_three_uses_end_of_day_slot():
    matches = matching_slots_for_hour(23, -10)
    assert matches == ["22:50", "23:20", "23:50+"]  # 23:50+ is the end-of-day slot


def test_matching_slots_offset_zero_yields_two_aligned_slots_per_hour():
    assert matching_slots_for_hour(5, 0) == ["05:00", "05:30"]
    assert matching_slots_for_hour(0, 0) == ["00:00", "00:30"]
    assert matching_slots_for_hour(23, 0) == ["23:00", "23:30"]


def test_matching_slots_invalid_hour_raises():
    with pytest.raises(ValueError):
        matching_slots_for_hour(24, -10)


# ── display_slot_id ───────────────────────────────────────────────────────────

def test_display_slot_id_renders_end_of_day_with_plus_one_day():
    assert display_slot_id("23:50+") == "23:50 (+1d)"
    assert display_slot_id("23:45+") == "23:45 (+1d)"


def test_display_slot_id_passes_through_normal_slot_ids():
    assert display_slot_id("00:20") == "00:20"
    assert display_slot_id("23:50") == "23:50"  # pre-day slot, no "+"


# ── slot_index_to_id / slot_id_to_index round trips ──────────────────────────

@pytest.mark.parametrize("offset", VALID_SLOT_OFFSETS)
def test_slot_index_to_id_round_trip(offset):
    for idx in range(slot_count(offset)):
        slot_str = slot_index_to_id(idx, offset)
        assert slot_id_to_index(slot_str, offset) == idx


def test_slot_index_to_id_default_offset_boundaries():
    assert slot_index_to_id(0, -10) == "23:50"  # pre-day
    assert slot_index_to_id(48, -10) == "23:50+"  # end-of-day
    assert slot_index_to_id(0, 0) == "00:00"
    assert slot_index_to_id(47, 0) == "23:30"


def test_slot_id_to_index_returns_none_for_unknown_slot():
    # "23:50+" doesn't exist at offset 0
    assert slot_id_to_index("23:50+", 0) is None
    # "00:15" doesn't exist at offset -10
    assert slot_id_to_index("00:15", -10) is None


def test_slot_id_to_index_returns_none_for_invalid_offset():
    assert slot_id_to_index("00:20", 7) is None


def test_slot_index_to_id_out_of_range_returns_none():
    # Returns None rather than raising so read paths can skip orphaned rows
    # (e.g. a slot_index=48 row written under offset=-10 viewed under
    # offset=0, which only has 48 slots indexed 0..47).
    assert slot_index_to_id(49, -10) is None
    assert slot_index_to_id(-1, -10) is None
    assert slot_index_to_id(48, 0) is None  # offset 0 only has 48 slots
    assert slot_index_to_id(48, -10) == "23:50+"  # but is valid at -10


def test_slot_index_to_id_invalid_offset_returns_none():
    # Unsupported offset → None rather than raising.
    assert slot_index_to_id(0, 7) is None


# ── hour_to_index / index_to_hour_str ────────────────────────────────────────

@pytest.mark.parametrize("inp,expected", [
    ("00:00", 0),
    ("01:00", 1),
    ("13:30", 13),  # minutes are ignored for hourly preferences
    ("23:00", 23),
    (5, 5),
    ("00", 0),
])
def test_hour_to_index_accepts_strings_and_ints(inp, expected):
    assert hour_to_index(inp) == expected


@pytest.mark.parametrize("inp", ["24:00", "-1:00", "abc", "", None, 24, -1])
def test_hour_to_index_returns_none_for_invalid_input(inp):
    assert hour_to_index(inp) is None


def test_index_to_hour_str_round_trip():
    for h in range(24):
        assert hour_to_index(index_to_hour_str(h)) == h


def test_index_to_hour_str_out_of_range_raises():
    with pytest.raises(ValueError):
        index_to_hour_str(24)


def test_default_slot_offset_is_minus_ten():
    assert DEFAULT_SLOT_OFFSET == -10


def test_valid_slot_offsets_matches_spec():
    assert set(VALID_SLOT_OFFSETS) == {-20, -15, -10, 0}
