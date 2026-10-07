"""Persistent offline process using the project's already-built native rules."""

from __future__ import annotations

import json
import os
import queue
import shutil
import subprocess
import tempfile
import threading
from pathlib import Path


class NativeRules:
    def __init__(self, java: str | None = None, class_path: str | None = None):
        root = Path(__file__).resolve().parents[2]
        bundled = sorted((root / ".tools/jdk-21").glob("*/bin/java.exe"))
        self.java = java or (str(bundled[-1]) if bundled else shutil.which("java"))
        if not self.java:
            raise FileNotFoundError("Java 21 is required for the native rules bridge")
        self.class_path = class_path or str(root / "target/universal/stage/lib/*")
        self.source = Path(__file__).with_name("NativeRules.java")
        self.process = None
        self.reader = None
        self.errors = None
        self.output = queue.Queue()

    def artifacts(self):
        files = []
        for entry in self.class_path.split(os.pathsep):
            path = Path(entry)
            if path.name == "*":
                files.extend(sorted(path.parent.glob("*.jar")))
            elif path.is_file():
                files.append(path)
            else:
                raise ValueError("Native classpath must contain staged JAR files")
        if not any("xiangqi" in file.name for file in files):
            raise FileNotFoundError(
                "Native rules JAR missing; run the repository SBT stage command first"
            )
        return files

    def start(self):
        if self.process is not None and self.process.poll() is None:
            return
        self.close()
        self.artifacts()
        self.errors = tempfile.TemporaryFile(mode="w+b")  # noqa: SIM115 - process-owned, closed by close()
        self.process = subprocess.Popen(
            [
                self.java,
                "-Xmx512m",
                "-XX:ActiveProcessorCount=1",
                "--class-path",
                self.class_path,
                str(self.source),
            ],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=self.errors,
            text=True,
            encoding="utf-8",
            bufsize=1,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
        process, output = self.process, self.output

        def pump():
            for line in process.stdout:
                output.put(line)
            output.put(None)

        self.reader = threading.Thread(
            target=pump, daemon=True, name="calibration-native-rules"
        )
        self.reader.start()

    def position(self, initial_fen: str, moves: tuple[str, ...]) -> dict:
        cold = self.process is None or self.process.poll() is not None
        self.start()
        self.process.stdin.write(
            json.dumps({"initialFen": initial_fen, "moves": moves}) + "\n"
        )
        self.process.stdin.flush()
        try:
            line = self.output.get(timeout=60 if cold else 10)
        except queue.Empty as error:
            self.close()
            raise TimeoutError("Native rules bridge timed out") from error
        if line is None:
            self.errors.seek(0)
            detail = self.errors.read().decode(errors="replace")[-4000:]
            self.close()
            raise RuntimeError("Native rules bridge exited: " + detail)
        state = json.loads(line)
        if "error" in state:
            raise ValueError(state["error"])
        if (
            state.get("gameResult") not in {"*", "1-0", "0-1", "1/2-1/2"}
            or state.get("turn") not in {"red", "black"}
            or not isinstance(state.get("fen"), str)
            or not isinstance(state.get("legalMoves"), list)
        ):
            raise ValueError("Native rules returned an invalid state")
        return state

    def close(self):
        process, self.process = self.process, None
        if process:
            try:
                if process.stdin:
                    process.stdin.close()
                process.wait(timeout=2)
            except (OSError, subprocess.TimeoutExpired):
                process.kill()
                process.wait(timeout=5)
            finally:
                if self.reader:
                    self.reader.join(timeout=2)
                if process.stdout:
                    process.stdout.close()
        if self.errors:
            self.errors.close()
            self.errors = None
        self.output = queue.Queue()
