"""Offline JSON-lines adapter. Reuses the repository's one maintained Pikafish UCI bridge.

This process is never imported by the browser package. Results are diagnostic labels,
not runtime candidates, evaluation features, rescue moves, or knowledge updates.
"""
from __future__ import annotations

import json
from pathlib import Path
import sys
import threading

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from tools.xiangqi_data.pikafish import Pikafish


def main() -> None:
    engine = Pikafish()
    try:
        for line in sys.stdin:
            try:
                request = json.loads(line)
                nodes = request.get("nodes", 10000)
                if not isinstance(nodes, int) or not 1 <= nodes <= 100000:
                    raise ValueError("Offline oracle requires 1 to 100000 nodes")
                final = None
                expired = threading.Event()

                def stop_stalled_engine() -> None:
                    expired.set()
                    child = engine.process
                    if child is not None and child.poll() is None:
                        # Only the subprocess owned by this oracle can be stopped.
                        child.kill()

                watchdog = threading.Timer(20, stop_stalled_engine)
                watchdog.start()
                try:
                    for result in engine.search_stream(
                        initial_fen=request["initialFen"], moves=request["moves"],
                        legal_moves=request["legalMoves"], search={"nodes": nodes},
                        multi_pv=1, threads=1, hash_mb=16,
                    ):
                        final = result
                finally:
                    watchdog.cancel()
                    watchdog.join()
                if expired.is_set():
                    raise TimeoutError("Offline Pikafish runtime limit exceeded")
                if final is None or final["bestMove"] not in request["legalMoves"]:
                    raise ValueError("Oracle returned no authorized legal move")
                print(json.dumps({"ok": True, "analysis": final}), flush=True)
            except Exception as error:
                print(json.dumps({"ok": False, "error": str(error)}), flush=True)
    finally:
        engine.close()


if __name__ == "__main__":
    main()
