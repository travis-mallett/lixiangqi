"""Independent terminal-position matchers for Xiangqi mating methods."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Mapping

from .models import BLACK, RED, opposite
from .position import (
    decode_position,
    encode_position,
    general_escape_positions,
    general_palace_targets,
)

PAWN_TRIPLE_THEME = "pawnTripleAdvancementAttack"
PAWN_TRIPLE_VERSION = "1.0"

BOLD_CHARIOT_THEME = "boldChariotAttack"
BOLD_CHARIOT_VERSION = "1.0"

SANDWICH_THEME = "cannonsSandwichingChariot"
SANDWICH_VERSION = "1.3"

DOUBLE_TOAST_THEME = "doubleToastMate"
DOUBLE_TOAST_VERSION = "1.0"

IRON_BOLT_REQUIREMENTS = {"ironBolt": "R", "smallIronBolt": "P"}
IRON_BOLT_LOGIC_VERSIONS = {"ironBolt": "1.2", "smallIronBolt": "1.1"}
PAWN_MATE_VERSIONS = {
    "childWorshipsBuddha": "1.0",
    "crowningMate": "1.0",
    "eunuchChasingEmperorKill": "1.3",
}
HEAVEN_EARTH_THEME = "heavenAndEarthCannons"
HEAVEN_EARTH_VERSION = "1.0"

OLD_PAWN_THEME = "oldPawnSearchingMountain"
OLD_PAWN_LOGIC_VERSION = "1.1"
STALEMATE_THEME = "stalemateMate"
LEISURELY_STROLL_THEME = "leisurelyStrollMate"
HEADHUNTER_CANNON_THEME = "headhunterCannonAttack"
HEADHUNTER_CANNON_LOGIC_VERSION = "1.1"
CROSS_CHECK_THEME = "crossCheckAttack"
TERMINAL_MOTIF_VERSION = "1.0"
CENTROID_PAWN_THEME = "centroidPawnMate"
CENTROID_PAWN_LOGIC_VERSION = "1.4"
OCTAGONAL_HORSE_THEME = "octagonalHorse"
OCTAGONAL_HORSE_LOGIC_VERSION = "1.1"
SPRING_HORSE_THEME = "springHorseMate"
SPRING_HORSE_LOGIC_VERSION = "1.0"
SMOTHERED_CANNON_THEME = "smotheredCannon"
SMOTHERED_CANNON_LOGIC_VERSION = "1.2"
SERVANT_CROWDING_MASTER_THEME = "servantCrowdingMasterAttack"
SERVANT_CROWDING_MASTER_LOGIC_VERSION = "1.0"
FLANKING_TRIO_THEME = "flankingTrioMate"
FLANKING_TRIO_LOGIC_VERSION = "1.3"
CHECK_COUNT_REQUIREMENTS = {
    "doubleCheckMate": 2,
    "tripleCheckMate": 3,
    "quadrupleCheckMate": 4,
}
CHECK_COUNT_LOGIC_VERSIONS = {theme: "1.0" for theme in CHECK_COUNT_REQUIREMENTS}
WHITE_FACED_GENERAL_THEME = "whiteFacedGeneral"
WHITE_FACED_GENERAL_LOGIC_VERSION = "1.1"
CHARIOT_MATING_METHODS_THEME = "chariotMatingMethods"
CHARIOT_MATING_METHODS_LOGIC_VERSION = "2.0"
HORSE_MATING_METHODS_THEME = "horseMatingMethods"
HORSE_MATING_METHODS_LOGIC_VERSION = "2.0"
CANNON_MATING_METHODS_THEME = "cannonMatingMethods"
CANNON_MATING_METHODS_LOGIC_VERSION = "2.0"
SOLDIER_MATING_METHODS_THEME = "soldierMatingMethods"
SOLDIER_MATING_METHODS_LOGIC_VERSION = "2.0"
CHARIOT_HORSE_MATING_METHODS_THEME = "chariotHorseMatingMethods"
CHARIOT_HORSE_MATING_METHODS_LOGIC_VERSION = "2.0"
CHARIOT_CANNON_MATING_METHODS_THEME = "chariotCannonMatingMethods"
CHARIOT_CANNON_MATING_METHODS_LOGIC_VERSION = "2.0"
CHARIOT_SOLDIER_MATING_METHODS_THEME = "chariotSoldierMatingMethods"
CHARIOT_SOLDIER_MATING_METHODS_LOGIC_VERSION = "2.0"
HORSE_CANNON_MATING_METHODS_THEME = "horseCannonMatingMethods"
HORSE_CANNON_MATING_METHODS_LOGIC_VERSION = "2.0"
HORSE_SOLDIER_MATING_METHODS_THEME = "horseSoldierMatingMethods"
HORSE_SOLDIER_MATING_METHODS_LOGIC_VERSION = "2.0"
CANNON_SOLDIER_MATING_METHODS_THEME = "cannonSoldierMatingMethods"
CANNON_SOLDIER_MATING_METHODS_LOGIC_VERSION = "2.0"
CHARIOT_HORSE_CANNON_MATING_METHODS_THEME = "chariotHorseCannonMatingMethods"
CHARIOT_HORSE_CANNON_MATING_METHODS_LOGIC_VERSION = "2.0"
CHARIOT_HORSE_SOLDIER_MATING_METHODS_THEME = "chariotHorseSoldierMatingMethods"
CHARIOT_HORSE_SOLDIER_MATING_METHODS_LOGIC_VERSION = "2.0"
CHARIOT_CANNON_SOLDIER_MATING_METHODS_THEME = "chariotCannonSoldierMatingMethods"
CHARIOT_CANNON_SOLDIER_MATING_METHODS_LOGIC_VERSION = "2.0"
HORSE_CANNON_SOLDIER_MATING_METHODS_THEME = "horseCannonSoldierMatingMethods"
HORSE_CANNON_SOLDIER_MATING_METHODS_LOGIC_VERSION = "2.0"
CHARIOT_HORSE_CANNON_SOLDIER_MATING_METHODS_THEME = (
    "chariotHorseCannonSoldierMatingMethods"
)
CHARIOT_HORSE_CANNON_SOLDIER_MATING_METHODS_LOGIC_VERSION = "2.0"
PIECE_TYPE_MATING_METHOD_THEMES = (
    CHARIOT_MATING_METHODS_THEME,
    HORSE_MATING_METHODS_THEME,
    CANNON_MATING_METHODS_THEME,
    SOLDIER_MATING_METHODS_THEME,
    CHARIOT_HORSE_MATING_METHODS_THEME,
    CHARIOT_CANNON_MATING_METHODS_THEME,
    CHARIOT_SOLDIER_MATING_METHODS_THEME,
    HORSE_CANNON_MATING_METHODS_THEME,
    HORSE_SOLDIER_MATING_METHODS_THEME,
    CANNON_SOLDIER_MATING_METHODS_THEME,
    CHARIOT_HORSE_CANNON_MATING_METHODS_THEME,
    CHARIOT_HORSE_SOLDIER_MATING_METHODS_THEME,
    CHARIOT_CANNON_SOLDIER_MATING_METHODS_THEME,
    HORSE_CANNON_SOLDIER_MATING_METHODS_THEME,
    CHARIOT_HORSE_CANNON_SOLDIER_MATING_METHODS_THEME,
)
PIECE_TYPE_MATING_METHOD_LOGIC_VERSIONS = {
    CHARIOT_MATING_METHODS_THEME: CHARIOT_MATING_METHODS_LOGIC_VERSION,
    HORSE_MATING_METHODS_THEME: HORSE_MATING_METHODS_LOGIC_VERSION,
    CANNON_MATING_METHODS_THEME: CANNON_MATING_METHODS_LOGIC_VERSION,
    SOLDIER_MATING_METHODS_THEME: SOLDIER_MATING_METHODS_LOGIC_VERSION,
    CHARIOT_HORSE_MATING_METHODS_THEME: CHARIOT_HORSE_MATING_METHODS_LOGIC_VERSION,
    CHARIOT_CANNON_MATING_METHODS_THEME: CHARIOT_CANNON_MATING_METHODS_LOGIC_VERSION,
    CHARIOT_SOLDIER_MATING_METHODS_THEME: CHARIOT_SOLDIER_MATING_METHODS_LOGIC_VERSION,
    HORSE_CANNON_MATING_METHODS_THEME: HORSE_CANNON_MATING_METHODS_LOGIC_VERSION,
    HORSE_SOLDIER_MATING_METHODS_THEME: HORSE_SOLDIER_MATING_METHODS_LOGIC_VERSION,
    CANNON_SOLDIER_MATING_METHODS_THEME: CANNON_SOLDIER_MATING_METHODS_LOGIC_VERSION,
    CHARIOT_HORSE_CANNON_MATING_METHODS_THEME: CHARIOT_HORSE_CANNON_MATING_METHODS_LOGIC_VERSION,
    CHARIOT_HORSE_SOLDIER_MATING_METHODS_THEME: CHARIOT_HORSE_SOLDIER_MATING_METHODS_LOGIC_VERSION,
    CHARIOT_CANNON_SOLDIER_MATING_METHODS_THEME: CHARIOT_CANNON_SOLDIER_MATING_METHODS_LOGIC_VERSION,
    HORSE_CANNON_SOLDIER_MATING_METHODS_THEME: HORSE_CANNON_SOLDIER_MATING_METHODS_LOGIC_VERSION,
    CHARIOT_HORSE_CANNON_SOLDIER_MATING_METHODS_THEME: CHARIOT_HORSE_CANNON_SOLDIER_MATING_METHODS_LOGIC_VERSION,
}
MOON_SCOOPING_THEME = "moonScoopingMate"
MOON_SCOOPING_LOGIC_VERSION = (
    f"1.0+whiteFacedGeneral@{WHITE_FACED_GENERAL_LOGIC_VERSION}"
)
DOUBLE_CANNONS_THEME = "doubleCannons"
DOUBLE_CANNONS_LOGIC_VERSION = "1.0"
DOUBLE_CHARIOTS_THEME = "doubleChariotsMate"
DOUBLE_CHARIOTS_LOGIC_VERSION = "1.1"
DOUBLE_GHOSTS_THEME = "doubleGhostsKnocking"
DOUBLE_GHOSTS_VERSION = "1.1"
CHARIOTS_THREATENING_ADVISOR_THEME = "doubleChariotsThreateningAdvisor"
CHARIOTS_THREATENING_ADVISOR_LOGIC_VERSION = "2.0"
THROAT_CUTTING_THEME = "throatCuttingMate"
THROAT_CUTTING_LOGIC_VERSION = "1.0"
SMALL_THROAT_CUTTING_THEME = "smallThroatCuttingMate"
SMALL_THROAT_CUTTING_LOGIC_VERSION = "1.0"
MATE_IN_THEMES = {ply: f"mateIn{ply}" for ply in range(1, 9)}
MATE_TAXONOMY_VERSION = "2"


@dataclass(frozen=True)
class TerminalPosition:
    fen: str
    checkmate: bool
    losing_side: str
    # A stalemate is a terminal no-legal-move position without check.
    stalemate: bool = False

    @property
    def winning_side(self) -> str:
        return opposite(self.losing_side)


def centroid_pawn_candidate(terminal: TerminalPosition) -> bool:
    """Match a mate where a central pawn restricts a cornered general.

    The pawn must still occupy the centre of the losing side's palace in the
    terminal position.  A general on either home-rank palace corner has an
    inward escape square controlled by that pawn; a general on the front rank
    would not be restricted this way.  Because the pawn is on the rank
    immediately in front of the general, it cannot itself attack the general,
    so the terminal check must be supplied by another piece.
    """

    if not (terminal.checkmate or terminal.stalemate):
        return False
    position = decode_position(terminal.fen)
    if terminal.losing_side == BLACK:
        return (
            position.get("d10") == "k" or position.get("f10") == "k"
        ) and position.get("e9") == "P"
    if terminal.losing_side == RED:
        return (
            position.get("d1") == "K" or position.get("f1") == "K"
        ) and position.get("e2") == "p"
    raise ValueError(f"unknown losing side: {terminal.losing_side}")


def centroid_pawn_escape_positions(
    terminal: TerminalPosition,
) -> tuple[tuple[str, str], ...]:
    """Build the two inward palace steps for attack inspection.

    Friendly occupants prohibit a move; enemy non-generals are captured.
    Attacks are assessed on the resulting board, with the pawn retained.
    """
    if not centroid_pawn_candidate(terminal):
        return ()
    position = decode_position(terminal.fen)
    general = "k" if terminal.losing_side == BLACK else "K"
    origin = next(s for s, piece in position.items() if piece == general)
    rank = int(origin[1:])
    inward_rank = rank - 1 if terminal.losing_side == BLACK else rank + 1
    result = []
    for target in (f"e{rank}", f"{origin[0]}{inward_rank}"):
        occupant = position.get(target)
        if occupant and (
            occupant.isupper() == general.isupper() or occupant.lower() == "k"
        ):
            continue
        moved = dict(position)
        del moved[origin]
        moved[target] = general
        fields = terminal.fen.split()
        fields[0] = encode_position(moved)
        result.append((origin + target, " ".join(fields)))
    return tuple(result)


_PALACE_CORNERS = {
    BLACK: frozenset(("d8", "f8", "d10", "f10")),
    RED: frozenset(("d1", "f1", "d3", "f3")),
}

SINGLE_HORSE_THEME = "singleHorseCapturesKing"
HORSE_CANNON_THEME = "horseCannonMate"
DOUBLE_HORSES_THEME = "doubleHorsesMate"
HORSE_ROLE_THEMES = (
    "elbowHorse",
    "anglerHorse",
    "highAnglerHorse",
    "palcornerHorse",
    SINGLE_HORSE_THEME,
    HORSE_CANNON_THEME,
    DOUBLE_HORSES_THEME,
)
HORSE_ROLE_VERSIONS = {
    theme: (
        "1.0"
        if theme in (SINGLE_HORSE_THEME, HORSE_CANNON_THEME, DOUBLE_HORSES_THEME)
        else "1.1"
    )
    for theme in HORSE_ROLE_THEMES
}


def horse_cannon_screens(terminal: TerminalPosition) -> dict[str, str]:
    """Checking cannon -> winning horse serving as its sole screen."""
    if not terminal.checkmate:
        return {}
    board = decode_position(terminal.fen)
    general = "k" if terminal.losing_side == BLACK else "K"
    origin = next((s for s, p in board.items() if p == general), None)
    if origin is None:
        return {}
    horse, cannon = ("N", "C") if terminal.winning_side == RED else ("n", "c")
    result = {}
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        x, y = ord(origin[0]), int(origin[1:])
        screen = None
        while True:
            x, y = x + dx, y + dy
            if not (ord("a") <= x <= ord("i") and 1 <= y <= 10):
                break
            square = f"{chr(x)}{y}"
            piece = board.get(square)
            if piece is None:
                continue
            if screen is None and piece == horse:
                screen = square
                continue
            if screen is not None and piece == cannon:
                result[square] = screen
            break
    return result


def horse_role_candidate_squares(
    terminal: TerminalPosition, theme: str
) -> tuple[str, ...]:
    """Winning horses eligible for each motif's terminal condition and posts."""
    horse = "N" if terminal.winning_side == RED else "n"
    position = decode_position(terminal.fen)
    if theme == SINGLE_HORSE_THEME:
        return (
            tuple(sorted(s for s, p in position.items() if p == horse))
            if terminal.stalemate and not terminal.checkmate
            else ()
        )
    if not terminal.checkmate:
        return ()
    if theme == DOUBLE_HORSES_THEME:
        horses = tuple(sorted(s for s, p in position.items() if p == horse))
        return horses if len(horses) == 2 else ()
    if theme == HORSE_CANNON_THEME:
        return tuple(sorted(set(horse_cannon_screens(terminal).values())))
    if theme == "palcornerHorse":
        squares = _PALACE_CORNERS[terminal.losing_side]
    else:
        rank = {"elbowHorse": 2, "anglerHorse": 3, "highAnglerHorse": 4}[theme]
        if terminal.losing_side == BLACK:
            rank = 11 - rank
        squares = {f"c{rank}", f"g{rank}"}
    return tuple(sorted(s for s in squares if position.get(s) == horse))


