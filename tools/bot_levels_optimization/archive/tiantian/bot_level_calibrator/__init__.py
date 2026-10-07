"""Tiantian-vs-Lixiangqi bot level calibration tool."""

import sys
from .paths import REPOSITORY_ROOT

# The desktop launcher runs from this archived tool directory. Make the shared
# production opening policy importable there as well as from repository tests.
if str(REPOSITORY_ROOT) not in sys.path:
    sys.path.insert(0, str(REPOSITORY_ROOT))

from .strength import (
    StrengthProfile,
    initial_profile_for_level,
    profile_for_nodes,
    profile_for_strength,
)

__all__ = [
    "StrengthProfile",
    "initial_profile_for_level",
    "profile_for_nodes",
    "profile_for_strength",
]
