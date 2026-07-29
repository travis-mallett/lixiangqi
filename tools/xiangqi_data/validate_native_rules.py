"""Differentially validate the native Scala rules domain against Pikafish.

This is an offline release-check tool. Pikafish is deliberately used as a test
oracle here, never as a production move-legality dependency.
"""

from __future__ import annotations

import argparse
import json
import random
import urllib.error
import urllib.request
from typing import Any

from .pikafish_rules import PikafishGameValidator, START_FEN


def native_request(endpoint: str, action: str, body: dict[str, Any]) -> dict[str, Any]:
    request = urllib.request.Request(
        f"{endpoint.rstrip('/')}/api/analysis/{action}",
        data=json.dumps(body, separators=(",", ":")).encode(),
        headers={
            "Content-Type": "application/json",
            "X-Requested-With": "XMLHttpRequest",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        detail = error.read().decode(errors="replace")
        raise RuntimeError(f"Native rules returned HTTP {error.code}: {detail}") from error
    if not isinstance(result, dict):
        raise RuntimeError("Native rules returned a non-object response")
    return result


def validate(endpoint: str, games: int, max_plies: int, seed: int) -> tuple[int, int]:
    rng = random.Random(seed)
    positions = 0
    moves = 0

    with PikafishGameValidator() as pikafish:
        for game_index in range(games):
            fen = START_FEN
            for ply in range(max_plies):
                native = native_request(endpoint, "position", {"initialFen": fen, "moves": []})
                engine_moves = pikafish.legal_moves(fen)
                native_moves = native.get("legalMoves")
                if not isinstance(native_moves, list):
                    raise RuntimeError("Native rules omitted legalMoves")
                if set(native_moves) != set(engine_moves):
                    missing = sorted(set(engine_moves) - set(native_moves))
                    extra = sorted(set(native_moves) - set(engine_moves))
                    raise AssertionError(
                        f"Legal-move divergence in game {game_index + 1}, ply {ply}: "
                        f"missing={missing}, extra={extra}, fen={fen}"
                    )

                inspected_fen, checked = pikafish.inspect(fen)
                if inspected_fen != fen:
                    raise AssertionError(
                        f"Pikafish normalized FEN unexpectedly at game {game_index + 1}, "
                        f"ply {ply}: expected={fen}, actual={inspected_fen}"
                    )
                if native.get("check") is not checked:
                    raise AssertionError(
                        f"Check-state divergence in game {game_index + 1}, ply {ply}: fen={fen}"
                    )

                positions += 1
                if not engine_moves:
                    break

                move = rng.choice(engine_moves)
                native_next = native_request(
                    endpoint,
                    "move",
                    {"initialFen": fen, "moves": [], "move": move},
                )
                engine_next, _checked = pikafish.inspect(fen, (move,))
                if native_next.get("fen") != engine_next:
                    raise AssertionError(
                        f"Transition divergence in game {game_index + 1}, ply {ply + 1}, "
                        f"move={move}: native={native_next.get('fen')}, "
                        f"pikafish={engine_next}"
                    )
                fen = engine_next
                moves += 1

    return positions, moves


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Compare native Lixiangqi legality and transitions with Pikafish"
    )
    parser.add_argument("--endpoint", default="http://127.0.0.1:9663")
    parser.add_argument("--games", type=int, default=25)
    parser.add_argument("--max-plies", type=int, default=120)
    parser.add_argument("--seed", type=int, default=0x1A2B3C)
    args = parser.parse_args()
    if args.games < 1 or args.max_plies < 1:
        parser.error("--games and --max-plies must be positive")

    positions, moves = validate(args.endpoint, args.games, args.max_plies, args.seed)
    print(
        f"Native Xiangqi rules match Pikafish across "
        f"{positions} positions and {moves} transitions."
    )


if __name__ == "__main__":
    main()