def horse_role_escape_positions(
    terminal: TerminalPosition,
    *,
    empty_only: bool = False,
) -> tuple[tuple[str, str], ...]:
    """Palace steps including captures, inspected after moving the general.

    Losing-side occupants are not escapes. Capturing a winning piece removes
    it before attack inspection, which also updates any blocked horse legs.
    Empty-only motifs exclude all occupied destinations.
    """
    if not (terminal.checkmate or terminal.stalemate):
        return ()
    return general_escape_positions(
        terminal.fen, terminal.losing_side, empty_only=empty_only
    )


def octagonal_horse_candidate_squares(terminal: TerminalPosition) -> tuple[str, ...]:
    """Return winning horses satisfying the geometric octagonal pattern."""

    if not (terminal.checkmate or terminal.stalemate):
        return ()
    position = decode_position(terminal.fen)
    losing, winning = terminal.losing_side, opposite(terminal.losing_side)
    general = "k" if losing == BLACK else "K"
    general_square = next((s for s, p in position.items() if p == general), None)
    if general_square is None or general_square not in _PALACE_CORNERS[losing]:
        return ()
    opposite_corner = {
        "d1": "f3",
        "f1": "d3",
        "d3": "f1",
        "f3": "d1",
        "d8": "f10",
        "f8": "d10",
        "d10": "f8",
        "f10": "d8",
    }
    candidates: list[str] = []
    for horse, piece in position.items():
        if (
            piece != ("N" if winning == RED else "n")
            or horse not in _PALACE_CORNERS[losing]
        ):
            continue
        if opposite_corner.get(horse) != general_square:
            continue
        candidates.append(horse)
    return tuple(candidates)


