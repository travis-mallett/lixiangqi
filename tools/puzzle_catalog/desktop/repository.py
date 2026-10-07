"""Paged read-only views of mining/content, with a separate operator audit ledger."""

from __future__ import annotations
from contextlib import contextmanager, closing
from datetime import datetime, UTC
import json
from pathlib import Path
import sqlite3
import threading

from .queries import attach as attach_cancellation

from ..catalog import PuzzleCatalog, _json
from ..authoring import admit_candidate
from tools.xiangqi_data.puzzle_mining.discovery import DISCOVERY_VERSION


class ContentRepository:
    LIBRARY_STATUSES = (
        "unpublished",
        "published",
        "retired",
        "uncategorized_checkmate",
        "single_solution_uncategorized_checkmate",
        "uncategorized_tactic",
    )
    STATUSES = [
        "unpublished",
        "awaiting_verification",
        "awaiting_classification",
        "uncategorized",
        "published",
        "pending_retirement",
        "retired",
        "rejected",
        "review",
        "pending",
        "processing",
        "retry",
        "failed",
        "withdrawn",
    ]

    def __init__(self, catalog_path: Path, mining_path: Path, state_dir: Path):
        self.catalog_path, self.mining_path = Path(catalog_path), Path(mining_path)
        self._watch_lock = threading.Lock()
        self._watchers = {}
        self._cached = {}
        state_dir = Path(state_dir)
        state_dir.mkdir(parents=True, exist_ok=True)
        self.audit_path = state_dir / "moderation.sqlite3"
        with closing(sqlite3.connect(self.audit_path)) as db, db:
            db.executescript("""PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS moderation(id INTEGER PRIMARY KEY,puzzle_key TEXT NOT NULL,action TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS review_state(key TEXT PRIMARY KEY,action TEXT NOT NULL,reason TEXT NOT NULL,updated_at TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS moderation_key ON moderation(puzzle_key,id);
            DROP TABLE IF EXISTS published_inventory;
            DROP TABLE IF EXISTS projection_metadata;""")

    @contextmanager
    def _db(self):
        db = sqlite3.connect(":memory:", uri=True, timeout=2)
        db.row_factory = sqlite3.Row
        attach_cancellation(db)
        try:
            for schema, path in [
                ("authored", self.catalog_path),
                ("mining", self.mining_path),
                ("review", self.audit_path),
            ]:
                db.execute(
                    f"ATTACH DATABASE ? AS {schema}",
                    (
                        (
                            path.resolve().as_uri() + "?mode=ro"
                            if path.is_file()
                            else ":memory:"
                        ),
                    ),
                )
            if not self.catalog_path.is_file():
                db.executescript(
                    """CREATE TABLE authored.catalog_puzzles(id TEXT,document TEXT,evidence TEXT);
                CREATE TABLE authored.catalog_metadata(key TEXT,value TEXT);
                CREATE TABLE authored.catalog_releases(id TEXT,document TEXT);
                CREATE TABLE authored.catalog_assessments(id INTEGER,puzzle_id TEXT,theme TEXT,result TEXT);"""
                )
                from ..inventory import install

                install(db, schema="authored")
            if not self.mining_path.is_file():
                db.executescript(
                    """CREATE TABLE mining.puzzles(id TEXT,candidate_id INTEGER,game_id TEXT,fen TEXT,line TEXT,themes TEXT,solution_plies INTEGER,mate_in INTEGER,created_at TEXT,verification_status TEXT);
                CREATE TABLE mining.candidates(id INTEGER,candidate_key TEXT,game_id TEXT,source_database TEXT,pre_fen TEXT,played_move TEXT,solution_json TEXT,themes_json TEXT,status TEXT,diagnostic TEXT,updated_at TEXT,candidate_type TEXT,current_verification_id INTEGER,current_classification_id INTEGER);
                CREATE TABLE mining.candidate_assessments(id INTEGER,candidate_id INTEGER,coverage TEXT,
                    accepted INTEGER,solution_plies INTEGER,solution_json TEXT,
                    branches_json TEXT,verification_settings_json TEXT);
                CREATE TABLE mining.taxonomy_assessments(id INTEGER,verification_assessment_id INTEGER,taxonomy_version TEXT,status TEXT);
                CREATE TABLE mining.game_jobs(status TEXT,discovery_version TEXT);
                CREATE TABLE mining.verification_jobs(status TEXT,candidate_id INTEGER,signature TEXT);
                CREATE TABLE mining.category_assessments(candidate_id INTEGER,verification_assessment_id INTEGER,category TEXT,category_version TEXT,consensus_version TEXT,outcome TEXT,attempted_at TEXT);
                CREATE TABLE mining.metadata(key TEXT,value TEXT);"""
                )
                from tools.xiangqi_data.puzzle_mining.inventory import install

                install(db, schema="mining")
            db.execute("PRAGMA query_only=ON")
            # One short snapshot keeps page counts and rows consistent. No read
            # transaction survives the request or holds up WAL checkpoints.
            db.execute("BEGIN")
            yield db
        finally:
            db.close()

    def revision(self):
        """SQLite commit versions, using idle connections with no read transaction.

        Opening a fresh connection for data_version on every poll cannot detect
        changes. Retain these tiny observers, but never their read snapshots.
        """
        with self._watch_lock:
            result = []
            for path in (self.catalog_path, self.mining_path, self.audit_path):
                if not path.is_file():
                    result.append(None)
                    old = self._watchers.pop(path, None)
                    if old:
                        old[1].close()
                    continue
                stat = path.stat()
                identity = (stat.st_dev, stat.st_ino)
                old = self._watchers.get(path)
                if not old or old[0] != identity:
                    if old:
                        old[1].close()
                    observer = sqlite3.connect(
                        path.resolve().as_uri() + "?mode=ro",
                        uri=True,
                        timeout=0.1,
                        check_same_thread=False,
                    )
                    self._watchers[path] = (identity, observer)
                observer = self._watchers[path][1]
                result.append(
                    (identity, observer.execute("PRAGMA data_version").fetchone()[0])
                )
            return tuple(result)

    def cached(self, key, read):
        revision = self.revision()
        with self._watch_lock:
            previous = self._cached.get(key)
            if previous and previous[0] == revision:
                return previous[1]
        value = read()
        with self._watch_lock:
            if len(self._cached) >= 32:
                self._cached.clear()
            self._cached[key] = (revision, value)
        return value

    def close(self):
        with self._watch_lock:
            for _, connection in self._watchers.values():
                connection.close()
            self._watchers.clear()
            self._cached.clear()

    @staticmethod
    def _candidate_pool():
        return """SELECT c.* FROM mining.candidate_inventory c WHERE NOT EXISTS (
            SELECT 1 FROM mining.assessment_inventory a
            WHERE a.id=c.current_verification_id AND a.candidate_id=c.id AND a.coverage='invalid')"""

    def _cte(self, *, library=False, key=None, theme=""):
        from tools.xiangqi_data.puzzle_mining.classification_job import (
            taxonomy_versions,
        )
        from ..publication import OFFICIAL_THEMES
        from tools.xiangqi_data.puzzle_mining.position import PUZZLE_HISTORY_POLICY
        from tools.xiangqi_data.puzzle_mining.verification_store import (
            ready_for_categorization_sql,
        )

        verified = ready_for_categorization_sql(inventory=True).replace(
            "?", "'" + PUZZLE_HISTORY_POLICY.replace("'", "''") + "'"
        )

        versions = _json(taxonomy_versions()).replace("'", "''")
        tactic_versions = _json(
            taxonomy_versions(candidate_type="tactic_candidate")
        ).replace("'", "''")
        themes = _json(sorted(OFFICIAL_THEMES)).replace("'", "''")
        # Candidate work is never visible in the library. Exclude that branch
        # before query planning, rather than discarding thousands of rows later.
        candidate_branch = (
            ""
            if library
            else """UNION ALL
          SELECT 'candidate:'||c.id,'candidate:'||c.id,c.game_id,c.pre_fen,json_array(c.played_move),COALESCE(c.themes_json,'[]'),0,'candidate','candidate:'||c.id,c.updated_at,0,c.source_database,
            CASE WHEN c.status IN ('untagged','published') THEN 'review' ELSE c.status END,0,0,'',1
          FROM candidate_pool c WHERE NOT EXISTS(SELECT 1 FROM mining.puzzles p WHERE p.candidate_id=c.id)
            __CANDIDATE_KEY__ __CANDIDATE_THEME__
        """
        )
        return (
            """WITH candidate_pool AS (__CANDIDATE_POOL__), live AS (
          SELECT id,document FROM authored.published_inventory
        ), base AS (
          SELECT a.id key,a.id id,a.game_id,a.fen,a.line,a.themes,a.retired,'authored' kind,
            COALESCE('candidate:'||p.candidate_id,a.id) review_key,
            COALESCE(p.created_at,'') updated,0 mate_in,
            a.source,
            CASE WHEN a.retired=1 THEN CASE WHEN json_extract(l.document,'$.retired')=0 THEN 'pending_retirement' ELSE 'retired' END
                 WHEN a.evidence_status='unresolved' THEN 'review'
                 WHEN l.id IS NOT NULL THEN 'published' WHEN p.verification_status='withdrawn' THEN 'withdrawn' ELSE 'unpublished' END raw_status,
            CASE WHEN l.id IS NOT NULL THEN 1 ELSE 0 END published,
            CASE WHEN l.id IS NOT NULL AND (a.themes!=json_extract(l.document,'$.themes') OR a.retired!=json_extract(l.document,'$.retired')) THEN 1 ELSE 0 END changed,
            '' diagnostic,a.line_length
          FROM authored.catalog_inventory a LEFT JOIN live l ON l.id=a.id LEFT JOIN mining.puzzle_inventory p ON p.id=a.id WHERE 1=1 __AUTHORED_KEY__ __AUTHORED_THEME__
          UNION ALL
          SELECT p.id,p.id,p.game_id,p.fen,p.line,p.themes,0,'mined','candidate:'||c.id,p.created_at,COALESCE(p.mate_in,0),c.source_database,
            CASE WHEN p.verification_status='active' THEN 'unpublished' ELSE 'withdrawn' END,0,0,'',p.solution_plies+1
          FROM mining.puzzle_inventory p JOIN mining.candidate_inventory c ON c.id=p.candidate_id WHERE NOT EXISTS(SELECT 1 FROM authored.catalog_inventory a WHERE a.id=p.id) __MINED_KEY__ __MINED_THEME__
          __CANDIDATE_BRANCH__
        ), readiness AS (
          SELECT b.*,a.id AS verification_assessment_id,CASE
            WHEN b.raw_status!='unpublished' THEN b.raw_status
            WHEN c.id IS NOT NULL AND (a.id IS NULL OR a.coverage!='complete') THEN 'awaiting_verification'
            WHEN c.id IS NOT NULL AND (t.id IS NULL OR t.verification_assessment_id IS NOT c.current_verification_id
                OR t.versions IS NOT CASE WHEN c.candidate_type='tactic_candidate' THEN '__TACTIC_VERSIONS__' ELSE '__VERSIONS__' END) THEN 'awaiting_classification'
            WHEN c.id IS NOT NULL AND t.status='category_conflict' THEN 'review'
            WHEN NOT EXISTS(SELECT 1 FROM json_each(b.themes) theme
                WHERE theme.value IN (SELECT value FROM json_each('__THEMES__'))) THEN 'uncategorized'
            ELSE 'unpublished' END pipeline_status,
            CASE WHEN __VERIFIED__ AND NOT EXISTS (
                SELECT 1 FROM json_each(b.themes) theme
                WHERE theme.value IN (SELECT value FROM json_each('__THEMES__')))
              THEN CASE c.candidate_type WHEN 'checkmate_candidate' THEN 'uncategorized_checkmate'
                WHEN 'tactic_candidate' THEN 'uncategorized_tactic' END END uncategorized_pool
          FROM base b LEFT JOIN mining.candidate_inventory c ON c.id=CASE WHEN b.review_key LIKE 'candidate:%' THEN CAST(substr(b.review_key,11) AS INTEGER) END
          LEFT JOIN mining.assessment_inventory a ON a.id=c.current_verification_id AND a.candidate_id=c.id
          LEFT JOIN mining.taxonomy_inventory t ON t.id=c.current_classification_id
        ), items AS (
          SELECT b.*,json_object('_id',b.id,'gameId',b.game_id,'fen',b.fen,
            'line',CASE WHEN b.kind='authored' THEN b.line ELSE json(b.line) END,
            'themes',json(b.themes),'retired',json(CASE WHEN b.retired=1 THEN 'true' ELSE 'false' END)) document,
            '{}' evidence,CASE WHEN b.kind!='authored' AND r.action='reject' THEN 'rejected' ELSE b.pipeline_status END status,
            (SELECT json_extract(document,'$.retired') FROM live WHERE id=b.id) live_retired,COALESCE(r.action,'') moderation_action,COALESCE(r.reason,'') moderation_reason
          FROM readiness b LEFT JOIN review.review_state r ON r.key=b.review_key
        ) """.replace("__VERSIONS__", versions)
            .replace("__VERIFIED__", verified)
            .replace("__TACTIC_VERSIONS__", tactic_versions)
            .replace("__THEMES__", themes)
            .replace("__CANDIDATE_POOL__", self._candidate_pool())
            .replace("__CANDIDATE_BRANCH__", candidate_branch)
            .replace(
                "__AUTHORED_KEY__", "AND a.id=:item_key" if key is not None else ""
            )
            .replace("__MINED_KEY__", "AND p.id=:item_key" if key is not None else "")
            .replace(
                "__CANDIDATE_KEY__", "AND c.id=:candidate_id" if key is not None else ""
            )
            .replace(
                "__AUTHORED_THEME__",
                (
                    "AND a.id IN (SELECT puzzle_id FROM authored.inventory_themes WHERE theme=:theme)"
                    if theme
                    else ""
                ),
            )
            .replace(
                "__MINED_THEME__",
                (
                    "AND p.id IN (SELECT puzzle_id FROM mining.inventory_themes WHERE theme=:theme)"
                    if theme
                    else ""
                ),
            )
            .replace(
                "__CANDIDATE_THEME__",
                (
                    "AND EXISTS (SELECT 1 FROM json_each(c.themes_json) WHERE value=:theme)"
                    if theme
                    else ""
                ),
            )
        )

    @staticmethod
    def _row(r):
        p = json.loads(r["document"])
        return dict(
            key=r["key"],
            id=r["id"],
            status=r["status"],
            pool=(
                ("retired" if r["live_retired"] else "published")
                if r["published"]
                else "unpublished"
            ),
            changes=(
                (
                    "Withdraw"
                    if p.get("retired")
                    else "Restore" if r["live_retired"] else "Tags edited"
                )
                if r["changed"]
                else ""
            ),
            themes=p.get("themes", []),
            gameId=p.get("gameId"),
            fen=p.get("fen"),
            line=p.get("line", []),
            source=r["source"],
            kind=r["kind"],
            review_key=r["review_key"],
            published=bool(r["published"]),
            changed=bool(r["changed"]),
            updated=r["updated"],
            mate_in=r["mate_in"],
            diagnostic=r["diagnostic"],
            evidence=json.loads(r["evidence"]),
            document=p,
            moderation={
                "action": r["moderation_action"],
                "reason": r["moderation_reason"],
            },
        )

    @staticmethod
    def _filter(query, status, theme, source):
        clauses = []
        args = {}
        if query:
            clauses.append(
                "(instr(lower(id),lower(:query))>0 OR instr(lower(game_id),lower(:query))>0)"
            )
            args["query"] = query
        if status != "all":
            clauses.append("status=:status")
            args["status"] = status
        if theme:
            args["theme"] = theme
        if source:
            clauses.append("source=:source")
            args["source"] = source
        return (" WHERE " + " AND ".join(clauses) if clauses else ""), args

    def page(
        self,
        query="",
        status="all",
        theme="",
        source="",
        sort="updated",
        offset=0,
        limit=100,
        library=False,
    ):
        pool_status = status
        where, args = self._filter(query, "all" if library else status, theme, source)
        if library:
            if pool_status in {
                "uncategorized_checkmate",
                "uncategorized_tactic",
                "single_solution_uncategorized_checkmate",
            }:
                where += (
                    " AND " if where else " WHERE "
                ) + "uncategorized_pool=:pool_status"
                args["pool_status"] = (
                    "uncategorized_checkmate"
                    if pool_status == "single_solution_uncategorized_checkmate"
                    else pool_status
                )
                if pool_status == "single_solution_uncategorized_checkmate":
                    where += """ AND EXISTS (
                        SELECT 1 FROM mining.candidate_assessments single_solution
                        WHERE single_solution.id=verification_assessment_id
                          AND CASE WHEN json_valid(single_solution.branches_json)
                            THEN json_type(single_solution.branches_json)='array'
                              AND json_array_length(single_solution.branches_json)=1
                            ELSE 0 END
                    )"""
            elif pool_status != "all":
                where += (
                    (" AND " if where else " WHERE ")
                    + "CASE WHEN published=1 THEN CASE WHEN live_retired=1 THEN 'retired' ELSE 'published' END ELSE coalesce(uncategorized_pool,'unpublished') END=:pool_status"
                )
                args["pool_status"] = pool_status
        if library:
            visible = "(published=1 OR status='unpublished' OR (uncategorized_pool IS NOT NULL AND status!='rejected'))"
            where += (" AND " if where else " WHERE ") + visible
        ordering = {
            "updated": "updated DESC,key",
            "id": "id",
            "source": "source,key",
            "length": "line_length DESC,key",
        }.get(sort, "updated DESC,key")
        with self._db() as db:
            total = db.execute(
                self._cte(library=library, theme=theme)
                + "SELECT count(*) FROM items"
                + where,
                args,
            ).fetchone()[0]
            rows = db.execute(
                self._cte(library=library, theme=theme)
                + "SELECT * FROM items"
                + where
                + " ORDER BY "
                + ordering
                + " LIMIT :limit OFFSET :offset",
                {**args, "limit": max(1, min(500, limit)), "offset": max(0, offset)},
            ).fetchall()
            result = [self._row(r) for r in rows]
            if library:
                for item, row in zip(result, rows):
                    item["status"] = (
                        ("retired" if row["live_retired"] else "published")
                        if item["published"]
                        else row["uncategorized_pool"] or "unpublished"
                    )
                    item["pool"] = item["status"]
            return {"rows": result, "total": total}

    def matching_keys(self, query="", status="all", theme="", source="", **_):
        # Freeze only identifiers for a bulk operation; never materialize every board.
        where, args = self._filter(query, status, theme, source)
        with self._db() as db:
            return [
                r[0]
                for r in db.execute(
                    self._cte(theme=theme)
                    + "SELECT key FROM items"
                    + where
                    + " ORDER BY key",
                    args,
                )
            ]

    def detail(self, key):
        with self._db() as db:
            candidate_id = (
                int(key[10:])
                if key.startswith("candidate:") and key[10:].isdigit()
                else -1
            )
            r = db.execute(
                self._cte(key=key) + "SELECT * FROM items WHERE key=:item_key",
                {"item_key": key, "candidate_id": candidate_id},
            ).fetchone()
            if r:
                r = dict(r)
                if r["kind"] == "authored":
                    full = db.execute(
                        "SELECT document,evidence FROM authored.catalog_puzzles WHERE id=?",
                        (key,),
                    ).fetchone()
                    r.update(document=full[0], evidence=full[1])
                    r["diagnostic"] = json.loads(full[0]).get("retirementReason") or ""
                else:
                    candidate = int(r["review_key"][10:])
                    r["diagnostic"] = db.execute(
                        "SELECT diagnostic FROM mining.candidates WHERE id=?",
                        (candidate,),
                    ).fetchone()[0]
            result = self._row(r) if r else None
            if result:
                result["audit"] = [
                    dict(x)
                    for x in db.execute(
                        "SELECT action,reason,created_at FROM review.moderation WHERE puzzle_key=? ORDER BY id DESC LIMIT 30",
                        (result["review_key"],),
                    )
                ]
            return result

    def facets(self):
        with self._db() as db:
            themes = [
                r[0]
                for r in db.execute(
                    "SELECT theme FROM authored.inventory_themes UNION SELECT theme FROM mining.inventory_themes ORDER BY theme"
                )
            ]
            sources = [
                r[0]
                for r in db.execute(
                    "SELECT source FROM authored.catalog_inventory WHERE source!='' "
                    "UNION SELECT source_database FROM mining.candidate_inventory WHERE source_database!='' ORDER BY 1"
                )
            ]
        return {"themes": themes, "sources": sources, "statuses": self.STATUSES}

    def stats(self):
        with self._db() as db:
            statuses = dict(
                db.execute(
                    self._cte() + "SELECT status,count(*) FROM items GROUP BY status"
                )
            )
            live = dict(
                db.execute(
                    self._cte()
                    + "SELECT COALESCE(json_extract(document,'$.retired'),0),count(*) FROM live GROUP BY 1"
                )
            )
            jobs = dict(
                db.execute(
                    """SELECT status,count(*) FROM mining.game_jobs
                    WHERE discovery_version = ? GROUP BY status""",
                    (DISCOVERY_VERSION,),
                )
            )
            candidate_counts = db.execute(
                f"SELECT candidate_type,status,count(*) FROM ({self._candidate_pool()}) GROUP BY candidate_type,status"
            ).fetchall()
            candidates = {
                row[1]: row[2]
                for row in candidate_counts
                if row[0] == "checkmate_candidate"
            }
            all_candidates = sum(row[2] for row in candidate_counts)
            from tools.xiangqi_data.puzzle_mining.classification_job import (
                taxonomy_versions,
            )

            from tools.xiangqi_data.puzzle_mining.category_status import pool_counts

            category = pool_counts(db, taxonomy_versions(), schema="mining")
            tactic_category = pool_counts(
                db,
                taxonomy_versions(candidate_type="tactic_candidate"),
                schema="mining",
                candidate_type="tactic_candidate",
            )
            tactic_candidates = sum(
                row[2] for row in candidate_counts if row[0] == "tactic_candidate"
            )
            complete_saved = db.execute(
                "SELECT count(*) FROM mining.candidate_inventory c JOIN mining.assessment_inventory a ON a.id=c.current_verification_id "
                "WHERE c.candidate_type='checkmate_candidate' AND a.coverage='complete'"
            ).fetchone()[0]
            verified, awaiting = category["pool"], category["needs_checks"]
            from tools.xiangqi_data.puzzle_mining.verification_store import (
                verification_progress,
            )

            verification_work = verification_progress(db, schema="mining")
            categorized = statuses.get("unpublished", 0)
            total = db.execute(
                "SELECT count(*) FROM authored.catalog_puzzles"
            ).fetchone()[0]
            return {
                "category": category,
                "tactic_category": tactic_category,
                "tactic_verification": {
                    "candidates": tactic_candidates,
                    "eligible": tactic_category["pool"],
                },
                "verification": {
                    **verification_work,
                    "candidates": sum(candidates.values()),
                    "eligible": verified,
                    "older_proofs": complete_saved - verified,
                },
                "pipeline": {
                    "candidates": all_candidates,
                    "verified": verified + tactic_category["pool"],
                    "awaiting_category": awaiting + tactic_category["needs_checks"],
                    "categorized": categorized,
                    "published": live.get(0, 0),
                },
                "total": total,
                "published": live.get(0, 0),
                "published_retired": live.get(1, 0),
                "statuses": statuses,
                "mining": {
                    "candidates": all_candidates,
                    "awaiting_tactic_verifier": tactic_candidates
                    - tactic_category["pool"],
                    "pending": sum(
                        candidates.get(x, 0) for x in ("pending", "processing", "retry")
                    ),
                    "jobs": sum(jobs.values()),
                    "job_statuses": jobs,
                    "candidate_statuses": candidates,
                    "verification_statuses": dict(
                        db.execute(
                            "SELECT status,count(*) FROM mining.verification_jobs GROUP BY status"
                        )
                    ),
                },
            }

    def publication(self):
        with self._db() as db:
            meta = {
                r[0]: json.loads(r[1])
                for r in db.execute(
                    "SELECT key,value FROM authored.catalog_metadata WHERE key IN ('deployedReleaseId','snapshotId','baselineDigest')"
                )
            }
            return meta

    def admit_ready(
        self, source_catalog, progress=None, *, include_uncategorized=False
    ):
        """Internally admit ready output before publication.

        Selection uses the same durable moderation ledger as the library. The
        domain admission checks remain authoritative; any failure blocks publication.
        Successful admissions are retained so an interrupted run can be resumed.
        """
        from ..publication import officially_categorized
        from ..authoring import reconcile_assessments

        with PuzzleCatalog(self.catalog_path) as catalog:
            reconcile_assessments(catalog, self.mining_path)

        with self._db() as db:
            keys = [
                row[0]
                for row in db.execute(
                    self._cte()
                    + "SELECT key,document FROM items WHERE kind='mined' AND status IN ('unpublished','uncategorized') ORDER BY key"
                )
                if include_uncategorized or officially_categorized(json.loads(row[1]))
            ]
        if progress:
            progress(0, len(keys))
        with PuzzleCatalog(self.catalog_path) as catalog:
            for index, key in enumerate(keys, 1):
                try:
                    admit_candidate(catalog, self.mining_path, key, source_catalog)
                except (ValueError, sqlite3.Error) as exc:
                    raise ValueError(
                        f"Cannot include puzzle {key}: {exc}. Publication was not started."
                    ) from exc
                if progress and (index % 25 == 0 or index == len(keys)):
                    progress(index, len(keys))
        return len(keys)

    def moderate(self, keys, action, reason="", source_catalog=None):
        if action not in {"reject", "retire", "restore", "tags"}:
            raise ValueError("Unknown library action")
        outcomes = []
        for key in dict.fromkeys(keys):
            try:
                item = self.detail(key)
                if not item:
                    raise ValueError("Puzzle no longer exists")
                if action == "reject" and item["published"]:
                    raise ValueError("Use Withdraw for published puzzles")
                if action in {"retire", "restore"} and not item["published"]:
                    raise ValueError(
                        "This action requires a published or retired puzzle"
                    )
                if action == "tags":
                    from ..publication import EDITABLE_THEMES

                    tags = json.loads(reason)
                    if (
                        not isinstance(tags, list)
                        or not tags
                        or any(
                            not isinstance(t, str)
                            or t not in EDITABLE_THEMES | set(item["themes"])
                            for t in tags
                        )
                        or len(set(tags)) != len(tags)
                    ):
                        raise ValueError("Choose at least one supported category")
                    if item["kind"] != "authored":
                        if item["status"] != "unpublished":
                            raise ValueError("Only ready puzzles can be edited")
                        with PuzzleCatalog(self.catalog_path) as c:
                            admit_candidate(c, self.mining_path, key, source_catalog)
                        item = self.detail(key)
                if item["kind"] == "authored":
                    with PuzzleCatalog(self.catalog_path) as c, c.db:
                        c.db.execute("BEGIN IMMEDIATE")
                        row = c.db.execute(
                            "SELECT document FROM catalog_puzzles WHERE id=?", (key,)
                        ).fetchone()
                        if not row or json.loads(row[0]) != item["document"]:
                            raise ValueError("Puzzle changed; refresh and retry")
                        document = json.loads(row[0])
                        if action == "tags":
                            document["themes"] = sorted(tags)
                        else:
                            document.update(
                                retired=action != "restore",
                                retirementReason=(
                                    (reason or "Withdrawn by operator")
                                    if action != "restore"
                                    else None
                                ),
                            )
                        c.db.execute(
                            "UPDATE catalog_puzzles SET document=? WHERE id=?",
                            (_json(document), key),
                        )
                stamp = datetime.now(UTC).isoformat()
                with closing(sqlite3.connect(self.audit_path)) as db, db:
                    db.execute(
                        "INSERT INTO moderation(puzzle_key,action,reason,created_at) VALUES(?,?,?,?)",
                        (item["review_key"], action, reason, stamp),
                    )
                    if action != "note":
                        db.execute(
                            "INSERT INTO review_state VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET action=excluded.action,reason=excluded.reason,updated_at=excluded.updated_at",
                            (item["review_key"], action, reason, stamp),
                        )
                outcomes.append({"key": key, "ok": True})
            except (ValueError, sqlite3.Error) as exc:
                outcomes.append({"key": key, "ok": False, "error": str(exc)})
        return outcomes
