"""Natural, deterministic ordering for round labels."""

from __future__ import annotations

import re
from functools import lru_cache

_ROUND_PARTS = re.compile(r"([0-9]+)")


@lru_cache(maxsize=4096)
def round_sort_key(label: str) -> bytes:
    """Return a byte key whose binary order is the natural round order."""

    label = label.strip()
    if not label:
        return b"\x01"

    key = bytearray(b"\x00")
    for part in _ROUND_PARTS.split(label):
        if not part:
            continue
        if part.isdigit():
            significant = part.lstrip("0") or "0"
            key.extend(b"\x01")
            key.extend(len(significant).to_bytes(8, "big"))
            key.extend(significant.encode("ascii"))
            # Numerically equal runs put fewer leading zeros first.
            key.extend(len(part).to_bytes(8, "big"))
        else:
            key.extend(b"\x02")
            for byte in part.casefold().encode("utf-8"):
                key.extend((byte + 1).to_bytes(2, "big"))
            key.extend(b"\x00\x00")

    # The terminator sorts before another token, so a label prefix sorts first.
    key.extend(b"\x00")
    # Use the original spelling as a final deterministic tie-breaker.
    key.extend(b"\x01")
    for byte in label.encode("utf-8"):
        key.extend((byte + 1).to_bytes(2, "big"))
    key.extend(b"\x00\x00")
    return bytes(key)


def compare_rounds(left: str, right: str) -> int:
    """Compare labels using the same natural order as the SQLite sort key."""

    left_key = round_sort_key(left)
    right_key = round_sort_key(right)
    return (left_key > right_key) - (left_key < right_key)
