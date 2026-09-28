"""Proofs for pawn arrival, palace crowning, and an identity-bound pawn chase."""

from dataclasses import dataclass

from .attack_evidence import checked_attackers
from .engine import EngineProtocolError, IncompleteSearchError
from .final_move_mates import final_moving_piece
from .models import SearchContext, VerifiedTrace, fen_side
from .patterns import PAWN_MATE_VERSIONS, TerminalPosition, pawn_mate_squares
from .pawn_chase import chasing_pawns
from .position import UI_MOVE, decode_position


@dataclass(frozen=True)
class PawnMate:
    theme: str

    @property
    def version(self) -> str:
        return PAWN_MATE_VERSIONS[self.theme]

    def squares(self, trace: VerifiedTrace) -> set[str] | None:
        terminal = TerminalPosition(
            trace.terminal.fen, trace.checkmate, fen_side(trace.terminal.fen)
        )
        squares = pawn_mate_squares(terminal, self.theme)
        if not squares:
            return set()
        if self.theme == "eunuchChasingEmperorKill":
            return chasing_pawns(trace, squares)
        if self.theme == "crowningMate":
            return squares
        piece = final_moving_piece(trace)
        if piece is None:
            return None
        parsed = UI_MOVE.fullmatch(trace.moves[-1])
        direction = 1 if terminal.losing_side == "black" else -1
        target = parsed[3] + parsed[4]
        if (
            piece.lower() != "p"
            or parsed[1] != parsed[3]
            or int(parsed[4]) - int(parsed[2]) != direction
        ):
            return set()
        return squares.intersection({target})

    def candidate(self, trace: VerifiedTrace) -> bool | None:
        squares = self.squares(trace)
        return None if squares is None else bool(squares)

    def stamp(self, trace: VerifiedTrace) -> dict:
        return {
            "logic_version": self.version,
            "terminal_fen": trace.terminal.fen,
            "positions": [d.position_fen for d in trace.decisions],
            "moves": list(trace.moves),
        }

    def evidence_outcome(self, trace: VerifiedTrace, record: object) -> str | None:
        if not isinstance(record, dict) or any(
            record.get(k) != v for k, v in self.stamp(trace).items()
        ):
            return None
        squares = self.squares(trace)
        if squares is None:
            return None
        if not squares:
            return "not_key"
        if self.theme == "eunuchChasingEmperorKill":
            return "key"
        checking = checked_attackers(record.get("terminal"), trace.terminal.fen)
        if checking is None:
            return None
        board = decode_position(trace.terminal.fen)
        red = fen_side(trace.terminal.fen) == "black"
        if any(board[s].isupper() != red for s in checking):
            return None
        return "key" if squares.intersection(checking) else "not_key"

    def assess(self, engine, trace: VerifiedTrace) -> dict:
        record = {**self.stamp(trace), "outcome": "inconclusive"}
        candidate = self.candidate(trace)
        if candidate is not True:
            record["outcome"] = "not_key" if candidate is False else "inconclusive"
            return record
        if self.theme == "eunuchChasingEmperorKill":
            record["outcome"] = "key"
            return record
        try:
            fen, checkers = engine.checking_pieces(
                SearchContext(trace.terminal.fen, ())
            )
            record["terminal"] = {"fen": fen, "checkers": list(checkers)}
            record["outcome"] = self.evidence_outcome(trace, record) or "inconclusive"
        except (
            EngineProtocolError,
            IncompleteSearchError,
            OSError,
            TimeoutError,
        ) as exc:
            record["reason"] = f"inspection_failed:{type(exc).__name__}"
        return record


ASSESSORS = tuple(PawnMate(theme) for theme in PAWN_MATE_VERSIONS)
THEMES = frozenset(PAWN_MATE_VERSIONS)
