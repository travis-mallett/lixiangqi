"""Presentation-only replay of accepted moves, using the shared FEN helpers."""

from __future__ import annotations
from PySide6.QtCore import Qt, Signal, QRectF, QPointF
from PySide6.QtGui import QPainter, QPen, QColor, QFont
from PySide6.QtWidgets import QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton
from tools.xiangqi_data.puzzle_mining.position import FenState, UI_MOVE
from tools.puzzle_catalog.catalog import fen_ply

FILES = "abcdefghi"
BLACK = {"r": "車", "n": "馬", "b": "象", "a": "士", "k": "將", "c": "炮", "p": "卒"}
RED = {**BLACK, "b": "相", "a": "仕", "k": "帥", "p": "兵"}


class XiangqiBoard(QWidget):
    positionChanged = Signal(int)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setMinimumSize(240, 270)
        self.setFocusPolicy(Qt.StrongFocus)
        self.fen = ""
        self.line = []
        self.index = 0
        self.flipped = False
        self.error = "Select a puzzle"
        self.positions = []

    def set_puzzle(self, puzzle):
        self.fen = puzzle.get("fen", "")
        raw = puzzle.get("line", [])
        self.line = raw.split() if isinstance(raw, str) else list(raw or [])
        self.error = ""
        self.positions = []
        self.index = 0
        try:
            fen_ply(self.fen)
            state = FenState(self.fen)
            self.positions.append(self._pieces(state))
            winner_is_black = state.turn == "b"
            for ply, move in enumerate(self.line):
                state.push(move)
                self.positions.append(self._pieces(state))
                # The setup move is the loser's move; its resulting turn is the
                # winning side whose pieces should face the user.
                if ply == 0:
                    winner_is_black = state.turn == "b"
            self.index = len(self.line)
            self.flipped = winner_is_black
        except (ValueError, IndexError, TypeError, KeyError) as exc:
            self.error = str(exc) if self.fen else "Select a puzzle"
            self.positions = []
        self.positionChanged.emit(self.index)
        self.update()

    @staticmethod
    def _pieces(state):
        return {
            (square[0], square[1:]): (piece.lower(), piece.isupper())
            for square, piece in state.position.items()
        }

    def _parse_fen(self, fen):
        fen_ply(fen)
        return self._pieces(FenState(fen))

    def reset(self):
        self.index = min(1, max(0, len(self.positions) - 1))
        self.positionChanged.emit(self.index)
        self.update()

    def set_flipped(self, value):
        self.flipped = bool(value)
        self.update()

    def navigate(self, delta):
        self.index = max(0, min(max(0, len(self.positions) - 1), self.index + delta))
        self.positionChanged.emit(self.index)
        self.update()

    def _coord(self, file, rank):
        x, y = FILES.index(file), 10 - int(rank)
        return (8 - x, 9 - y) if self.flipped else (x, y)

    def keyPressEvent(self, event):
        action = {
            Qt.Key_Left: -1,
            Qt.Key_Right: 1,
            Qt.Key_Home: -10000,
            Qt.Key_End: 10000,
        }
        if event.key() in action:
            self.navigate(action[event.key()])
            event.accept()
        else:
            super().keyPressEvent(event)

    def paintEvent(self, event):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        p.setBrush(QColor("#DEC396"))
        p.setPen(Qt.NoPen)
        p.drawRoundedRect(self.rect(), 12, 12)
        if self.error:
            p.setPen(QColor("#684129"))
            p.drawText(
                self.rect().adjusted(16, 16, -16, -16),
                Qt.AlignCenter | Qt.TextWordWrap,
                self.error,
            )
            return
        cell = min((self.width() - 24) / 9, (self.height() - 24) / 10)
        ox = (self.width() - cell * 8) / 2
        oy = (self.height() - cell * 9) / 2
        point = lambda x, y: QPointF(ox + x * cell, oy + y * cell)
        p.setPen(QPen(QColor("#886744"), 1.2))
        for rank in range(10):
            p.drawLine(point(0, rank), point(8, rank))
        for file in range(9):
            p.drawLine(point(file, 0), point(file, 4))
            p.drawLine(point(file, 5), point(file, 9))
        p.drawLine(point(0, 4), point(0, 5))
        p.drawLine(point(8, 4), point(8, 5))
        for a, b in [
            ((3, 0), (5, 2)),
            ((5, 0), (3, 2)),
            ((3, 7), (5, 9)),
            ((5, 7), (3, 9)),
        ]:
            p.drawLine(point(*a), point(*b))
        p.setFont(QFont("Microsoft YaHei", max(9, int(cell * 0.23))))
        p.drawText(
            QRectF(ox, oy + cell * 4, cell * 8, cell),
            Qt.AlignCenter,
            "楚 河                         漢 界",
        )
        if self.index and self.index <= len(self.line):
            match = UI_MOVE.fullmatch(self.line[self.index - 1])
            p.setBrush(QColor(36, 132, 150, 75))
            p.setPen(Qt.NoPen)
            for f, r in [(match[1], match[2]), (match[3], match[4])]:
                x, y = self._coord(f, r)
                p.drawRoundedRect(
                    QRectF(
                        ox + (x - 0.46) * cell,
                        oy + (y - 0.46) * cell,
                        0.92 * cell,
                        0.92 * cell,
                    ),
                    5,
                    5,
                )
        for (file, rank), (piece, red) in self.positions[self.index].items():
            x, y = self._coord(file, rank)
            center = point(x, y)
            p.setBrush(QColor("#F5DFB7"))
            p.setPen(QPen(QColor("#B39970"), 1.3))
            p.drawEllipse(center, cell * 0.39, cell * 0.39)
            p.setBrush(Qt.NoBrush)
            p.setPen(QPen(QColor("#BB3C32" if red else "#34414A"), 1.2))
            p.drawEllipse(center, cell * 0.32, cell * 0.32)
            font = QFont("Microsoft YaHei")
            font.setPixelSize(max(12, int(cell * 0.49)))
            font.setBold(True)
            p.setFont(font)
            p.drawText(
                QRectF(
                    center.x() - cell * 0.4,
                    center.y() - cell * 0.4,
                    cell * 0.8,
                    cell * 0.8,
                ),
                Qt.AlignCenter,
                (RED if red else BLACK)[piece],
            )
        p.setPen(QColor("#806849"))
        font = QFont("Segoe UI")
        font.setPixelSize(max(9, int(cell * 0.18)))
        p.setFont(font)
        for i in range(9):
            f = FILES[8 - i] if self.flipped else FILES[i]
            p.drawText(
                QRectF(ox + (i - 0.4) * cell, oy + 9.45 * cell, 0.8 * cell, 0.3 * cell),
                Qt.AlignCenter,
                f,
            )


