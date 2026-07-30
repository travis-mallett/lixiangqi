from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tools.games_database import (
    dpxq_ancient_manuals,
    dpxq_scraper,
    elephantchess_scraper,
    gdchess_scraper,
    update,
    xqdao_scraper,
)


class GamesDatabaseUpdateTest(unittest.TestCase):
    def test_dpxq_update_requests_only_ids_above_the_committed_frontier(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "games.sqlite3"
            output = Path(directory) / "html"
            with (
                patch.object(dpxq_scraper, "latest_master_id", return_value=141_805),
                patch.object(dpxq_scraper, "newest_stored_id", return_value=141_802),
                patch.object(dpxq_scraper, "_run_legacy", return_value=0) as run,
            ):
                status = dpxq_scraper.main(
                    [
                        "update-new",
                        "--database",
                        str(database),
                        "--output",
                        str(output),
                    ]
                )

        self.assertEqual(0, status)
        arguments = run.call_args.args[0]
        self.assertEqual("141803", arguments[arguments.index("--start") + 1])
        self.assertEqual("141805", arguments[arguments.index("--end") + 1])

    def test_dpxq_adapter_turns_legacy_system_exit_into_a_status(self) -> None:
        with patch.object(dpxq_scraper.legacy, "main", side_effect=SystemExit(1)):
            self.assertEqual(1, dpxq_scraper._run_legacy(["--start", "1"]))

    def test_01xq_update_bounds_the_refreshed_catalog_pages(self) -> None:
        with patch.object(gdchess_scraper.legacy, "main", return_value=0) as run:
            status = gdchess_scraper.main(
                ["update-new-events", "--lookback-pages", "3"]
            )

        self.assertEqual(0, status)
        arguments = run.call_args.args[0]
        self.assertIn("--refresh-listings", arguments)
        self.assertEqual("1", arguments[arguments.index("--start-page") + 1])
        self.assertEqual("3", arguments[arguments.index("--end-page") + 1])

    def test_xqdao_update_bounds_newest_index_pages_and_uses_desktop_ua(self) -> None:
        with patch.object(xqdao_scraper.legacy, "main", return_value=0) as run:
            status = xqdao_scraper.main(
                [
                    "update-new-events",
                    "--lookback-pages",
                    "4",
                    "--lookback-events",
                    "12",
                ]
            )

        self.assertEqual(0, status)
        arguments = run.call_args.args[0]
        self.assertEqual("4", arguments[arguments.index("--max-index-pages") + 1])
        self.assertEqual("12", arguments[arguments.index("--max-events") + 1])
        self.assertIn("Mozilla/5.0", arguments[arguments.index("--user-agent") + 1])

    def test_weekly_update_includes_elephantchess(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "games.sqlite3"
            with (
                patch.object(dpxq_scraper, "main", return_value=0),
                patch.object(dpxq_ancient_manuals, "main", return_value=0),
                patch.object(gdchess_scraper, "main", return_value=0),
                patch.object(xqdao_scraper, "main", return_value=0),
                patch.object(elephantchess_scraper, "main", return_value=0) as elephant,
                patch.object(update, "ensure_explorer_index", return_value=True),
            ):
                status = update.main(["--database", str(database)])

        self.assertEqual(0, status)
        elephant.assert_called_once_with(
            ["--database", str(database), "--delay", "1.0"]
        )


if __name__ == "__main__":
    unittest.main()
