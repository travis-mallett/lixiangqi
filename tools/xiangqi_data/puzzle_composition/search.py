"""Bounded backward search with engine screening; certification is separate."""

from collections import Counter
from dataclasses import dataclass

from ..puzzle_mining.engine import IncompleteSearchError, check_deadline
from ..puzzle_mining.models import SearchContext
from ..puzzle_mining.position import decode_position
from .retro import predecessors, repair_escapes


@dataclass(frozen=True)
class Candidate:
    fen: str
    moves: tuple[str, ...]
    family: str
    construction: tuple[dict, ...] = ()

    @property
    def mate(self):
        return (len(self.moves) + 1) // 2


@dataclass(frozen=True)
class SearchConfig:
    beam: int = 5
    screen_nodes: int = 4_000
    max_defense_predecessors: int = 100
    max_attacker_predecessors: int = 100
    max_repairs: int = 6
    max_added_per_extension: int = 2


def screen(candidate, oracle, config, stats):
    check_deadline(oracle.engine)
    if not oracle.legal_root(candidate.fen) or oracle.status(candidate.fen).checked:
        return False
    stats["screened"] += 1
    oracle.engine.new_game()
    try:
        result = oracle.engine.analyse(
            SearchContext(candidate.fen, ()),
            nodes=config.screen_nodes,
            multi_pv=min(2, len(oracle.status(candidate.fen).legal_moves)),
        )
    except IncompleteSearchError:
        stats["screen_incomplete"] += 1
        return False
    if not result.lines or result.best_move != candidate.moves[0]:
        return False
    best = result.primary.score
    if best.kind != "mate" or best.value != candidate.mate or best.bound is not None:
        return False
    if len(result.lines) > 1:
        second = result.lines[1].score
        if second.bound is not None or (
            second.kind == "mate" and 0 < second.value <= candidate.mate
        ):
            return False
    stats["screen_passed"] += 1
    return True


def extend(candidate, oracle, rng, config, stats=None):
    stats = stats if stats is not None else Counter()
    found, seen = [], set()
    for def_index, previous in enumerate(predecessors(candidate.fen, "b", oracle, rng)):
        if def_index >= config.max_defense_predecessors:
            break
        stats["defense_predecessors"] += 1
        if not oracle.status(previous.fen).checked:
            continue
        continuation = (previous.move, *candidate.moves)
        for repair_index, (defense_fen, additions) in enumerate(
            repair_escapes(
                previous.fen, continuation, oracle, rng, config.max_added_per_extension
            )
        ):
            if repair_index >= config.max_repairs:
                break
            stats["repaired_defenses"] += 1
            for attack_index, attacker in enumerate(
                predecessors(defense_fen, "w", oracle, rng)
            ):
                if attack_index >= config.max_attacker_predecessors:
                    break
                if attacker.fen in seen:
                    continue
                seen.add(attacker.fen)
                stats["attacker_predecessors"] += 1
                item = Candidate(
                    attacker.fen,
                    (attacker.move, *continuation),
                    candidate.family,
                    (
                        {
                            "attack": attacker.move,
                            "defense": previous.move,
                            "restored_by_attacker": attacker.restored,
                            "restored_by_defender": previous.restored,
                            "added_defenders": additions,
                        },
                        *candidate.construction,
                    ),
                )
                if screen(item, oracle, config, stats):
                    found.append(item)
                    if len(found) >= config.beam:
                        return found
    return found


def beam_order(candidates, rng, width):
    """Favor different first moves and restored captures over distant padding."""
    rng.shuffle(candidates)
    candidates.sort(key=lambda c: len(decode_position(c.fen)))
    chosen, seen = [], set()
    for candidate in candidates:
        signature = (
            candidate.moves[:2],
            tuple(
                (x["restored_by_attacker"], x["restored_by_defender"])
                for x in candidate.construction
            ),
        )
        if signature not in seen:
            chosen.append(candidate)
            seen.add(signature)
            if len(chosen) >= width:
                break
    return chosen
