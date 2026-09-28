import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from tools.environment_data.remote import capture_command


class OnlineCaptureTests(unittest.TestCase):
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
                for command in commands:
                    self.assertNotIn("compose stop", command)
                    self.assertNotIn("compose up", command)
                    self.assertNotIn("fsync", command)
                    if "mongorestore" in command:
                        self.assertTrue(
                            command.startswith("exec -i lixiangqi-snapshot-")
                        )
                        self.assertIn("--oplogReplay", command)
                if not failure:
                    self.assertTrue((root / "mongo.archive.gz").exists())
                    self.assertFalse((root / "online.archive.gz").exists())
                    self.assertTrue(any("--network none" in c for c in commands))
                    self.assertTrue(
                        any("ttlMonitorEnabled=false" in c for c in commands)
                    )


if __name__ == "__main__":
    unittest.main()
