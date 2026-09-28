"""Verify chariot or pawn checkmate behind the Iron Bolt screen formation."""

from dataclasses import dataclass

from .attack_evidence import checked_attackers
from .engine import EngineProtocolError, IncompleteSearchError
from .models import RED, SearchContext
from .patterns import (
    IRON_BOLT_LOGIC_VERSIONS,
    IRON_BOLT_REQUIREMENTS,
    TerminalPosition,
    iron_bolt_candidate,
)
from .position import decode_position


@dataclass(frozen=True)
class IronBolt:
    theme: str

    @property
    def version(self) -> str:
        return IRON_BOLT_LOGIC_VERSIONS[self.theme]

    def candidate(self, terminal: TerminalPosition) -> bool:
        return iron_bolt_candidate(terminal, self.theme)

    def evidence_outcome(
        self, terminal: TerminalPosition, record: object
    ) -> str | None:
        if (
            not isinstance(record, dict)
            or record.get("logic_version") != self.version
            or record.get("terminal_fen") != terminal.fen
        ):
            return None
        if not self.candidate(terminal):
            return "not_key"
        checking = checked_attackers(record.get("terminal"), terminal.fen)
        if checking is None:
            return None
        board = decode_position(terminal.fen)
        if any(
            board[square].isupper() != (terminal.winning_side == RED)
            for square in checking
        ):
            return None
        return (
            "key"
            if any(
                board[s].upper() == IRON_BOLT_REQUIREMENTS[self.theme] for s in checking
            )
            else "not_key"
        )

    def assess(self, engine, terminal: TerminalPosition) -> dict:
        record = {
            "logic_version": self.version,
            "terminal_fen": terminal.fen,
            "outcome": "inconclusive",
        }
        if not self.candidate(terminal):
            record["outcome"] = "not_key"
            return record
        try:
            fen, checkers = engine.checking_pieces(SearchContext(terminal.fen, ()))
            record["terminal"] = {"fen": fen, "checkers": list(checkers)}
            record["outcome"] = (
                self.evidence_outcome(terminal, record) or "inconclusive"
            )
        except (
            EngineProtocolError,
            IncompleteSearchError,
            OSError,
            TimeoutError,
        ) as exc:
            record["reason"] = f"inspection_failed:{type(exc).__name__}"
        return record


ASSESSORS = tuple(IronBolt(theme) for theme in IRON_BOLT_REQUIREMENTS)
THEMES = frozenset(IRON_BOLT_REQUIREMENTS)
