"""Shared master-book fade, independent of the nine engine strength profiles."""

from __future__ import annotations

import hashlib
import json
import logging
import os
import random
from collections.abc import Callable
from typing import TYPE_CHECKING
from urllib.request import Request, urlopen

if TYPE_CHECKING:
    from .ai import MoveWork, PikafishMoveEngine


def master_book_moves(fen: str) -> list[tuple[str, int]]:
    endpoint = os.environ.get("LIXIANGQI_EXPLORER_URL", "http://127.0.0.1:9002")
    request = Request(
        f"{endpoint.rstrip('/')}/opening-book",
        data=json.dumps({"fen": fen}).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urlopen(request, timeout=0.5) as response:
        moves = json.load(response)["moves"]
    return [
        (move, count)
        for move, count in moves
        if isinstance(move, str) and type(count) is int and count > 0
    ]


def choose_opening_move(
    work: MoveWork,
    engine: PikafishMoveEngine,
    rng: random.Random | None = None,
    *,
    book_lookup=None,
    missing_book_fallback: Callable[[], str | None] | None = None,
) -> str | None:
    # The side now moving has played floor(history plies / 2) times, even
    # for Black-first custom positions. FEN fullmove numbers are not bot turns.
    move_number = len(work.moves) // 2 + 1
    if move_number > 10:
        return None
    use_missing_book_fallback = False
    try:
        fen, legal_moves = engine.book_position(work)
        legal = set(legal_moves)
        candidates = [
            (move, count)
            for move, count in (book_lookup or master_book_moves)(fen)
            if move in legal and count > 0
        ]
        if rng is None:
            # Separate from engine rank sampling; retries repeat the decision,
            # while different games sample independently at every level.
            seed = f"master-opening|{work.game_id}|{work.initial_fen}|{' '.join(work.moves)}"
            rng = random.Random(hashlib.sha256(seed.encode()).digest())
        if rng.random() >= (11 - move_number) / 10:
            return None
        if not candidates:
            use_missing_book_fallback = True
        else:
            ticket = rng.randrange(sum(count for _, count in candidates))
            for move, count in candidates:
                if ticket < count:
                    return move
                ticket -= count
    except Exception:
        # Book availability must never stop an otherwise playable engine turn.
        logging.getLogger(__name__).warning(
            "Master opening lookup failed; using engine", exc_info=True
        )
        return None
    if use_missing_book_fallback and missing_book_fallback:
        return missing_book_fallback()
    return None
