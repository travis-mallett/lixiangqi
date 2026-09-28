"""Inventory accounting is independent of categorization attempt outcomes."""

import json
import sqlite3
import unittest

from tools.xiangqi_data.puzzle_mining.checkmate_inventory import (
    InventoryCounts,
    load_checkmate_inventory,
)
from tools.xiangqi_data.puzzle_mining.patterns import CHECKMATE_MATCHERS


class CheckmateInventoryTest(unittest.TestCase):
    def setUp(self) -> None:
        self.connection = sqlite3.connect(":memory:")
        self.addCleanup(self.connection.close)
        self.connection.executescript("""
            CREATE TABLE candidates(id INTEGER PRIMARY KEY, source_database TEXT, status TEXT);
            CREATE TABLE puzzles(id INTEGER PRIMARY KEY, candidate_id INTEGER, themes TEXT,
                                 verification_status TEXT);
        """)

    def add(self, source: str, themes: list[str], *, withdrawn: bool = False,
            status: str = "published") -> None:
        candidate = self.connection.execute(
            "INSERT INTO candidates(source_database, status) VALUES (?, ?)", (source, status)
        ).lastrowid
        self.connection.execute(
            "INSERT INTO puzzles(candidate_id, themes, verification_status) VALUES (?, ?, ?)",
            (candidate, json.dumps(themes), "withdrawn" if withdrawn else "active"),
        )

    def test_empty_inventory_lists_every_registered_category(self) -> None:
        snapshot = load_checkmate_inventory(self.connection)
        self.assertEqual([row.theme for row in snapshot.categories],
                         [matcher.name for matcher in CHECKMATE_MATCHERS])
        self.assertEqual(snapshot.counts, InventoryCounts())
        self.assertTrue(all(row.counts == InventoryCounts() for row in snapshot.categories))

    def test_canonical_matches_overlap_and_provenance(self) -> None:
        pawn, horse = "centroidPawnMate", "octagonalHorse"
        self.add("lixiangqi:https://site.example", [pawn, horse, pawn], status="processing")
        self.add("dpxq", [pawn])
        self.add("catalog", [horse])
        self.add("dpxq", [pawn], withdrawn=True)
        self.add("dpxq", ["mate", "mateIn1"])
        self.add("lixiangqi:https://other.example", ["fork"])
        # Unpublished candidate evidence must not inflate the inventory.
        self.connection.execute(
            "INSERT INTO candidates(source_database, status) VALUES ('dpxq', 'review')"
        )
        snapshot = load_checkmate_inventory(self.connection)
        self.assertEqual(snapshot.counts, InventoryCounts(3, 1, 2))
        by_theme = {row.theme: row for row in snapshot.categories}
        self.assertEqual(by_theme[pawn].counts, InventoryCounts(2, 1, 1))
        self.assertEqual(by_theme[horse].counts, InventoryCounts(2, 1, 1))
        self.assertEqual(by_theme[pawn].label, "Centroid Pawn Mate")
        self.assertEqual(by_theme[horse].label, "Octagonal Horse")



if __name__ == "__main__":
    unittest.main()
