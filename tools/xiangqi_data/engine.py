"""Stateless Xiangqi rules/notation adapter; never used for position evaluation."""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass
from typing import Any

from .pikafish_rules import PikafishBoard, START_FEN

class IllegalMove(ValueError):
    pass


class InvalidLesson(ValueError):
    pass


_PIECE_LIMITS = {"k": 1, "a": 2, "b": 2, "n": 2, "r": 2, "c": 2, "p": 5}
_RED_PALACE = {f"{file}{rank}" for file in "def" for rank in range(1, 4)}
_BLACK_PALACE = {f"{file}{rank}" for file in "def" for rank in range(8, 11)}
_RED_ADVISOR_POINTS = {"d1", "f1", "e2", "d3", "f3"}
_BLACK_ADVISOR_POINTS = {"d10", "f10", "e9", "d8", "f8"}
_RED_ELEPHANT_POINTS = {"c1", "g1", "a3", "e3", "i3", "c5", "g5"}
_BLACK_ELEPHANT_POINTS = {"c10", "g10", "a8", "e8", "i8", "c6", "g6"}


@dataclass(frozen=True)
class PositionRequest:
    initial_fen: str = START_FEN
    moves: tuple[str, ...] = ()

    @classmethod
    def from_json(cls, body: dict[str, Any]) -> "PositionRequest":
        initial_fen = body.get("initialFen", START_FEN)
        moves = body.get("moves", [])
        if not isinstance(initial_fen, str) or not initial_fen.strip():
            raise ValueError("initialFen must be a non-empty string")
        if not isinstance(moves, list) or not all(isinstance(move, str) for move in moves):
            raise ValueError("moves must be an array of UCI move strings")
        return cls(initial_fen=initial_fen, moves=tuple(moves))


def create_board(position: PositionRequest):
    board = PikafishBoard("xiangqi", initial_fen=position.initial_fen)
    for move in position.moves:
        legal_moves = board.legal_moves()
        if move not in legal_moves:
            raise IllegalMove(f"Illegal Xiangqi move at ply {board.ply + 1}: {move}")
        board.push(move)
    return board


def validate_lesson(position: PositionRequest) -> dict[str, Any]:
    """Validate a trainer line more strictly than a general analysis FEN.

    Pikafish remains authoritative for checks and every move. The extra
    placement checks reject syntactically valid composed FENs that could never
    occur in Xiangqi, such as an Advisor on e3. Multi-target trainer lines keep
    the learner's side to move between targets, but may not skip a reply after
    giving check.
    """

    learner_turn = _fen_turn(position.initial_fen)
    current_fen = position.initial_fen
    positions: list[dict[str, Any]] = []
    notations: list[str] = []

    for index, move in enumerate(position.moves):
        board = _validated_lesson_board(current_fen)
        if index == 0:
            positions.append(board_state(board))
        if move not in board.legal_moves():
            raise IllegalMove(f"Illegal Xiangqi lesson move at step {index + 1}: {move}")
        notations.append(board.get_san(move))
        board.push(move)
        after_fen = board.fen
        _validate_piece_placement(after_fen)

        is_last = index == len(position.moves) - 1
        if not is_last and board.is_checked():
            raise InvalidLesson(
                f"Lesson step {index + 1} gives check, so the opponent's reply cannot be skipped"
            )
        next_fen = after_fen if is_last else _fen_with_turn(after_fen, learner_turn)
        positions.append(board_state(_validated_lesson_board(next_fen)))
        current_fen = next_fen

    if not position.moves:
        positions.append(board_state(_validated_lesson_board(current_fen)))

    return {"positions": positions, "notations": notations}


def _validated_lesson_board(fen: str):
    _validate_piece_placement(fen)
    board = PikafishBoard("xiangqi", initial_fen=fen)

    # The side that just moved cannot have left the other side in check while
    # retaining the move. Switching only the FEN turn lets the same rules engine
    # evaluate that otherwise-hidden half of the position.
    other_turn_board = PikafishBoard("xiangqi", initial_fen=_fen_with_turn(fen, _opposite_turn(_fen_turn(fen))))
    if other_turn_board.is_checked():
        raise InvalidLesson("The side not to move is already in check")
    return board


