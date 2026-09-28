"""Apply current completed evidence to immutable publication identities.

Called inside the assessment transaction. Historical evidence and retired
publications remain recoverable, but only the candidate's two current pointers
are authoritative.
"""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def new_puzzle_id(connection, candidate_key):
    alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
    for salt in range(10_000):
        digest = hashlib.sha256(f"{candidate_key}:{salt}".encode()).digest()
        value = int.from_bytes(digest[:8], "big") % (62**5)
        chars = []
        for _ in range(5):
            value, remainder = divmod(value, 62)
            chars.append(alphabet[remainder])
        identifier = "".join(chars)
        if (
            connection.execute(
                "SELECT 1 FROM puzzles WHERE id=?", (identifier,)
            ).fetchone()
            is None
        ):
            return identifier
    raise RuntimeError("could not allocate a new puzzle ID")


def apply_assessment(
    connection, candidate_id, verification_id, classification_id, *, eligible
):
    candidate = connection.execute(
        "SELECT * FROM candidates WHERE id=?", (candidate_id,)
    ).fetchone()
    assessment = connection.execute(
        "SELECT * FROM candidate_assessments WHERE id=?", (verification_id,)
    ).fetchone()
    taxonomy = connection.execute(
        "SELECT * FROM taxonomy_assessments WHERE id=?", (classification_id,)
    ).fetchone()
    if (
        assessment["candidate_id"] != candidate_id
        or taxonomy["candidate_id"] != candidate_id
        or taxonomy["verification_assessment_id"] != verification_id
    ):
        raise ValueError("assessment ownership mismatch")
    connection.execute(
        "UPDATE candidates SET current_verification_id=?, current_classification_id=? WHERE id=?",
        (verification_id, classification_id, candidate_id),
    )
    current = connection.execute(
        "SELECT * FROM puzzles WHERE candidate_id=? AND verification_status='active'",
        (candidate_id,),
    ).fetchone()
    solution = json.loads(assessment["solution_json"] or "[]")
    if eligible and (not solution or len(solution) % 2 != 1):
        raise ValueError("invalid verified solution endpoint")
    themes = sorted(set(json.loads(taxonomy["themes_json"])))
    # Categories and assessment versions are mutable metadata. Reuse the solve's
    # identity even after withdrawal or an intervening different solution.
    line = [candidate["played_move"], *solution]
    matching = (
        next(
            (
                row
                for row in connection.execute(
                    "SELECT * FROM puzzles WHERE candidate_id=? AND game_id=? AND fen=? "
                    "ORDER BY (verification_status='active') DESC, rowid",
                    (candidate_id, candidate["game_id"], candidate["pre_fen"]),
                )
                if json.loads(row["line"]) == line
            ),
            None,
        )
        if eligible
        else None
    )
    stamp = datetime.now(UTC).isoformat()
    if current is not None and (matching is None or current["id"] != matching["id"]):
        connection.execute(
            "UPDATE puzzles SET verification_status='withdrawn', retired_at=?, retirement_reason=? WHERE id=?",
            (
                stamp,
                (
                    "assessment replaced publication"
                    if eligible
                    else "latest assessment ineligible"
                ),
                current["id"],
            ),
        )
    if not eligible:
        return None
    if not solution:
        raise ValueError("eligible assessment has no solution")
    settings = json.loads(assessment["verification_settings_json"] or "{}")
    signature = hashlib.sha256(
        encoded(
            {
                "engine": assessment["verified_engine_version"],
                "nnue": assessment["verified_nnue"],
                "settings": settings,
            }
        ).encode()
    ).hexdigest()
    if matching is not None:
        # Keep solve identity; advance categories and completed evidence together.
        connection.execute(
            "UPDATE puzzles SET themes=?, verification_status='active', retired_at=NULL, retirement_reason=NULL, canonical_assessment_id=?, taxonomy_assessment_id=?, verification_signature=?, engine=?, nnue=?, engine_nodes=?, engine_depth=? WHERE id=?",
            (
                encoded(themes),
                verification_id,
                classification_id,
                signature,
                assessment["verified_engine_version"],
                assessment["verified_nnue"],
                assessment["engine_nodes"] or 0,
                assessment["engine_depth"] or 0,
                matching["id"],
            ),
        )
        return matching["id"]
    identifier = new_puzzle_id(connection, candidate["candidate_key"])
    connection.execute(
        """INSERT INTO puzzles(id,candidate_id,game_id,source_url,fen,display_fen,initial_ply,
        line,solution,solution_plies,mate_in,themes,engine,nnue,engine_nodes,engine_depth,
        generator_version,created_at,verification_status,canonical_assessment_id,
        taxonomy_assessment_id,verification_signature)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?,?,?)""",
        (
            identifier,
            candidate_id,
            candidate["game_id"],
            candidate["source_url"],
            candidate["pre_fen"],
            candidate["position_fen"],
            candidate["ply"] - 1,
            encoded(line),
            encoded(solution),
            len(solution),
            (len(solution) + 1) // 2 if "mate" in themes else None,
            encoded(themes),
            assessment["verified_engine_version"],
            assessment["verified_nnue"],
            assessment["engine_nodes"] or 0,
            assessment["engine_depth"] or 0,
            2,
            stamp,
            verification_id,
            classification_id,
            signature,
        ),
    )
    return identifier
