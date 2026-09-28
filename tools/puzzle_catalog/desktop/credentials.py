"""Session-only publication credentials; never stored in settings or run arguments."""

import os
from html import escape
from PySide6.QtWidgets import QDialog, QVBoxLayout, QLineEdit, QDialogButtonBox
from .widgets import label


def publication_credentials(parent, settings, destinations):
    for destination in destinations:
        if destination == "preview":
            continue
        name = "LIXIANGQI_PUZZLE_TOKEN"
        if os.environ.get(name, "").strip():
            continue
        origin = settings.publication_origin
        title = "Live Site"
        dialog = QDialog(parent)
        dialog.setWindowTitle(f"Connect to {title}")
        dialog.resize(540, 260)
        layout = QVBoxLayout(dialog)
        layout.addWidget(
            label(
                f"Sign in to {title} with a PuzzleCurator account, then create a token with the puzzle:publish permission."
            )
        )
        url = (
            origin.rstrip("/")
            + "/account/oauth/token/create?scopes[]=puzzle:publish&description=Puzzle+Studio"
        )
        link = label(f'<a href="{escape(url, quote=True)}">Create a {title} token</a>')
        link.setOpenExternalLinks(True)
        layout.addWidget(link)
        field = QLineEdit()
        field.setEchoMode(QLineEdit.Password)
        field.setPlaceholderText("Paste the token here")
        layout.addWidget(field)
        layout.addWidget(
            label(
                "Kept only for this Studio session. It is not saved in settings or logs.",
                "muted",
            )
        )
        controls = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        controls.button(QDialogButtonBox.Ok).setText("Connect")
        controls.button(QDialogButtonBox.Ok).setEnabled(False)
        field.textChanged.connect(
            lambda text: controls.button(QDialogButtonBox.Ok).setEnabled(
                bool(text.strip())
            )
        )
        controls.accepted.connect(dialog.accept)
        controls.rejected.connect(dialog.reject)
        layout.addWidget(controls)
        if dialog.exec() != QDialog.Accepted or not field.text().strip():
            return False
        os.environ[name] = field.text().strip()
        field.clear()
    return True
