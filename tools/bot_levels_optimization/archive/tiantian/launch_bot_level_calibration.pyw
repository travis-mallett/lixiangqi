from __future__ import annotations

import ctypes
import multiprocessing
import os
import subprocess
import sys
import traceback
from pathlib import Path


TOOL_ROOT = Path(__file__).resolve().parent
ERROR_LOG = TOOL_ROOT / "launcher_error.log"


def _is_admin() -> bool:
    if os.name != "nt":
        return True
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def _elevate() -> bool:
    if _is_admin():
        return False
    parameters = subprocess.list2cmdline([str(Path(__file__).resolve()), *sys.argv[1:]])
    result = ctypes.windll.shell32.ShellExecuteW(
        None,
        "runas",
        sys.executable,
        parameters,
        str(TOOL_ROOT),
        1,
    )
    if int(result) <= 32:
        raise OSError(f"Windows elevation failed with ShellExecuteW code {result}.")
    return True


def _show_error() -> None:
    try:
        import tkinter as tk
        from tkinter import messagebox

        root = tk.Tk()
        root.withdraw()
        messagebox.showerror(
            "Lixiangqi bot calibration",
            f"The calibration GUI could not start.\n\nDetails: {ERROR_LOG}",
        )
        root.destroy()
    except Exception:
        pass


def run() -> int:
    if os.name != "nt":
        raise RuntimeError("Tiantian desktop automation currently requires Windows.")
    if _elevate():
        return 0
    os.chdir(TOOL_ROOT)
    if str(TOOL_ROOT) not in sys.path:
        sys.path.insert(0, str(TOOL_ROOT))
    from bot_level_calibrator.app import main

    return main()


if __name__ == "__main__":
    multiprocessing.freeze_support()
    try:
        raise SystemExit(run())
    except Exception:
        ERROR_LOG.write_text(traceback.format_exc(), encoding="utf-8")
        _show_error()
        raise