def _validate_piece_placement(fen: str) -> None:
    pieces = _fen_pieces(fen)
    counts = Counter(piece.lower() for piece, _square in pieces)
    colored_counts = Counter((piece.isupper(), piece.lower()) for piece, _square in pieces)

    if counts["k"] != 2 or colored_counts[(True, "k")] != 1 or colored_counts[(False, "k")] != 1:
        raise InvalidLesson("A lesson position must contain exactly one General per side")
    for is_red, color in ((True, "Red"), (False, "Black")):
        for role, limit in _PIECE_LIMITS.items():
            if colored_counts[(is_red, role)] > limit:
                raise InvalidLesson(f"{color} has too many {role.upper()} pieces")

    for piece, square in pieces:
        is_red = piece.isupper()
        role = piece.lower()
        if role == "k" and square not in (_RED_PALACE if is_red else _BLACK_PALACE):
            raise InvalidLesson(f"{'Red' if is_red else 'Black'} General is outside its palace at {square}")
        if role == "a" and square not in (_RED_ADVISOR_POINTS if is_red else _BLACK_ADVISOR_POINTS):
            raise InvalidLesson(f"{'Red' if is_red else 'Black'} Advisor cannot reach {square}")
        if role == "b" and square not in (_RED_ELEPHANT_POINTS if is_red else _BLACK_ELEPHANT_POINTS):
            raise InvalidLesson(f"{'Red' if is_red else 'Black'} Elephant cannot reach {square}")
        if role == "p" and not _soldier_can_reach(square, is_red):
            raise InvalidLesson(f"{'Red' if is_red else 'Black'} Soldier cannot reach {square}")

    red_general = next(square for piece, square in pieces if piece == "K")
    black_general = next(square for piece, square in pieces if piece == "k")
    if red_general[0] == black_general[0]:
        file = red_general[0]
        between = [
            square
            for _piece, square in pieces
            if square[0] == file
            and min(int(red_general[1:]), int(black_general[1:])) < int(square[1:]) < max(int(red_general[1:]), int(black_general[1:]))
        ]
        if not between:
            raise InvalidLesson("The Generals face each other on an open file")


def _fen_pieces(fen: str) -> list[tuple[str, str]]:
    fields = fen.split()
    if len(fields) < 2 or fields[1] not in {"w", "b"}:
        raise InvalidLesson("Lesson FEN must include a valid side to move")
    ranks = fields[0].split("/")
    if len(ranks) != 10:
        raise InvalidLesson("A Xiangqi lesson board must contain 10 ranks")

    pieces: list[tuple[str, str]] = []
    for row, encoded in enumerate(ranks):
        file_index = 0
        for char in encoded:
            if char.isdigit():
                file_index += int(char)
            elif char.lower() in _PIECE_LIMITS:
                if file_index >= 9:
                    raise InvalidLesson("A Xiangqi lesson rank contains too many points")
                pieces.append((char, f"{chr(97 + file_index)}{10 - row}"))
                file_index += 1
            else:
                raise InvalidLesson(f"Unsupported Xiangqi lesson piece: {char}")
        if file_index != 9:
            raise InvalidLesson("Every Xiangqi lesson rank must contain exactly 9 points")
    return pieces


def _soldier_can_reach(square: str, is_red: bool) -> bool:
    file_index = ord(square[0]) - 97
    rank = int(square[1:])
    if is_red:
        return rank >= 4 and (rank >= 6 or file_index % 2 == 0)
    return rank <= 7 and (rank <= 5 or file_index % 2 == 0)


def _fen_turn(fen: str) -> str:
    fields = fen.split()
    if len(fields) < 2 or fields[1] not in {"w", "b"}:
        raise InvalidLesson("Lesson FEN must include a valid side to move")
    return fields[1]


def _opposite_turn(turn: str) -> str:
    return "b" if turn == "w" else "w"


def _fen_with_turn(fen: str, turn: str) -> str:
    fields = fen.split()
    if len(fields) < 2:
        raise InvalidLesson("Lesson FEN must include a side to move")
    fields[1] = turn
    return " ".join(fields)


def board_state(board) -> dict[str, Any]:
    immediate_end, immediate_result = board.is_immediate_game_end()
    optional_end, optional_result = board.is_optional_game_end()
    white_insufficient, black_insufficient = board.insufficient_material()
    # A material draw requires both sides to lack mating material.
    insufficient_material = white_insufficient and black_insufficient
    # The native rules binding leaves the numeric result unspecified when the matching
    # end flag is false. Do not expose those native garbage values over JSON.
    immediate_result = immediate_result if immediate_end else 0
    optional_result = optional_result if optional_end else 0
    end_value = immediate_result if immediate_end else optional_result
    ended = immediate_end or optional_end

    def result_string(value: int) -> str:
        if value == 0:
            return "1/2-1/2"
        # The rules adapter reports a terminal flag, while `board.color` is the
        # side that would move next. In Xiangqi, a side with no legal move
        # loses, whether checked or stalemated.
        return "0-1" if board.color == 0 else "1-0"

    return {
        "variant": "xiangqi",
        "fen": board.fen,
        # A variation board is reconstructed from its branch FEN, so absolute
        # ply comes from the FEN turn/fullmove fields.
        "ply": _fen_ply(board.fen),
        "turn": "red" if board.color == 0 else "black",
        "legalMoves": board.legal_moves(),
        "check": board.is_checked(),
        "redInsufficientMaterial": white_insufficient,
        "blackInsufficientMaterial": black_insufficient,
        "insufficientMaterial": insufficient_material,
        "gameResult": result_string(end_value) if ended else "*",
        "immediateEnd": {"ended": immediate_end, "result": immediate_result},
        "optionalEnd": {"ended": optional_end, "result": optional_result},
    }


