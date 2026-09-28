import os
import unittest
from unittest.mock import patch
from PySide6.QtWidgets import QApplication, QDialog, QLineEdit
from PySide6.QtCore import QProcessEnvironment
from tools.puzzle_catalog.desktop.credentials import publication_credentials
from tools.puzzle_catalog.desktop.settings import Settings


class CredentialTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def test_preview_never_prompts_or_needs_an_environment_token(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(
            QDialog, "exec"
        ) as prompt:
            self.assertTrue(publication_credentials(None, Settings(), ["preview"]))
            prompt.assert_not_called()

    def test_token_is_available_to_workers_but_not_settings(self):
        def accept(dialog):
            dialog.findChild(QLineEdit).setText("test-live-token")
            return QDialog.Accepted

        with patch.dict(os.environ, {}, clear=True), patch.object(
            QDialog, "exec", accept
        ):
            self.assertTrue(publication_credentials(None, Settings(), ["live"]))
            self.assertEqual(
                QProcessEnvironment.systemEnvironment().value("LIXIANGQI_PUZZLE_TOKEN"),
                "test-live-token",
            )
            self.assertNotIn("LIXIANGQI_PREVIEW_PUZZLE_TOKEN", os.environ)
            self.assertNotIn("test-live-token", str(Settings()))

    def test_cancel_does_not_set_token(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(
            QDialog, "exec", return_value=QDialog.Rejected
        ):
            self.assertFalse(publication_credentials(None, Settings(), ["live"]))
            self.assertNotIn("LIXIANGQI_PUZZLE_TOKEN", os.environ)

    def test_existing_token_needs_no_prompt(self):
        with patch.dict(
            os.environ, {"LIXIANGQI_PUZZLE_TOKEN": "existing"}
        ), patch.object(QDialog, "exec") as prompt:
            self.assertTrue(publication_credentials(None, Settings(), ["live"]))
            prompt.assert_not_called()
