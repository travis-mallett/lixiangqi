"""Durable game checkpoints and human-readable JSON exports."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path


def write_json(path: Path, value) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(value, indent=2, sort_keys=True, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)


class RunStore:
    def __init__(self, root: Path, manifest: dict, resume: bool):
        root.mkdir(parents=True, exist_ok=True)
        self.root = root
        self.closed = False
        path = root / "checkpoint.sqlite3"
        exists = path.exists()
        if exists != resume:
            raise ValueError(
                "Use a new output directory, or --resume for an existing checkpoint"
            )
        # A separate SQLite transaction is an OS-released process lock, so
        # crashes never leave a stale PID file blocking resume.
        self.owner = sqlite3.connect(root / "owner.sqlite3", timeout=0)
        try:
            self.owner.execute("BEGIN EXCLUSIVE")
        except sqlite3.OperationalError as error:
            self.owner.close()
            raise ValueError(
                "This output directory is already in use by another run"
            ) from error
        self.connection = sqlite3.connect(path)
        self.connection.execute("PRAGMA synchronous=FULL")
        self.connection.executescript("""
            CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS games (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS iterations (iteration INTEGER PRIMARY KEY, payload TEXT NOT NULL);
        """)
        encoded = json.dumps(manifest, sort_keys=True)
        old = self.connection.execute(
            "SELECT value FROM metadata WHERE key='manifest'"
        ).fetchone()
        if old and old[0] != encoded:
            self.connection.close()
            self.owner.close()
            raise ValueError(
                "Resume configuration, suite, engine, or source fingerprint changed"
            )
        if not old:
            with self.connection:
                self.connection.execute(
                    "INSERT INTO metadata VALUES ('manifest', ?)", (encoded,)
                )
        write_json(root / "manifest.json", manifest)

    def game(self, game_id):
        row = self.connection.execute(
            "SELECT payload FROM games WHERE id=?", (game_id,)
        ).fetchone()
        return json.loads(row[0]) if row else None

    def save_game(self, game):
        with self.connection:
            self.connection.execute(
                "INSERT OR REPLACE INTO games VALUES (?, ?)",
                (game["gameId"], json.dumps(game, allow_nan=False)),
            )

    def report(self, iteration):
        row = self.connection.execute(
            "SELECT payload FROM iterations WHERE iteration=?", (iteration,)
        ).fetchone()
        return json.loads(row[0]) if row else None

    def save_report(self, report):
        with self.connection:
            self.connection.execute(
                "INSERT OR REPLACE INTO iterations VALUES (?, ?)",
                (report["iteration"], json.dumps(report, allow_nan=False)),
            )
        write_json(self.root / f"iteration-{report['iteration']:03}.json", report)
        self.export_games()

    def export_games(self):
        temporary = self.root / "games.jsonl.tmp"
        with temporary.open("w", encoding="utf-8") as stream:
            for row in self.connection.execute("SELECT payload FROM games ORDER BY id"):
                stream.write(row[0] + "\n")
        temporary.replace(self.root / "games.jsonl")

    def close(self):
        if not self.closed:
            try:
                self.export_games()
            finally:
                self.connection.close()
                self.owner.close()
                self.closed = True