def _fen_ply(fen: str) -> int:
    fields = fen.split()
    try:
        fullmove = max(1, int(fields[5]))
    except (IndexError, ValueError):
        fullmove = 1
    return (fullmove - 1) * 2 + (1 if len(fields) > 1 and fields[1] == "b" else 0)


def inspect_position(position: PositionRequest) -> dict[str, Any]:
    return board_state(create_board(position))


def _apply_move(board, move: str) -> tuple[str, dict[str, Any]]:
    if move not in board.legal_moves():
        raise IllegalMove(f"Illegal Xiangqi move at ply {board.ply + 1}: {move}")
    notation = board.get_san(move)
    capture = board.is_capture(move)
    board.push(move)
    state = board_state(board)
    state["capture"] = capture
    state["checkmate"] = state["check"] and state["immediateEnd"]["ended"]
    return notation, state


def play_move(position: PositionRequest, move: str) -> dict[str, Any]:
    board = create_board(position)
    notation, state = _apply_move(board, move)
    return {
        "move": move,
        "notation": notation,
        **state,
    }


def line_notation(board, moves: list[str]) -> list[str]:
    """Render a legal UI-coordinate PV as WXF without changing the caller's board."""

    line_board = PikafishBoard("xiangqi", initial_fen=board.fen)
    notation: list[str] = []
    for move in moves:
        if move not in line_board.legal_moves():
            break
        notation.append(line_board.get_san(move))
        line_board.push(move)
    return notation


_TAG_PATTERN = re.compile(r'^\s*\[([A-Za-z][A-Za-z0-9_]*)\s+"((?:\\.|[^"\\])*)"\s*\]\s*$', re.MULTILINE)
_MOVE_NUMBER_PATTERN = re.compile(r"^\d+\.(?:\.\.)?")
_UCI_PATTERN = re.compile(r"^[a-i](?:10|[1-9])[a-i](?:10|[1-9])$")
_RESULT_TOKENS = {"*", "1-0", "0-1", "1/2-1/2"}
_MAX_IMPORT_NODES = 2_000
_MAX_VARIATION_DEPTH = 64


def import_move_tree(text: str, supplied_initial_fen: str = START_FEN) -> dict[str, Any]:
    """Parse PGN-style Xiangqi movetext with recursive WXF/UCI variations.

    Pikafish remains the authority for legality; this adapter resolves WXF. The
    parser only owns the generic recursive-annotation-variation structure.
    """

    if not isinstance(text, str) or not text.strip():
        raise ValueError("notation must be a non-empty string")
    if len(text) > 500_000:
        raise ValueError("notation is too large")

    headers = {key.lower(): _unescape_tag(value) for key, value in _TAG_PATTERN.findall(text)}
    variant = headers.get("variant", "xiangqi").lower().replace(" ", "")
    if variant not in {"xiangqi", "standardxiangqi"}:
        raise ValueError(f"Unsupported Variant tag: {headers.get('variant')}")
    initial_fen = headers.get("fen", supplied_initial_fen).strip()
    root_board = PikafishBoard("xiangqi", initial_fen=initial_fen)
    root_state = board_state(root_board)

    movetext = _TAG_PATTERN.sub(" ", text)
    tokens = re.findall(r"\(|\)|[^\s()]+", _strip_pgn_comments(movetext))
    if tokens and all(_UCI_PATTERN.fullmatch(token) for token in tokens):
        return _import_uci_mainline(initial_fen, root_board, root_state, tokens, headers)
    parser = _MoveTreeParser(tokens)
    children: list[dict[str, Any]] = []
    parser.parse_sequence(root_board, children, depth=0, expect_close=False)
    if parser.node_count == 0:
        raise ValueError("notation contains no Xiangqi moves")
    return {
        "initialFen": initial_fen,
        "headers": headers,
        "state": root_state,
        "children": children,
    }


