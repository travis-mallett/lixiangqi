"""Published source IDs must resolve through provenance, without changing puzzle identity."""

from contextlib import closing
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

from tools.puzzle_catalog.catalog import PuzzleCatalog, catalog_source
from tools.puzzle_catalog.test_catalog import make_snapshot, puzzle
from tools.xiangqi_data.pikafish_rules import START_FEN


class SourceReferenceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.source = self.root / "games.sqlite3"
        with closing(sqlite3.connect(self.source)) as db, db:
            db.executescript(
                """CREATE TABLE games(id TEXT PRIMARY KEY,initial_fen TEXT,moves TEXT,red_name TEXT,black_name TEXT,red_rating INTEGER,black_rating INTEGER,event TEXT,source_url TEXT);
            CREATE TABLE game_sources(game_id TEXT,source TEXT,collection TEXT,external_id TEXT);"""
            )
            for id, name in [
                ("g:correct", "Correct game"),
                ("g:other", "Other source"),
            ]:
                db.execute(
                    "INSERT INTO games VALUES(?,?,?,?,?,?,?,?,?)",
                    (
                        id,
                        START_FEN,
                        '["a4a5","a7a6"]',
                        name,
                        "Opponent",
                        None,
                        None,
                        "Event",
                        "https://example.test",
                    ),
                )
            db.executemany(
                "INSERT INTO game_sources VALUES(?,?,?,?)",
                [
                    ("g:correct", "dpxq", "m", "15329"),
                    ("g:other", "xqdao", "games", "15329"),
                ],
            )

    def tearDown(self):
        self.tmp.cleanup()

    def test_source_prefix_disambiguates_reused_external_id(self):
        self.assertEqual(
            catalog_source(self.source, "dpxq:15329", "dpxq")["players"][0]["name"],
            "Correct game",
        )
        self.assertEqual(
            catalog_source(self.source, "xqdao:15329", "xqdao")["players"][0]["name"],
            "Other source",
        )
        self.assertEqual(
            catalog_source(self.source, "15329", "dpxq")["players"][0]["name"],
            "Correct game",
        )

    def test_canonical_id_resolves_without_source_lookup(self):
        self.assertEqual(
            catalog_source(self.source, "g:correct")["players"][0]["name"],
            "Correct game",
        )

    def test_ambiguous_source_and_conflicting_database_fail_closed(self):
        with self.assertRaisesRegex(ValueError, "conflicts"):
            catalog_source(self.source, "dpxq:15329", "xqdao")
        with closing(sqlite3.connect(self.source)) as db, db:
            db.execute("INSERT INTO game_sources VALUES('g:other','dpxq','n','15329')")
        with self.assertRaisesRegex(ValueError, "ambiguous"):
            catalog_source(self.source, "dpxq:15329", "dpxq")
        self.assertEqual(
            catalog_source(self.source, "dpxq_online:n:15329", "dpxq")["players"][0][
                "name"
            ],
            "Other source",
        )

    def test_multiple_witnesses_for_same_game_are_not_ambiguous(self):
        with closing(sqlite3.connect(self.source)) as db, db:
            db.execute(
                "INSERT INTO game_sources VALUES('g:correct','dpxq','n','15329')"
            )
        self.assertEqual(
            catalog_source(self.source, "dpxq:15329", "dpxq")["players"][0]["name"],
            "Correct game",
        )

    def test_published_inventory_and_release_preserve_original_identity(self):
        published = puzzle()
        published["gameId"] = "dpxq:15329"
        published["gameSource"] = {"type": "catalog", "database": "dpxq"}
        published["sourceSnapshot"] = None
        snapshot = self.root / "snapshot"
        make_snapshot(snapshot, [published])
        with PuzzleCatalog(self.root / "authored.sqlite3") as c:
            c.import_inventory(snapshot, self.source)
            release = c.build_release(source_catalog_digest="a" * 64)
            self.assertEqual(len(release["puzzles"]), 1)
            result = release["puzzles"][0]
            self.assertEqual(result["gameId"], "dpxq:15329")
            self.assertEqual(result["_id"], published["_id"])
            self.assertEqual(
                result["sourceSnapshot"]["players"][0]["name"], "Correct game"
            )


if __name__ == "__main__":
    unittest.main()