class MoveNavigator(QWidget):
    positionChanged = Signal(int)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.board = XiangqiBoard()
        self.status = QLabel("Select a puzzle")
        self.status.setWordWrap(True)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.addWidget(self.board, 1)
        controls = QHBoxLayout()
        self.buttons = []
        for text, delta, tip in [
            ("|←", -10000, "Initial position (Home)"),
            ("←", -1, "Previous move (Left)"),
            ("→", 1, "Next move (Right)"),
            ("→|", 10000, "End of solution (End)"),
        ]:
            b = QPushButton(text)
            b.setToolTip(tip)
            b.setFixedWidth(44)
            b.clicked.connect(lambda _, d=delta: self.board.navigate(d))
            controls.addWidget(b)
            self.buttons.append((b, delta))
        flip = QPushButton("Flip")
        flip.clicked.connect(lambda: self.board.set_flipped(not self.board.flipped))
        controls.addWidget(flip)
        controls.addStretch()
        layout.addLayout(controls)
        layout.addWidget(self.status)
        self.board.positionChanged.connect(self._changed)

    def set_puzzle(self, puzzle):
        self.board.set_puzzle(puzzle)

    def _changed(self, index):
        total = len(self.board.line)
        caption = (
            "Initial position"
            if index == 0
            else (
                "Setup move · your turn"
                if index == 1
                else f"Solution {index-1} / {max(0,total-1)}"
            )
        )
        move = f" · {self.board.line[index-1]}" if index else ""
        self.status.setText(self.board.error or caption + move)
        for b, delta in self.buttons:
            b.setEnabled(
                not self.board.error and (index > 0 if delta < 0 else index < total)
            )
        self.positionChanged.emit(index)
