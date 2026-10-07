"""Versioned verification requests and immutable solution evidence."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
import hashlib
import uuid

from .database_write import begin_write
from .workers import WorkerClaimLost
from .storage import ClaimedCandidate, _claimed_candidate, _json, now


# Assessment alias `a`. Complete coverage is the verifier's durable guarantee
# that every required branch is usable. Keep queue selection on small metadata;
# the classifier still validates the full ledger defensively after selection.
def ready_for_categorization_sql(*, inventory=False):
    solution = "a.has_solution=1" if inventory else "a.solution_json IS NOT NULL"
    branches = "a.has_branches=1" if inventory else "a.branches_json IS NOT NULL"
    history = (
        "a.history_policy"
        if inventory
        else "CASE WHEN json_valid(a.verification_settings_json) "
        "THEN json_extract(a.verification_settings_json,'$.history_policy') END"
    )
    return (
        "a.coverage='complete' AND a.accepted=1 AND a.solution_plies>0 "
        f"AND {solution} AND {branches} AND {history} = ?"
    )


READY_FOR_CATEGORIZATION_SQL = ready_for_categorization_sql()


DEFAULT_VERIFICATION_CANDIDATE_SQL = """NOT EXISTS (
    SELECT 1 FROM candidate_assessments a WHERE a.candidate_id=c.id
    AND (a.accepted=1 OR a.coverage='complete'
        OR (a.coverage='invalid' AND c.candidate_type!='checkmate_candidate')))
    AND NOT EXISTS (SELECT 1 FROM puzzles p WHERE p.candidate_id=c.id)"""


def verification_signature(config, engine):
    return hashlib.sha256(
        _json(
            {
                "settings": config.settings(),
                "engine": engine.engine_version,
                "nnue": engine.nnue,
            }
        ).encode()
    ).hexdigest()


def candidate_pool_sql(*, schema="main"):
    """Retained candidate work, excluding authoritative verification discards."""
    if schema not in {"main", "mining"}:
        raise ValueError("Invalid mining schema")
    return f"""SELECT c.* FROM {schema}.candidates c WHERE NOT EXISTS (
        SELECT 1 FROM {schema}.candidate_assessments a
        WHERE a.id=c.current_verification_id AND a.candidate_id=c.id
        AND a.coverage='invalid')"""


def verification_progress(
    connection, *, schema="main", candidate_type="checkmate_candidate"
):
    """Current queue attempts, including rejections, separate from saved solutions."""
    if schema not in {"main", "mining"}:
        raise ValueError("Invalid schema")
    guard = DEFAULT_VERIFICATION_CANDIDATE_SQL.replace(
        "FROM candidate_assessments", f"FROM {schema}.candidate_assessments"
    ).replace("FROM puzzles", f"FROM {schema}.puzzles")
    row = connection.execute(
        f"SELECT value FROM {schema}.metadata WHERE key=?",
        (f"verification_queue:{candidate_type}",),
    ).fetchone()
    signature = row[0] if row else ""
    statuses = dict(
        connection.execute(
            f"SELECT j.status,count(*) FROM {schema}.verification_jobs j "
            f"JOIN {schema}.candidates c ON c.id=j.candidate_id "
            "WHERE j.signature=? AND c.candidate_type=? AND j.status!='skipped' GROUP BY j.status",
            (signature, candidate_type),
        )
    )
    unqueued = connection.execute(
        f"SELECT count(*) FROM {schema}.candidates c WHERE c.candidate_type=? AND ({guard}) "
        f"AND NOT EXISTS(SELECT 1 FROM {schema}.verification_jobs j WHERE j.candidate_id=c.id AND j.signature=?)",
        (candidate_type, signature),
    ).fetchone()[0]
    finished = sum(
        statuses.get(s, 0) for s in ("complete", "invalid", "incomplete", "failed")
    )
    total = sum(statuses.values()) + unqueued
    return dict(
        work_total=total,
        finished=finished,
        remaining=total - finished,
        outcomes=statuses,
    )


def _skip_completed_requests(connection, signature):
    connection.execute(
        f"""UPDATE verification_jobs SET status='skipped',claim_token=NULL,
        claimed_at=NULL,next_attempt_at=NULL,diagnostic='previously_verified',updated_at=?
        WHERE signature=? AND status IN ('queued','retry') AND EXISTS (
            SELECT 1 FROM candidates c WHERE c.id=verification_jobs.candidate_id
            AND NOT ({DEFAULT_VERIFICATION_CANDIDATE_SQL}))""",
        (now(), signature),
    )


def seed_verification(
    connection,
    signature,
    *,
    reconstruct=False,
    force=False,
    candidate_type="checkmate_candidate",
):
    """Fill missing proofs, including old checkmate rejections under a new signature.

    Completed evidence remains protected. Old assessments are never overwritten.
    INSERT OR IGNORE keeps timeouts/rejections final for the same signature.
    """
    if candidate_type not in {
        "checkmate_candidate",
        "tactic_candidate",
    }:
        raise ValueError("Unknown verification candidate type")
    connection.execute("BEGIN IMMEDIATE")
    try:
        if force:
            if connection.execute(
                "SELECT 1 FROM verification_jobs j JOIN candidates c ON c.id=j.candidate_id WHERE j.status='processing' AND c.candidate_type=?",
                (candidate_type,),
            ).fetchone():
                raise ValueError(
                    "Stop verification workers before forcing reconstruction"
                )
            connection.execute(
                "DELETE FROM verification_jobs WHERE signature=?", (signature,)
            )
        if reconstruct or force:
            connection.execute(
                "UPDATE verification_jobs SET status='queued',diagnostic='',updated_at=? WHERE signature=? AND status='skipped'",
                (now(), signature),
            )
        else:
            _skip_completed_requests(connection, signature)
        guard = (
            ""
            if reconstruct or force
            else f"AND ({DEFAULT_VERIFICATION_CANDIDATE_SQL})"
        )
        cursor = connection.execute(
            f"""INSERT OR IGNORE INTO verification_jobs(candidate_id,signature,updated_at)
            SELECT c.id,?,? FROM candidates c WHERE c.candidate_type=? {guard}""",
            (signature, now(), candidate_type),
        )
        inserted = cursor.rowcount
        connection.execute(
            "INSERT OR REPLACE INTO metadata(key,value) VALUES(?,?)",
            (f"verification_queue:{candidate_type}", signature),
        )
        connection.commit()
        return inserted
    except Exception:
        connection.rollback()
        raise


@dataclass(frozen=True)
class VerificationClaim:
    id: int
    signature: str
    candidate: ClaimedCandidate
    previous_id: int | None


def claim_verification(
    connection, signature, *, lease_seconds=3600, reconstruct=False, stop_event=None
):
    from .queue_priority import prepare_priority

    prepare_priority(connection)
    stamp = now()
    cutoff = (datetime.now(UTC) - timedelta(seconds=lease_seconds)).isoformat()
    begin_write(connection, stop_event)
    try:
        connection.execute(
            "UPDATE verification_jobs SET status='retry',claim_token=NULL WHERE signature=? AND status='processing' AND claimed_at<?",
            (signature, cutoff),
        )
        # Preserve live-puzzle priority, then favor short discovered mates so
        # expensive branch trees cannot occupy every worker ahead of easy work.
        # Unknown imported scores remain eligible; ID is the stable tie-breaker.
        query = """SELECT j.id AS job_id,c.*,j.attempts AS job_attempts
            FROM verification_jobs j JOIN candidates c ON c.id=j.candidate_id
            WHERE j.signature=? AND j.status IN ('queued','retry')
            AND (j.next_attempt_at IS NULL OR j.next_attempt_at<=?)
            AND NOT EXISTS (SELECT 1 FROM verification_jobs busy WHERE busy.candidate_id=j.candidate_id AND busy.status='processing')
            {guard} {priority} ORDER BY
                CASE WHEN json_valid(c.after_score_json)
                    AND json_extract(c.after_score_json,'$.kind')='mate'
                    THEN abs(json_extract(c.after_score_json,'$.value'))
                    ELSE 1000000 END, j.id LIMIT 1"""
        row = connection.execute(
            query.format(
                guard=(
                    "" if reconstruct else f"AND ({DEFAULT_VERIFICATION_CANDIDATE_SQL})"
                ),
                priority="AND c.id IN (SELECT id FROM live_candidates)",
            ),
            (signature, stamp),
        ).fetchone()
        if row is None:
            row = connection.execute(
                query.format(
                    guard=(
                        ""
                        if reconstruct
                        else f"AND ({DEFAULT_VERIFICATION_CANDIDATE_SQL})"
                    ),
                    priority="",
                ),
                (signature, stamp),
            ).fetchone()
        if row is None:
            if not reconstruct:
                # Reconcile obsolete requests once the eligible queue is empty,
                # not on every worker claim while holding the writer lock.
                _skip_completed_requests(connection, signature)
            connection.commit()
            return None
        token = uuid.uuid4().hex
        connection.execute(
            "UPDATE verification_jobs SET status='processing',attempts=attempts+1,claim_token=?,claimed_at=?,updated_at=? WHERE id=?",
            (token, stamp, stamp, row["job_id"]),
        )
        connection.commit()
        return VerificationClaim(
            row["job_id"],
            signature,
            _claimed_candidate(row, token, attempts=row["job_attempts"] + 1),
            row["current_verification_id"],
        )
    except Exception:
        connection.rollback()
        raise


def finish_verification(
    connection, claim, config, engine, *, result=None, invalid=None, commit=True
):
    """Incomplete attempts are retained but never replace completed authority."""
    if (result is None) == (invalid is None):
        raise ValueError("Provide a solve result or a conclusive rejection")
    if (
        result is not None
        and result.complete
        and (result.uncertainty or not result.branches)
    ):
        raise ValueError("Complete verification requires uncapped solution evidence")
    candidate = claim.candidate
    coverage = "invalid" if invalid else "complete" if result.complete else "incomplete"
    branches = (
        [dict(verification=b.to_dict()) for b in result.branches] if result else []
    )
    solution = list(result.primary.moves) if result and result.branches else None
    diagnostic = invalid or _json(
        {
            "limits": list(result.uncertainty),
            "revisions": result.revisions,
            **({"metrics": result.metrics} if result.metrics else {}),
        }
    )
    if commit:
        begin_write(connection, getattr(engine, "cancel_event", None))
    elif not connection.in_transaction:
        raise RuntimeError("Batch verification requires an enclosing transaction")
    try:
        guard = connection.execute(
            "SELECT 1 FROM verification_jobs WHERE id=? AND status='processing' AND claim_token=?",
            (claim.id, candidate.claim_token),
        ).fetchone()
        current = connection.execute(
            "SELECT current_verification_id FROM candidates WHERE id=?", (candidate.id,)
        ).fetchone()
        if not guard:
            raise WorkerClaimLost("Verification claim lost")
        if not current or current[0] != claim.previous_id:
            raise RuntimeError("Verification evidence authority changed")
        assessment_id = connection.execute(
            """INSERT INTO candidate_assessments(
            candidate_id,revision_key,status,diagnostic,solution_json,solution_plies,branches_json,
            verified_engine_version,verified_nnue,verification_settings_json,engine_nodes,engine_depth,
            accepted,created_at,verification_version,verification_signature,coverage)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                candidate.id,
                candidate.revision_key,
                coverage,
                diagnostic,
                _json(solution) if solution else None,
                len(solution) if solution else None,
                _json(branches),
                engine.engine_version,
                engine.nnue,
                _json(config.settings()),
                result.nodes if result else 0,
                result.depth if result else 0,
                int(coverage == "complete"),
                now(),
                config.version,
                claim.signature,
                coverage,
            ),
        ).lastrowid
        if coverage in {"complete", "invalid"}:
            connection.execute(
                """UPDATE candidates SET current_verification_id=?,current_classification_id=NULL,
                solution_json=?,solution_plies=?,themes_json=NULL,verified_engine_version=?,verified_nnue=?,
                verification_settings_json=?,verifier_version=?,status=?,diagnostic=?,updated_at=? WHERE id=?""",
                (
                    assessment_id,
                    _json(solution) if solution else None,
                    len(solution) if solution else None,
                    engine.engine_version,
                    engine.nnue,
                    _json(config.settings()),
                    config.version,
                    "pending" if coverage == "complete" else "rejected",
                    diagnostic,
                    now(),
                    candidate.id,
                ),
            )
            if coverage == "invalid":
                connection.execute(
                    "UPDATE puzzles SET verification_status='withdrawn',retired_at=?,retirement_reason='verification invalid' WHERE candidate_id=? AND verification_status='active'",
                    (now(), candidate.id),
                )
        connection.execute(
            "UPDATE verification_jobs SET status=?,claim_token=NULL,claimed_at=NULL,diagnostic=?,updated_at=? WHERE id=?",
            (coverage, diagnostic, now(), claim.id),
        )
        if commit:
            connection.commit()
        return coverage, assessment_id
    except Exception:
        if commit:
            connection.rollback()
        raise


