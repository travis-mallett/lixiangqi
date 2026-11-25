import os
import subprocess
import tempfile
import unittest
from pathlib import Path


@unittest.skipUnless(os.name == "nt", "exercises Windows PowerShell 5.1")
class PrepareLilaWsTest(unittest.TestCase):
    def test_clean_current_and_previous_patch_with_stdin_open(self):
        helper = Path(__file__).resolve().parents[1] / "Prepare-LilaWs.ps1"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "gateway"
            marker = root / "applied.patch"
            patch = root / "current.patch"
            subprocess.run(["git", "init", "--quiet", source], check=True)
            git = ["git", "-C", source]
            subprocess.run(
                git + ["-c", "user.name=Test", "-c", "user.email=test@example.org",
                       "commit", "--quiet", "--allow-empty", "--no-gpg-sign", "-m", "base"],
                check=True,
            )
            commit = subprocess.check_output(git + ["rev-parse", "HEAD"], text=True).strip()
            command = [
                "powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", helper,
                "-Source", source, "-Patch", patch, "-Commit", commit, "-Marker", marker,
            ]
            for state, value in [("clean", "first"), ("already applied", "first"), ("upgrade", "second")]:
                with self.subTest(state=state):
                    if state == "already applied":
                        marker.unlink()  # Only the reverse check can recognize this state.
                    patch.write_bytes((
                        "diff --git a/message b/message\nnew file mode 100644\n"
                        "--- /dev/null\n+++ b/message\n@@ -0,0 +1 @@\n+" + value + "\n"
                    ).encode())
                    # An accidental standalone "-" makes git apply wait for another patch.
                    # Keep stdin open as it would be in the user's console.
                    with subprocess.Popen(command, stdin=subprocess.PIPE) as process:
                        try:
                            self.assertEqual(process.wait(timeout=20), 0)
                        finally:
                            process.stdin.close()
                    self.assertEqual((source / "message").read_text().strip(), value)
                    self.assertEqual(marker.read_bytes(), patch.read_bytes())


if __name__ == "__main__":
    unittest.main()
