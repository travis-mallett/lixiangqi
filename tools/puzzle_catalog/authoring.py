"""Explicit promotion from verified mining evidence into the authored catalog."""

from __future__ import annotations
import json
from pathlib import Path
import sqlite3

from .catalog import catalog_source, require, validate_puzzle
from tools.xiangqi_data.puzzle_mining.sources import (
    is_native_source,
    load_game,
    native_origin,
)


def admit_candidate(
    catalog, mining_path: Path, puzzle_id: str, source_catalog: Path | None
):
    connection = sqlite3.connect(f"{mining_path.resolve().as_uri()}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        row = connection.execute(
            """SELECT p.*, c.source_database,c.discovery_revision,c.categorized_revision,c.candidate_key,c.candidate_type,
          a.accepted,a.coverage,a.branches_json,a.verification_settings_json,t.taxonomy_version,t.status AS taxonomy_status
          FROM puzzles p JOIN candidates c ON c.id=p.candidate_id
          JOIN candidate_assessments a ON a.id=p.canonical_assessment_id
          JOIN taxonomy_assessments t ON t.id=p.taxonomy_assessment_id AND t.verification_assessment_id=a.id
          WHERE p.id=? AND p.verification_status='active'
          AND c.current_verification_id=a.id AND c.current_classification_id=t.id""",
            (puzzle_id,),
        ).fetchone()
        require(
            row is not None
            and row["accepted"] == 1
            and row["branches_json"]
            and row["coverage"] == "complete",
            "candidate lacks current canonical verification",
        )
        from tools.xiangqi_data.puzzle_mining.classification_job import (
            decode_taxonomy_versions,
            taxonomy_versions,
        )

        versions = decode_taxonomy_versions(row["taxonomy_version"])
        require(
            row["taxonomy_status"] in {"classified", "uncategorized"},
            "verification or taxonomy requires refresh",
        )
        require(
            versions == taxonomy_versions(candidate_type=row["candidate_type"]),
            "taxonomy logic requires refresh before admission",
        )
        if is_native_source(row["source_database"]):
            source = load_game(connection, {}, row["source_database"], row["game_id"])
            game_source = {
                "type": "native",
                "origin": native_origin(row["source_database"]),
            }
            # User identities are resolved in production; names/ratings are not
            # copied out of editable preview profiles.
            native = connection.execute(
                "SELECT players_json FROM native_games WHERE source_database=? AND game_id=?",
                (row["source_database"], row["game_id"]),
            ).fetchone()
            players = json.loads(native["players_json"])
            snapshot = {
                "initialFen": source.initial_fen,
                "moves": list(source.moves),
                "players": [
                    {"color": color, "userId": user_id}
                    for color, user_id in zip(("red", "black"), players)
                    if user_id
                ],
            }
        else:
            require(
                source_catalog is not None, "an authored source catalog is required"
            )
            game_source = {"type": "catalog", "database": row["source_database"]}
            snapshot = catalog_source(
                source_catalog, row["game_id"], row["source_database"]
            )
        puzzle = validate_puzzle(
            {
                "_id": row["id"],
                "gameId": row["game_id"],
                "gameSource": game_source,
                "fen": row["fen"],
                "line": " ".join(json.loads(row["line"])),
                "themes": json.loads(row["themes"]),
                "retired": False,
                "retirementReason": None,
                "sourceSnapshot": snapshot,
            }
        )
        with catalog.db:
            _reconcile_retired_rows(
                catalog,
                connection.execute(
                    "SELECT id,retirement_reason FROM puzzles WHERE candidate_id=? AND verification_status='withdrawn'",
                    (row["candidate_id"],),
                ).fetchall(),
            )
        return catalog.admit(
            puzzle,
            {
                "status": "verified",
                "candidateKey": row["candidate_key"],
                "miningDatabase": str(mining_path.resolve()),
                "branches": json.loads(row["branches_json"]),
                "assessmentId": row["canonical_assessment_id"],
                "taxonomyAssessmentId": row["taxonomy_assessment_id"],
                "discoveryRevision": row["discovery_revision"],
                "settings": json.loads(row["verification_settings_json"]),
                "verificationSignature": row["verification_signature"],
            },
        )
    finally:
        connection.close()