def octagonal_horse_removed_fens(
    terminal: TerminalPosition,
) -> tuple[tuple[str, str], ...]:
    """Return ``(horse square, removed FEN)`` for geometric horse candidates."""

    position = decode_position(terminal.fen)
    fields = terminal.fen.split()
    result: list[tuple[str, str]] = []
    for square in octagonal_horse_candidate_squares(terminal):
        fields[0] = encode_position(
            {key: value for key, value in position.items() if key != square}
        )
        result.append((square, " ".join(fields)))
    return tuple(result)


def octagonal_horse_candidate(terminal: TerminalPosition) -> bool:
    """Version 1.1 geometry-only octagonal-horse terminal pattern.

    A winning-side horse occupies a palace corner and the losing general the
    opposite corner.  Stalemate and checkmate are both eligible terminal
    positions; canonical legal-move generation and the removal search decide
    whether the horse actually supplies an escape restriction.
    """
    return bool(octagonal_horse_candidate_squares(terminal))


def octagonal_horse_geometry(terminal: TerminalPosition) -> bool:
    """Return whether the terminal position has horse geometry only."""

    return octagonal_horse_candidate(terminal)


def white_faced_general_escape_positions(
    terminal: TerminalPosition,
) -> tuple[tuple[str, str], ...]:
    """The empty horizontal palace escape on the adjacent general's file.

    Geometry requires an unobstructed file to the winning general. Pikafish
    then establishes that no other winning piece attacks this escape square.
    Both forms of terminal defeat count in Xiangqi.
    """
    if not (terminal.checkmate or terminal.stalemate):
        return ()
    position = decode_position(terminal.fen)
    general = "K" if terminal.losing_side == RED else "k"
    origin = next((s for s, p in position.items() if p == general), None)
    winner = next((s for s, p in position.items() if p == general.swapcase()), None)
    if origin is None or winner is None or abs(ord(origin[0]) - ord(winner[0])) != 1:
        return ()
    rank = int(origin[1:])
    ranks = range(1, 4) if terminal.losing_side == RED else range(8, 11)
    target = f"{winner[0]}{rank}"
    if winner[0] not in "def" or rank not in ranks or target in position:
        return ()
    if any(
        f"{winner[0]}{r}" in position
        for r in range(min(rank, int(winner[1:])) + 1, max(rank, int(winner[1:])))
    ):
        return ()
    moved = dict(position)
    del moved[origin]
    moved[target] = general
    fields = terminal.fen.split()
    fields[0] = encode_position(moved)
    return ((origin + target, " ".join(fields)),)


