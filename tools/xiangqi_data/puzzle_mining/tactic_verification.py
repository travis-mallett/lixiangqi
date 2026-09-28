"""Verify and construct only non-mating tactic candidates."""

import multiprocessing as mp

from .verification import main

if __name__ == "__main__":
    mp.freeze_support()
    raise SystemExit(main("tactic_candidate"))
