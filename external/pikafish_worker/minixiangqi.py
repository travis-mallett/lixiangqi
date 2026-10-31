"""Mini Xiangqi adapter for the same Fairy-Stockfish WASM shipped to browsers."""
import os
from pathlib import Path
import re
import shutil

from .ai import MoveWork, PikafishMoveEngine, StrengthProfile


def strength(level: int) -> StrengthProfile:
    if isinstance(level, bool) or not isinstance(level, int) or not 1 <= level <= 10:
        raise ValueError("Mini Xiangqi level must be between 1 and 10")
    nodes = (250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000)[level - 1]
    return StrengthProfile(nodes, 1, 1.0)


class MiniXiangqiMoveEngine(PikafishMoveEngine):
    _ui_move = _engine_move = re.compile(r"^[a-g][1-7][a-g][1-7]$")

    def __init__(self):
        super().__init__()
        self.executable = Path(os.environ.get("LIXIANGQI_NODE") or shutil.which("node") or "node")

    def _executable_command(self) -> list[str]:
        return [str(self.executable), str(Path(__file__).resolve().parents[2] / "scripts/minixiangqi-engine/uci.mjs")]

    def _position_command(self, work: MoveWork) -> str:
        if work.variant != "minixiangqi" or work.ruleset != "minixiangqi-v1":
            raise ValueError("Mini Xiangqi requires its native ruleset")
        return super()._position_command(work)

    @classmethod
    def _to_engine_move(cls, move: str) -> str:
        # Fairy-Stockfish uses one-based ranks on the 7x7 board, unlike Pikafish.
        if not cls._ui_move.fullmatch(move):
            raise ValueError(f"Invalid Mini Xiangqi move: {move}")
        return move

    _to_ui_move = _to_engine_move

    def _permitted_result(self, engine_move: str | None, work: MoveWork) -> str | None:
        move = self._to_ui_move(engine_move) if engine_move else None
        if work.legal_moves is None or move not in work.legal_moves:
            raise RuntimeError("Mini Xiangqi engine returned a move outside the authoritative legal moves")
        return move