def double_chariots_candidate(terminal: TerminalPosition, role: str = "R") -> bool:
    """Only verified checkmates with two winning pieces of the role need inspection."""
    chariot = role if terminal.winning_side == RED else role.lower()
    return (
        terminal.checkmate
        and list(decode_position(terminal.fen).values()).count(chariot) >= 2
    )


def spring_horse_candidate(terminal: TerminalPosition) -> bool:
    """Cheap terminal filter; the final move and attack proof establish the motif."""
    if not terminal.checkmate:
        return False
    pieces = set(decode_position(terminal.fen).values())
    return (
        {"R", "N"} <= pieces if terminal.winning_side == RED else {"r", "n"} <= pieces
    )


def piece_type_mating_methods_candidate(terminal: TerminalPosition) -> bool:
    """Select verified checkmates for piece-type trace assessors."""

    return terminal.checkmate


chariot_mating_methods_candidate = piece_type_mating_methods_candidate


def smothered_cannon_candidate(terminal: TerminalPosition) -> bool:
    """The sequence assessor proves the pre-move confinement and cannon check."""
    cannon = "C" if terminal.winning_side == RED else "c"
    return terminal.checkmate and cannon in decode_position(terminal.fen).values()


def double_chariots_escape_positions(
    terminal: TerminalPosition,
    role: str = "R",
) -> tuple[tuple[str, str], ...]:
    """Inspect empty palace escapes with both attacking pieces retained.

    Any occupant excludes the square: protecting a capturable attacking piece
    is not an escape-blocking role. Move the general first to expose attacks.
    """
    if not double_chariots_candidate(terminal, role):
        return ()
    return general_escape_positions(terminal.fen, terminal.losing_side, empty_only=True)