def reconcile_assessments(catalog, mining_path: Path):
    """Carry completed assessment retirements into the authored release atomically.

    Retired staging rows retain their old ID, solution, and source. Do not
    mistake a pending/failed verifier for a negative assessment.
    Only authored IDs need projection; probe mining by its puzzle primary key
    instead of scanning every mined puzzle while holding the catalog write lock.
    """
    if not mining_path.is_file():
        return
    connection = sqlite3.connect(mining_path.resolve().as_uri() + "?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        with catalog.db:
            catalog.db.execute("BEGIN IMMEDIATE")
            connection.execute("BEGIN")
            authored_ids = [
                row[0] for row in catalog.db.execute("SELECT id FROM catalog_puzzles")
            ]
            for puzzle_id in authored_ids:
                retired = connection.execute(
                    "SELECT id,retirement_reason FROM puzzles WHERE id=? AND verification_status='withdrawn'",
                    (puzzle_id,),
                ).fetchall()
                _reconcile_retired_rows(catalog, retired)
            # Solve IDs survive category changes; carry completed metadata forward.
            for puzzle_id in authored_ids:
                current = connection.execute(
                    """SELECT p.id,p.game_id,p.fen,p.line,p.themes,p.taxonomy_assessment_id,c.candidate_key,c.source_database,a.id AS assessment_id,
                p.verification_signature
                FROM candidates c JOIN puzzles p ON p.candidate_id=c.id AND p.verification_status='active'
                JOIN candidate_assessments a ON a.id=p.canonical_assessment_id
                WHERE p.id=? AND c.current_verification_id=a.id AND c.current_classification_id=p.taxonomy_assessment_id""",
                    (puzzle_id,),
                ).fetchone()
                if current is None:
                    continue
                row = catalog.db.execute(
                    "SELECT document,evidence FROM catalog_puzzles WHERE id=?",
                    (current["id"],),
                ).fetchone()
                if row is None:
                    continue
                document, evidence = json.loads(row[0]), json.loads(row[1])
                source = current["source_database"]
                game_source = (
                    {"type": "native", "origin": native_origin(source)}
                    if is_native_source(source)
                    else {"type": "catalog", "database": source}
                )
                if (
                    document["gameId"] != current["game_id"]
                    or document["gameSource"] != game_source
                    or document["fen"] != current["fen"]
                    or document["line"].split() != json.loads(current["line"])
                ):
                    raise ValueError(
                        "publication identity disagrees with current assessment"
                    )
                if (
                    evidence.get("assessmentId") == current["assessment_id"]
                    and evidence.get("taxonomyAssessmentId")
                    == current["taxonomy_assessment_id"]
                    and "playback" in document
                ):
                    continue
                if (
                    evidence.get("taxonomyAssessmentId")
                    != current["taxonomy_assessment_id"]
                ):
                    document["themes"] = json.loads(current["themes"])
                    if document.get("retirementReason") in {
                        "assessment replaced publication",
                        "latest assessment ineligible",
                        "latest completed classification",
                        "No supported basic kill pattern",
                    }:
                        document.update(retired=False, retirementReason=None)
                assessment = connection.execute(
                    "SELECT branches_json,verification_settings_json FROM candidate_assessments WHERE id=?",
                    (current["assessment_id"],),
                ).fetchone()
                evidence.update(
                    status="verified",
                    candidateKey=current["candidate_key"],
                    miningDatabase=str(mining_path.resolve()),
                    assessmentId=current["assessment_id"],
                    taxonomyAssessmentId=current["taxonomy_assessment_id"],
                    branches=json.loads(assessment["branches_json"] or "[]"),
                    settings=json.loads(
                        assessment["verification_settings_json"] or "{}"
                    ),
                    verificationSignature=current["verification_signature"],
                )
                from .playback import from_evidence

                document["playback"] = from_evidence(document, evidence)
                catalog.db.execute(
                    "UPDATE catalog_puzzles SET document=?,evidence=? WHERE id=?",
                    (
                        json.dumps(document, sort_keys=True),
                        json.dumps(evidence, sort_keys=True),
                        current["id"],
                    ),
                )
    finally:
        connection.close()


def _reconcile_retired_rows(catalog, retired):
    for row in retired:
        existing = catalog.db.execute(
            "SELECT document FROM catalog_puzzles WHERE id=?", (row["id"],)
        ).fetchone()
        if existing is None:
            continue
        document = json.loads(existing[0])
        if document["retired"]:
            continue
        document.update(
            retired=True,
            retirementReason=row["retirement_reason"] or "latest assessment ineligible",
        )
        catalog.db.execute(
            "UPDATE catalog_puzzles SET document=? WHERE id=?",
            (json.dumps(document, sort_keys=True), row["id"]),
        )
