"""Asynchronous jobs, persistent run logs, and explicit ownership of workers."""

from __future__ import annotations
import codecs
import json
import os
from pathlib import Path
import re
import sys
import time
import uuid
import psutil
from PySide6.QtCore import QObject, QProcess, QProcessEnvironment, QTimer, Signal


class JobManager(QObject):
    changed = Signal(str)
    output = Signal(str, str)
    finished = Signal(str, int)

    def __init__(self, root: Path, state_dir: Path):
        super().__init__()
        self.root, self.state_dir = Path(root), Path(state_dir)
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self._jobs = {}
        self._cancel = {}
        self._protected = {}
        self._logs = {}
        self._records = {}
        self._offset = {}
        self._decoders = {}
        self._history = []
        self.timer = QTimer(self)
        self.timer.timeout.connect(self._poll)
        self.timer.start(250)
        # Reattach monitoring to protected operations that survived a UI crash.
        for path in sorted(self.state_dir.glob("*.json")):
            try:
                r = json.loads(path.read_text(encoding="utf-8"))
                if "code" in r:
                    self._history.append((r["name"], r["code"]))
                    self._logs[r["name"]] = Path(r["log"])
                elif self._alive(r):
                    name = r["name"]
                    self._jobs[name] = None
                    self._cancel[name] = False
                    self._protected[name] = True
                    self._logs[name] = Path(r["log"])
                    self._records[name] = path
                    self._offset[name] = 0
                    self._decoders[name] = codecs.getincrementaldecoder("utf-8")(
                        "replace"
                    )
                else:
                    self._history.append((r["name"], -1))
            except (OSError, ValueError, KeyError):
                continue

    @staticmethod
    def _alive(r):
        try:
            return abs(psutil.Process(r["pid"]).create_time() - r["created"]) < 0.01
        except (psutil.Error, KeyError):
            return False

    def start(self, name, argv, cancellable=True):
        if not re.fullmatch(r"[A-Za-z0-9_-]+", name) or not argv or self.active(name):
            return False
        ident = f"{time.time_ns()}-{name}-{uuid.uuid4().hex[:6]}"
        log = self.state_dir / (ident + ".log")
        log.touch()
        record = self.state_dir / (ident + ".json")
        record.write_text(
            json.dumps(
                dict(name=name, log=str(log), started=time.time(), command=argv)
            ),
            encoding="utf-8",
        )
        proc = QProcess(self)
        proc.setWorkingDirectory(str(self.root))
        proc.setProgram(sys.executable)
        proc.setArguments(
            [
                str(Path(__file__).with_name("worker.py")),
                "--log",
                str(log),
                "--record",
                str(record),
                *(["--protected"] if not cancellable else []),
                "--",
                *map(str, argv),
            ]
        )
        env = QProcessEnvironment.systemEnvironment()
        env.insert("PYTHONUNBUFFERED", "1")
        env.insert("PYTHONIOENCODING", "utf-8")
        env.insert("PYTHONUTF8", "1")
        proc.setProcessEnvironment(env)
        proc.setProcessChannelMode(QProcess.MergedChannels)
        proc.readyReadStandardOutput.connect(
            lambda p=proc, n=name: self._supervisor_output(n, p)
        )
        proc.finished.connect(
            lambda code, status, n=name, p=proc: self._done(n, p, int(code))
        )
        proc.errorOccurred.connect(lambda err, n=name, p=proc: self._error(n, p, err))
        self._jobs[name] = proc
        self._logs[name] = log
        self._records[name] = record
        self._offset[name] = 0
        self._decoders[name] = codecs.getincrementaldecoder("utf-8")("replace")
        self._cancel[name] = cancellable
        self._protected[name] = not cancellable
        proc.start()
        self.changed.emit(name)
        return True

    def _supervisor_output(self, name, proc):
        text = bytes(proc.readAllStandardOutput()).decode("utf-8", "replace")
        if text:
            with self._logs[name].open("a", encoding="utf-8") as f:
                f.write(text)

    def _error(self, name, proc, error):
        self.output.emit(name, proc.errorString())
        if error == QProcess.FailedToStart:
            self._done(name, proc, -1)

    def _read(self, name):
        try:
            with self._logs[name].open("rb") as f:
                f.seek(self._offset[name])
                data = f.read(262144)
                self._offset[name] = f.tell()
            if data:
                self.output.emit(name, self._decoders[name].decode(data))
        except OSError as exc:
            self.output.emit(name, str(exc))

    def _poll(self):
        for name, proc in list(self._jobs.items()):
            self._read(name)
            if proc is None:
                try:
                    r = json.loads(self._records[name].read_text(encoding="utf-8"))
                    if "code" in r or not self._alive(r):
                        self._done(name, None, r.get("code", -1))
                except (OSError, ValueError):
                    pass

    def _done(self, name, proc, code):
        if name not in self._jobs or self._jobs[name] is not proc:
            return
        self._read(name)
        self._jobs.pop(name)
        self._history.append((name, code))
        try:
            r = json.loads(self._records[name].read_text(encoding="utf-8"))
            r.update(code=code, finished=time.time())
            self._records[name].write_text(json.dumps(r), encoding="utf-8")
        except (OSError, ValueError):
            pass
        if proc:
            proc.deleteLater()
        self.changed.emit(name)
        self.finished.emit(name, code)

    def stop(self, name):
        proc = self._jobs.get(name)
        if not proc or not self._cancel.get(name):
            return False
        self._cancel[name] = False
        proc.write(b"STOP\n")
        self.changed.emit(name)
        # The supervisor owns tree shutdown; kill-on-close is the Windows guard
        # if the supervisor itself becomes stuck. Never target other processes.
        QTimer.singleShot(8000, lambda: self._force(name, proc))
        return True

    def _force(self, name, proc):
        if self._jobs.get(name) is not proc:
            return
        # The supervisor owns tree shutdown, but a supervisor stuck badly enough
        # to be forced may die without it. A Windows job object cannot contain
        # descendants when the supervisor itself runs inside a job, so the
        # captured tree is cleared here rather than left mining unsupervised.
        try:
            children = psutil.Process(proc.processId()).children(recursive=True)
        except psutil.Error:
            children = []
        proc.kill()
        for child in reversed(children):
            try:
                child.kill()
            except psutil.Error:
                continue
        psutil.wait_procs(children, timeout=3)

    def active(self, name):
        return name in self._jobs

    def any_active(self):
        return bool(self._jobs)

    def running_names(self):
        return list(self._jobs)

    def protected(self):
        return [n for n in self._jobs if self._protected.get(n)]

    def history(self):
        return list(self._history)

    def log_paths(self):
        return dict(self._logs)
