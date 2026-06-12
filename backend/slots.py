"""
backend/slots.py

Slot identifier helpers.

The assignment grid is generated from an admin-configurable "slot offset" — the
number of minutes from each half-hour boundary at which 30-minute slots start.

Offsets in {-20, -15, -10, 0} are supported.

  offset  0 → 48 slots, aligned to the hour: 00:00, 00:30, ..., 23:30
  offset -10 → 49 slots starting with the pre-day "23:50" slot and ending with
               the end-of-day "23:50+" slot (current default; matches the
               historical hardcoded model).
  offset -15 → 49 slots: 23:45, 00:15, 00:45, ..., 23:15, 23:45+
  offset -20 → 49 slots: 23:40, 00:10, 00:40, ..., 23:10, 23:40+

End-of-day slots carry a trailing "+" so they don't collide with the pre-day
slot, which has the same HH:MM but logically belongs to the previous day.

This module contains the string-based slot identifier helpers (``slot_ids``,
``display_slot_id``, ``matching_slots_for_hour``, ``slot_count``, and
``slot_mapping``), numerical index <-> identifier converters
(``slot_index_to_id`` and ``slot_id_to_index``), and hour-preference converters
(``hour_to_index`` and ``index_to_hour_str``). The slot index converters return
``None`` for out-of-range indices or unknown identifiers, rather than raising,
so callers can tolerate rows written under a different offset.
"""
from __future__ import annotations

VALID_SLOT_OFFSETS = (-20, -15, -10, 0)
DEFAULT_SLOT_OFFSET = -10


def _slot_minutes(offset_min: int) -> tuple[int, int]:
    """Return the two within-hour slot start minutes for the given offset."""
    base = ((offset_min % 30) + 30) % 30
    return base, base + 30


def slot_ids(offset_min: int) -> list[str]:
    """Return the ordered list of slot identifier strings for the given offset."""
    if offset_min not in VALID_SLOT_OFFSETS:
        raise ValueError(
            f"Invalid slot offset {offset_min}; must be one of {VALID_SLOT_OFFSETS}"
        )

    if offset_min == 0:
        slots = []
        for h in range(24):
            slots.append(f"{h:02d}:00")
            slots.append(f"{h:02d}:30")
        return slots

    base, second = _slot_minutes(offset_min)
    # 49 slots: pre-day + 23 full hours (×2 slots each) + (23:base, 23:second+)
    slots = [f"23:{second:02d}"]  # pre-day slot (belongs to yesterday)
    for h in range(23):
        slots.append(f"{h:02d}:{base:02d}")
        slots.append(f"{h:02d}:{second:02d}")
    slots.append(f"23:{base:02d}")
    slots.append(f"23:{second:02d}+")  # end-of-day slot extends past midnight
    return slots


def matching_slots_for_hour(hour: int, offset_min: int) -> list[str]:
    """Return the slot identifiers whose 30-minute window overlaps the given hour
    by at least 10 minutes.

    Returns 2 slots for offset 0 (the two aligned half-hour slots within the
    hour) and 3 slots otherwise (one straddling each hour boundary plus the
    middle slot).
    """
    if offset_min not in VALID_SLOT_OFFSETS:
        raise ValueError(
            f"Invalid slot offset {offset_min}; must be one of {VALID_SLOT_OFFSETS}"
        )
    if not 0 <= hour <= 23:
        raise ValueError(f"hour must be in 0..23, got {hour}")

    if offset_min == 0:
        return [f"{hour:02d}:00", f"{hour:02d}:30"]

    base, second = _slot_minutes(offset_min)
    matches: list[str] = []

    # Previous hour's "second" slot (which extends into the start of this hour)
    if hour == 0:
        matches.append(f"23:{second:02d}")  # pre-day slot
    else:
        matches.append(f"{(hour - 1):02d}:{second:02d}")

    # This hour's "base" slot
    matches.append(f"{hour:02d}:{base:02d}")

    # This hour's "second" slot (extends into the next hour; "+" suffix at 23)
    if hour == 23:
        matches.append(f"23:{second:02d}+")
    else:
        matches.append(f"{hour:02d}:{second:02d}")

    return matches