def iron_bolt_candidate(terminal: TerminalPosition, theme: str) -> bool:
    """Two defending screens; Small Iron Bolt requires an advisor and elephant."""
    if not terminal.checkmate:
        return False
    board = decode_position(terminal.fen)
    red = terminal.winning_side == RED
    general, cannon = ("k", "C") if red else ("K", "c")
    required = IRON_BOLT_REQUIREMENTS[theme]
    if (required if red else required.lower()) not in board.values():
        return False
    origin = next((s for s, p in board.items() if p == general), None)
    if origin is None or origin[0] != "e":
        return False
    screens = {"a", "b"} if red else {"A", "B"}
    rank = int(origin[1:])
    for step in (-1, 1):
        occupants = []
        for r in range(rank + step, 11 if step == 1 else 0, step):
            piece = board.get(f"e{r}")
            if piece is None:
                continue
            occupants.append(piece)
            if len(occupants) == 3:
                valid_screens = (
                    all(p.isupper() != red for p in occupants[:2])
                    if theme == "ironBolt"
                    else set(occupants[:2]) == screens
                )
                if valid_screens and piece == cannon:
                    back_rank = 10 if red else 1
                    if not any(
                        p == cannon and s != f"e{r}" and int(s[1:]) == back_rank
                        for s, p in board.items()
                    ):
                        return True
                break
    return False


