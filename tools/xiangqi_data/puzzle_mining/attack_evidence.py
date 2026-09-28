"""Validate engine attack inspections against the requested board."""

from .position import decode_position, normalized_fen


def geometric_attack(position, origin, target):
    """Cheap xiangqi attack filter; engine inspections establish king safety.

    Unlike move generation this also describes checking a general. It can be
    used while the defending side is to move, without giving an invalid
    side-to-move board to the engine's legal-move generator.
    """
    piece = position[origin]
    x, y = ord(origin[0]) - 97, int(origin[1:])
    tx, ty = ord(target[0]) - 97, int(target[1:])
    dx, dy = tx - x, ty - y
    ax, ay = abs(dx), abs(dy)
    kind = piece.lower()
    if not (ax or ay):
        return False

    def occupied(f, r):
        return f"{chr(97 + f)}{r}" in position

    if kind in {"r", "c"}:
        if dx and dy:
            return False
        sx, sy = (dx > 0) - (dx < 0), (dy > 0) - (dy < 0)
        screens = sum(occupied(x + sx * i, y + sy * i) for i in range(1, max(ax, ay)))
        return screens == (1 if kind == "c" else 0)
    if kind == "n":
        return (ax, ay) in {(1, 2), (2, 1)} and not occupied(
            x + (dx // 2 if ax == 2 else 0), y + (dy // 2 if ay == 2 else 0)
        )
    if kind == "p":
        return (dx == 0 and dy == (1 if piece.isupper() else -1)) or (
            dy == 0 and ax == 1 and (y >= 6 if piece.isupper() else y <= 5)
        )
    if kind == "b":
        return (
            ax == ay == 2
            and (ty <= 5 if piece.isupper() else ty >= 6)
            and not occupied(x + dx // 2, y + dy // 2)
        )
    palace = 3 <= tx <= 5 and (1 <= ty <= 3 if piece.isupper() else 8 <= ty <= 10)
    if kind == "a":
        return palace and ax == ay == 1
    if kind == "k":
        return palace and ax + ay == 1
    raise ValueError(f"Unknown xiangqi piece: {piece}")


def checked_attackers(record, fen):
    if not isinstance(record, dict):
        return None
    inspected, checkers = record.get("fen"), record.get("checkers")
    if (
        not isinstance(inspected, str)
        or len(inspected.split()) < 2
        or normalized_fen(inspected) != normalized_fen(fen)
        or not isinstance(checkers, list)
        or not all(isinstance(s, str) and s in decode_position(fen) for s in checkers)
        or len(set(checkers)) != len(checkers)
    ):
        return None
    return set(checkers)
