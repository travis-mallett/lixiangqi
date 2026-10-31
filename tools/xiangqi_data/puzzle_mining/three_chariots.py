"""Three distinct chariot/pawn identities, with a captured or pinned advisor.

The final checkers must all be chariots/pawns. A different chariot/pawn must
control a terminal palace escape; a third must check during the solution or
capture an advisor. At least one of the three is a pawn. Advisor interaction
must belong to the selected triple, but need not involve an actual exchange.
"""

from .attack_evidence import checked_attackers, geometric_attack
from .engine import EngineProtocolError, IncompleteSearchError
from .models import SearchContext, fen_side
from .patterns import THREE_CHARIOTS_THEME as THEME, THREE_CHARIOTS_VERSION as VERSION
from .position import FenState, UI_MOVE, general_escape_positions, normalized_fen


def _replay(trace):
    """Validate the entire ledger and preserve identities, including sacrifices."""
    if not trace.moves or len(trace.moves) != len(trace.decisions):
        raise ValueError("missing move ledger")
    red = fen_side(trace.terminal.fen) == "black"
    state = FenState(trace.decisions[0].position_fen)
    if (state.turn == "w") != red:
        raise ValueError("solution must start with attacker")
    identities = {s: s for s in state.position}
    kinds = {
        s: p.lower()
        for s, p in state.position.items()
        if p.isupper() == red and p.lower() in {"r", "p"}
    }
    captures, pins, frames = set(), set(), []

    def record_pins():
        general = next(
            s for s, p in state.position.items() if p == ("k" if red else "K")
        )
        for square, piece in state.position.items():
            if piece != ("a" if red else "A"):
                continue
            without = dict(state.position)
            del without[square]
            for origin, chariot in state.position.items():
                if chariot == ("R" if red else "r") and (
                    not geometric_attack(state.position, origin, general)
                    and geometric_attack(without, origin, general)
                ):
                    pins.add(identities[origin])

    record_pins()
    for move, decision in zip(trace.moves, trace.decisions):
        if decision.selected_move != move or normalized_fen(
            state.fen()
        ) != normalized_fen(decision.position_fen):
            raise ValueError("inconsistent move ledger")
        parsed = UI_MOVE.fullmatch(move)
        if parsed is None:
            raise ValueError("invalid move")
        origin, target = parsed[1] + parsed[2], parsed[3] + parsed[4]
        piece = state.position.get(origin)
        if piece is None or piece.isupper() != (state.turn == "w"):
            raise ValueError("invalid moving piece")
        identity = identities.pop(origin)
        attacker_move = piece.isupper() == red
        if identity in kinds and state.position.get(target) == ("a" if red else "A"):
            captures.add(identity)
        identities.pop(target, None)
        identities[target] = identity
        state.push(move)
        record_pins()
        if attacker_move:
            frames.append((state.fen(), dict(identities)))
    if normalized_fen(state.fen()) != normalized_fen(trace.terminal.fen):
        raise ValueError("terminal board differs from ledger")
    return kinds, captures, pins, frames


def candidate(trace):
    if not trace.checkmate:
        return False
    try:
        kinds, captures, pins, _ = _replay(trace)
        return len(kinds) >= 3 and "p" in kinds.values() and bool(captures | pins)
    except (ValueError, IndexError, KeyError, StopIteration):
        return None


def stamp(trace):
    return {
        "logic_version": VERSION,
        "terminal_fen": trace.terminal.fen,
        "moves": list(trace.moves),
        "positions": [d.position_fen for d in trace.decisions],
    }


def evidence_outcome(trace, record):
    if not isinstance(record, dict) or any(
        record.get(k) != v for k, v in stamp(trace).items()
    ):
        return None
    possible = candidate(trace)
    if possible is not True:
        return "not_key" if possible is False else None
    kinds, captures, pins, frames = _replay(trace)
    inspections = record.get("checks")
    escapes = record.get("escapes")
    expected = dict(
        general_escape_positions(trace.terminal.fen, fen_side(trace.terminal.fen))
    )
    if (
        not isinstance(inspections, list)
        or len(inspections) != len(frames)
        or not isinstance(escapes, list)
        or len(escapes) != len(expected)
    ):
        return None
    historical = set()
    final = set()
    for (fen, identities), inspection in zip(frames, inspections):
        checking = checked_attackers(inspection, fen)
        if checking is None:
            return None
        board = FenState(fen).position
        if any(
            board[s].isupper() != (fen_side(trace.terminal.fen) == "black")
            for s in checking
        ):
            return None
        final = {identities[s] for s in checking}
        historical.update(final & kinds.keys())
    terminal_ids = frames[-1][1]
    controllers, seen = set(), set()
    for inspection in escapes:
        if not isinstance(inspection, dict):
            return None
        move = inspection.get("move")
        if not isinstance(move, str) or move not in expected or move in seen:
            return None
        seen.add(move)
        checking = checked_attackers(inspection, expected[move])
        if checking is None:
            return None
        board = FenState(expected[move]).position
        if any(
            board[s].isupper() != (fen_side(trace.terminal.fen) == "black")
            for s in checking
        ):
            return None
        controllers.update(
            terminal_ids[s] for s in checking if terminal_ids.get(s) in kinds
        )
    if not final or not final <= kinds.keys():
        return "not_key"
    for finisher in final:
        for controller in controllers - {finisher}:
            for third in (historical | captures) - {finisher, controller}:
                triple = {finisher, controller, third}
                if any(kinds[p] == "p" for p in triple) and triple & (captures | pins):
                    return "key"
    return "not_key"


def assess(engine, trace):
    record = {**stamp(trace), "checks": [], "escapes": [], "outcome": "inconclusive"}
    possible = candidate(trace)
    if possible is not True:
        record["outcome"] = "not_key" if possible is False else "inconclusive"
        return record
    try:
        _, _, _, frames = _replay(trace)
        # Reuse identical boards, including the terminal inspection in the ledger.
        cache = {}

        def inspect(fen):
            if fen not in cache:
                inspected, checkers = engine.checking_pieces(SearchContext(fen, ()))
                cache[fen] = {"fen": inspected, "checkers": list(checkers)}
            return dict(cache[fen])

        for fen, _ in frames:
            record["checks"].append(inspect(fen))
        for move, fen in general_escape_positions(
            trace.terminal.fen, fen_side(trace.terminal.fen)
        ):
            record["escapes"].append({"move": move, **inspect(fen)})
        record["outcome"] = evidence_outcome(trace, record) or "inconclusive"
    except (EngineProtocolError, IncompleteSearchError, OSError, TimeoutError) as exc:
        record["reason"] = f"inspection_failed:{type(exc).__name__}"
    return record
