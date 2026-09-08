from __future__ import annotations

import ctypes

def _make_process_dpi_aware() -> None:
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    awareness_contexts = (-4, -3)
    for value in awareness_contexts:
        setter = getattr(user32, "SetProcessDpiAwarenessContext", None)
        if setter is None:
            break
        try:
            if setter(ctypes.c_void_p(value)):
                return
        except Exception:
            break
    try:
        user32.SetProcessDPIAware()
    except Exception:
        return
