import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from .remove_phase_tags import clean_phase_tags


class RemovePhaseTagsTests(unittest.TestCase):
    def test_cleans_mutable_rows_and_preserves_releases_with_backup(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            catalog, mining = root / "catalog.sqlite3", root / "mining.sqlite3"
            with closing(sqlite3.connect(catalog)) as db:
                with db:
                    db.executescript("""
                    CREATE TABLE catalog_puzzles(id TEXT PRIMARY KEY, document TEXT, evidence TEXT);
                    CREATE TABLE catalog_assessments(id INTEGER PRIMARY KEY, puzzle_id TEXT, theme TEXT, version TEXT, result TEXT);
                    CREATE TABLE catalog_releases(id TEXT PRIMARY KEY, document TEXT);
                """)
                    db.execute(
                        "INSERT INTO catalog_puzzles VALUES ('abcde', ?, '{}')",
                        (
                            json.dumps(
                                {"themes": ["Opening", "centroidPawn", "Middle-Game"]}
                            ),
                        ),
                    )
                    db.execute(
                        "INSERT INTO catalog_assessments VALUES (1,'abcde','opening','v1','classified')"
                    )
                    db.execute(
                        "INSERT INTO catalog_releases VALUES ('r1', ?)",
                        (json.dumps({"themes": ["opening"]}),),
                    )
            with closing(sqlite3.connect(mining)) as db:
                with db:
                    db.executescript("""
                    CREATE TABLE puzzles(id TEXT, themes TEXT);
                    CREATE TABLE candidates(id INTEGER, themes_json TEXT);
                """)
                    db.execute(
                        "INSERT INTO puzzles VALUES ('p1', ?)",
                        (json.dumps(["middle_game", "mateIn2"]),),
                    )
                    db.execute(
                        "INSERT INTO candidates VALUES (1, ?)",
                        (json.dumps(["opening", "centroidPawn"]),),
                    )
            result = clean_phase_tags(catalog, mining, root / "backups")
            self.assertEqual(
                4,
                result["catalog_puzzles.tags"]
                + result["puzzles.tags"]
                + result["candidates.tags"],
            )
            with closing(sqlite3.connect(catalog)) as db:
                self.assertEqual(
                    ["centroidPawn"],
                    json.loads(
                        db.execute("SELECT document FROM catalog_puzzles").fetchone()[0]
                    )["themes"],
                )
                self.assertEqual(
                    1,
                    db.execute("SELECT count(*) FROM catalog_assessments").fetchone()[
                        0
                    ],
                )
                self.assertIn(
                    "opening",
                    json.loads(
                        db.execute("SELECT document FROM catalog_releases").fetchone()[
                            0
                        ]
                    )["themes"],
                )
            with closing(sqlite3.connect(mining)) as db:
                self.assertEqual(
                    ["mateIn2"],
                    json.loads(db.execute("SELECT themes FROM puzzles").fetchone()[0]),
                )
                self.assertEqual(
                    ["centroidPawn"],
                    json.loads(
                        db.execute("SELECT themes_json FROM candidates").fetchone()[0]
                    ),
                )
            self.assertEqual(2, len(result["backups"]))


if __name__ == "__main__":
    unittest.main()
