from __future__ import annotations

import json
import sqlite3
import threading
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from .optimizer import Observation
from .strength import StrengthProfile, profile_from_policy


@dataclass(frozen=True)
class GameResult:
    id: int
    seed: int
    result: str
    strength: float
    side: str
    nodes: int
    depth: int
    multi_pv: int
    random_move_chance: float
    temperature: float
    expected_rank: float
    opening_plies: int
    opening_random_move_chance: float
    opening_temperature: float
    plies: int
    reason: str
    played_at: str

    @property
    def score(self) -> float:
        return {"win": 1.0, "draw": 0.5, "loss": 0.0}[self.result]

    @property
    def profile(self) -> StrengthProfile:
        return profile_from_policy(self.nodes, self.multi_pv, self.expected_rank)


@dataclass(frozen=True)
class RecoveryReport:
    games: int
    repaired_policy_states: int


class CalibrationStore:
    """Durable game outcomes and the current one-dimensional strength policy.

    Legacy behavior-control columns remain in the game schema so existing local
    databases can be opened and old incompatible trials can be excluded. New
    records always store zero for those controls; the optimizer neither fits
    nor updates them.
    """

    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(path, check_same_thread=False)
        self.connection.row_factory = sqlite3.Row
        self.lock = threading.RLock()
        with self.connection:
            self.connection.execute("PRAGMA busy_timeout=30000")
            self.connection.execute("PRAGMA foreign_keys=ON")
            self.connection.execute("PRAGMA journal_mode=WAL")
            self.connection.execute("PRAGMA synchronous=FULL")
            self.connection.execute(
                """
                CREATE TABLE IF NOT EXISTS games (
                    id INTEGER PRIMARY KEY,
                    level INTEGER NOT NULL,
                    played_at TEXT NOT NULL,
                    seed INTEGER NOT NULL,
                    side TEXT NOT NULL CHECK(side IN ('red', 'black')),
                    strength REAL NOT NULL,
                    nodes INTEGER NOT NULL,
                    depth INTEGER NOT NULL,
                    multi_pv INTEGER NOT NULL,
                    random_move_chance REAL NOT NULL,
                    temperature REAL NOT NULL,
                    expected_rank REAL NOT NULL DEFAULT 1,
                    opening_plies INTEGER NOT NULL DEFAULT 0,
                    opening_random_move_chance REAL NOT NULL DEFAULT 0,
                    opening_temperature REAL NOT NULL DEFAULT 0,
                    moves_json TEXT NOT NULL DEFAULT '[]',
                    result TEXT NOT NULL CHECK(result IN ('win', 'draw', 'loss')),
                    plies INTEGER NOT NULL,
                    reason TEXT NOT NULL
                )
                """
            )
            columns = {
                str(row[1]) for row in self.connection.execute("PRAGMA table_info(games)")
            }
            if "expected_rank" not in columns:
                self.connection.execute(
                    "ALTER TABLE games ADD COLUMN expected_rank REAL NOT NULL DEFAULT 1"
                )
            self.connection.execute(
                "CREATE TABLE IF NOT EXISTS policy_states "
                "(level INTEGER PRIMARY KEY, state_json TEXT NOT NULL)"
            )
            self.connection.execute(
                "CREATE TABLE IF NOT EXISTS attempt_counters "
                "(level INTEGER PRIMARY KEY, next_attempt INTEGER NOT NULL CHECK(next_attempt >= 0))"
            )

    def recover(self) -> RecoveryReport:
        """Validate durable data and clamp impossible state counters."""

        with self.lock, self.connection:
            check = [str(row[0]) for row in self.connection.execute("PRAGMA quick_check")]
            if check != ["ok"]:
                raise RuntimeError("Calibration database integrity check failed: " + "; ".join(check))
            foreign_keys = self.connection.execute("PRAGMA foreign_key_check").fetchall()
            if foreign_keys:
                raise RuntimeError(
                    f"Calibration database contains {len(foreign_keys)} broken reference(s)."
                )
            counts = {
                int(row[0]): int(row[1])
                for row in self.connection.execute("SELECT level, COUNT(*) FROM games GROUP BY level")
            }
            repaired = 0
            for row in self.connection.execute(
                "SELECT level, state_json FROM policy_states"
            ).fetchall():
                level = int(row[0])
                try:
                    state = json.loads(str(row[1]))
                    if not isinstance(state, dict) or not isinstance(state.get("profile"), dict):
                        raise ValueError("missing profile")
                except (TypeError, ValueError, json.JSONDecodeError) as error:
                    raise RuntimeError(
                        f"Calibration policy state for level {level} is invalid: {error}"
                    ) from error
                boundary = counts.get(level, 0)
                changed = False
                for key in (
                    "plain_start_game_count",
                    "strength_start_game_count",
                    "decision_game_count",
                    "profile_start_game_count",
                    "cohort_start_compatible_count",
                ):
                    if key not in state:
                        continue
                    normalized = min(boundary, max(0, int(state[key])))
                    if state[key] != normalized:
                        state[key] = normalized
                        changed = True
                if changed:
                    self.connection.execute(
                        "UPDATE policy_states SET state_json=? WHERE level=?",
                        (json.dumps(state, separators=(",", ":"), sort_keys=True), level),
                    )
                    repaired += 1
            return RecoveryReport(sum(counts.values()), repaired)

    def policy_state(self, level: int) -> dict[str, object] | None:
        with self.lock:
            row = self.connection.execute(
                "SELECT state_json FROM policy_states WHERE level=?", (level,)
            ).fetchone()
        return json.loads(str(row[0])) if row is not None else None

    def save_policy_state(self, level: int, state: dict[str, object]) -> None:
        with self.lock, self.connection:
            self.connection.execute(
                "INSERT OR REPLACE INTO policy_states(level, state_json) VALUES (?, ?)",
                (level, json.dumps(state, separators=(",", ":"), sort_keys=True)),
            )

    def results(self, level: int) -> list[GameResult]:
        with self.lock:
            rows = self.connection.execute(
                "SELECT id, seed, result, strength, side, nodes, depth, multi_pv, "
                "random_move_chance, temperature, expected_rank, opening_plies, opening_random_move_chance, "
                "opening_temperature, plies, reason, played_at "
                "FROM games WHERE level=? ORDER BY id",
                (level,),
            ).fetchall()
        return [GameResult(**dict(row)) for row in rows]

    def observations(self, level: int) -> list[Observation]:
        return [Observation(item.profile.strength, item.score, item.side) for item in self.results(level)]

    def next_game(self, level: int) -> tuple[int, str, int]:
        """Preview the next completed-game slot without consuming an attempt."""
        with self.lock:
            completed, next_attempt = self._next_game_values(level)
        side = "red" if completed % 2 == 0 else "black"
        return completed + 1, side, level * 1_000_000 + next_attempt

    def reserve_game_attempt(self, level: int) -> tuple[int, str, int, int]:
        """Durably consume a fresh RNG seed before launching Tiantian.

        A failed GUI trial does not become calibration evidence, but it must not
        replay the same stochastic move trajectory forever. Persisting the
        attempt counter also prevents that retry trap after a process restart.
        """
        with self.lock, self.connection:
            completed, next_attempt = self._next_game_values(level)
            self.connection.execute(
                "INSERT OR REPLACE INTO attempt_counters(level, next_attempt) VALUES (?, ?)",
                (level, next_attempt + 1),
            )
        side = "red" if completed % 2 == 0 else "black"
        return completed + 1, side, level * 1_000_000 + next_attempt, next_attempt + 1

    def _next_game_values(self, level: int) -> tuple[int, int]:
        completed = int(
            self.connection.execute(
                "SELECT COUNT(*) FROM games WHERE level=?", (level,)
            ).fetchone()[0]
        )
        row = self.connection.execute(
            "SELECT next_attempt FROM attempt_counters WHERE level=?", (level,)
        ).fetchone()
        if row is not None:
            return completed, max(completed, int(row[0]))

        base = level * 1_000_000
        largest = self.connection.execute(
            "SELECT MAX(seed) FROM games WHERE level=? AND seed>=? AND seed<?",
            (level, base, base + 1_000_000),
        ).fetchone()[0]
        inferred = completed if largest is None else max(completed, int(largest) - base + 1)
        return completed, inferred

    def record(
        self,
        level: int,
        seed: int,
        side: str,
        profile: StrengthProfile,
        result: str,
        plies: int,
        reason: str,
        moves: Sequence[str] = (),
    ) -> int:
        with self.lock, self.connection:
            cursor = self.connection.execute(
                """
                INSERT INTO games (
                    level, played_at, seed, side, strength, nodes, depth,
                    multi_pv, random_move_chance, temperature, expected_rank, opening_plies,
                    opening_random_move_chance, opening_temperature, moves_json,
                    result, plies, reason
                ) VALUES (?, ?, ?, ?, ?, ?, 99, ?, 0, 0, ?, 0, 0, 0, ?, ?, ?, ?)
                """,
                (
                    level,
                    datetime.now(timezone.utc).isoformat(),
                    seed,
                    side,
                    profile.strength,
                    profile.nodes,
                    profile.multi_pv,
                    profile.expected_rank,
                    json.dumps(list(moves), separators=(",", ":")),
                    result,
                    plies,
                    reason,
                ),
            )
            return int(cursor.lastrowid)

    def close(self) -> None:
        with self.lock:
            self.connection.close()
