"""Single-writer, transactional SQLite pool with durable pending game plans."""

import json
import sqlite3
import zlib
from pathlib import Path

from .model import Bot, generate, rate


class PoolStore:
    def __init__(self, path, *, config=None, provenance=None, resume=False, initial_bots=None):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.owner = sqlite3.connect(str(self.path) + ".owner", timeout=0)
        self.db = None
        try:
            self.owner.execute("BEGIN EXCLUSIVE")
            if self.path.exists() != resume:
                raise ValueError(
                    "Use --resume for an existing pool; new pools require a new path"
                )
            self.db = sqlite3.connect(self.path)
            self.db.execute("PRAGMA journal_mode=WAL")
            self.db.execute("PRAGMA synchronous=FULL")
            initialize = not resume
            if resume and self._is_empty_database():
                # SQLite may have created the file and schema before an
                # interrupted first startup wrote its metadata. It is safe to
                # initialize only when every pool table is still empty.
                initialize = True
            if initialize:
                self.db.executescript("""
                    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                    CREATE TABLE IF NOT EXISTS bots (id TEXT PRIMARY KEY, data TEXT NOT NULL);
                    CREATE TABLE IF NOT EXISTS games (sequence INTEGER PRIMARY KEY, status TEXT NOT NULL,
                        plan TEXT NOT NULL, record BLOB, completed_order INTEGER UNIQUE);
                    CREATE INDEX IF NOT EXISTS game_status ON games(status);
                """)
                with self.db:
                    for key, value in (
                        ("config", config),
                        ("provenance", provenance),
                        ("version", 1),
                    ):
                        self.db.execute(
                            "INSERT INTO metadata VALUES (?,?)",
                            (key, json.dumps(value)),
                        )
                    bots = initial_bots
                    if bots is None:
                        bots = generate(config["bots"], config["seed"]).values()
                    for bot in bots:
                        self.save_bot(bot)
            self.config = self.metadata("config")
            if self.metadata("version") != 1:
                raise ValueError("Unsupported pool format")
            if (
                resume
                and provenance is not None
                and self.metadata("provenance") != provenance
            ):
                raise ValueError(
                    "Engine, rules or source hashes changed; resume requires the original runtime"
                )
            self.bots = {
                key: Bot(**json.loads(data))
                for key, data in self.db.execute("SELECT id,data FROM bots")
            }
            self.completed = self.db.execute(
                "SELECT count(*) FROM games WHERE status='completed'"
            ).fetchone()[0]
            self.sequence = self.db.execute(
                "SELECT coalesce(max(sequence),0) FROM games"
            ).fetchone()[0]
        except BaseException:
            self.close()
            raise

    def _is_empty_database(self):
        tables = {
            row[0]
            for row in self.db.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
        if not tables:
            return True
        expected = {"metadata", "bots", "games"}
        if tables != expected:
            return False
        return all(
            self.db.execute(f"SELECT 1 FROM {table} LIMIT 1").fetchone() is None
            for table in expected
        )

    def metadata(self, key):
        return json.loads(
            self.db.execute(
                "SELECT value FROM metadata WHERE key=?", (key,)
            ).fetchone()[0]
        )

    def save_bot(self, bot):
        self.db.execute(
            "INSERT OR REPLACE INTO bots VALUES (?,?)", (bot.id, json.dumps(bot.row()))
        )

    def pending(self):
        return [
            json.loads(row[0])
            for row in self.db.execute(
                "SELECT plan FROM games WHERE status='pending' ORDER BY sequence"
            )
        ]

    def reserve(self, plan):
        with self.db:
            self.db.execute(
                "INSERT INTO games(sequence,status,plan) VALUES (?,'pending',?)",
                (plan["sequence"], json.dumps(plan)),
            )
            red, black = self.bots[plan["red"]], self.bots[plan["black"]]
            red.lastOpponent, black.lastOpponent = black.id, red.id
            self.save_bot(red)
            self.save_bot(black)
        self.sequence = plan["sequence"]

    def finish(self, record):
        sequence = record["sequence"]
        row = self.db.execute(
            "SELECT status FROM games WHERE sequence=?", (sequence,)
        ).fetchone()
        if row is None or row[0] != "pending":
            raise ValueError(
                "Only a pending game may be completed (no duplicate rating updates)"
            )
        if record["status"] not in {"completed", "failed", "censored"}:
            raise ValueError("Unexpected game status")
        red, black = self.bots[record["red"]], self.bots[record["black"]]
        # Mutate copies, publishing them only after the transaction commits.
        red, black = Bot(**red.row()), Bot(**black.row())
        order = None
        with self.db:
            if record["status"] == "completed":
                record["ratingsBefore"] = [red.elo, black.elo]
                rate(red, black, record["result"], self.config["k"])
                record["ratingsAfter"] = [red.elo, black.elo]
                order = self.completed + 1
                self.save_bot(red)
                self.save_bot(black)
            self.db.execute(
                "UPDATE games SET status=?,record=?,completed_order=? WHERE sequence=?",
                (
                    record["status"],
                    zlib.compress(json.dumps(record).encode()),
                    order,
                    sequence,
                ),
            )
        self.bots[red.id], self.bots[black.id] = red, black
        if order:
            self.completed = order

    def close(self):
        if self.db:
            self.db.close()
            self.db = None
        if self.owner:
            self.owner.close()
            self.owner = None


def snapshot(path):
    db = sqlite3.connect(Path(path).resolve().as_uri() + "?mode=ro", uri=True)
    try:
        db.execute("BEGIN")
        bots = [
            Bot(**json.loads(row[0])) for row in db.execute("SELECT data FROM bots")
        ]
        counts = dict(db.execute("SELECT status,count(*) FROM games GROUP BY status"))
        return bots, counts
    finally:
        db.close()


def game_record(path, sequence):
    db = sqlite3.connect(Path(path).resolve().as_uri() + "?mode=ro", uri=True)
    try:
        row = db.execute(
            "SELECT record FROM games WHERE sequence=?", (sequence,)
        ).fetchone()
        if not row or row[0] is None:
            raise ValueError("No finished attempt for this game sequence")
        return json.loads(zlib.decompress(row[0]))
    finally:
        db.close()
