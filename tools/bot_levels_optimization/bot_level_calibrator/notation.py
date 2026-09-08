from __future__ import annotations

import re
import unicodedata
from collections import Counter
from pathlib import Path

from .constants import FILE_LETTERS, FILE_TO_INDEX, LALG_TO_PIECE
from .models import MoveRecord, NotationGame

def _normalize_ui_text(text: str) -> str:
    normalized = unicodedata.normalize("NFKC", text)
    filtered_chars = []
    for char in normalized:
        if char.isspace():
            continue
        if unicodedata.category(char).startswith("P"):
            continue
        filtered_chars.append(char)
    return "".join(filtered_chars).lower()


def _iter_setup_tokens(body: str) -> list[str]:
    compact = body.replace("\n", " ").replace("\r", " ")
    return [token.strip() for token in compact.split(";") if token.strip()]


def parse_notation_file(file_path: Path) -> NotationGame:
    text = file_path.read_text(encoding="utf-8")
    game_name_match = re.search(r"^GAME\s+(.+)$", text, flags=re.MULTILINE)
    title = game_name_match.group(1).strip() if game_name_match else file_path.stem

    setup_match = re.search(r"SETUP\{\s*(.*?)\s*\}\s*START\{", text, flags=re.DOTALL)
    if setup_match is None:
        raise RuntimeError(f"{file_path.name} does not contain a SETUP block.")
    setup_body = setup_match.group(1)

    start_match = re.search(r"START\{\s*(.*?)\s*\}\s*$", text, flags=re.DOTALL)
    if start_match is None:
        raise RuntimeError(f"{file_path.name} does not contain a START block.")
    start_body = start_match.group(1)

    setup_pieces: dict[str, tuple[str, str]] = {}
    first_side = "red"
    for token in _iter_setup_tokens(setup_body):
        if match := re.fullmatch(r"MOVE\s+1,\s*(RED|BLACK)", token, flags=re.IGNORECASE):
            first_side = "red" if match.group(1).upper() == "RED" else "black"
            continue
        piece_match = re.fullmatch(r"([KRCNGMPkrcngmp])([a-i][0-9])", token)
        if piece_match is None:
            continue
        letter, coord = piece_match.groups()
        side = "red" if letter.isupper() else "black"
        setup_pieces[coord] = (side, LALG_TO_PIECE[letter.upper()])

    move_pattern = re.compile(r"\b([KRCNGMP])([a-i][0-9])([\-x])([a-i][0-9])\b")
    moves: list[MoveRecord] = []
    side = first_side
    for symbol, src, separator, dst in move_pattern.findall(start_body):
        moves.append(
            MoveRecord(
                side=side,
                piece_type=LALG_TO_PIECE[symbol],
                src=src,
                dst=dst,
                capture=separator == "x",
            )
        )
        side = "black" if side == "red" else "red"

    return NotationGame(
        file_path=file_path,
        title=title,
        setup_pieces=setup_pieces,
        first_side=first_side,
        moves=moves,
    )


def _coord_is_valid(coord: str) -> bool:
    if len(coord) != 2 or coord[0] not in FILE_TO_INDEX or not coord[1].isdigit():
        return False
    return 0 <= int(coord[1]) < 10


def _coord_to_tuple(coord: str) -> tuple[int, int]:
    if not _coord_is_valid(coord):
        raise ValueError(f"Invalid board coordinate: {coord!r}")
    return FILE_TO_INDEX[coord[0]], int(coord[1])


def _tuple_to_coord(col: int, row: int) -> str:
    return f"{FILE_LETTERS[col]}{row}"


def _within_board(col: int, row: int) -> bool:
    return 0 <= col < 9 and 0 <= row < 10


def _in_palace(side: str, col: int, row: int) -> bool:
    if not 3 <= col <= 5:
        return False
    return 0 <= row <= 2 if side == "red" else 7 <= row <= 9


def _elephant_stays_home(side: str, row: int) -> bool:
    return row <= 4 if side == "red" else row >= 5


def _pawn_is_reachable(side: str, row: int) -> bool:
    return row >= 3 if side == "red" else row <= 6


