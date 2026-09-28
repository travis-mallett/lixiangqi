from importlib import import_module
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from tools.puzzle_catalog.test_catalog import puzzle

migration = import_module("tools.data_migration.20260912_puzzle_publication_v1")


class PuzzleWalTests(unittest.TestCase):
    def test_empty_wal_does_not_block_valid_source_snapshot(self):
        with tempfile.TemporaryDirectory() as tmp:
            catalog = Path(tmp) / "catalog.sqlite3"
            Path(str(catalog) + "-wal").touch()
            source = puzzle()["sourceSnapshot"]
            original = puzzle()
            del original["sourceSnapshot"]
            original["gameSource"] = {"type": "catalog", "database": "dpxq"}
            with patch.object(migration, "catalog_source", return_value=source):
                fields = migration.additions(
                    original, catalog, lambda _: None, "https://example.test"
                )
            self.assertEqual(fields["sourceSnapshot"], source)

    def test_uncheckpointed_wal_is_not_ignored_or_deleted(self):
        with tempfile.TemporaryDirectory() as tmp:
            catalog = Path(tmp) / "catalog.sqlite3"
            wal = Path(str(catalog) + "-wal")
            wal.write_bytes(b"committed frames")
            original = puzzle()
            del original["sourceSnapshot"]
            original["gameSource"] = {"type": "catalog", "database": "dpxq"}
            with patch.object(migration, "catalog_source") as load:
                with self.assertRaisesRegex(ValueError, "checkpointed"):
                    migration.additions(
                        original, catalog, lambda _: None, "https://example.test"
                    )
                load.assert_not_called()
            self.assertEqual(wal.read_bytes(), b"committed frames")


if __name__ == "__main__":
    unittest.main()
