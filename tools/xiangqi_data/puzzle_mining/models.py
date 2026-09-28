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
        # Some test engines and third-party UCI implementations omit WDL for
        # a CP score.  Preserve the raw score for evidence serialization;
        # callers that need a normalized expectation still use expected(),
        # which deliberately rejects missing WDL.
        raw["expected"] = (
            self.expected() if self.wdl is not None or self.kind == "mate" else None
        )
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
    search_nodes: int | None = None
    requested_multipv: int | None = None
    search_depth: int | None = None

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
            "search_nodes": self.search_nodes,
            "requested_multipv": self.requested_multipv,
            "search_depth": self.search_depth,
        }

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "SearchResult":
        return cls(
            engine_version=str(raw["engine_version"]),
            nnue=str(raw["nnue"]),
            best_move=raw.get("best_move"),
            lines=tuple(SearchLine.from_dict(line) for line in raw["lines"]),
            search_nodes=raw.get("search_nodes"),
            requested_multipv=raw.get("requested_multipv"),
            search_depth=raw.get("search_depth"),
        )


@dataclass(frozen=True)
class PositionStatus:
    fen: str
    checked: bool
    legal_moves: tuple[str, ...]

    @property
    def checkmate(self) -> bool:
        return self.checked and not self.legal_moves

    @property
    def stalemate(self) -> bool:
        """Whether the side to move has no legal move without being checked."""
        return not self.checked and not self.legal_moves

    @property
    def terminal_win(self) -> bool:
        """Whether the side to move has lost by checkmate or stalemate."""
        return self.checkmate or self.stalemate


@dataclass(frozen=True)
class SearchContext:
    initial_fen: str
    moves: tuple[str, ...]

    def extend(self, move: str) -> "SearchContext":
        return SearchContext(self.initial_fen, (*self.moves, move))


@dataclass(frozen=True)
class VerifiedDecision:
    """One accepted engine decision in a verified solution trace.

    Keeping the complete MultiPV result at each decision is intentional: motif
    classifiers may inspect the path later, and publication can show the
    evidence that established the canonical line without rerunning the engine.
    """

    context: SearchContext
    side: str
    legal_moves: tuple[str, ...]
    selected_move: str
    analysis: SearchResult
    certainty: str = "certain"
    uncertainty: str | None = None
    position_fen: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "initial_fen": self.context.initial_fen,
            "context_moves": list(self.context.moves),
            "side": self.side,
            "legal_moves": list(self.legal_moves),
            "selected_move": self.selected_move,
            "analysis": self.analysis.to_dict(),
            "certainty": self.certainty,
            "uncertainty": self.uncertainty,
            "position_fen": self.position_fen,
        }

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "VerifiedDecision":
        return cls(
            context=SearchContext(
                str(raw["initial_fen"]), tuple(raw.get("context_moves", ()))
            ),
            side=str(raw["side"]),
            legal_moves=tuple(raw.get("legal_moves", ())),
            selected_move=str(raw["selected_move"]),
            analysis=SearchResult.from_dict(raw["analysis"]),
            certainty=str(raw.get("certainty", "certain")),
            uncertainty=raw.get("uncertainty"),
            position_fen=str(raw.get("position_fen", "")),
        )


@dataclass(frozen=True)
class TacticEndpoint:
    """Unplayed endpoint analysis and the defense beyond the playable solution."""

    reason: str
    advantage: float
    uniqueness_gap: float
    defense: VerifiedDecision | None = None
    decision: VerifiedDecision | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "reason": self.reason,
            "advantage": self.advantage,
            "uniqueness_gap": self.uniqueness_gap,
            "defense": self.defense.to_dict() if self.defense else None,
            "decision": self.decision.to_dict() if self.decision else None,
        }

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "TacticEndpoint":
        return cls(
            reason=str(raw["reason"]),
            advantage=float(raw["advantage"]),
            uniqueness_gap=float(raw["uniqueness_gap"]),
            defense=(
                VerifiedDecision.from_dict(raw["defense"])
                if raw.get("defense")
                else None
            ),
            decision=(
                VerifiedDecision.from_dict(raw["decision"])
                if raw.get("decision")
                else None
            ),
        )


@dataclass(frozen=True)
class VerifiedTrace:
    """A coherent verified line, with separate evidence for a tactical endpoint."""

    moves: tuple[str, ...]
    terminal: PositionStatus
    decisions: tuple[VerifiedDecision, ...] = ()
    objective: str = "mate"
    # Callers must explicitly state that another verifier established this
    # trace.  A FEN-shaped object alone is never proof of a tactical result.
    verified: bool = False
    endpoint: TacticEndpoint | None = None

    @property
    def complete(self) -> bool:
        return self.verified and bool(self.terminal.fen)

    @property
    def checkmate(self) -> bool:
        return (
            self.complete and self.terminal.checkmate and not self.terminal.legal_moves
        )

    @property
    def stalemate(self) -> bool:
        return self.complete and self.terminal.stalemate

    @property
    def terminal_win(self) -> bool:
        return self.complete and self.terminal.terminal_win

    def to_dict(self) -> dict[str, Any]:
        return {
            "moves": list(self.moves),
            "terminal": {
                "fen": self.terminal.fen,
                "checked": self.terminal.checked,
                "legal_moves": list(self.terminal.legal_moves),
            },
            "decisions": [decision.to_dict() for decision in self.decisions],
            "objective": self.objective,
            "verified": self.verified,
            **({"endpoint": self.endpoint.to_dict()} if self.endpoint else {}),
        }

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "VerifiedTrace":
        terminal_raw = raw["terminal"]
        return cls(
            moves=tuple(raw.get("moves", ())),
            terminal=PositionStatus(
                fen=str(terminal_raw["fen"]),
                checked=bool(terminal_raw["checked"]),
                legal_moves=tuple(terminal_raw.get("legal_moves", ())),
            ),
            decisions=tuple(
                VerifiedDecision.from_dict(item) for item in raw.get("decisions", ())
            ),
            objective=str(raw.get("objective", "mate")),
            verified=bool(raw.get("verified", False)),
            endpoint=(
                TacticEndpoint.from_dict(raw["endpoint"])
                if raw.get("endpoint")
                else None
            ),
        )


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
