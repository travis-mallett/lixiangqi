"""Detect a newly created double attack ending at the verified payoff."""

import hashlib
import json

from .attack_evidence import geometric_attack
from .models import SearchContext, fen_side
from .position import UI_MOVE, FenState, normalized_fen
from .solver import SolutionReview
from .tactic_solver import capture_preserves_advantage

THEME = "winningMaterialByDoubleAttack"
VERSION = "3"
PIECE_VALUES = {"p": 1, "a": 2, "b": 2, "n": 4, "c": 4, "r": 9, "k": float("inf")}


def squares(move):
    parsed = UI_MOVE.fullmatch(move)
    if not parsed:
        raise ValueError(f"Invalid move: {move}")
    return parsed[1] + parsed[2], parsed[3] + parsed[4]


def trace_key(trace):
    return hashlib.sha256(
        json.dumps(trace.to_dict(), sort_keys=True).encode()
    ).hexdigest()


def evidence_outcome(trace, record):
    if (
        not isinstance(record, dict)
        or record.get("logic_version") != VERSION
        or record.get("trace_key") != trace_key(trace)
    ):
        return None
    outcome = record.get("outcome")
    if outcome == "key":
        if len(trace.moves) < 3 or not capture_preserves_advantage(
            trace, len(trace.moves)
        ):
            return None
        if record.get("fork_ply") != len(trace.moves) - 2:
            return None
    return outcome if outcome in {"key", "not_key"} else None


class ThreatInspector:
    """Per-candidate cache of cheap engine king-safety and recapture inspections."""

    def __init__(self, engine):
        self.engine = engine
        self.checks = {}
        self.legal = {}

    def checkers(self, state, red):
        fen = f"{state.fen().split()[0]} {'w' if red else 'b'} - - 0 1"
        if fen not in self.checks:
            inspected, checkers = self.engine.checking_pieces(SearchContext(fen, ()))
            if normalized_fen(inspected) != normalized_fen(fen):
                raise SolutionReview("fork_inspection_mismatch")
            self.checks[fen] = tuple(checkers)
        return self.checks[fen]

    def qualifies(self, state, origin, target):
        piece, victim = state.position.get(origin), state.position.get(target)
        if not piece or not victim or piece.isupper() == victim.isupper():
            return False
        red = piece.isupper()
        if victim.lower() == "k":
            return origin in self.checkers(state, not red)
        if not geometric_attack(state.position, origin, target):
            return False
        # Build the hypothetical capture only after the movement filter. Ask
        # Pikafish whether it leaves our general attacked, avoiding duplicate
        # pin/flying-general/check-evasion rules in the detector.
        captured = FenState(state.fen())
        captured.turn = "w" if red else "b"
        captured.push(origin + target)
        if self.checkers(captured, red):
            return False
        if PIECE_VALUES[victim.lower()] > PIECE_VALUES[piece.lower()]:
            return True
        fen = captured.fen()
        if fen not in self.legal:
            status = self.engine.inspect(SearchContext(fen, ()))
            if normalized_fen(status.fen) != normalized_fen(fen):
                raise SolutionReview("fork_recapture_inspection_mismatch")
            self.legal[fen] = status.legal_moves
        return not any(squares(move)[1] == target for move in self.legal[fen])

    def evidence(self):
        return {
            "checks": [
                {"fen": fen, "checkers": list(squares)}
                for fen, squares in self.checks.items()
            ],
            "recaptures": [
                {"fen": fen, "legal_moves": list(moves)}
                for fen, moves in self.legal.items()
            ],
        }


def boards(trace):
    """Validate the saved ledger while replaying, without engine search."""
    if (
        not trace.complete
        or not trace.moves
        or len(trace.decisions) != len(trace.moves)
    ):
        raise SolutionReview("fork_incomplete_ledger")
    state = FenState(trace.decisions[0].position_fen)
    positions = []
    base = trace.decisions[0].context
    for move, decision in zip(trace.moves, trace.decisions):
        if (
            decision.context != base
            or decision.selected_move != move
            or move not in decision.legal_moves
            or decision.certainty != "certain"
            or normalized_fen(state.fen()) != normalized_fen(decision.position_fen)
            or fen_side(state.fen()) != decision.side
        ):
            raise SolutionReview("fork_incoherent_ledger")
        positions.append(FenState(state.fen()))
        state.push(move)
        base = base.extend(move)
    if normalized_fen(state.fen()) != normalized_fen(trace.terminal.fen):
        raise SolutionReview("fork_incoherent_terminal")
    return positions


def assess(engine, trace):
    record = {
        "logic_version": VERSION,
        "trace_key": trace_key(trace),
        "outcome": "not_key",
    }
    if trace.objective != "advantage":
        return record
    positions = boards(trace)
    plies = len(trace.moves)
    # Work backward from the verified endpoint. The solver must create the
    # fork, receive a defense and capture; the automatic setup is not a move
    # the player has to find. An earlier incidental fork cannot trim the line.
    if plies < 3 or plies % 2 != 1:
        return {**record, "reason": "fork_creation_not_in_solution"}
    solver = trace.decisions[0].side
    if (
        trace.decisions[-3].side != solver
        or trace.decisions[-2].side == solver
        or trace.decisions[-1].side != solver
    ):
        raise SolutionReview("fork_incoherent_sides")
    origin, target = squares(trace.moves[-1])
    before_creation, before_defense, after_defense = positions[-3:]
    if target not in after_defense.position:
        return {**record, "reason": "endpoint_not_capture"}
    defender_origin, defender_target = squares(trace.moves[-2])
    if (
        before_defense.position.get(origin) != after_defense.position.get(origin)
        or defender_origin == origin
    ):
        return record
    piece = before_defense.position[origin]
    creator_origin, creator_target = squares(trace.moves[-3])
    # Moving another piece can create a fork by changing a screen or blocker.
    attacker_before = creator_origin if creator_target == origin else origin
    if before_creation.position.get(attacker_before) != piece:
        raise SolutionReview("fork_incoherent_attacker")
    possible = [
        s
        for s, p in before_defense.position.items()
        if p.isupper() != piece.isupper()
        and (p.lower() == "k" or geometric_attack(before_defense.position, origin, s))
    ]
    if target not in possible or len(possible) < 2:
        return record
    if engine is None:
        return {**record, "outcome": "inconclusive"}
    inspector = ThreatInspector(engine)

    def result(**details):
        return {**record, **details, "inspections": inspector.evidence()}

    # Adding a second threat does not create the eventual material opportunity
    # if this same piece could already make that profitable capture directly.
    if inspector.qualifies(before_creation, attacker_before, target):
        return result(reason="payoff_already_available")
    if not inspector.qualifies(
        before_defense, origin, target
    ) or not inspector.qualifies(after_defense, origin, target):
        return result()
    saved = []
    for other in possible:
        if other == target or not inspector.qualifies(before_defense, origin, other):
            continue
        destination = defender_target if other == defender_origin else other
        if not inspector.qualifies(after_defense, origin, destination):
            saved.append({"before": other, "after": destination})
    if not saved or not capture_preserves_advantage(trace, plies):
        return result()
    return result(
        outcome="key",
        fork_ply=plies - 2,
        fork_fen=before_defense.fen(),
        creation_move=trace.moves[-3],
        before_creation_fen=before_creation.fen(),
        attacker_before=attacker_before,
        attacker=origin,
        captured_target=target,
        saved_targets=saved,
    )
