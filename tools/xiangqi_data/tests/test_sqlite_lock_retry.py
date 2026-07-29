from __future__ import annotations

import sqlite3
import unittest

from tools.xiangqi_data.sqlite_lock_retry import SqliteLockRetry


class SqliteLockRetryTest(unittest.TestCase):
    def test_retries_lock_errors_at_one_second_intervals_without_a_limit(self) -> None:
        attempts = 0
        delays: list[float] = []
        messages: list[str] = []

        def operation() -> str:
            nonlocal attempts
            attempts += 1
            if attempts <= 20:
                raise sqlite3.OperationalError("database is locked")
            return "continued"

        retry = SqliteLockRetry(message=messages.append, sleep=delays.append)
        self.assertEqual("continued", retry.run(operation, context="testing"))
        self.assertEqual(21, attempts)
        self.assertEqual([1.0] * 20, delays)
        self.assertEqual(2, len(messages))
        self.assertIn("retrying every 1 second", messages[0])
        self.assertEqual("Explorer database is available; continuing.", messages[1])

    def test_does_not_hide_unrelated_database_errors(self) -> None:
        retry = SqliteLockRetry(sleep=lambda _delay: None)
        with self.assertRaisesRegex(sqlite3.OperationalError, "malformed"):
            retry.run(
                lambda: (_ for _ in ()).throw(
                    sqlite3.OperationalError("database disk image is malformed")
                ),
                context="testing",
            )


if __name__ == "__main__":
    unittest.main()
