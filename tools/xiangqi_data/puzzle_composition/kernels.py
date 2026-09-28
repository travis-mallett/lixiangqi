"""Procedural quadruple-check endpoints; no example FENs or solution sequences."""

from dataclasses import dataclass

from .board import fen, play, square, valid_material
from .retro import add_static, repair_escapes


@dataclass(frozen=True)
class Kernel:
    fen: str
    move: str
    family: str


def geometries():
    for kx in range(3, 6):
        for ky in range(7, 10):
            for sx in (-1, 1):
                for sy in (-1, 1):
                    horses = ((kx + 2 * sx, ky + sy), (kx + sx, ky + 2 * sy))
                    if any(not (0 <= x < 9 and 0 <= y < 10) for x, y in horses):
                        continue
                    for mover in "RP":
                        if mover == "P" and sy > 0:
                            continue
                        for axis in ("file", "rank"):
                            dx, dy = (kx, ky + sy) if axis == "file" else (kx + sx, ky)
                            rx, ry = (0, sy) if axis == "file" else (sx, 0)
                            for distance in range(2, 10):
                                cx, cy = kx + rx * distance, ky + ry * distance
                                if not (0 <= cx < 9 and 0 <= cy < 10):
                                    break
                                board = {
                                    square(kx, ky): "k",
                                    square(kx + sx, ky + sy): mover,
                                    square(cx, cy): "C",
                                    **{square(*h): "N" for h in horses},
                                }
                                # The direct checker needs protection only if capturable in the palace.
                                if 3 <= dx <= 5 and 7 <= dy <= 9:
                                    if axis == "file":
                                        board[square(kx - sx, dy)] = "P"
                                    elif sy > 0:
                                        board[square(dx, dy - 1)] = "P"
                                    else:
                                        board[square(dx, 3)] = "C"
                                # Ordinary home defense; never overwrite a generated checker.
                                for s, p in {
                                    "e3": "B",
                                    "e2": "A",
                                    "e1": "K",
                                    "f1": "A",
                                    "g1": "B",
                                }.items():
                                    if s in board:
                                        break
                                    board[s] = p
                                else:
                                    if valid_material(board):
                                        yield Kernel(
                                            fen(board),
                                            square(kx + sx, ky + sy) + square(dx, dy),
                                            f"{mover}-{axis}-{'lower' if sy < 0 else 'upper'}",
                                        )


def seeds(oracle, rng, *, max_variants=8):
    groups = {}
    for kernel in geometries():
        groups.setdefault(kernel.family, []).append(kernel)
    for group in groups.values():
        rng.shuffle(group)
    # Interleave families so a budget does not get spent on one geometry.
    while any(groups.values()):
        families = [name for name, group in groups.items() if group]
        rng.shuffle(families)
        for family in families:
            kernel = groups[family].pop()
            if (
                not oracle.legal_root(kernel.fen)
                or kernel.move not in oracle.status(kernel.fen).legal_moves
            ):
                continue
            final = play(kernel.fen, kernel.move)
            variants = 0
            for _modified, additions in repair_escapes(
                final, (), oracle, rng, max_added=3
            ):
                before = add_static(kernel.fen, (kernel.move,), additions)
                if before is None or not oracle.legal_root(before):
                    continue
                if oracle.mate_one_moves(before) != (kernel.move,):
                    continue
                yield Kernel(before, kernel.move, family)
                variants += 1
                if variants >= max_variants:
                    break
