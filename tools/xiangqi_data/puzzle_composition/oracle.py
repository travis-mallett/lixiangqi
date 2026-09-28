"""Bounded caches around the repository's existing Pikafish client."""

from functools import lru_cache

from ..puzzle_mining.models import SearchContext
from .board import other_turn, play


class Oracle:
    def __init__(self, engine, cache_size=50_000):
        self.engine = engine
        self.inspections = 0
        self.checker_inspections = 0
        self.status = lru_cache(maxsize=cache_size)(self._status)
        self.checkers = lru_cache(maxsize=cache_size)(self._checkers)

    def _status(self, fen):
        self.inspections += 1
        return self.engine.inspect(SearchContext(fen, ()))

    def _checkers(self, fen):
        self.checker_inspections += 1
        return self.engine.checking_pieces(SearchContext(fen, ()))[1]

    def legal_root(self, fen):
        return not self.checkers(other_turn(fen))

    def mate_one_moves(self, fen):
        # Stalemate is also a win and must not hide an equally fast alternative.
        return tuple(
            move
            for move in self.status(fen).legal_moves
            if self.status(play(fen, move)).terminal_win
        )

    def follows(self, fen, moves, *, forced=True):
        current = fen
        for move in moves:
            status = self.status(current)
            if move not in status.legal_moves:
                return False
            if forced and current.split()[1] == "b" and status.legal_moves != (move,):
                return False
            current = play(current, move)
        return self.status(current).checkmate and len(self.checkers(current)) == 4

    def clear(self):
        self.status.cache_clear()
        self.checkers.cache_clear()