def pawn_mate_squares(terminal: TerminalPosition, theme: str) -> set[str]:
    """Terminal geometry; checking pieces and move history are proved separately."""
    if not terminal.checkmate:
        return set()
    board = decode_position(terminal.fen)
    red = terminal.losing_side == "black"
    general = next((s for s, p in board.items() if p == ("k" if red else "K")), None)
    if general is None:
        return set()
    direction = 1 if red else -1
    pawns = {s for s, p in board.items() if p == ("P" if red else "p")}
    if theme == "childWorshipsBuddha":
        return {
            s
            for s in pawns
            if s[0] == general[0] and (int(general[1:]) - int(s[1:])) * direction == 1
        }
    if theme == "eunuchChasingEmperorKill":
        # All qualifying pawns are across the river. Count forward and sideways
        # steps only: a general behind the pawn cannot be reached.
        return {
            s
            for s in pawns
            if (dy := (int(general[1:]) - int(s[1:])) * direction) >= 0
            and 1 <= dy + abs(ord(general[0]) - ord(s[0])) <= 2
        }
    if theme != "crowningMate":
        return set()
    back = 10 if red else 1
    center = "e" + str(back - direction)
    if (
        general != "e" + str(back)
        or board.get(center) not in ({"P", "R"} if red else {"p", "r"})
        or any(board.get(f + str(back)) != ("a" if red else "A") for f in "df")
    ):
        return set()
    for rank in range(back - 2 * direction, 0 if red else 11, -direction):
        piece = board.get("e" + str(rank))
        if piece is not None:
            return {center} if piece == ("C" if red else "c") else set()
    return set()


def old_pawn_squares(terminal: TerminalPosition) -> set[str]:
    """Winning pawns on the losing side's back rank at verified checkmate."""
    if not terminal.checkmate:
        return set()
    pawn, rank = ("P", 10) if terminal.winning_side == RED else ("p", 1)
    return {
        square
        for square, piece in decode_position(terminal.fen).items()
        if piece == pawn and int(square[1:]) == rank
    }


def headhunter_cannon(terminal: TerminalPosition) -> bool:
    """An unscreened winning center-file cannon facing the losing general."""
    if not (terminal.checkmate or terminal.stalemate):
        return False
    board = decode_position(terminal.fen)
    general, cannon = ("k", "C") if terminal.losing_side == BLACK else ("K", "c")
    square = next((s for s, p in board.items() if p == general), None)
    if square is None or square[0] != "e":
        return False
    rank = int(square[1:])
    for step in (-1, 1):
        for r in range(rank + step, 11 if step == 1 else 0, step):
            piece = board.get(f"e{r}")
            if piece is not None:
                if piece == cannon:
                    return True
                break
    return False


def flanking_trio_pawns_distant(position: Mapping[str, str], losing_side: str) -> bool:
    """Winning pawns on either flank stay two orthogonal steps from the palace."""
    red = losing_side == BLACK
    low, high = (8, 10) if red else (1, 3)
    for square, piece in position.items():
        if piece == ("P" if red else "p"):
            file, rank = ord(square[0]), int(square[1:])
            distance = max(ord("d") - file, 0, file - ord("f")) + max(
                low - rank, 0, rank - high
            )
            if distance < 2:
                return False
    return True


def flanking_trio_boxes(
    position: Mapping[str, str], losing_side: str
) -> dict[str, tuple[str, ...]]:
    """Enemy-half boxes with exactly one friendly chariot, horse and cannon.

    Both boxes include the center file. Enemy occupants and pawns do not count.
    Pawn distance is checked separately across the whole board and solution.
    """
    red = losing_side == BLACK
    ranks = range(6, 11) if red else range(1, 6)
    winning = {
        s: p.upper()
        for s, p in position.items()
        if p.isupper() == red and int(s[1:]) in ranks and p.upper() != "P"
    }
    result = {}
    for flank, files in (("left", "abcde"), ("right", "efghi")):
        pieces = {s: p for s, p in winning.items() if s[0] in files}
        if len(pieces) == 3 and set(pieces.values()) == {"R", "N", "C"}:
            result[flank] = tuple(sorted(pieces))
    return result


def flanking_trio_candidate(terminal: TerminalPosition) -> bool:
    if not terminal.checkmate:
        return False
    position = decode_position(terminal.fen)
    return (
        flanking_trio_pawns_distant(position, terminal.losing_side)
        and len(flanking_trio_boxes(position, terminal.losing_side)) == 1
    )


def check_count_candidate(terminal: TerminalPosition, count: int) -> bool:
    """A verified checkmate must have enough winning pieces to supply its checks."""
    return (
        terminal.checkmate
        and sum(
            piece.isupper() == (terminal.winning_side == RED)
            for piece in decode_position(terminal.fen).values()
        )
        >= count
    )


def servant_crowding_master_attack(terminal: TerminalPosition) -> bool:
    """Every palace step is occupied by a defender in verified terminal defeat."""
    if not (terminal.checkmate or terminal.stalemate):
        return False
    position = decode_position(terminal.fen)
    general = "k" if terminal.losing_side == BLACK else "K"
    origin = next((s for s, p in position.items() if p == general), None)
    if origin is None:
        return False
    targets = general_palace_targets(origin, terminal.losing_side)
    return bool(targets) and all(
        target in position and position[target].isupper() == general.isupper()
        for target in targets
    )


def sandwich_candidate(terminal: TerminalPosition) -> bool:
    pieces = list(decode_position(terminal.fen).values())
    cannon, chariot = ("C", "R") if terminal.winning_side == RED else ("c", "r")
    return terminal.checkmate and pieces.count(cannon) >= 2 and chariot in pieces


