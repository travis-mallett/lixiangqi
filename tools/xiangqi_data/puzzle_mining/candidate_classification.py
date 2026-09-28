"""Tactic categorization uses the same solution/category ledger as checkmates."""

from dataclasses import dataclass
from .classification import TACTICAL_MOTIF_REGISTRY
from .classification_job import reclassify_canonical, taxonomy_versions


@dataclass
class ClassificationReport:
    queued: int = 0
    changed: int = 0
    current: int = 0
    awaiting_verifier: int = 0
    awaiting_logic: int = 0


def classify_candidates(
    connection, *, candidate_type, registry=None, themes=None, engine=None
):
    if candidate_type != "tactic_candidate":
        raise ValueError(f"unsupported candidate type: {candidate_type}")
    registry = registry if registry is not None else TACTICAL_MOTIF_REGISTRY
    if (
        themes is not None
        and set(themes)
        - taxonomy_versions(registry, candidate_type=candidate_type).keys()
    ):
        raise ValueError("unknown theme(s)")
    report = ClassificationReport()
    last_id = 0
    while True:
        rows = connection.execute(
            "SELECT id,candidate_key FROM candidates WHERE candidate_type=? AND id>? ORDER BY id LIMIT 100",
            (candidate_type, last_id),
        ).fetchall()
        if not rows:
            return report
        last_id = rows[-1]["id"]
        for row in rows:
            result = reclassify_canonical(
                connection,
                row["candidate_key"],
                registry=registry,
                selected_themes=themes,
                engine=engine,
            )
            if result.status == "already_current":
                report.current += 1
            elif result.status in {"classified", "uncategorized", "category_conflict"}:
                report.queued += 1
                report.changed += int(result.changed)
            elif result.status == "awaiting_classification_evidence":
                report.awaiting_logic += 1
            else:
                report.awaiting_verifier += 1
