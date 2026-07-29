"""Run the safe weekly incremental update for every installed source."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sqlite3
import sys
import traceback
from pathlib import Path

from . import dpxq_scraper, gdchess_scraper, xqdao_scraper
from .storage import database_path


def _record_run(database: Path, result: dict[str, object]) -> None:
    if not database.is_file():
        return
    with sqlite3.connect(database) as connection:
        connection.execute(
            """
            INSERT INTO sync_state(source, scope, cursor, last_success_at, metadata_json)
            VALUES ('all', 'weekly', '', ?, ?)
            ON CONFLICT(source, scope) DO UPDATE SET
              last_success_at = excluded.last_success_at,
              metadata_json = excluded.metadata_json
            """,
            (
                dt.datetime.now(dt.timezone.utc).isoformat(),
                json.dumps(result, ensure_ascii=False, separators=(",", ":")),
            ),
        )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, default=database_path())
    parser.add_argument("--delay", type=float, default=1.0)
    parser.add_argument(
        "--continue-on-error",
        action="store_true",
        help="attempt later sources after a source updater fails",
    )
    args = parser.parse_args(argv)
    common = ["--database", str(args.database), "--delay", str(args.delay)]
    jobs = (
        ("dpxq", dpxq_scraper.main, ["update-new", *common]),
        ("gdchess_01xq", gdchess_scraper.main, ["update-new-events", *common]),
        ("xqdao", xqdao_scraper.main, ["update-new-events", *common]),
    )
    result: dict[str, object] = {}
    failed = False
    for name, action, arguments in jobs:
        print(f"\n=== Updating {name} ===", flush=True)
        try:
            status = action(arguments)
            result[name] = {"ok": status == 0, "status": status}
            if status:
                failed = True
                if not args.continue_on_error:
                    break
        except (OSError, RuntimeError, sqlite3.DatabaseError) as error:
            failed = True
            result[name] = {"ok": False, "error": str(error)}
            traceback.print_exc()
            if not args.continue_on_error:
                break
    if not failed:
        _record_run(args.database, result)
    print(json.dumps(result, ensure_ascii=False, indent=2), flush=True)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
