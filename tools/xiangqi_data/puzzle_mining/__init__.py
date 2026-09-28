"""Engine-discovered Xiangqi candidates and native puzzle categorization."""

from .classification import (
    ClassificationResult,
    Motif,
    MotifRegistry,
    TacticalClassifier,
    TACTICAL_MOTIF_REGISTRY,
    reclassify_stored_trace,
)
from .classification_job import TaxonomyResult, reclassify_canonical
from .solver import (
    SolutionRejected,
    SolutionReview,
    SolveResult,
    VerifiedBranch,
    solve_checkmate,
)

__all__ = [
    "ClassificationResult",
    "Motif",
    "MotifRegistry",
    "SolutionRejected",
    "SolutionReview",
    "SolveResult",
    "TACTICAL_MOTIF_REGISTRY",
    "TacticalClassifier",
    "TaxonomyResult",
    "reclassify_canonical",
    "reclassify_stored_trace",
    "VerifiedBranch",
    "solve_checkmate",
]
