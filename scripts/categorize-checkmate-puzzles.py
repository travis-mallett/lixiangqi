#!/usr/bin/env python3
"""Run deep Xiangqi checkmate categorization and puzzle promotion."""

from __future__ import annotations

import multiprocessing as mp
from pathlib import Path
import sys


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from tools.xiangqi_data.puzzle_mining.checkmate import main


if __name__ == "__main__":
    mp.freeze_support()
    raise SystemExit(main())
