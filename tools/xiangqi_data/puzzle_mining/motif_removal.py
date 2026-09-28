"""Engine-backed key-piece verification shared by terminal motif classifiers."""

from __future__ import annotations

from typing import Any

from .engine import (
    EngineCancelled,
    EngineProtocolError,
    IncompleteSearchError,
    PuzzleEngine,
)
from .models import SearchContext, PositionStatus, fen_side
from .patterns import (
    THEME_LOGIC_VERSIONS,
    TerminalPosition,
)
from .position import decode_position, normalized_fen


def general_square(fen: str, losing_side: str) -> str | None:
    general = "K" if losing_side == "red" else "k"
    return next(
        (square for square, piece in decode_position(fen).items() if piece == general),
        None,
    )


def inward_general_moves(
    terminal: TerminalPosition, status: PositionStatus
) -> tuple[str, ...]:
    """Find legal moves that move the losing general one step in its palace."""

    origin = general_square(terminal.fen, terminal.losing_side)
    if origin is None:
        return ()
    of, rank = ord(origin[0]) - 97, int(origin[1:])
    allowed_ranks = range(1, 4) if terminal.losing_side == "red" else range(8, 11)
    moves: list[str] = []
    for move in status.legal_moves:
        if not move.startswith(origin) or len(move) <= len(origin) + 1:
            continue
        target = move[len(origin) :]
        try:
            tf, trank = ord(target[0]) - 97, int(target[1:])
        except (IndexError, ValueError):
            continue
        if (
            tf in (3, 4, 5)
            and trank in allowed_ranks
            and abs(tf - of) + abs(trank - rank) == 1
        ):
            moves.append(move)
    return tuple(sorted(set(moves)))


def _status_evidence(status: PositionStatus) -> dict[str, Any]:
    return {
        "fen": status.fen,
        "checked": status.checked,
        "legal_moves": list(status.legal_moves),
        "checkmate": status.checkmate,
        "stalemate": status.stalemate,
    }


def inconclusive_evidence(
    theme: str,
    removed_fen: str,
    *,
    nodes: int | None,
    reason: str,
) -> dict[str, Any]:
    return {
        "theme": theme,
        "logic_version": THEME_LOGIC_VERSIONS[theme],
        "removed_fen": removed_fen,
        "nodes": nodes,
        "outcome": "inconclusive",
        "reason": reason,
    }


def verify_removed_motif(
    engine: PuzzleEngine,
    terminal: TerminalPosition,
    theme: str,
    removed_fen: str,
    *,
    nodes: int,
) -> dict[str, Any]:
    """Verify whether one removed motif piece is essential.

    The modified terminal position is inspected first.  Only when the
    losing general gains an inward palace move is one bounded MultiPV=1
    root search made.  The search score is from the defender's perspective:
    a negative mate means the original forced win remains; a positive mate
    or a non-mating CP score establishes a key piece at this budget.
    """

    if nodes < 1:
        raise ValueError("motif-removal search nodes must be positive")
    evidence = inconclusive_evidence(theme, removed_fen, nodes=nodes, reason="")
    try:
        status = engine.inspect(SearchContext(removed_fen, ()))
    except EngineCancelled:
        raise
    except (EngineProtocolError, IncompleteSearchError, OSError, TimeoutError) as exc:
        evidence["reason"] = f"inspect_failed:{type(exc).__name__}"
        return evidence
    evidence["inspect"] = _status_evidence(status)
    evidence["engine_version"] = engine.engine_version
    evidence["nnue"] = engine.nnue
    evidence["newly_legal_general_moves"] = list(inward_general_moves(terminal, status))
    if normalized_fen(status.fen) != normalized_fen(removed_fen):
        evidence["reason"] = "inspected_fen_changed"
        return evidence
    if fen_side(status.fen) != terminal.losing_side:
        evidence["reason"] = "removed_position_side_changed"
        return evidence
    if status.terminal_win:
        evidence["outcome"] = "not_key"
        evidence["reason"] = "removed_position_still_terminally_defeated"
        return evidence
    if not evidence["newly_legal_general_moves"]:
        evidence["outcome"] = "not_key"
        evidence["reason"] = "removal_did_not_open_general_escape"
        return evidence
    try:
        engine.new_game()
        result = engine.analyse(SearchContext(removed_fen, ()), nodes=nodes, multi_pv=1)
    except EngineCancelled:
        raise
    except (EngineProtocolError, IncompleteSearchError, OSError, TimeoutError) as exc:
        evidence["reason"] = f"search_inconclusive:{type(exc).__name__}"
        return evidence
    evidence["engine_result"] = result.to_dict()
    if (
        len(result.lines) != 1
        or result.primary.multipv != 1
        or result.engine_version != engine.engine_version
        or result.nnue != engine.nnue
        or result.primary.nodes < 1
        or result.best_move is None
        or not result.primary.moves
        or result.primary.moves[0] != result.best_move
        or result.primary.moves[0] not in status.legal_moves
        or result.primary.score.bound is not None
    ):
        evidence["reason"] = "illegal_or_incomplete_engine_result"
        return evidence
    score = result.primary.score
    if score.kind == "mate" and score.value < 0:
        evidence["outcome"] = "not_key"
        evidence["reason"] = "forced_mate_remains_after_removal"
    elif score.kind == "mate" and score.value > 0:
        evidence["outcome"] = "key"
        evidence["reason"] = "defender_wins_after_removal"
    elif score.kind == "cp":
        evidence["outcome"] = "key"
        evidence["reason"] = "no_mate_found_at_budget"
    else:
        evidence["reason"] = "unsupported_engine_score"
    return evidence
