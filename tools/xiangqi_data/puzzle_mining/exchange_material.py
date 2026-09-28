"""An opening equal-piece exchange with a bounded, retained material gain.

Continuation searches are category evidence only; the verified solve is immutable.
"""

import hashlib
import json

from .engine import construction_budget
from .models import PositionStatus, SearchResult, fen_side
from .position import FenState, UI_MOVE, normalized_fen
from .solver import SolutionReview, SolverConfig, _analyse_with_retry

THEME = "exchangingToWinMaterial"
VERSION = "3"
PIECE_VALUES = {"a": 2, "b": 2, "n": 4, "c": 4, "r": 9, "k": 0}
MIN_GAIN = 3
RETENTION = 0.75
CHECK_PLIES = 5
MAX_PLIES = 7
SOLVER_CHOICES = 4


def material_balance(board, red):
    """Winning-side material minus defending-side material; generals cancel."""
    total = 0
    for square, piece in board.items():
        if piece.lower() == "p":
            crossed = int(square[1:]) >= 6 if piece.isupper() else int(square[1:]) <= 5
            value = 2 if crossed else 1
        else:
            value = PIECE_VALUES[piece.lower()]
        total += value if piece.isupper() == red else -value
    return total


def inspect_exchange(trace, *, pre_fen, setup_move):
    """Return audit data, or None when the verified move ledger is incomplete."""
    if not trace.complete:
        return None
    if len(trace.moves) < 2:
        return {"opening_exchange": False, "reason": "no_immediate_reply"}
    if len(trace.decisions) != len(trace.moves):
        return None
    try:
        state = FenState(trace.decisions[0].position_fen)
        red = state.turn == "w"
        setup = FenState(pre_fen)
        if setup.turn == state.turn:
            return None
        initial = material_balance(setup.position, red)
        setup.push(setup_move)
        if normalized_fen(setup.fen()) != normalized_fen(state.fen()):
            return None
        opening_trade = False
        recapture = False
        exchange_square = None
        sacrificed = None
        context = trace.decisions[0].context
        for index, (move, decision) in enumerate(zip(trace.moves, trace.decisions)):
            if (
                decision.context != context
                or decision.selected_move != move
                or move not in decision.legal_moves
                or decision.certainty != "certain"
                or decision.side != fen_side(state.fen())
                or normalized_fen(state.fen()) != normalized_fen(decision.position_fen)
            ):
                return None
            parsed = UI_MOVE.fullmatch(move)
            if parsed is None:
                return None
            origin, target = parsed[1] + parsed[2], parsed[3] + parsed[4]
            piece, captured = state.position.get(origin), state.position.get(target)
            if piece is None or piece.isupper() != (state.turn == "w"):
                return None
            if captured is not None and (
                captured.isupper() == piece.isupper() or captured.lower() == "k"
            ):
                return None
            if index == 0:
                exchange_square, sacrificed = target, piece
                opening_trade = captured is not None and (
                    (piece.lower() in {"n", "c"} and captured.lower() in {"n", "c"})
                    or piece.lower() == captured.lower() == "r"
                )
            elif index == 1:
                recapture = target == exchange_square and captured == sacrificed
            state.push(move)
            context = context.extend(move)
        if normalized_fen(state.fen()) != normalized_fen(trace.terminal.fen):
            return None
        final = material_balance(state.position, red)
    except (ValueError, IndexError, KeyError):
        return None
    return {
        "opening_exchange": opening_trade and recapture,
        "exchange_square": exchange_square,
        "initial_fen": normalized_fen(pre_fen),
        "setup_move": setup_move,
        "initial_balance": initial,
        "terminal_balance": final,
        "material_gain": final - initial,
    }


def trace_key(trace):
    return hashlib.sha256(
        json.dumps(trace.to_dict(), sort_keys=True).encode()
    ).hexdigest()


def evidence_outcome(trace, record, *, pre_fen, setup_move):
    if (
        not isinstance(record, dict)
        or record.get("logic_version") != VERSION
        or record.get("trace_key") != trace_key(trace)
    ):
        return None
    audit = inspect_exchange(trace, pre_fen=pre_fen, setup_move=setup_move)
    if audit is None or record.get("material") != audit:
        return None
    if not audit["opening_exchange"] or audit["material_gain"] < MIN_GAIN:
        return "not_key"
    if trace.terminal_win:
        return (
            "key"
            if fen_side(trace.terminal.fen) != trace.decisions[0].side
            else "not_key"
        )
    try:
        depth, advantage = _settings(trace)
        retention = record["retention"]
        if retention["depth"] != depth or retention["advantage"] != advantage:
            return None
        defense = SearchResult.from_dict(retention["defense"])
        _validate_search(defense, trace.terminal, depth, 1)
        if defense.primary.score.negated().expected() < advantage:
            return None
        response = PositionStatus(**retention["response"])
        state = FenState(trace.terminal.fen)
        state.push(defense.best_move)
        if normalized_fen(state.fen()) != normalized_fen(response.fen):
            return None
        choices = SearchResult.from_dict(retention["choices"])
        _validate_search(choices, response, depth, SOLVER_CHOICES)
        winning = [line for line in choices.lines if line.score.expected() >= advantage]
        if not winning:
            return None
        continuations = retention["continuations"]
        outcomes = []
        # Require exactly the examined winning choices. A missing alternative
        # must not turn incomplete evidence into a negative classification.
        if len(continuations) != len(winning):
            return None
        for line, positions in zip(winning, continuations):
            statuses = [response, *(PositionStatus(**item) for item in positions)]
            outcomes.append(
                _continuation_outcome(trace, audit, defense.best_move, line, statuses)
            )
        if "key" in outcomes:
            return "key"
        return "not_key" if all(outcome == "not_key" for outcome in outcomes) else None
    except (KeyError, TypeError, ValueError, IndexError, SolutionReview):
        return None


