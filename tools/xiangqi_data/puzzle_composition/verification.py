"""Final certificates using the canonical solver and exact short-mate checks."""

import time
from functools import lru_cache

from ..puzzle_mining.check_count import ASSESSORS
from ..puzzle_mining.engine import check_deadline, construction_budget
from ..puzzle_mining.models import SearchContext
from ..puzzle_mining.patterns import TerminalPosition
from ..puzzle_mining.position import decode_position, puzzle_root_fen
from ..puzzle_mining.solver import SolverConfig, solve_checkmate
from .board import play, valid_material
from .diversity import fingerprints, puzzle_id


class Rejected(ValueError):
    pass


def exact_short_mate(oracle, fens, moves):
    """All legal moves, including quiet moves and stalemate wins, through 5 plies.

    Restrict this board-keyed proof to a fresh root and mate <= 3. Longer roots
    use the history-aware canonical engine verifier; they are never labeled as
    mathematically exhaustive. A reversible 4-ply cycle cannot improve a win
    within this 5-ply horizon, and threefold history cannot yet occur.
    """
    if len(moves) > 5:
        raise ValueError("exact short proof supports at most mate in three")
    visits = 0

    @lru_cache(maxsize=500_000)
    def win(fen_value, plies):
        nonlocal visits
        visits += 1
        check_deadline(oracle.engine)
        status = oracle.status(fen_value)
        red = fen_value.split()[1] == "w"
        if not status.legal_moves:
            return not red
        if plies == 0:
            return False
        if red:
            return any(win(play(fen_value, m), plies - 1) for m in status.legal_moves)
        return all(win(play(fen_value, m), plies - 1) for m in status.legal_moves)

    for ply in range(0, len(moves), 2):
        fen_value = puzzle_root_fen(fens[ply])
        expected = len(moves) - ply
        for horizon in range(1, expected + 1, 2):
            good = [
                m
                for m in oracle.status(fen_value).legal_moves
                if win(play(fen_value, m), horizon - 1)
            ]
            if good:
                if horizon != expected or good != [moves[ply]]:
                    raise Rejected("exact_shortest_or_uniqueness")
                break
        else:
            raise Rejected("exact_mate_not_found")
    return {
        "method": "exhaustive_bounded_minimax",
        "exhaustive": True,
        "positions": visits,
        "plies": len(moves),
        "includes_quiet_moves_and_stalemates": True,
    }


def certify(candidate, oracle, *, depth=20, exact_through=2, seconds=300, tail_plies=5):
    started = time.monotonic()
    with construction_budget(oracle.engine, seconds):
        if not valid_material(decode_position(candidate.fen)) or not oracle.legal_root(
            candidate.fen
        ):
            raise Rejected("invalid_root")
        oracle.engine.new_game()
        result = solve_checkmate(
            oracle.engine,
            SearchContext(candidate.fen, ()),
            "red",
            SolverConfig(depth=depth, max_solution_plies=len(candidate.moves)),
        )
        if not result.complete or len(result.branches) != 1:
            raise Rejected("incomplete_or_multiple_solutions")
        branch = result.primary
        if branch.moves != candidate.moves or not branch.terminal.checkmate:
            raise Rejected("different_mate")
        contexts = [SearchContext(candidate.fen, ())]
        for move in branch.moves:
            contexts.append(contexts[-1].extend(move))
        states = [oracle.engine.inspect(context) for context in contexts]
        for ply, state in enumerate(states[:-1]):
            if branch.moves[ply] not in state.legal_moves:
                raise Rejected("illegal_solution_move")
            if ply % 2 and state.legal_moves != (branch.moves[ply],):
                raise Rejected("defensive_branch")
        fens = [s.fen for s in states]
        terminal = TerminalPosition(fens[-1], True, "black")
        assessor = next(a for a in ASSESSORS if a.theme == "quadrupleCheckMate")
        category = assessor.assess(oracle.engine, terminal)
        if category["outcome"] != "key":
            raise Rejected("not_quadruple_checkmate")
        proof = {
            "method": "canonical_engine_verifier",
            "depth": depth,
            "exhaustive": False,
            "defender_replies": "one legal move at every turn",
        }
        if candidate.mate <= exact_through:
            proof = exact_short_mate(oracle, fens, branch.moves)
        checkers = category["terminal"]["checkers"]
        return {
            "id": puzzle_id(candidate.fen, branch.moves),
            "fen": candidate.fen,
            "moves": list(branch.moves),
            "mate": candidate.mate,
            "family": candidate.family,
            "fens": fens,
            "terminal_checkers": checkers,
            "legal_move_counts": [len(s.legal_moves) for s in states],
            "diversity": fingerprints(fens, branch.moves, checkers, tail_plies),
            "construction": list(candidate.construction),
            "verification": proof,
            "classification": category,
            "canonical_solution": branch.to_dict(),
            "engine": result.engine_version,
            "nnue": result.nnue,
            "seconds": round(time.monotonic() - started, 3),
            "provenance": "algorithmically_composed",
            "opening_reachability_proved": False,
        }
