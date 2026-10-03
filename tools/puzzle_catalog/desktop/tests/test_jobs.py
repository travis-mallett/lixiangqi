import sys
import os

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
import tempfile
import time
import unittest
import json
import psutil
from pathlib import Path

try:
    from PySide6.QtWidgets import QApplication as QCoreApplication
    from tools.puzzle_catalog.desktop.jobs import JobManager
except ImportError:
    QCoreApplication = None
    JobManager = None


@unittest.skipUnless(QCoreApplication, "PySide6 is required")
class JobManagerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QCoreApplication.instance() or QCoreApplication([])

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.manager = JobManager(self.root, self.root / "state")
        self.events = []
        self.manager.finished.connect(lambda n, c: self.events.append((n, c)))

    def tearDown(self):
        self.tmp.cleanup()

    def wait(self, name, timeout=10):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline and self.manager.active(name):
            self.app.processEvents()
            time.sleep(0.02)
        self.app.processEvents()
        self.assertFalse(self.manager.active(name), f"job {name} did not finish")

    def command(self, code):
        return [sys.executable, "-c", code]

    def test_success_and_failure_emit_once_and_write_log(self):
        self.assertTrue(self.manager.start("ok", self.command("print('hello')")))
        self.wait("ok")
        self.assertEqual([e for e in self.events if e[0] == "ok"], [("ok", 0)])
        self.assertIn(
            "hello", self.manager.log_paths()["ok"].read_text(encoding="utf-8")
        )
        self.assertTrue(self.manager.start("bad", self.command("raise SystemExit(7)")))
        self.wait("bad")
        self.assertEqual([e for e in self.events if e[0] == "bad"], [("bad", 7)])

    def test_duplicate_is_rejected(self):
        args = self.command("import time; time.sleep(2)")
        self.assertTrue(self.manager.start("same", args))
        self.assertFalse(self.manager.start("same", args))
        self.manager.stop("same")
        self.wait("same")

    def test_generation_child_yields_cpu_to_interactive_apps(self):
        self.manager.start(
            "priority",
            self.command("import psutil; print(int(psutil.Process().nice()))"),
        )
        self.wait("priority")
        actual = int(self.manager.log_paths()["priority"].read_text().strip())
        if os.name == "nt":
            self.assertEqual(actual, int(psutil.BELOW_NORMAL_PRIORITY_CLASS))
        else:
            self.assertGreaterEqual(actual, 5)

    @unittest.skipUnless(os.name == "nt", "Windows generation priorities")
    def test_stage_priority_is_inherited_by_engine_grandchildren(self):
        code = (
            "import subprocess,sys; "
            "subprocess.run([sys.executable, '-c', "
            "'import psutil; print(int(psutil.Process().nice()))'], check=True)"
        )
        for name in ("discovery", "verifier", "categorizer"):
            with self.subTest(stage=name):
                self.assertTrue(self.manager.start(name, self.command(code)))
                self.wait(name)
                self.assertEqual(self.events[-1], (name, 0))
                actual = int(self.manager.log_paths()[name].read_text().strip())
                expected = (
                    psutil.NORMAL_PRIORITY_CLASS
                    if name == "discovery"
                    else psutil.BELOW_NORMAL_PRIORITY_CLASS
                )
                self.assertEqual(actual, int(expected))

    def test_non_cancellable_job_is_protected(self):
        self.assertTrue(
            self.manager.start(
                "protected",
                self.command("import time; time.sleep(.2)"),
                cancellable=False,
            )
        )
        self.assertFalse(self.manager.stop("protected"))
        self.wait("protected")
        self.assertEqual(self.events[-1], ("protected", 0))

    def test_stop_cancels_child_tree(self):
        marker = self.root / "child.json"
        code = "import subprocess,time,sys,json,pathlib; c=subprocess.Popen([sys.executable,'-c','import time; time.sleep(30)']); pathlib.Path(sys.argv[1]).write_text(json.dumps([c.pid])); time.sleep(30)"
        self.assertTrue(self.manager.start("tree", [*self.command(code), str(marker)]))
        deadline = time.monotonic() + 5
        while not marker.exists() and time.monotonic() < deadline:
            self.app.processEvents()
            time.sleep(0.02)
        self.assertTrue(marker.exists())
        pid = json.loads(marker.read_text())[0]
        self.assertTrue(psutil.pid_exists(pid))
        self.assertTrue(self.manager.stop("tree"))
        self.wait("tree", 10)
        self.assertFalse(psutil.pid_exists(pid))
        self.assertEqual(self.events[-1], ("tree", 130))

    def test_forced_stop_does_not_orphan_the_child_tree(self):
        marker = self.root / "forced.json"
        code = "import subprocess,time,sys,json,pathlib; c=subprocess.Popen([sys.executable,'-c','import time; time.sleep(30)']); pathlib.Path(sys.argv[1]).write_text(json.dumps([c.pid])); time.sleep(30)"
        self.assertTrue(self.manager.start("forced", [*self.command(code), str(marker)]))
        deadline = time.monotonic() + 5
        while not marker.exists() and time.monotonic() < deadline:
            self.app.processEvents()
            time.sleep(0.02)
        self.assertTrue(marker.exists())
        pid = json.loads(marker.read_text())[0]
        self.manager._cancel["forced"] = False
        self.manager._force("forced", self.manager._jobs["forced"])
        self.wait("forced", 10)
        deadline = time.monotonic() + 5
        while psutil.pid_exists(pid) and time.monotonic() < deadline:
            time.sleep(0.02)
        self.assertFalse(psutil.pid_exists(pid))

    def test_parent_pipe_loss_stops_generation_but_not_protected_operation(self):
        self.manager.start("ordinary", self.command("import time; time.sleep(20)"))
        self.manager._jobs["ordinary"].closeWriteChannel()
        self.wait("ordinary")
        self.assertEqual(self.events[-1], ("ordinary", 130))
        self.manager.start(
            "protected", self.command("import time; time.sleep(.5)"), False
        )
        self.manager._jobs["protected"].closeWriteChannel()
        self.wait("protected")
        self.assertEqual(self.events[-1], ("protected", 0))

    def test_start_failure_and_unique_run_logs(self):
        self.manager.start("missing", [str(self.root / "no-program.exe")])
        self.wait("missing")
        self.assertNotEqual(self.events[-1][1], 0)
        self.manager.start("repeat", self.command("print(1)"))
        self.wait("repeat")
        first = self.manager.log_paths()["repeat"]
        self.manager.start("repeat", self.command("print(2)"))
        self.wait("repeat")
        second = self.manager.log_paths()["repeat"]
        self.assertNotEqual(first, second)
        self.assertIn("1", first.read_text())
        self.assertIn("2", second.read_text())


if __name__ == "__main__":
    unittest.main()
