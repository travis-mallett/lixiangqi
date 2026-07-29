"""Shared value objects for engine-discovered Xiangqi puzzle mining."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any


RED = "red"
BLACK = "black"


def opposite(side: str) -> str:
    if side == RED:
        return BLACK
    if side == BLACK:
        return RED
    raise ValueError(f"unknown Xiangqi side: {side}")


def fen_side(fen: str) -> str:
    fields = fen.split()
    if len(fields) < 2 or fields[1] not in {"w", "b"}:
        raise ValueError("invalid Xiangqi FEN side to move")
    return RED if fields[1] == "w" else BLACK


@dataclass(frozen=True)
class EngineScore:
    """A UCI score and Pikafish WDL, always from one declared perspective.

    ``expected`` is normalized to [-1, 1] as (wins - losses) / 1000. Mate
    scores map to the endpoints. Discovery requires WDL for non-mating scores
    instead of applying a chess-trained centipawn sigmoid to Xiangqi values.
    """

    kind: str
    value: int
    wdl: tuple[int, int, int] | None = None
    bound: str | None = None

    def expected(self) -> float:
        if self.kind == "mate":
            return 1.0 if self.value > 0 else -1.0
        if self.kind != "cp":
            raise ValueError(f"unsupported engine score kind: {self.kind}")
        if self.wdl is None:
            raise ValueError("Pikafish returned a centipawn score without WDL")
        wins, _draws, losses = self.wdl
        return (wins - losses) / 1000.0

    def negated(self) -> "EngineScore":
        wdl = None if self.wdl is None else (self.wdl[2], self.wdl[1], self.wdl[0])
        bound = {"lower": "upper", "upper": "lower"}.get(self.bound, self.bound)
        return EngineScore(self.kind, -self.value, wdl, bound)

    def to_dict(self) -> dict[str, Any]:
        raw = asdict(self)
        raw["wdl"] = list(self.wdl) if self.wdl is not None else None
        raw["expected"] = self.expected()
        return raw

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "EngineScore":
        wdl = raw.get("wdl")
        return cls(
            kind=str(raw["kind"]),
            value=int(raw["value"]),
            wdl=tuple(int(value) for value in wdl) if wdl is not None else None,
            bound=raw.get("bound"),
        )


@dataclass(frozen=True)
class SearchLine:
    multipv: int
    depth: int
    seldepth: int
    nodes: int
    time_ms: int
    score: EngineScore
    moves: tuple[str, ...]

    def to_dict(self) -> dict[str, Any]:
        return {
            "multipv": self.multipv,
            "depth": self.depth,
            "seldepth": self.seldepth,
            "nodes": self.nodes,
            "time_ms": self.time_ms,
            "score": self.score.to_dict(),
            "moves": list(self.moves),
        }

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "SearchLine":
        return cls(
            multipv=int(raw["multipv"]),
            depth=int(raw["depth"]),
            seldepth=int(raw.get("seldepth", 0)),
            nodes=int(raw["nodes"]),
            time_ms=int(raw.get("time_ms", 0)),
            score=EngineScore.from_dict(raw["score"]),
            moves=tuple(raw["moves"]),
        )


@dataclass(frozen=True)
class SearchResult:
    engine_version: str
    nnue: str
    best_move: str | None
    lines: tuple[SearchLine, ...]

    @property
    def primary(self) -> SearchLine:
        if not self.lines:
            raise ValueError("engine search returned no principal line")
        return self.lines[0]

    def to_dict(self) -> dict[str, Any]:
        return {
            "engine_version": self.engine_version,
            "nnue": self.nnue,
            "best_move": self.best_move,
            "lines": [line.to_dict() for line in self.lines],
        }

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "SearchResult":
        return cls(
            engine_version=str(raw["engine_version"]),
            nnue=str(raw["nnue"]),
            best_move=raw.get("best_move"),
            lines=tuple(SearchLine.from_dict(line) for line in raw["lines"]),
        )


@dataclass(frozen=True)
class PositionStatus:
    fen: str
    checked: bool
    legal_moves: tuple[str, ...]

    @property
    def checkmate(self) -> bool:
        return self.checked and not self.legal_moves


@dataclass(frozen=True)
class SearchContext:
    initial_fen: str
    moves: tuple[str, ...]

    def extend(self, move: str) -> "SearchContext":
        return SearchContext(self.initial_fen, (*self.moves, move))


@dataclass(frozen=True)
class CandidateRecord:
    candidate_key: str
    source_database: str
    game_id: str
    source_url: str
    ply: int
    side_to_move: str
    pre_fen: str
    position_fen: str
    position_hash: str
    played_move: str
    best_move: str
    before_score: EngineScore
    after_score: EngineScore
    evaluation_loss: float
    candidate_type: str
    engine_version: str
    nnue: str
    search_settings: dict[str, Any]
