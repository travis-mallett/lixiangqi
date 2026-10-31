"""Jieqi information-set adapter; this module cannot accept a secret deal."""
import os
from pathlib import Path
import re
import shutil

from .ai import MoveWork, PikafishMoveEngine, StrengthProfile

ROLES = "RACPNB"


def validate_observation(value: object) -> None:
    if not isinstance(value, dict) or set(value) != {"fen", "remaining"}:
        raise ValueError("Invalid Jieqi observation")
    fen, remaining = value["fen"], value["remaining"]
    if not isinstance(fen, str) or not re.fullmatch(r"[racpnbkxRACPNBKX1-9/]+ [wb] j - \d+ \d+", fen):
        raise ValueError("Invalid public Jieqi position")
    ranks = fen.split()[0].split("/")
    if len(ranks) != 10 or any(sum(int(c) if c.isdigit() else 1 for c in rank) != 9 for rank in ranks):
        raise ValueError("Invalid Jieqi board dimensions")
    if not isinstance(remaining, dict) or set(remaining) != set(ROLES + ROLES.lower()):
        raise ValueError("Invalid Jieqi hidden inventory")
    for piece, count in remaining.items():
        if isinstance(count, bool) or not isinstance(count, int) or not 0 <= count <= (5 if piece.upper() == "P" else 2):
            raise ValueError("Invalid Jieqi inventory count")
    for roles, hidden in [(ROLES, "X"), (ROLES.lower(), "x")]:
        if sum(remaining[p] for p in roles) < fen.split()[0].count(hidden):
            raise ValueError("Jieqi inventory cannot supply its concealed pieces")


def engine_fen(observation: dict) -> str:
    validate_observation(observation)
    placement, turn, _, _, quiet, fullmove = observation["fen"].split()
    remaining = observation["remaining"]
    inventory = "".join(piece + str(remaining[piece]) for piece in ROLES + ROLES.lower() if remaining[piece])
    return f"{placement} {turn} {inventory or '-'} {quiet} {fullmove}"


def strength(level: int) -> StrengthProfile:
    if isinstance(level, bool) or not isinstance(level, int) or not 1 <= level <= 10:
        raise ValueError("Jieqi level must be between 1 and 10")
    nodes = (250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000)[level - 1]
    return StrengthProfile(nodes, 1, 1.0)


class JieqiMoveEngine(PikafishMoveEngine):
    def __init__(self):
        super().__init__()
        self.executable = Path(os.environ.get("LIXIANGQI_NODE") or shutil.which("node") or "node")

    def _executable_command(self) -> list[str]:
        return [str(self.executable), str(Path(__file__).resolve().parents[2] / "scripts/jieqi-engine/uci.mjs")]

    def _position_command(self, work: MoveWork) -> str:
        if work.variant != "jieqi" or work.observation is None:
            raise ValueError("Jieqi requires a player observation")
        # Never replay ordinary coordinates through concealed outcomes. Each request supplies
        # the current information set; authoritative history-dependent legality is searchmoves.
        return "position fen " + engine_fen(work.observation)

    def _permitted_result(self, engine_move: str | None, work: MoveWork) -> str | None:
        move = self._to_ui_move(engine_move) if engine_move else None
        if work.legal_moves is None or move not in work.legal_moves:
            raise RuntimeError("Jieqi engine returned a move outside the authoritative legal moves")
        return move