def _pieces_between(board: dict[str, tuple[str, str]], src: str, dst: str) -> list[str]:
    src_col, src_row = _coord_to_tuple(src)
    dst_col, dst_row = _coord_to_tuple(dst)
    coords: list[str] = []
    if src_col == dst_col:
        step = 1 if dst_row > src_row else -1
        for row in range(src_row + step, dst_row, step):
            coord = _tuple_to_coord(src_col, row)
            if coord in board:
                coords.append(coord)
    elif src_row == dst_row:
        step = 1 if dst_col > src_col else -1
        for col in range(src_col + step, dst_col, step):
            coord = _tuple_to_coord(col, src_row)
            if coord in board:
                coords.append(coord)
    return coords


def _open_destination(
    board: dict[str, tuple[str, str]],
    side: str,
    dst_col: int,
    dst_row: int,
) -> str | None:
    if not _within_board(dst_col, dst_row):
        return None
    dst = _tuple_to_coord(dst_col, dst_row)
    occupant = board.get(dst)
    if occupant is not None and occupant[0] == side:
        return None
    return dst


def _ray_destinations(
    board: dict[str, tuple[str, str]],
    side: str,
    col: int,
    row: int,
    *,
    cannon: bool,
) -> list[str]:
    destinations: list[str] = []
    for dc, dr in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        dst_col, dst_row = col + dc, row + dr
        screens = 0
        while _within_board(dst_col, dst_row):
            dst = _tuple_to_coord(dst_col, dst_row)
            occupant = board.get(dst)
            if not cannon:
                if occupant is None:
                    destinations.append(dst)
                else:
                    if occupant[0] != side:
                        destinations.append(dst)
                    break
            elif occupant is None and screens == 0:
                destinations.append(dst)
            elif occupant is not None:
                screens += 1
                if screens == 2:
                    if occupant[0] != side:
                        destinations.append(dst)
                    break
            dst_col += dc
            dst_row += dr
    return destinations