def display_slot_id(slot_id: str) -> str:
    """Convert an internal slot ID to a human-friendly display label.

    End-of-day slots stored with a trailing "+" render as "HH:MM (+1d)" so the
    cross-midnight nature is visible to users.
    """
    if slot_id.endswith("+"):
        return f"{slot_id[:-1]} (+1d)"
    return slot_id


# ---------------------------------------------------------------------------
# Numerical slot indexing
#
# The slot identifier strings above are derived from the configured offset and
# therefore depend on it. To make persisted assignment rows offset-independent
# we additionally expose a numerical "slot_index" — the 0-based position of
# the slot inside ``slot_ids(offset)``. Indices are what the database stores;
# strings are computed on read.
#
# Mapping summary at the supported offsets:
#   offset -10 → indices 0..48, index 0 == "23:50" (pre-day), index 48 == "23:50+"
#   offset -15 → indices 0..48, index 0 == "23:45" (pre-day), index 48 == "23:45+"
#   offset -20 → indices 0..48, index 0 == "23:40" (pre-day), index 48 == "23:40+"
#   offset   0 → indices 0..47, index 0 == "00:00", index 47 == "23:30"
# ---------------------------------------------------------------------------


def slot_count(offset_min: int) -> int:
    """Return the number of slots produced by the given offset."""
    return len(slot_ids(offset_min))


def slot_mapping(offset_min: int) -> dict[int, str]:
    """Return ``{index: slot_id}`` for the given offset — convenient for API
    payloads so clients can resolve indices to display strings independently.
    """
    return {i: sid for i, sid in enumerate(slot_ids(offset_min))}


def slot_index_to_id(index: int, offset_min: int) -> str | None:
    """Return the slot identifier string for the given index and offset.

    Returns ``None`` when ``index`` is outside the valid range for the offset
    (for example a row stored with ``slot_index=48`` under a 49-slot offset
    that is later viewed under offset ``0`` with only 48 slots). Returning
    ``None`` lets read paths skip the orphaned row instead of raising and
    500-ing the entire endpoint.
    """
    try:
        ids = slot_ids(offset_min)
    except ValueError:
        return None
    if not 0 <= index < len(ids):
        return None
    return ids[index]


def slot_id_to_index(slot_id: str, offset_min: int) -> int | None:
    """Return the numerical index for a slot identifier, or None if it isn't a
    valid slot under the given offset.

    Returns ``None`` rather than raising so callers (notably the migration
    code) can tolerate legacy rows that were written under a different offset
    and decide what to do with them on a per-row basis.
    """
    try:
        ids = slot_ids(offset_min)
    except ValueError:
        return None
    try:
        return ids.index(slot_id)
    except ValueError:
        return None


def hour_to_index(hour_str_or_int: str | int) -> int | None:
    """Parse an hourly preference into its 0..23 index.

    Accepts either an integer hour (``13``) or a ``"HH:MM"`` / ``"HH"`` string
    (the minutes portion is ignored — hourly preferences only carry the hour).
    Returns ``None`` for unparseable input.
    """
    if isinstance(hour_str_or_int, int):
        return hour_str_or_int if 0 <= hour_str_or_int <= 23 else None
    if not isinstance(hour_str_or_int, str):
        return None
    head = hour_str_or_int.split(":", 1)[0].strip()
    if not head.isdigit():
        return None
    value = int(head)
    return value if 0 <= value <= 23 else None


def index_to_hour_str(index: int) -> str:
    """Format an hour index back to the canonical ``"HH:00"`` preference string."""
    if not 0 <= index <= 23:
        raise ValueError(f"hour index {index} out of range 0..23")
    return f"{index:02d}:00"