def double_cannons_mate(terminal: TerminalPosition) -> bool:
    """A winning cannon checks over the other winning cannon in verified mate.

    The final move may move either cannon, including a discovered check.
    Only the terminal attack matters; stalemate does not qualify.
    """
    if not terminal.checkmate:
        return False
    return bool(double_cannon_attackers(terminal.fen, terminal.losing_side))


def double_cannon_attackers(fen: str, losing_side: str) -> set[str]:
    """Cannons attacking the general over another friendly cannon as sole screen."""
    position = decode_position(fen)
    general = "k" if losing_side == BLACK else "K"
    cannon = "C" if losing_side == BLACK else "c"
    origin = next((s for s, p in position.items() if p == general), None)
    if origin is None:
        return set()
    attackers = set()
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        x, y = ord(origin[0]), int(origin[1:])
        screened = False
        while True:
            x, y = x + dx, y + dy
            if not (ord("a") <= x <= ord("i") and 1 <= y <= 10):
                break
            piece = position.get(f"{chr(x)}{y}")
            if piece is None:
                continue
            if piece != cannon:
                break
            if screened:
                attackers.add(f"{chr(x)}{y}")
                break
            screened = True
    return attackers


def matching_assessed_themes(
    terminal: TerminalPosition,
    evidence: Mapping[str, object],
    themes: set[str] | None = None,
) -> set[str]:
    """Match verified terminal motifs, requiring extra evidence where needed.

    ``evidence`` values are intentionally opaque here; callers supply the
    persisted/verifier-owned records. Motifs requiring counterfactuals accept
    only records whose ``outcome`` is ``"key"``; missing or inconclusive
    evidence fails closed. Direct terminal-attack motifs need no extra proof.
    """

    selected = set(THEME_LOGIC_VERSIONS) if themes is None else themes
    geometry = matching_themes(terminal, themes=selected)
    matched: set[str] = set()
    direct = {m.name for m in CHECKMATE_MATCHERS if not m.requires_counterfactual}
    for theme in geometry:
        if theme in direct:
            matched.add(theme)
            continue
        item = evidence.get(theme)
        if isinstance(item, Mapping):
            if item.get("outcome") == "key":
                matched.add(theme)
        elif isinstance(item, (list, tuple)) and any(
            isinstance(record, Mapping) and record.get("outcome") == "key"
            for record in item
        ):
            matched.add(theme)
    return matched


@dataclass(frozen=True)
class PatternMatcher:
    name: str
    version: str
    matcher: Callable[[TerminalPosition], bool]
    requires_counterfactual: bool = True


