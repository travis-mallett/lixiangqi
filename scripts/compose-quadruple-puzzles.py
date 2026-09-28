#!/usr/bin/env python3
"""Generate and verify diverse composed quadruple-checkmate puzzles offline."""

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from tools.xiangqi_data.puzzle_composition.cli import main

if __name__ == "__main__":
    raise SystemExit(main())
