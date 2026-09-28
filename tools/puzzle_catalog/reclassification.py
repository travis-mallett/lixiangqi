"""Reclassify through the candidate's current evidence authority."""

from pathlib import Path
import json
from typing import Any

from tools.xiangqi_data.puzzle_mining.classification_job import (
    reclassify_canonical,
    taxonomy_versions,
    all_theme_versions,
)
from tools.xiangqi_data.puzzle_mining.storage import open_database


def assess_puzzle(
    puzzle: dict[str, Any], theme: str, engine: Any, config: Any
) -> dict[str, Any]:
    evidence = dict(puzzle.get("_verificationEvidence") or {})
    result = {
        "themeVersion": all_theme_versions().get(theme, "unknown"),
        "taxonomyVersions": taxonomy_versions(),
        "evidence": evidence,
    }
    connection = None
    try:
        if not evidence.get("miningDatabase") or not evidence.get("candidateKey"):
            raise ValueError(
                "current candidate evidence required; run the appropriate verifier"
            )
        path = Path(evidence["miningDatabase"])
        if not path.is_file():
            raise ValueError("candidate evidence database is unavailable")
        connection = open_database(path)
        kind = connection.execute(
            "SELECT candidate_type FROM candidates WHERE candidate_key=?",
            (evidence["candidateKey"],),
        ).fetchone()
        if kind is None:
            raise ValueError("candidate unavailable")
        result["candidateType"] = kind[0]
        result["taxonomyVersions"] = taxonomy_versions(candidate_type=kind[0])
        assessment = reclassify_canonical(
            connection,
            evidence["candidateKey"],
            force=False,
            engine=engine,
            removal_nodes=config.nodes,
        )
        if assessment.status not in {
            "classified",
            "uncategorized",
            "category_conflict",
            "already_current",
        }:
            return {**result, "outcome": "unresolved", "reason": assessment.status}
        current = connection.execute(
            """SELECT c.current_classification_id,a.id,a.branches_json,a.verification_settings_json,p.id AS publication_id,p.line
            FROM candidates c JOIN candidate_assessments a ON a.id=c.current_verification_id
            LEFT JOIN puzzles p ON p.candidate_id=c.id AND p.verification_status='active'
            WHERE c.candidate_key=?""",
            (evidence["candidateKey"],),
        ).fetchone()
        if (
            current is None
            or current["current_classification_id"] != assessment.assessment_id
        ):
            raise ValueError("current assessment changed during publication projection")
        evidence.update(
            assessmentId=current["id"],
            taxonomyAssessmentId=current["current_classification_id"],
            branches=json.loads(current["branches_json"]),
            settings=json.loads(current["verification_settings_json"] or "{}"),
        )
        return {
            **result,
            "outcome": (
                "qualifies" if theme in assessment.themes else "does_not_qualify"
            ),
            "reason": "completed_classification",
            "categories": list(assessment.themes),
            "publicationId": current["publication_id"],
            "line": " ".join(json.loads(current["line"])) if current["line"] else None,
        }
    except Exception as exc:
        evidence["error"] = type(exc).__name__ + ": " + str(exc)
        return {
            **result,
            "outcome": "unresolved",
            "reason": "classification_unresolved",
        }
    finally:
        if connection is not None:
            connection.close()


def current_audit_results(results):
    """Invalidate cached catalog audits when their exact evidence changes.

    Group connections by staging database, so a frozen audit does not open a
    connection for every puzzle. Missing evidence is unresolved, never approval.
    """
    import sqlite3

    connections = {}
    try:
        for identifier, result in results.items():
            if result["outcome"] == "unresolved":
                yield identifier, "unresolved"
                continue
            evidence = result.get("evidence") or {}
            database, key = evidence.get("miningDatabase"), evidence.get("candidateKey")
            if result.get("taxonomyVersions") != taxonomy_versions(
                candidate_type=result.get("candidateType", "checkmate_candidate")
            ):
                continue
            if not database or not key:
                continue
            if database not in connections:
                path = Path(database)
                try:
                    connections[database] = sqlite3.connect(
                        path.resolve().as_uri() + "?mode=ro", uri=True
                    )
                except sqlite3.Error:
                    connections[database] = None
            connection = connections[database]
            if connection is None:
                continue
            current = connection.execute(
                "SELECT current_verification_id,current_classification_id FROM candidates WHERE candidate_key=?",
                (key,),
            ).fetchone()
            if (
                current
                and current[0] == evidence.get("assessmentId")
                and current[1] == evidence.get("taxonomyAssessmentId")
            ):
                yield identifier, result["outcome"]
    finally:
        for connection in connections.values():
            if connection is not None:
                connection.close()
