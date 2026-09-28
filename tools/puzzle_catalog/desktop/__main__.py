"""Puzzle Studio desktop entry point. Opening the UI performs no network actions."""

import argparse
import sys
from pathlib import Path
from PySide6.QtCore import QLockFile
from PySide6.QtWidgets import QApplication, QMessageBox
from .settings import STATE
from .theme import apply


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--settings", type=Path, default=STATE / "settings.json")
    args = parser.parse_args()
    app = QApplication(sys.argv[:1])
    app.setApplicationName("LiXiangQi Puzzle Studio")
    app.setOrganizationName("LiXiangQi")
    apply(app)
    STATE.mkdir(parents=True, exist_ok=True)
    lock = QLockFile(str(STATE / "studio.lock"))
    lock.setStaleLockTime(0)
    if not lock.tryLock(0):
        QMessageBox.information(
            None,
            "Puzzle Studio is already open",
            "Use the existing Puzzle Studio window. Only one control panel may own the local tools.",
        )
        return 1
    try:
        from .window import StudioWindow

        window = StudioWindow(args.settings)
        window.show()
        return app.exec()
    except Exception as exc:
        import traceback

        details = traceback.format_exc()
        log_path = STATE / "startup-error.log"
        try:
            log_path.write_text(details, encoding="utf-8")
            detail_message = "\n\nDetails: " + str(log_path)
        except OSError:
            detail_message = "\n\nThe startup log could not be saved.\n\n" + details
        QMessageBox.critical(
            None,
            "Puzzle Studio could not start",
            str(exc) + detail_message,
        )
        return 1
    finally:
        lock.unlock()


if __name__ == "__main__":
    raise SystemExit(main())
