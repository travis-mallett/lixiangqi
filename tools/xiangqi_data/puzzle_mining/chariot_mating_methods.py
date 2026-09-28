"""Compatibility exports for the chariot mating-methods assessor."""

from .patterns import (
    CHARIOT_MATING_METHODS_LOGIC_VERSION as VERSION,
    CHARIOT_MATING_METHODS_THEME as THEME,
)
from .piece_type_mating_methods import BY_THEME


CHARIOT_MATE = BY_THEME[THEME]
candidate = CHARIOT_MATE.candidate
assess = CHARIOT_MATE.assess
evidence_outcome = CHARIOT_MATE.evidence_outcome