def _legal_destinations(
    board: dict[str, tuple[str, str]],
    coord: str,
) -> list[str]:
    side, piece_type = board[coord]
    col, row = _coord_to_tuple(coord)
    destinations: list[str] = []

    if piece_type == "k":
        for dc, dr in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            dst_col, dst_row = col + dc, row + dr
            if _in_palace(side, dst_col, dst_row) and (dst := _open_destination(board, side, dst_col, dst_row)):
                destinations.append(dst)
        enemy_general = next(
            (enemy_coord for enemy_coord, value in board.items() if value[0] != side and value[1] == "k"),
            None,
        )
        if enemy_general is not None:
            enemy_col, _enemy_row = _coord_to_tuple(enemy_general)
            if enemy_col == col and not _pieces_between(board, coord, enemy_general):
                destinations.append(enemy_general)
    elif piece_type == "g":
        for dc, dr in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
            dst_col, dst_row = col + dc, row + dr
            if _in_palace(side, dst_col, dst_row) and (dst := _open_destination(board, side, dst_col, dst_row)):
                destinations.append(dst)
    elif piece_type == "m":
        for dc, dr in ((2, 2), (2, -2), (-2, 2), (-2, -2)):
            dst_col, dst_row = col + dc, row + dr
            eye_col, eye_row = col + (dc // 2), row + (dr // 2)
            if not _within_board(eye_col, eye_row) or not _elephant_stays_home(side, dst_row):
                continue
            if _tuple_to_coord(eye_col, eye_row) not in board and (dst := _open_destination(board, side, dst_col, dst_row)):
                destinations.append(dst)
    elif piece_type == "n":
        for dc, dr, leg_c, leg_r in (
            (1, 2, 0, 1),
            (-1, 2, 0, 1),
            (1, -2, 0, -1),
            (-1, -2, 0, -1),
            (2, 1, 1, 0),
            (2, -1, 1, 0),
            (-2, 1, -1, 0),
            (-2, -1, -1, 0),
        ):
            dst_col, dst_row = col + dc, row + dr
            leg_col, leg_row = col + leg_c, row + leg_r
            if not _within_board(leg_col, leg_row):
                continue
            if _tuple_to_coord(leg_col, leg_row) not in board and (dst := _open_destination(board, side, dst_col, dst_row)):
                destinations.append(dst)
    elif piece_type == "r":
        destinations.extend(_ray_destinations(board, side, col, row, cannon=False))
    elif piece_type == "c":
        destinations.extend(_ray_destinations(board, side, col, row, cannon=True))
    elif piece_type == "p":
        forward = 1 if side == "red" else -1
        deltas = [(0, forward)]
        crossed = row >= 5 if side == "red" else row <= 4
        if crossed:
            deltas.extend(((1, 0), (-1, 0)))
        for dc, dr in deltas:
            if dst := _open_destination(board, side, col + dc, row + dr):
                destinations.append(dst)

    return list(dict.fromkeys(destinations))


def _validate_setup(board: dict[str, tuple[str, str]]) -> str | None:
    limits = {"k": 1, "r": 2, "n": 2, "c": 2, "g": 2, "m": 2, "p": 5}
    counts: Counter[tuple[str, str]] = Counter()
    for coord, (side, piece_type) in sorted(board.items()):
        if side not in ("red", "black") or piece_type not in limits:
            return f"SETUP contains an unknown piece at {coord}: {side} {piece_type}."
        if not _coord_is_valid(coord):
            return f"SETUP contains an invalid coordinate: {coord}."
        col, row = _coord_to_tuple(coord)
        counts[(side, piece_type)] += 1
        if piece_type in ("k", "g") and not _in_palace(side, col, row):
            name = "general" if piece_type == "k" else "advisor"
            return f"SETUP places the {side} {name} illegally at {coord}; it must stay in its own palace."
        if piece_type == "m" and not _elephant_stays_home(side, row):
            return f"SETUP places the {side} elephant illegally at {coord}; elephants cannot cross the river."
        if piece_type == "p" and not _pawn_is_reachable(side, row):
            return f"SETUP places the {side} pawn illegally at {coord}; pawns cannot move backward to that rank."

    for side in ("red", "black"):
        if counts[(side, "k")] != 1:
            return f"SETUP must contain exactly one {side} general, but found {counts[(side, 'k')]}."
        for piece_type, limit in limits.items():
            if counts[(side, piece_type)] > limit:
                return (
                    f"SETUP contains too many {side} {piece_type} pieces: "
                    f"{counts[(side, piece_type)]}, maximum {limit}."
                )
    return None


def validate_setup_pieces(setup_pieces: dict[str, tuple[str, str]]) -> str | None:
    return _validate_setup(dict(setup_pieces))


def replay_moves(
    setup_pieces: dict[str, tuple[str, str]],
    moves: list[MoveRecord],
) -> tuple[dict[str, tuple[str, str]], str | None]:
    board = dict(setup_pieces)
    setup_error = validate_setup_pieces(board)
    if setup_error is not None:
        return board, setup_error

    for index, move in enumerate(moves, start=1):
        piece = board.get(move.src)
        if piece is None:
            return board, f"Move {index} expects a piece on {move.src}, but the SETUP block does not place one there."
        if piece != (move.side, move.piece_type):
            actual_side, actual_piece = piece
            return (
                board,
                (
                    f"Move {index} expects {move.side} {move.piece_type} on {move.src}, "
                    f"but the board has {actual_side} {actual_piece} there."
                ),
            )
        dst_piece = board.get(move.dst)
        if move.capture and (dst_piece is None or dst_piece[0] == move.side):
            return board, f"Move {index} is marked as a capture, but {move.dst} does not hold an enemy piece."
        if not move.capture and dst_piece is not None:
            return board, f"Move {index} is not marked as a capture, but {move.dst} is occupied."
        if move.dst not in _legal_destinations(board, move.src):
            return board, f"Move {index} is illegal for {move.side} {move.piece_type}: {move.src} to {move.dst}."
        board.pop(move.src, None)
        board.pop(move.dst, None)
        board[move.dst] = (move.side, move.piece_type)
    return board, None


def validate_notation_game(game: NotationGame) -> str | None:
    expected_side = game.first_side
    for index, move in enumerate(game.moves, start=1):
        if move.side != expected_side:
            return f"Move {index} is by {move.side}, but {expected_side} is expected to move."
        expected_side = "black" if expected_side == "red" else "red"
    _board, error = replay_moves(game.setup_pieces, game.moves)
    return error


def repair_legacy_final_setup(game: NotationGame) -> NotationGame | None:
    if not game.moves or any(move.capture for move in game.moves):
        return None
    board = dict(game.setup_pieces)
    for move in reversed(game.moves):
        piece = board.get(move.dst)
        if piece is None or piece != (move.side, move.piece_type):
            return None
        board.pop(move.dst, None)
        board[move.src] = (move.side, move.piece_type)
    repaired = NotationGame(
        file_path=game.file_path,
        title=game.title,
        setup_pieces=board,
        first_side=game.first_side,
        moves=list(game.moves),
    )
    if validate_notation_game(repaired) is not None:
        return None
    return repaired
