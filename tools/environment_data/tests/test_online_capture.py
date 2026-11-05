import os
from contextlib import redirect_stdout
import io
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import MagicMock

from tools.environment_data.remote import capture_command, run_remote


class OnlineCaptureTests(unittest.TestCase):
    def test_ssh_combines_stderr_before_execution_and_streams_output(self):
        client = MagicMock()
        channel = client.get_transport.return_value.open_session.return_value
        channel.__enter__.return_value = channel
        events = []
        channel.set_combine_stderr.side_effect = lambda value: events.append("combine")
        channel.exec_command.side_effect = lambda command: events.append("execute")
        channel.makefile.return_value = io.StringIO("Capturing production data\nDone\n")
        channel.recv_exit_status.return_value = 0
        output = io.StringIO()
        with redirect_stdout(output):
            run_remote(client, "capture")
        self.assertEqual(events, ["combine", "execute"])
        self.assertEqual(output.getvalue(), "Capturing production data\nDone\n")
        channel.__exit__.assert_called_once()

    def test_ssh_failure_reports_exit_code_and_bounded_diagnostic_tail(self):
        for diagnostic in (
            "",
            "early stderr failure\n",
            "old output\n" * 50 + "restore failed\n",
        ):
            with self.subTest(diagnostic=diagnostic):
                client = MagicMock()
                channel = client.get_transport.return_value.open_session.return_value
                channel.__enter__.return_value = channel
                channel.makefile.return_value = io.StringIO(diagnostic)
                channel.recv_exit_status.return_value = 1
                with redirect_stdout(io.StringIO()):
                    with self.assertRaisesRegex(RuntimeError, "exit 1") as caught:
                        run_remote(client, "capture")
                message = str(caught.exception)
                self.assertIn(
                    (
                        diagnostic.splitlines()[-1]
                        if diagnostic
                        else "No remote diagnostic output"
                    ),
                    message,
                )
                self.assertLessEqual(message.count("old output"), 39)
                channel.__exit__.assert_called_once()

    def test_command_requires_safe_unique_paths_and_shared_deployment_lock(self):
        sid = "a" * 32
        command = capture_command(
            "/opt/site", "/opt/site-snapshots/" + sid, sid, "https://example.org"
        )
        self.assertTrue(command.startswith("flock -n /opt/site.data.lock "))
        self.assertIn("deployment recovery is pending", command)
        self.assertLess(
            command.index("capture_online.sh"), command.index("manifest.json")
        )
        for bad in ("../other", "", "a; touch /tmp/unsafe"):
            with self.assertRaises(ValueError):
                capture_command(
                    "/opt/site",
                    "/opt/site-snapshots/" + bad,
                    bad,
                    "https://example.org",
                )

    def test_capture_failures_cleanup_without_touching_live_services(self):
        bash = shutil.which("bash") or "C:/Program Files/Git/bin/bash.exe"
        if not Path(bash).is_file():
            self.skipTest("Bash is required")
        script = Path(__file__).parents[1] / "capture_online.sh"
        # Exercise the actual shell control flow; every Docker command is recorded.
        shim = """
docker() {
  printf '%s\\n' "$*" >> "$TRACE"
  case "$*" in
    *"compose exec -T mongo mongosh"*) [ "$FAIL" != preflight ] ;;
    *"compose exec -T mongo mongodump"*) [ "$FAIL" != dump ] && printf archive ;;
    *"compose ps -q mongo"*) printf live-mongo ;;
    "inspect "*) printf mongo-image ;;
    "run "*) [ "$FAIL" != startup ] ;;
    *mongorestore*) [ "$FAIL" != replay ] ;;
    *"exportSnapshot"*) [ "$FAIL" != export ] ;;
    *mongodump*) printf archive ;;
    "rm -fv "*) [ "$FAIL" != cleanup ] ;;
    *) return 0 ;;
  esac
}
export -f docker
bash "$SCRIPT" "$STAGING" aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa https://example.org
"""
        for failure in (
            "preflight",
            "dump",
            "startup",
            "replay",
            "export",
            "cleanup",
            "",
        ):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                trace = root / "trace"
                env = dict(
                    os.environ,
                    FAIL=failure,
                    TRACE=trace.as_posix(),
                    STAGING=root.as_posix(),
                    SCRIPT=script.resolve().as_posix(),
                )
                result = subprocess.run(
                    [bash, "-c", shim], env=env, capture_output=True, text=True
                )
                self.assertEqual(result.returncode == 0, not failure, result.stderr)
                commands = trace.read_text().splitlines()
                self.assertTrue(commands[-1].startswith("rm -fv lixiangqi-snapshot-"))
                if failure and failure != "cleanup":
                    self.assertIn(
                        "Production snapshot capture failed (exit", result.stderr
                    )
                for command in commands:
                    self.assertNotIn("compose stop", command)
                    self.assertNotIn("compose up", command)
                    self.assertNotIn("fsync", command)
                    if "mongodump" in command or "mongorestore" in command:
                        self.assertNotIn("--quiet", command)
                    if "mongorestore" in command:
                        self.assertTrue(
                            command.startswith("exec -i lixiangqi-snapshot-")
                        )
                        self.assertIn("--oplogReplay", command)
                if not failure:
                    self.assertIn("Capturing production MongoDB", result.stdout)
                    self.assertIn("Restoring the captured data", result.stdout)
                    self.assertTrue((root / "mongo.archive.gz").exists())
                    self.assertFalse((root / "online.archive.gz").exists())
                    self.assertTrue(any("--network none" in c for c in commands))
                    self.assertTrue(
                        any("ttlMonitorEnabled=false" in c for c in commands)
                    )


if __name__ == "__main__":
    unittest.main()
