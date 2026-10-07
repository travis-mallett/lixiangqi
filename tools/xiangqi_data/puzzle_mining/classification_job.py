"""Reclassify taxonomy from canonical evidence.

Verification produces the canonical line and its evidence ledger. Reuse reads
that ledger; when an older ledger has only geometry, the worker may perform the
bounded motif counterfactual checks and persist them separately. Neither path changes
the verifier assessment or its canonical pointer.
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from . import (
    centroid_pawn,
    white_faced_general,
    double_chariots,
    horse_roles,
    throat_cutting,
    chariots_threatening_advisor,
    three_immortals,
    repatriation,
    general_disrobing,
    assisting_king,
    double_ghosts,
    cannon_chariot_discovered,
    detonating_mine,
    moon_scooping,
    spring_horse,
    smothered_cannon,
    check_count,
    flanking_trio,
    final_move_mates,
    old_pawn,
    heaven_earth,
    double_toast,
    bold_chariot,
    pawn_triple,
    cannon_sandwich,
    exchange_material,
    pawn_mates,
    headhunter_cannon,
    iron_bolt,
    piece_type_mating_methods,
)
from .database_write import begin_write
from .classification import MotifRegistry, TacticalClassifier
from . import fork
from .models import VerifiedTrace, fen_side
from .engine import PuzzleEngine, EngineProtocolError, IncompleteSearchError
from .motif_removal import verify_removed_motif
from .position import normalized_fen, PUZZLE_HISTORY_POLICY
from .patterns import (
    DOUBLE_CHARIOTS_THEME,
    DOUBLE_CHARIOTS_LOGIC_VERSION,
    double_chariots_candidate,
    spring_horse_candidate,
    CENTROID_PAWN_LOGIC_VERSION,
    CENTROID_PAWN_THEME,
    OCTAGONAL_HORSE_LOGIC_VERSION,
    OCTAGONAL_HORSE_THEME,
    WHITE_FACED_GENERAL_THEME,
    WHITE_FACED_GENERAL_LOGIC_VERSION,
    white_faced_general_escape_positions,
    TerminalPosition,
    centroid_pawn_candidate,
    octagonal_horse_candidate,
    octagonal_horse_removed_fens,
    piece_type_mating_methods_candidate,
    mate_themes,
    MATE_TAXONOMY_VERSION,
    matching_assessed_themes,
)

# Puzzle Studio switch for the tactic categorizer. When off, tactic candidates
# are no longer scanned for winningMaterialByDoubleAttack: the theme, its
# detector, stored verdicts and existing puzzle tags are all untouched, and a
# stored match is reused so already-tagged puzzles keep their tag. Only a
# missing verdict is filled in as a non-match, without any engine work. Set to
# True to resume scanning, then force a reclassification pass so the skipped
# candidates are scanned again.
DOUBLE_ATTACK_DETECTION_ENABLED = False


@dataclass(frozen=True)
class TaxonomyResult:
    status: str
    themes: tuple[str, ...] = ()
    assessment_id: int | None = None
    changed: bool = False


def taxonomy_versions(registry=None, *, candidate_type="checkmate_candidate"):
    """Theme logic and branch-consensus policy, independent of the verifier."""
    classifier = TacticalClassifier(registry)
    if candidate_type == "tactic_candidate":
        # The cannon chariot discovery and its reversing twin are the motifs
        # both pools share; the mating pool also receives them through the
        # terminal matcher registry.
        return {
            fork.THEME: fork.VERSION,
            exchange_material.THEME: exchange_material.VERSION,
            cannon_chariot_discovered.THEME: cannon_chariot_discovered.VERSION,
            detonating_mine.THEME: detonating_mine.VERSION,
            **classifier.registry.versions,
            "__consensus__": "2",
        }
    return {
        **classifier.registry.logic_versions(),
        "__mate__": MATE_TAXONOMY_VERSION,
        "__consensus__": "2",
    }


def all_theme_versions():
    return {
        name: version
        for kind in ("checkmate_candidate", "tactic_candidate")
        for name, version in taxonomy_versions(candidate_type=kind).items()
        if not name.startswith("__")
    }


def _encoded(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def encode_taxonomy_revision(versions: dict[str, str]) -> str:
    return _encoded(
        {"versions": dict(sorted(versions.items())), "run": uuid.uuid4().hex}
    )


def decode_taxonomy_versions(raw: str | None) -> dict[str, str]:
    try:
        value = json.loads(raw) if raw else None
    except (TypeError, json.JSONDecodeError):
        return {}
    if not isinstance(value, dict) or not isinstance(value.get("versions"), dict):
        return {}
    return {str(k): str(v) for k, v in value["versions"].items()}


def _stored_traces(raw_branches: str | None) -> tuple[VerifiedTrace, ...] | None:
    if not raw_branches:
        return None
    try:
        branches = json.loads(raw_branches)
    except (TypeError, json.JSONDecodeError):
        return None
    if not isinstance(branches, list) or not branches:
        return None
    traces: list[VerifiedTrace] = []
    for branch in branches:
        raw_trace = branch.get("verification") if isinstance(branch, dict) else None
        if not isinstance(raw_trace, dict):
            return None
        try:
            trace = VerifiedTrace.from_dict(raw_trace)
        except (KeyError, TypeError, ValueError, json.JSONDecodeError):
            return None
        if not trace.complete:
            return None
        traces.append(trace)
    return tuple(traces)


def _stored_motif_removal(
    raw_branches: str | None, theme: str
) -> tuple[object, ...] | None:
    """Read complete current-version motif-removal evidence from branches."""

    try:
        branches = json.loads(raw_branches) if raw_branches else None
    except (TypeError, json.JSONDecodeError):
        return None
    if not isinstance(branches, list) or not branches:
        return None
    results: list[object] = []
    for branch in branches:
        if not isinstance(branch, dict):
            return None
        evidence = (
            branch.get("motif_removal", {}).get(theme)
            if isinstance(branch.get("motif_removal"), dict)
            else None
        )
        if evidence is None:
            results.append([])
            continue
        records = evidence if isinstance(evidence, list) else [evidence]
        if not records or any(
            not isinstance(record, dict)
            or record.get("logic_version")
            != {
                OCTAGONAL_HORSE_THEME: OCTAGONAL_HORSE_LOGIC_VERSION,
            }[theme]
            or record.get("outcome") not in {"key", "not_key"}
            or not record.get("removed_fen")
            or "inspect" not in record
            or not isinstance(record.get("inspect"), dict)
            or not record["inspect"].get("fen")
            or normalized_fen(record["inspect"]["fen"])
            != normalized_fen(record["removed_fen"])
            or not isinstance(record["inspect"].get("legal_moves"), list)
            or not isinstance(record.get("newly_legal_general_moves"), list)
            or (
                record.get("outcome") == "key"
                and (
                    "engine_result" not in record
                    or not record.get("newly_legal_general_moves")
                )
            )
            for record in records
        ):
            return None
        results.append(records)
    return tuple(results)


def _external_motif_removal(
    connection: sqlite3.Connection,
    candidate_id: int,
    assessment_id: int,
    theme: str,
    branch_count: int,
) -> tuple[object, ...] | None:
    rows = connection.execute(
        """SELECT branch_index, evidence_json FROM motif_removal_evidence
           WHERE candidate_id = ? AND canonical_assessment_id = ?
             AND theme = ? AND theme_version = ?
           ORDER BY branch_index""",
        (
            candidate_id,
            assessment_id,
            theme,
            {
                OCTAGONAL_HORSE_THEME: OCTAGONAL_HORSE_LOGIC_VERSION,
            }[theme],
        ),
    ).fetchall()
    if any(
        row["branch_index"] < 0 or row["branch_index"] >= branch_count for row in rows
    ):
        return None
    by_index = {row["branch_index"]: row for row in rows}
    try:
        values = tuple(
            (
                []
                if index not in by_index
                else [json.loads(by_index[index]["evidence_json"])]
            )
            for index in range(branch_count)
        )
    except (TypeError, json.JSONDecodeError):
        return None
    for records in values:
        if not records:
            continue
        record = records[0]
        if (
            not isinstance(record, dict)
            or record.get("logic_version")
            != {
                OCTAGONAL_HORSE_THEME: OCTAGONAL_HORSE_LOGIC_VERSION,
            }[theme]
            or record.get("outcome") not in {"key", "not_key"}
            or not record.get("removed_fen")
            or not isinstance(record.get("inspect"), dict)
            or not record["inspect"].get("fen")
            or normalized_fen(record["inspect"]["fen"])
            != normalized_fen(record["removed_fen"])
            or not isinstance(record["inspect"].get("legal_moves"), list)
            or not isinstance(record.get("newly_legal_general_moves"), list)
            or (
                record["outcome"] == "key"
                and (
                    "engine_result" not in record
                    or not record["newly_legal_general_moves"]
                )
            )
        ):
            return None
    return values


def _removal_fens_for_trace(trace: VerifiedTrace) -> set[str]:
    terminal = TerminalPosition(
        fen=trace.terminal.fen,
        checkmate=trace.terminal.checkmate,
        losing_side=fen_side(trace.terminal.fen),
        stalemate=trace.terminal.stalemate,
    )
    return {removed for _square, removed in octagonal_horse_removed_fens(terminal)}


def _shared_check_count_evidence(connection, current, index, assessor, terminal):
    """Reuse a board-bound checker inspection from another check-count category."""
    themes = sorted(check_count.THEMES)
    placeholders = ",".join("?" for _ in themes)
    rows = connection.execute(
        f"""SELECT evidence_json FROM motif_removal_evidence
            WHERE candidate_id=? AND canonical_assessment_id=?
              AND theme IN ({placeholders}) AND theme_version=? AND branch_index=?""",
        (
            current["candidate_id"],
            current["current_verification_id"],
            *themes,
            assessor.version,
            index,
        ),
    )
    for row in rows:
        try:
            record = json.loads(row[0])
            outcome = assessor.evidence_outcome(terminal, record)
        except (ValueError, TypeError):
            continue
        if outcome is not None and record.get("outcome") != "inconclusive":
            return record, outcome
    return None, None


def _evaluate_category(
    connection, current, traces, classifier, category, engine, removal_nodes
):
    """Evaluate one category across the verified branches, short-circuiting a non-match."""
    verification_id = current["current_verification_id"]
    proofs = {}
    embedded_proofs = {}
    persisted_proofs = {}
    terminal_cache = {}
    for index, trace in enumerate(traces):
        if category in {
            fork.THEME,
            exchange_material.THEME,
            bold_chariot.THEME,
            pawn_triple.THEME,
            double_ghosts.THEME,
            cannon_chariot_discovered.THEME,
            detonating_mine.THEME,
        }:
            assessor = {
                fork.THEME: fork,
                exchange_material.THEME: exchange_material,
                bold_chariot.THEME: bold_chariot,
                pawn_triple.THEME: pawn_triple,
                double_ghosts.THEME: double_ghosts,
                cannon_chariot_discovered.THEME: cannon_chariot_discovered,
                detonating_mine.THEME: detonating_mine,
            }[category]
            setup = (
                {"pre_fen": current["pre_fen"], "setup_move": current["played_move"]}
                if category == exchange_material.THEME
                else {}
            )
            row = connection.execute(
                "SELECT evidence_json FROM motif_removal_evidence WHERE candidate_id=? AND canonical_assessment_id=? AND theme=? AND theme_version=? AND branch_index=?",
                (
                    current["candidate_id"],
                    verification_id,
                    category,
                    assessor.VERSION,
                    index,
                ),
            ).fetchone()
            record = json.loads(row[0]) if row else None
            outcome = assessor.evidence_outcome(trace, record, **setup)
            if (
                outcome is None
                and category == fork.THEME
                and not DOUBLE_ATTACK_DETECTION_ENABLED
            ):
                # Double-attack detection is switched off. A stored verdict was
                # already reused above, so existing tags survive; otherwise
                # record a placeholder non-match instead of scanning.
                record = {
                    "outcome": "not_key",
                    "reason": "double_attack_detection_disabled",
                }
                outcome = "not_key"
            if outcome is None:
                from .solver import SolutionReview

                try:
                    record = assessor.assess(engine, trace, **setup)
                    outcome = assessor.evidence_outcome(trace, record, **setup)
                except (
                    SolutionReview,
                    ValueError,
                    EngineProtocolError,
                    IncompleteSearchError,
                    OSError,
                    TimeoutError,
                ) as exc:
                    record = {"outcome": "inconclusive", "reason": str(exc)}
            proofs[(category, index)] = [record]
            if outcome is None:
                return "inconclusive", proofs
            if outcome != "key":
                return ("no_match" if index == 0 else "conflict"), proofs
            continue
        if category == headhunter_cannon.THEME and trace.stalemate:
            terminal = TerminalPosition(
                trace.terminal.fen, False, fen_side(trace.terminal.fen), True
            )
            if not headhunter_cannon.candidate(terminal):
                return ("no_match" if index == 0 else "conflict"), proofs
            continue
        if category == final_move_mates.LEISURELY_STROLL_THEME:
            sequence = final_move_mates.leisurely_stroll(trace)
            if sequence is None:
                return "inconclusive", proofs
            if not sequence:
                return ("no_match" if index == 0 else "conflict"), proofs
            continue
        terminal = TerminalPosition(
            trace.terminal.fen,
            trace.terminal.checkmate,
            fen_side(trace.terminal.fen),
            trace.terminal.stalemate,
        )
        terminal_category = category
        selected = {terminal_category}
        if category == moon_scooping.THEME:
            sequence = moon_scooping.candidate(trace)
            if sequence is None:
                return "inconclusive", proofs
            if not sequence:
                return ("no_match" if index == 0 else "conflict"), proofs
            selected.add(WHITE_FACED_GENERAL_THEME)
        evidence = {}
        for theme, geometry in ((OCTAGONAL_HORSE_THEME, octagonal_horse_candidate),):
            if (selected is not None and theme not in selected) or not geometry(
                terminal
            ):
                continue
            if theme not in embedded_proofs:
                embedded_proofs[theme] = _stored_motif_removal(
                    current["branches_json"], theme
                )
            stored = embedded_proofs[theme]
            records = stored[index] if stored is not None else None
            expected = _removal_fens_for_trace(trace)
            if not records or {r.get("removed_fen") for r in records} != expected:
                if theme not in persisted_proofs:
                    persisted_proofs[theme] = _external_motif_removal(
                        connection,
                        current["candidate_id"],
                        verification_id,
                        theme,
                        len(traces),
                    )
                stored = persisted_proofs[theme]
                records = stored[index] if stored is not None else None
            if not records or {r.get("removed_fen") for r in records} != expected:
                if engine is None or removal_nodes is None:
                    return "inconclusive", proofs
                records = []
                for removed in sorted(expected):
                    cache_key = (theme, terminal.fen, removed)
                    if cache_key not in terminal_cache:
                        record = verify_removed_motif(
                            engine, terminal, theme, removed, nodes=removal_nodes
                        )
                        terminal_cache[cache_key] = {
                            **record,
                            "terminal_fen": terminal.fen,
                        }
                    record = terminal_cache[cache_key]
                    records.append(record)
            if any(
                r.get("outcome") not in {"key", "not_key"}
                or r.get("terminal_fen") != terminal.fen
                for r in records
            ):
                return "inconclusive", proofs
            evidence[theme] = records
            proofs[(theme, index)] = records
        for theme, version, geometry, assessor in (
            (
                assisting_king.THEME,
                assisting_king.VERSION,
                lambda terminal: assisting_king.candidate(trace) is not False,
                assisting_king,
            ),
            (
                general_disrobing.THEME,
                general_disrobing.VERSION,
                lambda terminal: general_disrobing.candidate(trace) is not False,
                general_disrobing,
            ),
            (
                repatriation.THEME,
                repatriation.VERSION,
                lambda terminal: repatriation.candidate(trace) is not False,
                repatriation,
            ),
            (
                three_immortals.THEME,
                three_immortals.VERSION,
                lambda terminal: three_immortals.candidate(trace) is not False,
                three_immortals,
            ),
            (
                chariots_threatening_advisor.THEME,
                chariots_threatening_advisor.VERSION,
                lambda terminal: chariots_threatening_advisor.candidate(trace)
                is not False,
                chariots_threatening_advisor,
            ),
            *(
                (role.theme, role.version, role.candidate, role)
                for role in iron_bolt.ASSESSORS
            ),
            (
                headhunter_cannon.THEME,
                headhunter_cannon.VERSION,
                headhunter_cannon.candidate,
                headhunter_cannon,
            ),
            *(
                (
                    role.theme,
                    role.version,
                    lambda terminal, role=role: role.candidate(trace) is not False,
                    role,
                )
                for role in pawn_mates.ASSESSORS
            ),
            (
                cannon_sandwich.THEME,
                cannon_sandwich.VERSION,
                lambda terminal: cannon_sandwich.candidate(trace),
                cannon_sandwich,
            ),
            (
                double_toast.THEME,
                double_toast.VERSION,
                lambda terminal: double_toast.candidate(trace) is not False,
                double_toast,
            ),
            (
                heaven_earth.THEME,
                heaven_earth.VERSION,
                lambda terminal: heaven_earth.candidate(trace) is not False,
                heaven_earth,
            ),
            (
                old_pawn.THEME,
                old_pawn.VERSION,
                lambda terminal: old_pawn.candidate(trace) is not False,
                old_pawn,
            ),
            (
                final_move_mates.THEME,
                final_move_mates.VERSION,
                lambda terminal: terminal.checkmate,
                final_move_mates,
            ),
            (
                flanking_trio.THEME,
                flanking_trio.VERSION,
                lambda terminal: flanking_trio.candidate(trace) is not False,
                flanking_trio,
            ),
            *(
                (role.theme, role.version, role.candidate, role)
                for role in check_count.ASSESSORS
            ),
            (
                smothered_cannon.THEME,
                smothered_cannon.VERSION,
                lambda terminal: smothered_cannon.candidate(trace) is not False,
                smothered_cannon,
            ),
            (
                spring_horse.THEME,
                spring_horse.VERSION,
                spring_horse_candidate,
                spring_horse,
            ),
            (
                moon_scooping.THEME,
                moon_scooping.VERSION,
                lambda terminal: True,
                moon_scooping,
            ),
            *(
                (
                    role.theme,
                    role.version,
                    lambda terminal, role=role: role.candidate(trace) is not False,
                    role,
                )
                for role in throat_cutting.ASSESSORS
            ),
            *(
                (role.theme, role.version, role.candidate, role)
                for role in horse_roles.ASSESSORS
            ),
            (
                DOUBLE_CHARIOTS_THEME,
                DOUBLE_CHARIOTS_LOGIC_VERSION,
                double_chariots_candidate,
                double_chariots,
            ),
            (
                CENTROID_PAWN_THEME,
                CENTROID_PAWN_LOGIC_VERSION,
                centroid_pawn_candidate,
                centroid_pawn,
            ),
            (
                WHITE_FACED_GENERAL_THEME,
                WHITE_FACED_GENERAL_LOGIC_VERSION,
                white_faced_general_escape_positions,
                white_faced_general,
            ),
            *(
                (
                    role.theme,
                    role.version,
                    piece_type_mating_methods_candidate,
                    role,
                )
                for role in piece_type_mating_methods.ASSESSORS
            ),
        ):
            if (selected is not None and theme not in selected) or not geometry(
                terminal
            ):
                continue

            subject = (
                trace
                if theme
                in throat_cutting.THEMES
                | {
                    repatriation.THEME,
                    general_disrobing.THEME,
                    assisting_king.THEME,
                    three_immortals.THEME,
                    chariots_threatening_advisor.THEME,
                    moon_scooping.THEME,
                    spring_horse.THEME,
                    smothered_cannon.THEME,
                    flanking_trio.THEME,
                    final_move_mates.THEME,
                    old_pawn.THEME,
                    heaven_earth.THEME,
                    double_toast.THEME,
                    cannon_sandwich.THEME,
                }
                | pawn_mates.THEMES
                | piece_type_mating_methods.THEMES
                else terminal
            )
            row = connection.execute(
                """SELECT evidence_json FROM motif_removal_evidence
                   WHERE candidate_id=? AND canonical_assessment_id=? AND theme=?
                     AND theme_version=? AND branch_index=?""",
                (
                    current["candidate_id"],
                    verification_id,
                    theme,
                    version,
                    index,
                ),
            ).fetchone()
            try:
                record = json.loads(row[0]) if row else None
                outcome = assessor.evidence_outcome(subject, record)
            except (ValueError, TypeError):
                record, outcome = None, None
            if outcome is None and theme in check_count.THEMES:
                record, outcome = _shared_check_count_evidence(
                    connection, current, index, assessor, terminal
                )
            if outcome is None:
                if engine is None:
                    return "inconclusive", proofs
                cache_key = (
                    theme,
                    terminal.fen,
                    (
                        trace.moves
                        if theme
                        in throat_cutting.THEMES
                        | {
                            moon_scooping.THEME,
                            spring_horse.THEME,
                            smothered_cannon.THEME,
                            flanking_trio.THEME,
                            final_move_mates.THEME,
                            old_pawn.THEME,
                            heaven_earth.THEME,
                            double_toast.THEME,
                            cannon_sandwich.THEME,
                        }
                        | pawn_mates.THEMES
                        | piece_type_mating_methods.THEMES
                        else ()
                    ),
                )
                if cache_key not in terminal_cache:
                    terminal_cache[cache_key] = assessor.assess(engine, subject)
                record = terminal_cache[cache_key]
                outcome = assessor.evidence_outcome(subject, record)
            if outcome is None or record.get("outcome") == "inconclusive":
                return "inconclusive", proofs
            record["outcome"] = outcome
            evidence[theme] = [record]
            proofs[(theme, index)] = [record]
        themes = matching_assessed_themes(terminal, evidence, selected)
        themes.update(
            classifier.classify(
                trace, candidate_type="verified", selected_themes=selected
            ).themes
        )
        # A category belongs to the puzzle only when every verified branch
        # matches it. Overlapping motifs on one terminal board are valid.
        if terminal_category not in themes or (
            category == moon_scooping.THEME and WHITE_FACED_GENERAL_THEME not in themes
        ):
            return ("no_match" if index == 0 else "conflict"), proofs
    return "match", proofs


def _save_category(
    connection, current, category, versions, outcome, proofs, stop_event=None
):
    timestamp = datetime.now(UTC).isoformat()
    verification_id = current["current_verification_id"]
    begin_write(connection, stop_event)
    try:
        guard = connection.execute(
            "SELECT current_verification_id FROM candidates WHERE id=?",
            (current["candidate_id"],),
        ).fetchone()
        if guard is None or guard[0] != verification_id:
            connection.rollback()
            return False
        for (theme, index), records in proofs.items():
            # The terminal predicates currently select one role proof per branch.
            for record in records:
                connection.execute(
                    """INSERT INTO motif_removal_evidence(candidate_id,canonical_assessment_id,theme,theme_version,branch_index,evidence_json,created_at)
                    VALUES(?,?,?,?,?,?,?) ON CONFLICT(candidate_id,canonical_assessment_id,theme,theme_version,branch_index)
                    DO UPDATE SET evidence_json=excluded.evidence_json,created_at=excluded.created_at""",
                    (
                        current["candidate_id"],
                        verification_id,
                        theme,
                        versions[theme],
                        index,
                        _encoded(record),
                        timestamp,
                    ),
                )
        connection.execute(
            "INSERT INTO category_assessments(candidate_id,verification_assessment_id,category,category_version,consensus_version,outcome,attempted_at) "
            "VALUES(?,?,?,?,?,?,?) ON CONFLICT(candidate_id,verification_assessment_id,category,category_version,consensus_version) "
            "DO UPDATE SET outcome=excluded.outcome,attempted_at=excluded.attempted_at",
            (
                current["candidate_id"],
                verification_id,
                category,
                versions[category],
                versions["__consensus__"],
                outcome,
                timestamp,
            ),
        )
        # A forced same-version check must not leave an old snapshot authorizing
        # publication while its replacement is only partially complete.
        connection.execute(
            "UPDATE candidates SET current_classification_id=NULL WHERE id=?",
            (current["candidate_id"],),
        )
        connection.commit()
        return True
    except BaseException:
        connection.rollback()
        raise


def reclassify_canonical(
    connection: sqlite3.Connection,
    candidate_key: str,
    *,
    registry: MotifRegistry | None = None,
    expected_verification_assessment_id: int | None = None,
    selected_themes: set[str] | None = None,
    force: bool = False,
    engine: PuzzleEngine | None = None,
    removal_nodes: int | None = None,
    stop_event=None,
) -> TaxonomyResult:
    """Replace classification from current stored traces; never reconstruct a solve.

    Per-category results own freshness. Taxonomy snapshots are derived only
    when every current category has a conclusive result for this exact solution.
    """
    from .publication import apply_assessment

    connection.row_factory = sqlite3.Row
    current = connection.execute(
        """SELECT c.id AS candidate_id,c.current_verification_id,c.current_classification_id,
        a.solution_json,a.accepted,a.coverage,a.verification_settings_json,
        c.candidate_type,c.pre_fen,c.played_move,
        t.themes_json,t.taxonomy_version,t.verification_assessment_id AS classified_verification_id
        FROM candidates c JOIN candidate_assessments a ON a.id=c.current_verification_id AND a.candidate_id=c.id
        LEFT JOIN taxonomy_assessments t ON t.id=c.current_classification_id
        WHERE c.candidate_key=?""",
        (candidate_key,),
    ).fetchone()
    if current is None:
        return TaxonomyResult("awaiting_verifier")
    if current["coverage"] != "complete" or not current["accepted"]:
        return TaxonomyResult("awaiting_branch_verification")
    settings = json.loads(current["verification_settings_json"] or "{}")
    if settings.get("history_policy") != PUZZLE_HISTORY_POLICY:
        return TaxonomyResult("awaiting_verifier")
    verification_id = current["current_verification_id"]
    if (
        expected_verification_assessment_id is not None
        and verification_id != expected_verification_assessment_id
    ):
        return TaxonomyResult("stale_canonical")
    classifier = TacticalClassifier(registry)
    versions = taxonomy_versions(
        classifier.registry, candidate_type=current["candidate_type"]
    )
    from .category_status import saved_results, complete_results

    categories = {name for name in versions if not name.startswith("__")}
    if selected_themes is not None and selected_themes - categories:
        raise ValueError("unknown puzzle theme(s)")
    current = dict(current)
    results = saved_results(
        connection, current["candidate_id"], verification_id, versions
    )
    forced = (
        (selected_themes if selected_themes is not None else categories)
        if force
        else set()
    )
    pending = categories - complete_results(results) | forced
    if (
        not pending
        and current["classified_verification_id"] == verification_id
        and decode_taxonomy_versions(current["taxonomy_version"]) == versions
    ):
        return TaxonomyResult(
            "already_current",
            tuple(json.loads(current["themes_json"])),
            current["current_classification_id"],
        )
    if pending:
        current["branches_json"] = connection.execute(
            "SELECT branches_json FROM candidate_assessments WHERE id=?",
            (verification_id,),
        ).fetchone()[0]
        traces = _stored_traces(current["branches_json"])
        if traces is None:
            return TaxonomyResult("awaiting_verifier")
        for category in sorted(pending):
            outcome, proofs = _evaluate_category(
                connection, current, traces, classifier, category, engine, removal_nodes
            )
            if not _save_category(
                connection, current, category, versions, outcome, proofs, stop_event
            ):
                return TaxonomyResult("stale_canonical")
    begin_write(connection, stop_event)
    try:
        guard = connection.execute(
            "SELECT current_verification_id,current_classification_id FROM candidates WHERE id=?",
            (current["candidate_id"],),
        ).fetchone()
        if guard is None or guard[0] != verification_id:
            connection.rollback()
            return TaxonomyResult("stale_canonical")
        results = saved_results(
            connection, current["candidate_id"], verification_id, versions
        )
        if categories - complete_results(results):
            connection.rollback()
            return TaxonomyResult("awaiting_classification_evidence")
        targets = {name for name, outcome in results.items() if outcome == "match"}
        classification_status = (
            "classified"
            if targets
            else (
                "category_conflict"
                if "conflict" in results.values()
                else "uncategorized"
            )
        )
        tactic = current["candidate_type"] == "tactic_candidate"
        solution_plies = len(json.loads(current["solution_json"]))
        themes = (
            tuple(sorted(targets | (set() if tactic else mate_themes(solution_plies))))
            if targets
            else ()
        )
        if targets and not current["accepted"]:
            connection.rollback()
            return TaxonomyResult("awaiting_branch_verification")
        timestamp = datetime.now(UTC).isoformat()
        taxonomy_id = connection.execute(
            "INSERT INTO taxonomy_assessments(candidate_id,verification_assessment_id,taxonomy_version,status,themes_json,created_at) VALUES(?,?,?,?,?,?)",
            (
                current["candidate_id"],
                verification_id,
                encode_taxonomy_revision(versions),
                classification_status,
                _encoded(themes),
                timestamp,
            ),
        ).lastrowid
        apply_assessment(
            connection,
            current["candidate_id"],
            verification_id,
            taxonomy_id,
            eligible=bool(targets)
            or (not tactic and classification_status == "uncategorized"),
        )
        connection.execute(
            "UPDATE candidates SET themes_json=?,status=? WHERE id=?",
            (
                _encoded(themes),
                (
                    "published"
                    if targets
                    else (
                        "rejected"
                        if classification_status == "category_conflict"
                        else "untagged"
                    )
                ),
                current["candidate_id"],
            ),
        )
        connection.commit()
        return TaxonomyResult(
            classification_status,
            themes,
            taxonomy_id,
            set(themes) != set(json.loads(current["themes_json"] or "[]")),
        )
    except BaseException:
        connection.rollback()
        raise


def classify_solutions(
    connection,
    *,
    engine=None,
    nodes=None,
    force=False,
    partition=0,
    partitions=1,
    registry=None,
    published_only=None,
    stop_event=None,
    candidate_type="checkmate_candidate",
):
    """Streaming pass across all collection states, keyed by exact assessment."""
    if partitions < 1 or not 0 <= partition < partitions:
        raise ValueError("Invalid classification worker partition")
    counts = {}
    from .queue_priority import prepare_priority

    prepare_priority(connection)
    # Finish the live partition before walking unpublished candidates.
    for published in (1, 0) if published_only is None else (int(published_only),):
        last_id = 0
        while True:
            from .category_status import pool_cte

            query, params = pool_cte(
                taxonomy_versions(registry, candidate_type=candidate_type),
                candidate_type=candidate_type,
                after=last_id,
                partition=partition,
                partitions=partitions,
            )
            rows = connection.execute(
                query
                + """SELECT id,candidate_key,current_verification_id FROM category_pool p
                WHERE EXISTS(SELECT 1 FROM live_candidates live WHERE live.id=p.id)=?
                AND (? OR pending_checks>0 OR projection_current=0) ORDER BY id LIMIT 100""",
                (*params, published, force),
            ).fetchall()
            if not rows:
                break
            last_id = rows[-1]["id"]
            for row in rows:
                result = reclassify_canonical(
                    connection,
                    row["candidate_key"],
                    expected_verification_assessment_id=row["current_verification_id"],
                    registry=registry,
                    engine=engine,
                    removal_nodes=nodes,
                    force=force,
                    stop_event=stop_event,
                )
                counts[result.status] = counts.get(result.status, 0) + 1
    return counts
