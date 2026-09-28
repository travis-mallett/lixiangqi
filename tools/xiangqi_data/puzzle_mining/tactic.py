"""Categorize verified tactics with the shared resumable category worker."""

import multiprocessing as mp

from .checkmate import main

if __name__ == "__main__":
    mp.freeze_support()
    raise SystemExit(main("tactic_candidate"))
