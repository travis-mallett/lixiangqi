from __future__ import annotations

import cv2
import numpy as np
from PIL import Image, ImageGrab, ImageTk

# The optimizer intentionally uses only deterministic fixed-theme vision.
# Keep explicit sentinels for legacy copied helper signatures, but do not import
# or initialize an OCR runtime anywhere in this project.
RapidOCR = None
PieceRapidOCR = None

try:
    import win32api
    import win32clipboard
    import win32con
except ImportError:  # pragma: no cover - optional runtime dependency.
    win32api = None
    win32clipboard = None
    win32con = None

try:
    import pyautogui

    pyautogui.FAILSAFE = False
except ImportError:  # pragma: no cover - optional runtime dependency.
    pyautogui = None

try:
    from windows_capture import WindowsCapture
except ImportError:  # pragma: no cover - optional runtime dependency.
    WindowsCapture = None

try:
    import tkinter as tk
    from tkinter import filedialog, messagebox, scrolledtext
except ImportError:  # pragma: no cover - Tkinter is expected on Windows.
    tk = None
    filedialog = None
    messagebox = None
    scrolledtext = None
