"""Bounded, cancellable child processes; no web service or database is used."""

import json
import os
import queue
import subprocess
import tempfile
import threading
import time


class Cancelled(Exception):
    pass


class Lines:
    def __init__(self, command, stop, cwd):
        self.stop = stop
        self.output = queue.Queue()
        self.errors = tempfile.TemporaryFile()
        try:
            self.process = subprocess.Popen(
                command, cwd=cwd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                stderr=self.errors, text=True, encoding="utf-8", bufsize=1,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            )
        except BaseException:
            self.errors.close()
            raise

        def pump():
            try:
                for line in self.process.stdout:
                    self.output.put(line.rstrip())
            finally:
                self.output.put(None)

        self.reader = threading.Thread(target=pump, daemon=True)
        self.reader.start()

    def send(self, command):
        if self.stop.is_set():
            raise Cancelled()
        self.process.stdin.write(command + "\n")
        self.process.stdin.flush()

    def until(self, predicate, timeout=30):
        deadline = time.monotonic() + timeout
        lines = []
        while True:
            if self.stop.is_set():
                raise Cancelled()
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("Child process did not finish within its watchdog budget")
            try:
                line = self.output.get(timeout=min(0.25, remaining))
            except queue.Empty:
                continue
            if line is None:
                self.errors.seek(0)
                raise RuntimeError("Child process exited: " + self.errors.read().decode(errors="replace")[-4000:])
            lines.append(line)
            if predicate(line):
                return lines

    def close(self):
        try:
            if self.process.poll() is None:
                self.process.terminate()
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait(timeout=5)
        finally:
            self.reader.join(timeout=5)
            self.process.stdin.close()
            self.process.stdout.close()
            self.errors.close()


class Referee(Lines):
    def request(self, value):
        self.send(json.dumps(value))
        response = json.loads(self.until(lambda _: True, timeout=90)[-1])
        if "error" in response:
            raise RuntimeError(response["error"])
        return response


def engine_move(move):
    """Site ranks are 1..10; UCI ranks are 0..9."""
    import re
    match = re.fullmatch(r"([a-i])(10|[1-9])([a-i])(10|[1-9])", move)
    if not match:
        raise ValueError(f"Invalid site coordinate: {move}")
    a, b, c, d = match.groups()
    return f"{a}{int(b) - 1}{c}{int(d) - 1}"


def observation_fen(state):
    placement, turn, _, _, quiet, fullmove = state["fen"].split()
    inventory = "".join(p + str(state["remaining"][p]) for p in "RACPNBracpnb" if state["remaining"][p])
    return f"{placement} {turn} {inventory or '-'} {quiet} {fullmove}"


class Engine(Lines):
    def initialize(self, hash_mb):
        self.send("uci")
        identity = self.until(lambda line: line == "uciok", timeout=60)
        for option in ("Threads value 1", f"Hash value {hash_mb}", "MultiPV value 1"):
            self.send("setoption name " + option)
        self.new_game()
        return identity

    def new_game(self):
        self.send("ucinewgame")
        self.send("isready")
        self.until(lambda line: line == "readyok")

    def choose(self, state, movetime):
        moves = {engine_move(move): move for move in state["legalMoves"]}
        if not moves:
            raise ValueError("Ongoing game has no legal moves")
        fen = observation_fen(state)
        self.send("position fen " + fen)
        command = f"go movetime {movetime} searchmoves " + " ".join(moves)
        start = time.monotonic()
        self.send(command)
        output = self.until(lambda line: line.startswith("bestmove "), timeout=max(15, movetime / 1000 * 5))
        elapsed = time.monotonic() - start
        chosen = output[-1].split()[1]
        if chosen not in moves:
            raise RuntimeError(f"Engine returned forbidden move {chosen}")
        return {
            "move": moves[chosen], "engineFen": fen, "go": command,
            "elapsedSeconds": elapsed, "output": output,
        }
