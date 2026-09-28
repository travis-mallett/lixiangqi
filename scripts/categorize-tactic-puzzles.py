#!/usr/bin/env python3
"""Classify tactic candidates from persisted verification evidence."""

from __future__ import annotations
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tools.xiangqi_data.puzzle_mining.checkmate import main


if __name__ == "__main__":
    import multiprocessing as mp

    mp.freeze_support()
    raise SystemExit(main("tactic_candidate"))
