"""Independent, evidence-only tactical classification interfaces.

The registry supports pure trace predicates. Categories needing engine attack
inspections, including double attack, are evaluated by classification_job.
Neither path constructs a solution for an unverified tactic.
Registered detectors receive the same complete verified trace for mating and
non-mating solutions, making motif logic orthogonal to proof generation.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Iterable

from .models import VerifiedTrace
from .patterns import THEME_LOGIC_VERSIONS, classification_logic_version

CLASSIFICATION_VERSION = classification_logic_version()
MotifDetector = Callable[[VerifiedTrace], bool]


@dataclass(frozen=True)
class Motif:
    name: str
    detector: MotifDetector
    version: str = "1"


class MotifRegistry:
    """Ordered named detectors with no built-in tactical assumptions."""

    def __init__(self, motifs: Iterable[Motif] = ()) -> None:
        self._motifs: list[Motif] = []
        for motif in motifs:
            self.register(motif.name, motif.detector, version=motif.version)

    @property
    def motifs(self) -> tuple[Motif, ...]:
        return tuple(self._motifs)

    @property
    def names(self) -> tuple[str, ...]:
        return tuple(motif.name for motif in self._motifs)

    @property
    def versions(self) -> dict[str, str]:
        return {motif.name: motif.version for motif in self._motifs}

    def register(
        self, name: str, detector: MotifDetector, *, version: str = "1"
    ) -> None:
        if not name or not name.strip():
            raise ValueError("motif name must not be empty")
        if any(motif.name == name for motif in self._motifs):
            raise ValueError(f"motif already registered: {name}")
        if not version or not str(version).strip():
            raise ValueError("motif version must not be empty")
        self._motifs.append(Motif(name, detector, version))

    def logic_versions(self) -> dict[str, str]:
        """Return versions for terminal and registered tactical themes."""
        versions = dict(THEME_LOGIC_VERSIONS)
        duplicate_names = set(versions).intersection(self.versions)
        if duplicate_names:
            raise ValueError(
                "tactical motif duplicates terminal theme(s): "
                + ", ".join(sorted(duplicate_names))
            )
        versions.update(self.versions)
        return versions

    def assess(
        self, trace: VerifiedTrace, selected: set[str] | None = None
    ) -> tuple[str, ...]:
        if not trace.complete:
            raise ValueError("motif assessment requires a complete verified trace")
        return tuple(
            motif.name
            for motif in self._motifs
            if (selected is None or motif.name in selected) and motif.detector(trace)
        )


# Extension point for pure trace predicates. Engine-assisted categories have
# their versioned assessors in the shared category execution layer.
TACTICAL_MOTIF_REGISTRY = MotifRegistry()


@dataclass(frozen=True)
class ClassificationResult:
    status: str
    themes: tuple[str, ...] = ()
    evidence: tuple[dict[str, object], ...] = ()
    version: str = CLASSIFICATION_VERSION

    @property
    def awaiting_logic(self) -> bool:
        return self.status == "awaiting_logic"


class TacticalClassifier:
    """Classify a verified trace using the configured motif registry."""

    def __init__(
        self,
        registry: MotifRegistry | None = None,
        *,
        version: str | None = None,
    ) -> None:
        self.registry = registry if registry is not None else TACTICAL_MOTIF_REGISTRY
        self.version = (
            version
            if version is not None
            else ",".join(
                f"{name}@{revision}"
                for name, revision in sorted(self.registry.logic_versions().items())
            )
        )

    def classify(
        self,
        trace: VerifiedTrace | None,
        *,
        candidate_type: str = "tactic_candidate",
        selected_themes: set[str] | None = None,
    ) -> ClassificationResult:
        # Non-mate candidates remain awaiting proof.  An empty theme set must
        # never be interpreted as a verified tactical solution.
        if candidate_type == "tactic_candidate" and trace is None:
            return ClassificationResult("awaiting_verifier", version=self.version)
        if trace is None:
            return ClassificationResult("awaiting_verifier", version=self.version)
        if not trace.complete:
            return ClassificationResult("awaiting_verifier", version=self.version)
        return self._assess(trace, selected_themes)

    def _assess(
        self, trace: VerifiedTrace, selected_themes: set[str] | None = None
    ) -> ClassificationResult:
        if not trace.complete:
            return ClassificationResult("awaiting_verifier", version=self.version)
        if not self.registry.motifs:
            return ClassificationResult("awaiting_logic", version=self.version)
        themes = self.registry.assess(trace, selected_themes)
        status = "matched" if themes else "untagged"
        evidence = tuple(
            {"motif": name, "trace_plies": len(trace.moves)} for name in themes
        )
        return ClassificationResult(
            status=status,
            themes=themes,
            evidence=evidence,
            version=self.version,
        )


def classify_verified_trace(
    trace: VerifiedTrace,
    *,
    registry: MotifRegistry | None = None,
    selected_themes: set[str] | None = None,
) -> ClassificationResult:
    """Convenience entry point used by checkmate taxonomy and future tactics."""

    return TacticalClassifier(registry).classify(
        trace, candidate_type="verified", selected_themes=selected_themes
    )


def classify_tactical_candidate(
    trace: VerifiedTrace | None = None,
    *,
    registry: MotifRegistry | None = None,
) -> ClassificationResult:
    """Assess a tactic only after another component supplies proof."""

    return TacticalClassifier(registry).classify(trace)


def reclassify_stored_trace(
    raw_trace: dict[str, object] | None,
    *,
    registry: MotifRegistry | None = None,
) -> ClassificationResult:
    """Re-run taxonomy on persisted evidence without invoking an engine.

    Older rows may contain only a solution line and no verification ledger;
    they remain explicitly awaiting re-verification rather than being turned
    into a fabricated ``VerifiedTrace``.
    """

    if raw_trace is None:
        return ClassificationResult("awaiting_verifier")
    trace = VerifiedTrace.from_dict(raw_trace)
    if not trace.verified:
        return ClassificationResult("awaiting_verifier")
    return classify_verified_trace(trace, registry=registry)