CHECKMATE_MATCHERS: tuple[PatternMatcher, ...] = (
    PatternMatcher(
        PAWN_TRIPLE_THEME, PAWN_TRIPLE_VERSION, lambda terminal: terminal.checkmate
    ),
    PatternMatcher(
        BOLD_CHARIOT_THEME, BOLD_CHARIOT_VERSION, lambda terminal: terminal.checkmate
    ),
    PatternMatcher(SANDWICH_THEME, SANDWICH_VERSION, sandwich_candidate),
    PatternMatcher(
        DOUBLE_TOAST_THEME, DOUBLE_TOAST_VERSION, lambda terminal: terminal.checkmate
    ),
    *(
        PatternMatcher(
            theme,
            version,
            lambda terminal, theme=theme: bool(pawn_mate_squares(terminal, theme)),
        )
        for theme, version in PAWN_MATE_VERSIONS.items()
    ),
    PatternMatcher(
        HEAVEN_EARTH_THEME, HEAVEN_EARTH_VERSION, lambda terminal: terminal.checkmate
    ),
    *(
        PatternMatcher(
            theme,
            IRON_BOLT_LOGIC_VERSIONS[theme],
            lambda terminal, theme=theme: iron_bolt_candidate(terminal, theme),
        )
        for theme in IRON_BOLT_REQUIREMENTS
    ),
    PatternMatcher(
        OLD_PAWN_THEME,
        OLD_PAWN_LOGIC_VERSION,
        lambda terminal: bool(old_pawn_squares(terminal)),
    ),
    PatternMatcher(
        STALEMATE_THEME,
        TERMINAL_MOTIF_VERSION,
        lambda terminal: terminal.stalemate,
        requires_counterfactual=False,
    ),
    PatternMatcher(
        HEADHUNTER_CANNON_THEME,
        HEADHUNTER_CANNON_LOGIC_VERSION,
        headhunter_cannon,
    ),
    PatternMatcher(
        LEISURELY_STROLL_THEME,
        TERMINAL_MOTIF_VERSION,
        lambda terminal: terminal.stalemate,
    ),
    PatternMatcher(
        CROSS_CHECK_THEME, TERMINAL_MOTIF_VERSION, lambda terminal: terminal.checkmate
    ),
    PatternMatcher(
        FLANKING_TRIO_THEME, FLANKING_TRIO_LOGIC_VERSION, flanking_trio_candidate
    ),
    *(
        PatternMatcher(
            theme,
            CHECK_COUNT_LOGIC_VERSIONS[theme],
            lambda terminal, count=count: check_count_candidate(terminal, count),
        )
        for theme, count in CHECK_COUNT_REQUIREMENTS.items()
    ),
    PatternMatcher(
        SERVANT_CROWDING_MASTER_THEME,
        SERVANT_CROWDING_MASTER_LOGIC_VERSION,
        servant_crowding_master_attack,
        requires_counterfactual=False,
    ),
    PatternMatcher(
        SMOTHERED_CANNON_THEME,
        SMOTHERED_CANNON_LOGIC_VERSION,
        smothered_cannon_candidate,
    ),
    PatternMatcher(
        SPRING_HORSE_THEME, SPRING_HORSE_LOGIC_VERSION, spring_horse_candidate
    ),
    PatternMatcher(
        MOON_SCOOPING_THEME,
        MOON_SCOOPING_LOGIC_VERSION,
        lambda terminal: terminal.checkmate
        and bool(white_faced_general_escape_positions(terminal)),
    ),
    PatternMatcher(
        DOUBLE_GHOSTS_THEME,
        DOUBLE_GHOSTS_VERSION,
        lambda terminal: terminal.checkmate,
    ),
    PatternMatcher(
        CHARIOTS_THREATENING_ADVISOR_THEME,
        CHARIOTS_THREATENING_ADVISOR_LOGIC_VERSION,
        lambda terminal: terminal.checkmate,
    ),
    PatternMatcher(
        SMALL_THROAT_CUTTING_THEME,
        SMALL_THROAT_CUTTING_LOGIC_VERSION,
        lambda terminal: terminal.checkmate,
    ),
    PatternMatcher(
        THROAT_CUTTING_THEME,
        THROAT_CUTTING_LOGIC_VERSION,
        lambda terminal: terminal.checkmate,
    ),
    *(
        PatternMatcher(
            theme,
            HORSE_ROLE_VERSIONS[theme],
            lambda terminal, theme=theme: bool(
                horse_role_candidate_squares(terminal, theme)
            ),
        )
        for theme in HORSE_ROLE_THEMES
    ),
    PatternMatcher(
        DOUBLE_CHARIOTS_THEME, DOUBLE_CHARIOTS_LOGIC_VERSION, double_chariots_candidate
    ),
    PatternMatcher(
        DOUBLE_CANNONS_THEME,
        DOUBLE_CANNONS_LOGIC_VERSION,
        double_cannons_mate,
        requires_counterfactual=False,
    ),
    PatternMatcher(
        CENTROID_PAWN_THEME, CENTROID_PAWN_LOGIC_VERSION, centroid_pawn_candidate
    ),
    PatternMatcher(
        OCTAGONAL_HORSE_THEME, OCTAGONAL_HORSE_LOGIC_VERSION, octagonal_horse_candidate
    ),
    PatternMatcher(
        WHITE_FACED_GENERAL_THEME,
        WHITE_FACED_GENERAL_LOGIC_VERSION,
        lambda terminal: bool(white_faced_general_escape_positions(terminal)),
    ),
    *(
        PatternMatcher(
            theme,
            PIECE_TYPE_MATING_METHOD_LOGIC_VERSIONS[theme],
            piece_type_mating_methods_candidate,
        )
        for theme in PIECE_TYPE_MATING_METHOD_THEMES
    ),
)
THEME_LOGIC_VERSIONS = {matcher.name: matcher.version for matcher in CHECKMATE_MATCHERS}


def classification_logic_version(themes: set[str] | None = None) -> str:
    """Return the stable revision for the selected built-in theme logic."""
    selected = themes or set(THEME_LOGIC_VERSIONS)
    unknown = selected - THEME_LOGIC_VERSIONS.keys()
    if unknown:
        raise ValueError(f"unknown puzzle theme(s): {', '.join(sorted(unknown))}")
    return ",".join(
        f"{theme}@{THEME_LOGIC_VERSIONS[theme]}" for theme in sorted(selected)
    )


def matching_themes(
    terminal: TerminalPosition,
    themes: set[str] | None = None,
) -> set[str]:
    """Return geometry-only built-in matches.

    This compatibility helper intentionally does not claim that a motif piece
    is essential.  Use :func:`matching_assessed_themes` for publication.
    """

    selected = set(THEME_LOGIC_VERSIONS) if themes is None else themes
    return {
        matcher.name
        for matcher in CHECKMATE_MATCHERS
        if matcher.name in selected and matcher.matcher(terminal)
    }


def mate_themes(solution_plies: int) -> set[str]:
    """Classify a verified solution as mate in 1, 2, 3, 4, or 5+ moves."""

    if solution_plies < 1:
        raise ValueError("a mating solution must contain an attacker move")
    mate_in = (solution_plies + 1) // 2
    theme = MATE_IN_THEMES.get(mate_in)
    return {"mate", theme} if theme else {"mate"}
