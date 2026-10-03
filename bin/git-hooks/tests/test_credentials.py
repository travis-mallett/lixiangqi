"""Exercise the real pre-commit guard in disposable repositories."""

import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


HOOK = Path(__file__).resolve().parents[1] / "pre-commit"
BASH = shutil.which("bash") or "C:/Program Files/Git/bin/bash.exe"


@unittest.skipUnless(Path(BASH).is_file(), "Git Bash is required")
class CredentialGuardTest(unittest.TestCase):
    def test_credential_formats_and_embedded_image_data(self):
        with tempfile.TemporaryDirectory(prefix="credential-guard-") as temp:
            root = Path(temp)
            repository = root / "repository"
            repository.mkdir()
            commands = root / "commands"
            commands.mkdir()
            # This suite tests the credential guard, not the separately run linters.
            pnpm = commands / "pnpm"
            pnpm.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
            pnpm.chmod(0o755)
            command_path = commands.as_posix()
            if os.name == "nt":
                command_path = "/" + command_path[0].lower() + command_path[2:]
            env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}

            def git(*args):
                subprocess.run(
                    ["git", *args], cwd=repository, env=env,
                    check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                )

            git("init", "--quiet")
            git("config", "user.name", "Credential guard test")
            git("config", "user.email", "test@users.noreply.github.com")
            git("config", "core.autocrlf", "false")
            cases = {
                "AWS access key": ("AK" + "IA" + "A" * 16, True),
                "AWS session key": ("AS" + "IA" + "1" * 16, True),
                "GitHub token": ("gh" + "p_" + "a" * 30, True),
                "GitHub fine-grained token": ("github_" + "pat_" + "a" * 30, True),
                "Slack token": ("xo" + "xb-" + "a" * 24, True),
                "private key": ("-----BEGIN " + "PRIVATE KEY-----", True),
                "credential URL": ("https://" + "user:password@" + "example.org", True),
                "embedded mixed-case image data": ("data:image/png;base64,xasIA" + "aB2C" * 4, False),
                "embedded uppercase image data": ("data:image/png;base64,xAK" + "IA" + "A" * 16 + "x", False),
                "ordinary URL": ("https://example.org", False),
            }
            for label, (value, blocked) in cases.items():
                with self.subTest(label=label):
                    (repository / "fixture.txt").write_text(value + "\n", encoding="utf-8")
                    git("add", "--", "fixture.txt")
                    result = subprocess.run(
                        [BASH, "-c", 'PATH="$1:$PATH"; export PATH; exec sh "$2"',
                         "guard-test", command_path, HOOK.as_posix()],
                        cwd=repository, env=env, capture_output=True, text=True,
                    )
                    self.assertEqual(result.returncode, 1 if blocked else 0, result.stderr)
                    if blocked:
                        self.assertIn("high-confidence credential pattern", result.stderr)


if __name__ == "__main__":
    unittest.main()
