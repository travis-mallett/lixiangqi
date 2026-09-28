"""Canonical category-result storage and the shared categorizer input projection."""

import json

from .position import PUZZLE_HISTORY_POLICY
from .verification_store import ready_for_categorization_sql

CATEGORY_SCHEMA = """CREATE TABLE IF NOT EXISTS category_assessments (
    candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    verification_assessment_id INTEGER NOT NULL REFERENCES candidate_assessments(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    category_version TEXT NOT NULL,
    consensus_version TEXT NOT NULL,
    outcome TEXT NOT NULL CHECK(outcome IN ('match','no_match','conflict','inconclusive')),
    attempted_at TEXT NOT NULL,
    PRIMARY KEY(candidate_id,verification_assessment_id,category,category_version,consensus_version)
);"""


def saved_results(connection, candidate_id, verification_id, versions):
    return {
        row[0]: row[2]
        for row in connection.execute(
            "SELECT category,category_version,outcome FROM category_assessments "
            "WHERE candidate_id=? AND verification_assessment_id=? AND consensus_version=?",
            (candidate_id, verification_id, versions["__consensus__"]),
        )
        if versions.get(row[0]) == row[1]
    }


def complete_results(results):
    return {name for name, outcome in results.items() if outcome != "inconclusive"}


def pool_cte(
    versions,
    *,
    schema="main",
    candidate_type="checkmate_candidate",
    after=-1,
    partition=0,
    partitions=1,
):
    """One eligibility/freshness definition for workers and Studio, using small fields.

    Each row is a retained verified solution, whether categorized, uncategorized,
    published, or withdrawn. A result is reusable only for this solution and logic.
    """
    if schema not in {"main", "mining"}:
        raise ValueError("Invalid mining schema")
    raw = json.dumps(versions, sort_keys=True, separators=(",", ":"))
    return (
        f"""WITH logic AS MATERIALIZED (SELECT key category,value version FROM json_each(?) WHERE substr(key,1,2)!='__'),
        eligible AS MATERIALIZED (
            SELECT c.id,c.candidate_key,c.current_verification_id,c.current_classification_id,
                CASE WHEN t.verification_assessment_id=c.current_verification_id
                    AND t.versions=? THEN 1 ELSE 0 END projection_current
            FROM {schema}.candidate_inventory c JOIN {schema}.assessment_inventory a
                ON a.id=c.current_verification_id AND a.candidate_id=c.id
            LEFT JOIN {schema}.taxonomy_inventory t ON t.id=c.current_classification_id
            WHERE c.candidate_type=? AND {ready_for_categorization_sql(inventory=True)}
                AND c.id>? AND c.id % ? = ?
        ), checks AS (
            SELECT e.id,
                coalesce(sum(r.outcome IN ('match','no_match','conflict')),0) completed_checks,
                coalesce(sum(r.outcome='inconclusive'),0) inconclusive_checks,
                coalesce(sum(r.outcome='match'),0) matches
            FROM eligible e CROSS JOIN logic l
            LEFT JOIN {schema}.category_assessments r ON r.candidate_id=e.id
                AND r.verification_assessment_id=e.current_verification_id
                AND r.consensus_version=?
                AND r.category=l.category AND r.category_version=l.version
            GROUP BY e.id
        ), category_pool AS (
            SELECT e.*,(SELECT count(*) FROM logic) total_checks,coalesce(k.completed_checks,0) completed_checks,
                coalesce(k.inconclusive_checks,0) inconclusive_checks,coalesce(k.matches,0) matches,
                (SELECT count(*) FROM logic)-coalesce(k.completed_checks,0) pending_checks
            FROM eligible e LEFT JOIN checks k ON k.id=e.id
        ) """,
        (
            raw,
            raw,
            candidate_type,
            PUZZLE_HISTORY_POLICY,
            after,
            partitions,
            partition,
            versions["__consensus__"],
        ),
    )


def pool_counts(
    connection, versions, *, schema="main", candidate_type="checkmate_candidate"
):
    query, args = pool_cte(versions, schema=schema, candidate_type=candidate_type)
    row = connection.execute(
        query + """SELECT count(*) pool,
        coalesce(sum(pending_checks=0 AND projection_current=1),0) current,
        coalesce(sum(pending_checks>0 OR projection_current=0),0) needs_checks,
        coalesce(sum(pending_checks=0 AND projection_current=1 AND matches>0),0) matched,
        coalesce(sum(pending_checks=0 AND projection_current=1 AND matches=0),0) unmatched,
        coalesce(sum(total_checks),0) total_checks,
        coalesce(sum(completed_checks),0) completed_checks,
        coalesce(sum(pending_checks),0) pending_checks,
        coalesce(sum(inconclusive_checks),0) inconclusive_checks FROM category_pool""",
        args,
    ).fetchone()
    return dict(
        zip(
            (
                "pool",
                "current",
                "needs_checks",
                "matched",
                "unmatched",
                "total_checks",
                "completed_checks",
                "pending_checks",
                "inconclusive_checks",
            ),
            row,
        )
    )
