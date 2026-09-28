"""Shared terminal attack inspections for named horse mating methods."""

from dataclasses import dataclass

from .attack_evidence import checked_attackers
from .engine import EngineProtocolError, IncompleteSearchError
from .models import SearchContext
from .position import decode_position
from .patterns import (
    HORSE_ROLE_VERSIONS,
    DOUBLE_HORSES_THEME,
    HORSE_CANNON_THEME,
    horse_cannon_screens,
    HORSE_ROLE_THEMES,
    SINGLE_HORSE_THEME,
    TerminalPosition,
    horse_role_candidate_squares,
    horse_role_escape_positions,
)


@dataclass(frozen=True)
class HorseRole:
    theme: str

    @property
    def version(self) -> str:
        return HORSE_ROLE_VERSIONS[self.theme]

    def candidate(self, terminal: TerminalPosition) -> bool:
        return bool(horse_role_candidate_squares(terminal, self.theme))

    def escape_positions(self, terminal: TerminalPosition):
        return horse_role_escape_positions(
            terminal, empty_only=self.theme == DOUBLE_HORSES_THEME
        )

    def evidence_outcome(
        self, terminal: TerminalPosition, record: object
    ) -> str | None:
        if (
            not isinstance(record, dict)
            or record.get("logic_version") != self.version
            or record.get("theme") != self.theme
            or record.get("terminal_fen") != terminal.fen
        ):
            return None
        checking = checked_attackers(record.get("terminal"), terminal.fen)
        if checking is None:
            return None
        horses = set(horse_role_candidate_squares(terminal, self.theme))
        single = self.theme == SINGLE_HORSE_THEME
        double = self.theme == DOUBLE_HORSES_THEME
        screens = {
            horse
            for cannon, horse in horse_cannon_screens(terminal).items()
            if cannon in checking
        }
        if not single and not double and not screens and checking & horses:
            return "key"
        expected = dict(self.escape_positions(terminal))
        inspections = record.get("escapes")
        if not isinstance(inspections, list) or len(inspections) != len(expected):
            return None
        seen = set()
        key = False
        all_attackers = set()
        all_blocked = bool(expected)
        horse_cannon = False
        double_horses = False
        for item in inspections:
            if not isinstance(item, dict):
                return None
            move = item.get("move")
            if not isinstance(move, str) or move not in expected or move in seen:
                return None
            seen.add(move)
            attackers = checked_attackers(item, expected[move])
            if attackers is None:
                return None
            # Shared coverage counts; the horse need not be the only attacker.
            key |= bool(attackers & horses)
            all_attackers.update(attackers)
            all_blocked &= bool(attackers)
            double_horses |= (
                len(checking) == 1
                and checking <= horses
                and len(attackers) == 1
                and attackers <= horses - checking
            )
            horse_cannon |= len(attackers) == 1 and bool(attackers & screens)
        if double:
            return "key" if self.candidate(terminal) and double_horses else "not_key"
        if self.theme == HORSE_CANNON_THEME:
            return "key" if horse_cannon else "not_key"
        if horse_cannon:
            # Keep horse-cannon mates separate even when another horse also
            # satisfies a named post. Both categories use the same proof.
            return "not_key"
        if single:
            general = "K" if terminal.winning_side == "red" else "k"
            flying_generals = {
                s for s, p in decode_position(terminal.fen).items() if p == general
            }
            # Exactly one contributing horse, with only flying-general support.
            # Other horses may be present but must not attack any escape.
            return (
                "key"
                if (
                    not checking
                    and all_blocked
                    and key
                    and len(all_attackers & horses) == 1
                    and all_attackers <= horses | flying_generals
                )
                else "not_key"
            )
        return "key" if key or checking & horses else "not_key"

    def assess(self, engine, terminal: TerminalPosition) -> dict:
        record = {
            "theme": self.theme,
            "logic_version": self.version,
            "terminal_fen": terminal.fen,
            "escapes": [],
            "outcome": "inconclusive",
        }
        try:
            inspected, checkers = engine.checking_pieces(
                SearchContext(terminal.fen, ())
            )
            record["terminal"] = {"fen": inspected, "checkers": list(checkers)}
            if (
                horse_cannon_screens(terminal)
                or self.theme in (SINGLE_HORSE_THEME, DOUBLE_HORSES_THEME)
                or not set(checkers)
                & set(horse_role_candidate_squares(terminal, self.theme))
            ):
                for move, fen in self.escape_positions(terminal):
                    inspected, checkers = engine.checking_pieces(SearchContext(fen, ()))
                    record["escapes"].append(
                        {"move": move, "fen": inspected, "checkers": list(checkers)}
                    )
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


ASSESSORS = tuple(HorseRole(theme) for theme in HORSE_ROLE_THEMES)