def fail_verification(
    connection, claim, diagnostic, *, inconclusive=False, max_attempts=3, stop_event=None
):
    status = (
        "incomplete"
        if inconclusive
        else "retry" if claim.candidate.attempts < max_attempts else "failed"
    )
    due = (
        (datetime.now(UTC) + timedelta(seconds=60)).isoformat()
        if status == "retry"
        else None
    )
    begin_write(connection, stop_event)
    try:
        cursor = connection.execute(
            """UPDATE verification_jobs SET status=?,diagnostic=?,claim_token=NULL,
            claimed_at=NULL,next_attempt_at=?,updated_at=? WHERE id=? AND claim_token=? AND status='processing' """,
            (status, diagnostic, due, now(), claim.id, claim.candidate.claim_token),
        )
        if cursor.rowcount != 1:
            raise WorkerClaimLost("Verification claim lost")
        connection.commit()
        return status
    except Exception:
        connection.rollback()
        raise


def release_verification(connection, claim):
    """An operator stop is resumable work, not an engine failure attempt."""
    connection.execute(
        """UPDATE verification_jobs SET status='queued',attempts=max(0,attempts-1),
        claim_token=NULL,claimed_at=NULL,next_attempt_at=NULL,diagnostic='cancelled',updated_at=?
        WHERE id=? AND status='processing' AND claim_token=?""",
        (now(), claim.id, claim.candidate.claim_token),
    )
    connection.commit()
