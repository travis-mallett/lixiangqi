"""Starting-position uniqueness at admission, including the one-time cleanup."""

import json
import sqlite3
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from dataclasses import replace
from importlib import import_module
from pathlib import Path
from unittest.mock import patch

from tools.puzzle_catalog.mining_inventory import import_live_positions
from tools.xiangqi_data.puzzle_mining.position import replay_fens
from tools.xiangqi_data.puzzle_mining.storage import insert_candidate, open_database
from tools.xiangqi_data.tests import test_puzzle_mining as mining_tests

cleanup = import_module("tools.data_migration.20260924_deduplicate_puzzle_positions")
migration = import_module("tools.data_migration.20260924_unique_puzzle_positions_v18")


class UniquePositionsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "mining.sqlite3"
        self.db = open_database(self.path)
        self.addCleanup(self.db.close)
        self.candidate = mining_tests.PersistenceTest()._candidate()

    def count(self, table="candidates"):
        return self.db.execute(f"SELECT count(*) FROM {table}").fetchone()[0]

    def test_other_history_game_counters_and_category_are_discarded(self):
        original = insert_candidate(self.db, self.candidate)
        other = replace(
            self.candidate,
            candidate_key="other-history",
            game_id="other-game",
            candidate_type="tactic_candidate",
            played_move="c7c6",
            position_fen=" ".join(self.candidate.position_fen.split()[:4]) + " 27 89",
            position_hash="do not trust a caller-supplied hash",
        )
        self.assertIsNone(insert_candidate(self.db, other))
        self.assertEqual(self.count(), 1)
        self.assertEqual(self.count("candidate_revisions"), 1)
        self.assertEqual(
            self.db.execute("SELECT id FROM candidates").fetchone()[0], original
        )

    def test_same_occurrence_can_receive_a_new_analysis_revision(self):
        original = insert_candidate(self.db, self.candidate)
        revised = replace(self.candidate, search_settings={"depth": 30})
        self.assertEqual(insert_candidate(self.db, revised), original)
        self.assertEqual(self.count(), 1)
        self.assertEqual(self.count("candidate_revisions"), 2)

    def test_other_side_to_move_and_other_board_are_distinct(self):
        insert_candidate(self.db, self.candidate)
        fen = self.candidate.position_fen.replace(" b ", " w ")
        self.assertIsNotNone(
            insert_candidate(
                self.db, replace(self.candidate, candidate_key="red", position_fen=fen)
            )
        )
        self.assertIsNotNone(
            insert_candidate(
                self.db,
                replace(
                    self.candidate,
                    candidate_key="other",
                    position_fen=replay_fens(["c4c5"])[-1],
                ),
            )
        )
        self.assertEqual(self.count(), 3)

    def test_rejected_candidate_still_reserves_its_position(self):
        insert_candidate(self.db, self.candidate)
        with self.db:
            self.db.execute("UPDATE candidates SET status='rejected'")
        self.assertIsNone(
            insert_candidate(self.db, replace(self.candidate, candidate_key="another"))
        )
        self.assertEqual(self.count(), 1)

    def test_concurrent_discoveries_have_one_winner(self):
        def admit(index):
            db = sqlite3.connect(self.path, timeout=10)
            db.row_factory = sqlite3.Row
            try:
                return insert_candidate(
                    db, replace(self.candidate, candidate_key=f"source-{index}")
                )
            finally:
                db.close()

        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(admit, range(8)))
        self.assertEqual(sum(r is not None for r in results), 1)
        self.assertEqual(self.count(), 1)

    def catalog(self, puzzles):
        path = Path(self.temp.name) / "catalog.sqlite3"
        with closing(sqlite3.connect(path)) as db, db:
            db.executescript("""
                CREATE TABLE catalog_metadata(key TEXT PRIMARY KEY,value TEXT);
                CREATE TABLE catalog_puzzles(id TEXT PRIMARY KEY,document TEXT,evidence TEXT);
                CREATE TABLE catalog_live(id TEXT PRIMARY KEY,document TEXT);
            """)
            db.execute(
                "INSERT INTO catalog_metadata VALUES ('baseline',?)",
                (json.dumps(puzzles),),
            )
            for p in puzzles:
                db.execute(
                    "INSERT INTO catalog_puzzles VALUES (?,?,?)",
                    (p["_id"], json.dumps(p), "{}"),
                )
                db.execute(
                    "INSERT INTO catalog_live VALUES (?,?)", (p["_id"], json.dumps(p))
                )
        return path

    def published(self, pid="live1", **changes):
        return {
            "_id": pid,
            "gameId": "g1",
            "gameSource": {"type": "catalog", "database": "test"},
            "fen": self.candidate.pre_fen,
            "line": "a4a5 a7a6",
            "themes": ["exchangingToWinMaterial"],
            "retired": False,
            "retirementReason": None,
            "sourceSnapshot": {
                "initialFen": self.candidate.pre_fen,
                "moves": ["a4a5"],
                "players": [],
            },
            **changes,
        }

    def test_published_tactic_is_reserved_before_discovery(self):
        path = self.catalog([self.published()])
        self.assertEqual(import_live_positions(self.db, path), 1)
        row = self.db.execute("SELECT candidate_type FROM candidates").fetchone()
        self.assertEqual(row[0], "tactic_candidate")
        self.assertIsNone(self.db.execute("SELECT mate_in FROM puzzles").fetchone()[0])
        self.assertIsNone(
            insert_candidate(
                self.db, replace(self.candidate, candidate_key="new-source")
            )
        )
        self.assertEqual(import_live_positions(self.db, path), 0)

    def legacy_duplicate(self):
        insert_candidate(self.db, self.candidate)
        self.db.executescript("""
            DROP INDEX candidates_by_position;
            CREATE INDEX candidates_by_position ON candidates(position_hash);
            UPDATE metadata SET value='17' WHERE key='schema_version';
        """)
        row = dict(self.db.execute("SELECT * FROM candidates").fetchone())
        row.pop("id")
        row["candidate_key"] = "another-history"
        row["game_id"] = "g2"
        with self.db:
            self.db.execute(
                "INSERT INTO candidates("
                + ",".join(row)
                + ") VALUES("
                + ",".join("?" for _ in row)
                + ")",
                tuple(row.values()),
            )
        return self.db.execute("SELECT max(id) FROM candidates").fetchone()[0]

    def test_upgrade_refuses_duplicates_without_cleaning_them(self):
        self.legacy_duplicate()
        with self.assertRaisesRegex(RuntimeError, "explicit one-time cleanup"):
            migration.migrate(self.db)
        self.assertEqual(self.count(), 2)
        self.assertEqual(
            self.db.execute(
                "SELECT value FROM metadata WHERE key='schema_version'"
            ).fetchone()[0],
            "17",
        )

    def test_schema_index_rejects_bypassing_admission(self):
        insert_candidate(self.db, self.candidate)
        row = dict(self.db.execute("SELECT * FROM candidates").fetchone())
        row.pop("id")
        row["candidate_key"] = "bypass"
        with self.assertRaises(sqlite3.IntegrityError), self.db:
            self.db.execute(
                "INSERT INTO candidates("
                + ",".join(row)
                + ") VALUES("
                + ",".join("?" for _ in row)
                + ")",
                tuple(row.values()),
            )

    def test_cleanup_prefers_published_owner_and_preserves_retired_id_and_backup(self):
        newer = self.legacy_duplicate()
        for cid, pid, line in [(1, "local", "a7a6"), (newer, "live1", "c7c6")]:
            with self.db:
                self.db.execute(
                    """INSERT INTO puzzles(id,candidate_id,game_id,fen,display_fen,initial_ply,line,solution,solution_plies,themes,engine,nnue,engine_nodes,engine_depth,generator_version,created_at)
                    VALUES (?,?,?,?,?,0,?,?,1,'[]','test','test',0,20,2,'today')""",
                    (
                        pid,
                        cid,
                        "g1",
                        self.candidate.pre_fen,
                        self.candidate.position_fen,
                        json.dumps(["a4a5", line]),
                        json.dumps([line]),
                    ),
                )
                self.db.execute(
                    "INSERT INTO verification_jobs(candidate_id,signature,updated_at) VALUES (?,'test','today')",
                    (cid,),
                )
        catalog = self.catalog(
            [self.published("local"), self.published("live1", line="a4a5 c7c6")]
        )
        # Only the newer candidate owns an ID on the live site.
        with closing(sqlite3.connect(catalog)) as db, db:
            db.execute("DELETE FROM catalog_live WHERE id='local'")
        backup = Path(self.temp.name) / "backup"
        with patch(
            "sys.argv",
            [
                "cleanup",
                "--mining",
                str(self.path),
                "--catalog",
                str(catalog),
                "--backup-dir",
                str(backup),
            ],
        ):
            cleanup.main()
        self.assertEqual(self.count(), 1)
        self.assertEqual(
            self.db.execute("SELECT id FROM candidates").fetchone()[0], newer
        )
        self.assertEqual(self.count("verification_jobs"), 1)
        self.assertEqual(self.count("puzzles"), 1)
        with closing(sqlite3.connect(catalog)) as db, db:
            local = json.loads(
                db.execute(
                    "SELECT document FROM catalog_puzzles WHERE id='local'"
                ).fetchone()[0]
            )
            self.assertTrue(local["retired"])
        with closing(sqlite3.connect(backup / "mining.sqlite3")) as db:
            self.assertEqual(
                db.execute("SELECT count(*) FROM candidates").fetchone()[0], 2
            )
        self.assertEqual(list(self.db.execute("PRAGMA foreign_key_check")), [])
        # Stale live inventory cannot recreate the removed source occurrence.
        self.assertEqual(import_live_positions(self.db, catalog), 0)


if __name__ == "__main__":
    unittest.main()