def _settings(trace):
    """Use the shared solver depth and the verified winning threshold."""
    if (
        trace.endpoint is None
        or trace.objective != "advantage"
        or len(trace.moves) % 2 != 1
    ):
        raise SolutionReview("exchange_missing_verification_settings")
    return SolverConfig().depth, trace.endpoint.advantage


def _validate_search(result, status, depth, width):
    expected = min(width, len(status.legal_moves))
    if (
        not expected
        or result.search_depth != depth
        or result.requested_multipv != expected
        or len(result.lines) != expected
        or any(not line.moves for line in result.lines)
        or result.best_move != result.primary.moves[0]
        or len({line.moves[0] for line in result.lines}) != expected
        or any(
            line.moves[0] not in status.legal_moves
            or line.depth < depth
            or line.score.bound is not None
            for line in result.lines
        )
    ):
        raise SolutionReview("exchange_incomplete_search")


def _continuation_outcome(trace, audit, defense, line, statuses):
    """Replay evidence, judging only settled checkpoints after defender moves.

    At five plies a quiet retained gain passes. Otherwise inspect seven. Check,
    a pending capture, repetition or a short PV cannot certify a settled loss.
    """
    moves = (defense, *line.moves)
    state = FenState(trace.terminal.fen)
    red = trace.decisions[0].side == "red"
    previous = trace.terminal
    seen = {normalized_fen(state.fen())}
    required = RETENTION * audit["material_gain"]
    if not 1 <= len(statuses) <= MAX_PLIES:
        return None
    for ply, status in enumerate(statuses, 1):
        if ply > len(moves) or moves[ply - 1] not in previous.legal_moves:
            return None
        state.push(moves[ply - 1])
        fen = normalized_fen(state.fen())
        if fen != normalized_fen(status.fen) or fen in seen:
            return None
        seen.add(fen)
        gain = material_balance(state.position, red) - audit["initial_balance"]
        if status.terminal_win:
            return (
                "key" if (state.turn == "w") != red and gain >= required else "not_key"
            )
        if ply in {CHECK_PLIES, MAX_PLIES}:
            # A short nonterminal PV does not show whether a recapture is due.
            if ply >= len(moves) or moves[ply] not in status.legal_moves:
                return None
            next_move = UI_MOVE.fullmatch(moves[ply])
            target = next_move[3] + next_move[4]
            unsettled = status.checked or target in state.position
            if not unsettled and gain >= required:
                return "key"
            if ply == MAX_PLIES:
                return None if unsettled else "not_key"
        previous = status
    return None


def _status_record(status):
    return {
        "fen": status.fen,
        "checked": status.checked,
        "legal_moves": list(status.legal_moves),
    }


def _retention(engine, trace, audit):
    depth, advantage = _settings(trace)
    config = SolverConfig(depth=depth)
    context = trace.decisions[-1].context.extend(trace.moves[-1])
    inspections = {}

    def inspect(at):
        if at not in inspections:
            inspections[at] = engine.inspect(at)
        return inspections[at]

    def search(at, status, width):
        result = _analyse_with_retry(
            engine,
            at,
            depth=depth,
            multi_pv=min(width, len(status.legal_moves)),
            config=config,
        )
        _validate_search(result, status, depth, width)
        return result

    # The existing engine deadline bounds the whole category, including retries.
    # Reset once per puzzle so classification order cannot supply search history.
    with construction_budget(engine):
        engine.new_game()
        terminal = inspect(context)
        if normalized_fen(terminal.fen) != normalized_fen(trace.terminal.fen):
            raise SolutionReview("exchange_terminal_mismatch")
        if terminal.terminal_win:
            raise SolutionReview("exchange_terminal_without_continuation")
        defense = search(context, terminal, 1)
        context = context.extend(defense.best_move)
        response = inspect(context)
        if response.terminal_win:
            raise SolutionReview("exchange_no_winning_reply")
        choices = search(context, response, SOLVER_CHOICES)
        continuations = []
        for line in choices.lines:
            if line.score.expected() < advantage:
                continue
            at = context
            statuses = [response]
            for move in line.moves[: MAX_PLIES - 1]:
                if move not in statuses[-1].legal_moves:
                    raise SolutionReview("exchange_illegal_continuation")
                at = at.extend(move)
                statuses.append(inspect(at))
                if statuses[-1].terminal_win or (
                    len(statuses) == CHECK_PLIES
                    and _continuation_outcome(
                        trace, audit, defense.best_move, line, statuses
                    )
                    == "key"
                ):
                    break
            continuations.append([_status_record(status) for status in statuses[1:]])
        return {
            "depth": depth,
            "advantage": advantage,
            "defense": defense.to_dict(),
            "response": _status_record(response),
            "choices": choices.to_dict(),
            "continuations": continuations,
        }


def assess(engine, trace, *, pre_fen, setup_move):
    record = {
        "logic_version": VERSION,
        "trace_key": trace_key(trace),
        "material": inspect_exchange(trace, pre_fen=pre_fen, setup_move=setup_move),
        "outcome": "inconclusive",
    }
    audit = record["material"]
    if (
        audit
        and audit["opening_exchange"]
        and audit["material_gain"] >= MIN_GAIN
        and not trace.terminal_win
        and engine is not None
    ):
        record["retention"] = _retention(engine, trace, audit)
    record["outcome"] = (
        evidence_outcome(trace, record, pre_fen=pre_fen, setup_move=setup_move)
        or "inconclusive"
    )
    return record