def _import_uci_mainline(
    initial_fen: str,
    board,
    root_state: dict[str, Any],
    moves: list[str],
    headers: dict[str, str],
) -> dict[str, Any]:
    """Build a stored UCI game without recalculating each position's legal moves twice."""

    if len(moves) > _MAX_IMPORT_NODES:
        raise ValueError("Notation contains too many moves")
    children: list[dict[str, Any]] = []
    next_children = children
    current_state = root_state
    for move in moves:
        if move not in current_state["legalMoves"]:
            raise IllegalMove(f"Illegal Xiangqi move at ply {current_state['ply'] + 1}: {move}")
        notation, current_state = _apply_move(board, move)
        node = {"move": move, "notation": notation, "state": current_state, "children": []}
        next_children.append(node)
        next_children = node["children"]
    return {
        "initialFen": initial_fen,
        "headers": headers,
        "state": root_state,
        "children": children,
    }


def _unescape_tag(value: str) -> str:
    return value.replace(r'\"', '"').replace(r"\\", "\\")


def _strip_pgn_comments(text: str) -> str:
    output: list[str] = []
    brace_depth = 0
    line_comment = False
    for char in text:
        if line_comment:
            if char in "\r\n":
                line_comment = False
                output.append(" ")
            continue
        if brace_depth:
            if char == "{":
                brace_depth += 1
            elif char == "}":
                brace_depth -= 1
            continue
        if char == "{":
            brace_depth = 1
            output.append(" ")
        elif char == ";":
            line_comment = True
            output.append(" ")
        else:
            output.append(char)
    if brace_depth:
        raise ValueError("Unclosed notation comment")
    return "".join(output)


class _MoveTreeParser:
    def __init__(self, tokens: list[str]):
        self.tokens = tokens
        self.index = 0
        self.node_count = 0

    def parse_sequence(
        self,
        board,
        siblings: list[dict[str, Any]],
        depth: int,
        expect_close: bool,
    ) -> None:
        if depth > _MAX_VARIATION_DEPTH:
            raise ValueError("Notation variations are nested too deeply")

        current_children = siblings
        last_parent_children: list[dict[str, Any]] | None = None
        last_before_fen: str | None = None

        while self.index < len(self.tokens):
            raw_token = self.tokens[self.index]
            if raw_token == ")":
                if not expect_close:
                    raise ValueError("Unexpected closing variation parenthesis")
                self.index += 1
                return
            if raw_token == "(":
                if last_parent_children is None or last_before_fen is None:
                    raise ValueError("Variation must follow a move")
                self.index += 1
                variation_board = PikafishBoard("xiangqi", initial_fen=last_before_fen)
                self.parse_sequence(variation_board, last_parent_children, depth + 1, expect_close=True)
                continue

            self.index += 1
            token = self._move_token(raw_token)
            if token is None:
                continue

            before_fen = board.fen
            move = self._resolve_move(board, token)
            notation, state = _apply_move(board, move)

            existing = next((node for node in current_children if node["move"] == move), None)
            if existing is None:
                self.node_count += 1
                if self.node_count > _MAX_IMPORT_NODES:
                    raise ValueError("Notation contains too many moves")
                node = {"move": move, "notation": notation, "state": state, "children": []}
                current_children.append(node)
            else:
                node = existing
                if node["state"]["fen"] != state["fen"]:
                    raise ValueError(f"Conflicting duplicate move in notation: {token}")

            last_parent_children = current_children
            last_before_fen = before_fen
            current_children = node["children"]

        if expect_close:
            raise ValueError("Unclosed variation parenthesis")

    @staticmethod
    def _move_token(raw_token: str) -> str | None:
        token = _MOVE_NUMBER_PATTERN.sub("", raw_token.strip())
        if not token or token in _RESULT_TOKENS or token.startswith("$"):
            return None
        token = re.sub(r"[!?]+$", "", token)
        return token or None

    @staticmethod
    def _resolve_move(board, token: str) -> str:
        legal_moves = board.legal_moves()
        if _UCI_PATTERN.fullmatch(token):
            if token not in legal_moves:
                raise IllegalMove(f"Illegal Xiangqi move at ply {board.ply + 1}: {token}")
            return token

        normalized = token.replace("−", "-").upper()
        matches = [
            move
            for move in legal_moves
            if board.get_san(move).replace("−", "-").upper() == normalized
        ]
        if not matches:
            raise IllegalMove(f"Unknown or illegal Xiangqi notation at ply {board.ply + 1}: {token}")
        if len(matches) > 1:
            raise ValueError(f"Ambiguous Xiangqi notation at ply {board.ply + 1}: {token}")
        return matches[0]
