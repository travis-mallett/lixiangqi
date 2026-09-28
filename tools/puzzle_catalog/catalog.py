"""Authored puzzle catalog: production snapshots in, content releases out."""

from __future__ import annotations
import copy
import hashlib
import json
from pathlib import Path
import re
import sqlite3
from tools.environment_data.snapshot import verify_snapshot
from tools.xiangqi_data.pikafish_rules import START_FEN


class CatalogError(ValueError):
    pass


PUZZLE_KEYS = {
    "_id",
    "gameId",
    "gameSource",
    "fen",
    "line",
    "themes",
    "retired",
    "retirementReason",
    "sourceSnapshot",
    "playback",
}
SNAPSHOT_KEYS = {
    "initialFen",
    "moves",
    "players",
    "name",
    "event",
    "sourceUrl",
    "rated",
    "perf",
}
UCI = re.compile(r"[a-i](?:10|[1-9])[a-i](?:10|[1-9])")


def _json(value):
    return json.dumps(
        value,
        ensure_ascii=False,
        allow_nan=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def _digest(value):
    return hashlib.sha256(_json(value).encode("utf-8")).hexdigest()


def require(condition, message):
    if not condition:
        raise CatalogError(message)


def fen_ply(fen):
    require(isinstance(fen, str), "invalid FEN")
    f = fen.split(" ")
    require(len(f) == 6 and f[1] in {"w", "b"} and f[2:4] == ["-", "-"], "invalid FEN")
    require(
        f[4].isdigit() and f[5].isdigit() and int(f[5]) >= 1, "invalid FEN counters"
    )
    ranks = f[0].split("/")
    require(
        len(ranks) == 10
        and all(
            re.fullmatch(r"[1-9kabnrcpKABNRCP]+", r)
            and not re.search(r"\d\d", r)
            and sum(int(c) if c.isdigit() else 1 for c in r) == 9
            for r in ranks
        ),
        "invalid board",
    )
    return (int(f[5]) - 1) * 2 + (f[1] == "b")


def identity(p):
    return {k: p[k] for k in ("_id", "gameId", "gameSource", "fen", "line")}


def solve_identity(p):
    return {k: v for k, v in identity(p).items() if k != "_id"}


def baseline_digest(puzzles):
    return _digest(
        [
            {**identity(p), "retired": p.get("retired") is True}
            for p in sorted(puzzles, key=lambda p: p["_id"])
        ]
    )


def validate_puzzle(p):
    require(
        isinstance(p, dict)
        and not set(p) - PUZZLE_KEYS
        and (PUZZLE_KEYS - {"retirementReason", "playback"}) <= p.keys(),
        "incomplete puzzle or unowned fields",
    )
    require(
        isinstance(p["_id"], str) and re.fullmatch(r"[A-Za-z0-9]{5}", p["_id"]),
        "puzzle ID must have five base62 characters",
    )
    require(isinstance(p["gameId"], str) and bool(p["gameId"]), "missing source game")
    s = p["gameSource"]
    require(isinstance(s, dict), "invalid source")
    require(
        (
            set(s) == {"type", "database"}
            and s["type"] == "catalog"
            and isinstance(s["database"], str)
            and bool(s["database"])
        )
        or (
            set(s) == {"type", "origin"}
            and s["type"] == "native"
            and isinstance(s["origin"], str)
            and s["origin"].startswith("https://")
        ),
        "invalid source",
    )
    ply = fen_ply(p["fen"])
    require(isinstance(p["line"], str), "invalid line")
    line = p["line"].split(" ")
    require(len(line) >= 2 and all(UCI.fullmatch(m) for m in line), "invalid solution")
    require(
        isinstance(p["themes"], list)
        and all(
            isinstance(t, str) and re.fullmatch(r"[A-Za-z][A-Za-z0-9]*", t)
            for t in p["themes"]
        )
        and len(set(p["themes"])) == len(p["themes"]),
        "invalid themes",
    )
    require(type(p["retired"]) is bool, "retirement must be explicit")
    require(
        (
            (
                isinstance(p.get("retirementReason"), str)
                and bool(p["retirementReason"].strip())
            )
            if p["retired"]
            else p.get("retirementReason") is None
        ),
        "invalid retirement reason",
    )
    snap = p["sourceSnapshot"]
    require(
        isinstance(snap, dict)
        and not set(snap) - SNAPSHOT_KEYS
        and {"initialFen", "moves", "players"} <= snap.keys(),
        "source snapshot required",
    )
    offset = ply - fen_ply(snap["initialFen"])
    moves = snap["moves"]
    require(
        isinstance(moves, list)
        and all(isinstance(m, str) and UCI.fullmatch(m) for m in moves),
        "invalid source moves",
    )
    require(
        0 <= offset < len(moves) and moves[offset] == line[0], "source setup differs"
    )
    players = snap["players"]
    require(isinstance(players, list) and len(players) <= 2, "invalid players")
    colors = set()
    for player in players:
        require(
            isinstance(player, dict)
            and not set(player) - {"color", "userId", "name", "rating"}
            and player.get("color") in {"red", "black"}
            and player["color"] not in colors,
            "invalid player",
        )
        colors.add(player["color"])
        for k in ("userId", "name"):
            if k in player:
                require(
                    isinstance(player[k], str) and bool(player[k]), "invalid identity"
                )
        if "rating" in player:
            require(
                type(player["rating"]) is int and player["rating"] >= 0,
                "invalid rating",
            )
        require(
            s["type"] != "native" or "name" not in player, "native names resolve live"
        )
    for k in ("name", "event", "sourceUrl", "perf"):
        if k in snap:
            require(isinstance(snap[k], str), "invalid source metadata")
    if "rated" in snap:
        require(type(snap["rated"]) is bool, "invalid rated flag")
    if "playback" in p:
        from .playback import validate_playback

        try:
            validate_playback(p["playback"], line[1:])
        except ValueError as error:
            raise CatalogError(str(error)) from error
    return copy.deepcopy(p)


def change(before, after):
    if before is None:
        return "added"
    if not before["retired"] and after["retired"]:
        return "retired"
    if before["retired"] and not after["retired"]:
        return "reactivated"
    return "unchanged" if before == after else "relabeled"


def catalog_source(path, game_id, database=None, *, immutable=False):
    # Offline deployment mounts a quiesced, checkpointed catalog read-only.
    # Immutable mode avoids creating WAL shared-memory files on that mount.
    query = "mode=ro&immutable=1" if immutable else "mode=ro"
    db = sqlite3.connect(f"{Path(path).resolve().as_uri()}?{query}", uri=True)
    db.row_factory = sqlite3.Row
    try:
        from tools.games_database.identity import resolve_catalog_game

        row = resolve_catalog_game(db, game_id, database)
    finally:
        db.close()
    require(row is not None, f"missing catalog game: {game_id}")
    result = {
        "initialFen": row["initial_fen"] or START_FEN,
        "moves": json.loads(row["moves"]),
        "players": [],
        "rated": False,
        "name": row["event"] or "Games database",
    }
    for color in ("red", "black"):
        player = {"color": color}
        if row[f"{color}_name"]:
            player["name"] = row[f"{color}_name"]
        if row[f"{color}_rating"] is not None:
            player["rating"] = row[f"{color}_rating"]
        result["players"].append(player)
    for field, key in (("event", "event"), ("source_url", "sourceUrl")):
        if row[field]:
            result[key] = row[field]
    return result


class PuzzleCatalog:
    def __init__(self, path):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path, timeout=30)
        self.db.row_factory = sqlite3.Row
        # Studio reads the catalog while background jobs commit assessments.
        # WAL keeps those readers from blocking the writer's commit.
        self.db.executescript(
            """PRAGMA journal_mode=WAL;
          PRAGMA foreign_keys=ON;
          CREATE TABLE IF NOT EXISTS catalog_metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS catalog_puzzles(id TEXT PRIMARY KEY,document TEXT NOT NULL,evidence TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS catalog_releases(id TEXT PRIMARY KEY,document TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS catalog_assessments(id INTEGER PRIMARY KEY,puzzle_id TEXT NOT NULL,theme TEXT NOT NULL,version TEXT NOT NULL,result TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);"""
        )
        self.db.execute(
            "CREATE INDEX IF NOT EXISTS catalog_by_solve ON catalog_puzzles("
            "json_extract(document,'$.gameId'),json_extract(document,'$.fen'),json_extract(document,'$.line'))"
        )
        from importlib import import_module

        import_module(
            "tools.data_migration.20260925_supported_catalog_objectives"
        ).migrate(self.db)
        from .inventory import install

        install(self.db)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()

    def close(self):
        self.db.close()

    def _meta(self, key):
        row = self.db.execute(
            "SELECT value FROM catalog_metadata WHERE key=?", (key,)
        ).fetchone()
        return json.loads(row[0]) if row else None

    def _set_meta(self, key, value):
        self.db.execute(
            "INSERT INTO catalog_metadata VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, _json(value)),
        )

    def puzzles(self):
        return [
            json.loads(r[0])
            for r in self.db.execute("SELECT document FROM catalog_puzzles ORDER BY id")
        ]

    def import_inventory(self, snapshot_root, source_catalog=None):
        require(
            isinstance(snapshot_root, Path),
            "input must be a verified production snapshot directory",
        )
        manifest = verify_snapshot(snapshot_root)
        raw = json.loads(
            (snapshot_root / "puzzle-inventory.json").read_text(encoding="utf-8")
        )
        require(
            raw.get("schemaVersion") in (1, 2) and isinstance(raw.get("puzzles"), list),
            "invalid inventory",
        )
        puzzles = copy.deepcopy(raw["puzzles"])
        require(len({p["_id"] for p in puzzles}) == len(puzzles), "duplicate IDs")
        for p in puzzles:
            if p.get("sourceSnapshot") is None:
                require(
                    p["gameSource"]["type"] == "catalog" and source_catalog is not None,
                    f"missing source: {p['_id']}",
                )
                p["sourceSnapshot"] = catalog_source(
                    source_catalog, p["gameId"], p["gameSource"]["database"]
                )
            validate_puzzle(p)
        if raw["schemaVersion"] == 2:
            from .live import reconcile, wire_digest

            revisions = raw["publication"]["revisions"]
            require(
                set(revisions) == {p["_id"] for p in puzzles},
                "snapshot publication membership differs",
            )
            reconcile(
                self,
                [
                    {
                        "puzzle": p,
                        "digest": wire_digest(
                            {**p, "retirementReason": p.get("retirementReason")}
                        ),
                        "revision": revisions[p["_id"]],
                    }
                    for p in puzzles
                ],
            )
            return manifest["snapshotId"]
        previous = self._meta("baseline")
        if previous is not None and previous != puzzles:
            deployed = raw.get("release")
            require(
                isinstance(deployed, dict),
                "changed production inventory lacks a content release",
            )
            known = self.release(deployed["releaseId"])
            require(
                known == deployed and known["puzzles"] == puzzles,
                "production content differs from the authored release",
            )
            with self.db:
                self._set_meta("deployedReleaseId", deployed["releaseId"])
                self._set_meta("snapshotId", manifest["snapshotId"])
            return manifest["snapshotId"]
        require(
            not self.puzzles() or previous is not None,
            "cannot bootstrap unrelated authored set",
        )
        with self.db:
            self._set_meta("baseline", puzzles)
            self._set_meta("snapshotId", manifest["snapshotId"])
            self._set_meta("baselineDigest", baseline_digest(puzzles))
            for p in puzzles:
                self.db.execute(
                    "INSERT OR IGNORE INTO catalog_puzzles VALUES (?,?,?)",
                    (
                        p["_id"],
                        _json(p),
                        _json(
                            {
                                "status": "inherited",
                                "snapshotId": manifest["snapshotId"],
                            }
                        ),
                    ),
                )
            release = raw.get("release")
            if release:
                self.db.execute(
                    "INSERT OR IGNORE INTO catalog_releases VALUES (?,?)",
                    (release["releaseId"], _json(release)),
                )
                self._set_meta("deployedReleaseId", release["releaseId"])
        return manifest["snapshotId"]

    def admit(self, puzzle, evidence):
        from .playback import from_evidence

        p = validate_puzzle(
            {
                **puzzle,
                "playback": (
                    from_evidence(puzzle, evidence)
                    if evidence.get("branches")
                    else puzzle.get("playback")
                ),
            }
        )
        require(self._meta("baseline") is not None, "import production inventory first")
        require(
            evidence.get("status") == "verified" and bool(evidence.get("assessmentId")),
            "canonical verification required",
        )
        with self.db:
            self.db.execute("BEGIN IMMEDIATE")
            self._store_puzzle(p, evidence)
        return p["_id"]

    def _store_puzzle(self, p, evidence):
        """Store authored content under the caller's write transaction."""
        row = self.db.execute(
            "SELECT document FROM catalog_puzzles WHERE id=?", (p["_id"],)
        ).fetchone()
        require(
            row is None or identity(json.loads(row[0])) == identity(p),
            "changed solve requires new ID",
        )
        for other in self.db.execute(
            "SELECT id,document FROM catalog_puzzles WHERE id!=? "
            "AND json_extract(document,'$.gameId')=? AND json_extract(document,'$.fen')=? "
            "AND json_extract(document,'$.line')=?",
            (p["_id"], p["gameId"], p["fen"], p["line"]),
        ):
            require(
                solve_identity(json.loads(other["document"])) != solve_identity(p),
                f"Duplicate solve identity: {p['_id']} already belongs to {other['id']}",
            )
        self.db.execute(
            "INSERT INTO catalog_puzzles VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document,evidence=excluded.evidence",
            (p["_id"], _json(p), _json(evidence)),
        )

    def retire(self, puzzle_id, reason):
        require(
            isinstance(reason, str) and bool(reason.strip()),
            "retirement requires reason",
        )
        row = self.db.execute(
            "SELECT document FROM catalog_puzzles WHERE id=?", (puzzle_id,)
        ).fetchone()
        require(row is not None, "unknown puzzle")
        p = json.loads(row[0])
        p.update(retired=True, retirementReason=reason)
        with self.db:
            self.db.execute(
                "UPDATE catalog_puzzles SET document=? WHERE id=?",
                (_json(p), puzzle_id),
            )

    def release(self, release_id):
        row = self.db.execute(
            "SELECT document FROM catalog_releases WHERE id=?", (release_id,)
        ).fetchone()
        require(row is not None, "unknown parent release")
        return json.loads(row[0])

    def build_release(
        self,
        parent_release_id=None,
        source_catalog_digest="",
        *,
        include_uncategorized=False,
    ):
        base = self._meta("baseline")
        require(base is not None, "production inventory not reconciled")
        parent_release_id = parent_release_id or self._meta("deployedReleaseId")
        prior = (
            self.release(parent_release_id)["puzzles"] if parent_release_id else base
        )
        old = {p["_id"]: p for p in prior}
        from .publication import officially_categorized, validate_release_categories

        puzzles = self.puzzles()
        if not include_uncategorized:
            # Keep every previously deployed ID. An operator must explicitly
            # retire any existing unclassified puzzle instead of omitting it.
            require(
                all(
                    p.get("retired") or officially_categorized(p)
                    for p in puzzles
                    if p["_id"] in old
                ),
                "Published puzzles without an official category must be retired explicitly, or enable inclusion of uncategorized puzzles",
            )
            puzzles = [
                p
                for p in puzzles
                if p["_id"] in old or p.get("retired") or officially_categorized(p)
            ]
        validate_release_categories(
            puzzles, include_uncategorized=include_uncategorized
        )
        require(
            set(old) <= {p["_id"] for p in puzzles},
            "prior IDs omitted; retire explicitly",
        )
        for p in puzzles:
            validate_puzzle(p)
            if p["_id"] in old:
                require(
                    identity(old[p["_id"]]) == identity(p), "solve identity changed"
                )
            evidence = json.loads(
                self.db.execute(
                    "SELECT evidence FROM catalog_puzzles WHERE id=?", (p["_id"],)
                ).fetchone()[0]
            )
            # Admission already requires canonical verification. Published-theme
            # audits are optional, versioned editorial evidence and therefore do
            # not invalidate the authored puzzle when an audit is inconclusive or
            # interrupted.
            require(
                evidence.get("status") != "rejected",
                f"rejected authored puzzle: {p['_id']}",
            )
        if any(p["gameSource"]["type"] == "catalog" for p in puzzles):
            require(
                bool(re.fullmatch(r"[a-f0-9]{64}", source_catalog_digest)),
                "catalog release digest required",
            )
        body = {
            "schemaVersion": 1,
            "parentReleaseId": parent_release_id,
            "baselineDigest": self._meta("baselineDigest"),
            "sourceCatalogDigest": source_catalog_digest,
            "puzzles": puzzles,
            "changes": [
                {
                    "_id": p["_id"],
                    "status": change(old.get(p["_id"]), p),
                    "reason": p.get("retirementReason"),
                }
                for p in puzzles
            ],
        }
        result = {**body, "digest": _digest(body), "releaseId": _digest(body)}
        with self.db:
            self.db.execute(
                "INSERT OR IGNORE INTO catalog_releases VALUES (?,?)",
                (result["releaseId"], _json(result)),
            )
        return result

    def audit_plan(self, parent_release_id, theme):
        from tools.xiangqi_data.puzzle_mining.classification_job import (
            all_theme_versions,
        )

        require(theme in all_theme_versions(), "unknown theme")
        version = all_theme_versions()[theme]
        selected = [
            p
            for p in self.release(parent_release_id)["puzzles"]
            if not p["retired"] and theme in p["themes"]
        ]
        ids = {p["_id"] for p in selected}
        latest = {}
        for row in self.db.execute(
            "SELECT puzzle_id,result FROM catalog_assessments "
            "WHERE theme=? AND version=? ORDER BY id",
            (theme, version),
        ):
            if row[0] in ids:
                latest[row[0]] = json.loads(row[1])
        from .reclassification import current_audit_results

        latest = dict(current_audit_results(latest))
        completed = {key for key, value in latest.items() if value != "unresolved"}
        outcomes = {
            outcome: sum(value == outcome for value in latest.values())
            for outcome in ("qualifies", "does_not_qualify", "unresolved")
        }
        return {
            "theme": theme,
            "version": version,
            "total": len(selected),
            "completed": len(completed),
            "remaining": len(selected) - len(completed),
            "outcomes": outcomes,
            "pending": [p for p in selected if p["_id"] not in completed],
        }

    def reclassify(
        self,
        parent_release_id,
        theme,
        engine,
        config,
        *,
        progress=None,
    ):
        from .reclassification import assess_puzzle

        plan = self.audit_plan(parent_release_id, theme)
        if progress:
            progress({k: v for k, v in plan.items() if k != "pending"})
        for p in plan["pending"]:
            stored = self.db.execute(
                "SELECT evidence FROM catalog_puzzles WHERE id=?", (p["_id"],)
            ).fetchone()
            result = assess_puzzle(
                {**p, "_verificationEvidence": json.loads(stored[0]) if stored else {}},
                theme,
                engine,
                config,
            )
            current = self.db.execute(
                "SELECT document FROM catalog_puzzles WHERE id=?", (p["_id"],)
            ).fetchone()
            require(
                current is not None and identity(json.loads(current[0])) == identity(p),
                "identity changed during audit",
            )
            with self.db:
                assessment_id = self.db.execute(
                    "INSERT INTO catalog_assessments(puzzle_id,theme,version,result) VALUES (?,?,?,?)",
                    (p["_id"], theme, result["themeVersion"], _json(result)),
                ).lastrowid
                if result["outcome"] != "unresolved":
                    require(
                        isinstance(result.get("categories"), list),
                        "complete classification categories required",
                    )
                    self._apply_completed_assessment(p, assessment_id, result)
            if progress:
                refreshed = self.audit_plan(parent_release_id, theme)
                progress({k: v for k, v in refreshed.items() if k != "pending"})
        final = self.audit_plan(parent_release_id, theme)
        return {k: v for k, v in final.items() if k != "pending"}

    def _apply_completed_assessment(self, puzzle, assessment_id, result):
        """One completed candidate assessment changes publication in its transaction."""
        row = self.db.execute(
            "SELECT evidence FROM catalog_puzzles WHERE id=?", (puzzle["_id"],)
        ).fetchone()
        evidence = json.loads(row[0])
        root = evidence.get("originatingPuzzleId", puzzle["_id"])
        authority_key = f"assessment:{root}"
        previous = self._meta(authority_key)
        if previous is not None and int(previous) >= assessment_id:
            return
        related = self.db.execute(
            "SELECT id,document,evidence FROM catalog_puzzles WHERE id=? OR json_extract(evidence,'$.originatingPuzzleId')=? OR json_extract(evidence,'$.candidateKey')=?",
            (root, root, evidence.get("candidateKey")),
        ).fetchall()
        live = [r for r in related if not json.loads(r[1])["retired"]]
        require(len(live) <= 1, "multiple active publications for an assessment origin")
        categories = sorted(set(result["categories"]))
        current = json.loads(live[0][1]) if live else None
        for r in live:
            retired = json.loads(r[1])
            retired.update(
                retired=True, retirementReason="latest completed classification"
            )
            self.db.execute(
                "UPDATE catalog_puzzles SET document=? WHERE id=?",
                (_json(retired), r[0]),
            )
        if categories:
            replacement = {
                **(current or puzzle),
                "themes": categories,
                "retired": False,
                "retirementReason": None,
            }
            replacement.pop("_verificationEvidence", None)
            new_id = result.get("publicationId")
            require(new_id is not None, "current candidate publication ID required")
            if result.get("line") is not None:
                replacement["line"] = result["line"]
            replacement["_id"] = new_id
            replacement_evidence = {
                **evidence,
                **result["evidence"],
                "originatingPuzzleId": root,
                "appliedAssessmentId": assessment_id,
            }
            from .playback import from_evidence

            replacement["playback"] = from_evidence(replacement, replacement_evidence)
            self._store_puzzle(validate_puzzle(replacement), replacement_evidence)
        self._set_meta(authority_key, str(assessment_id))
