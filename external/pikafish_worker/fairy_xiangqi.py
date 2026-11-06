"""Mini Xiangqi and Manchu+ adapter for the Fairy-Stockfish WASM shipped to browsers."""
from dataclasses import replace
import os
from pathlib import Path
import re
import shutil

from .ai import MoveWork, PikafishMoveEngine, StrengthProfile


def strength(level: int) -> StrengthProfile:
    if isinstance(level, bool) or not isinstance(level, int) or not 1 <= level <= 10:
        raise ValueError("Variant level must be between 1 and 10")
    nodes = (250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000)[level - 1]
    return StrengthProfile(nodes, 1, 1.0)


class FairyXiangqiMoveEngine(PikafishMoveEngine):
    def __init__(self, variant: str):
        if variant not in {"minixiangqi", "manchu"}:
            raise ValueError("Unsupported Fairy-Stockfish variant")
        super().__init__()
        self.variant = variant
        self._ui_move = self._engine_move = re.compile(
            r"^[a-g][1-7][a-g][1-7]$" if variant == "minixiangqi" else r"^[a-i](?:10|[1-9])[a-i](?:10|[1-9])$"
        )
        self.executable = Path(os.environ.get("LIXIANGQI_NODE") or shutil.which("node") or "node")

    def _executable_command(self) -> list[str]:
        return [str(self.executable), str(Path(__file__).resolve().parents[2] / "scripts/fairy-stockfish-engine/uci.mjs"), self.variant]

    def _position_command(self, work: MoveWork) -> str:
        if work.variant != self.variant or work.ruleset != f"{self.variant}-v1":
            raise ValueError("Variant requires its native ruleset")
        if self.variant == "manchu":
            fields = work.initial_fen.split()
            if fields[2] == "m":
                fields[2] = "-"
            work = replace(work, initial_fen=" ".join(fields))
        return super()._position_command(work)

    def _to_engine_move(self, move: str) -> str:
        # Fairy-Stockfish uses one-based ranks for both variants, unlike Pikafish.
        if not self._ui_move.fullmatch(move):
            raise ValueError(f"Invalid {self.variant} move: {move}")
        return move

    _to_ui_move = _to_engine_move

    def _permitted_result(self, engine_move: str | None, work: MoveWork) -> str | None:
        move = self._to_ui_move(engine_move) if engine_move else None
        if work.legal_moves is None or move not in work.legal_moves:
            raise RuntimeError("Variant engine returned a move outside the authoritative legal moves")
        return move
