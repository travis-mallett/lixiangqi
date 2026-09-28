"""Prove the palace-center advisor exchange and sole finishing-piece check."""

from dataclasses import dataclass

from .attack_evidence import checked_attackers
from .engine import EngineProtocolError, IncompleteSearchError
from .models import SearchContext, VerifiedTrace, fen_side
from .patterns import (
    THROAT_CUTTING_THEME,
    SMALL_THROAT_CUTTING_THEME,
    SMALL_THROAT_CUTTING_LOGIC_VERSION,
    THROAT_CUTTING_LOGIC_VERSION,
)
from .position import FenState, UI_MOVE, normalized_fen


@dataclass(frozen=True)
class ThroatCutting:
    theme: str
    version: str
    sacrifice: str
    finishers: str

    def candidate(self, trace: VerifiedTrace) -> bool | None:
        """False excludes the motif; None means the verified ledger is incomplete.

        Replay only the final three already-verified moves, checking each stored
        board. Legality and mate proof remain the verifier's responsibility.
        """
        if not trace.checkmate or len(trace.moves) < 3:
            return False
        if len(trace.decisions) != len(trace.moves):
            return None
        decisions = trace.decisions[-3:]
        if any(not decision.position_fen for decision in decisions):
            return None
        red = fen_side(trace.terminal.fen) == "black"
        sacrifice = self.sacrifice if red else self.sacrifice.lower()
        finishers = tuple(self.finishers if red else self.finishers.lower())
        advisor = "a" if red else "A"
        center = "e9" if red else "e2"
        state = FenState(decisions[0].position_fen)
        for index, (move, decision) in enumerate(zip(trace.moves[-3:], decisions)):
            if decision.selected_move != move or normalized_fen(
                state.fen()
            ) != normalized_fen(decision.position_fen):
                return None
            parsed = UI_MOVE.fullmatch(move)
            if not parsed:
                return None
            origin, target = parsed[1] + parsed[2], parsed[3] + parsed[4]
            expected_turn = "w" if red != (index == 1) else "b"
            if state.turn != expected_turn:
                return None
            piece, captured = state.position.get(origin), state.position.get(target)
            if index == 0 and (
                piece != sacrifice or target != center or captured != advisor
            ):
                return False
            if index == 1 and (
                piece != advisor or target != center or captured != sacrifice
            ):
                return False
            if index == 2 and piece not in finishers:
                return False
            state.push(move)
        if normalized_fen(state.fen()) != normalized_fen(trace.terminal.fen):
            return None
        return True

    def evidence_outcome(self, trace: VerifiedTrace, record: object) -> str | None:
        if (
            not isinstance(record, dict)
            or record.get("logic_version") != self.version
            or record.get("terminal_fen") != trace.terminal.fen
            or record.get("moves") != list(trace.moves[-3:])
        ):
            return None
        sequence = self.candidate(trace)
        if sequence is not True:
            return "not_key" if sequence is False else None
        checking = checked_attackers(record.get("terminal"), trace.terminal.fen)
        if checking is None:
            return None
        move = UI_MOVE.fullmatch(trace.moves[-1])
        return "key" if checking == {move[3] + move[4]} else "not_key"

    def assess(self, engine, trace: VerifiedTrace) -> dict:
        record = {
            "logic_version": self.version,
            "terminal_fen": trace.terminal.fen,
            "moves": list(trace.moves[-3:]),
            "outcome": "inconclusive",
        }
        sequence = self.candidate(trace)
        if sequence is not True:
            record["outcome"] = "not_key" if sequence is False else "inconclusive"
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


CHARIOT_MATE = ThroatCutting(
    THROAT_CUTTING_THEME, THROAT_CUTTING_LOGIC_VERSION, "R", "R"
)
SMALL_MATE = ThroatCutting(
    SMALL_THROAT_CUTTING_THEME, SMALL_THROAT_CUTTING_LOGIC_VERSION, "P", "RP"
)
ASSESSORS = (CHARIOT_MATE, SMALL_MATE)
THEMES = frozenset(role.theme for role in ASSESSORS)
