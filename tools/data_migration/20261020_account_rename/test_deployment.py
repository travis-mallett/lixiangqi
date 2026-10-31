"""Local-only orchestration tests. No SSH or Docker calls are performed."""

import importlib.util
import os
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

import compose


class AdapterTest(unittest.TestCase):
    def test_live_writer_blocks_before_database_access(self):
        with patch.object(compose, "running_services", return_value={"lila", "mongo"}):
            with patch.object(compose, "run") as run, self.assertRaises(RuntimeError):
                compose.check_stopped()
            run.assert_not_called()

    def test_nonempty_redis_requires_review(self):
        with patch.object(compose, "running_services", return_value={"mongo", "redis"}):
            with patch.object(compose, "run", return_value=subprocess.CompletedProcess([], 0, "2\n")):
                with self.assertRaises(RuntimeError):
                    compose.check_stopped()


class TransportTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        root = Path(__file__).resolve().parents[3]
        path = root.parent / "lixiangqi-beta-deployment/push_transport.py"
        if not path.exists():
            raise unittest.SkipTest("Sibling deployment checkout is required")
        spec = importlib.util.spec_from_file_location("rename_transport_test", path)
        cls.transport = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.transport)

    def test_rename_is_explicit_and_follows_other_migrations(self):
        plan = {"build": [], "recreate": [], "prepare_catalog_index": False}
        with patch.dict(os.environ, {"PUSH_RENAME_ACCOUNT": "no"}):
            normal = self.transport.activation_command("/opt/lixiangqi-beta", plan)
        with patch.dict(os.environ, {"PUSH_RENAME_ACCOUNT": "yes"}):
            rename = self.transport.activation_command("/opt/lixiangqi-beta", plan)
        self.assertNotIn("compose.py prepare-apply", normal)
        self.assertIn("compose.py prepare-apply", rename)
        # All preceding schema commits must finish before the one-account gate.
        conversion = rename.index("compose.py prepare-apply")
        self.assertLess(rename.index(self.transport.video_migration_commit_command("/opt/lixiangqi-beta")), conversion)
        self.assertLess(conversion, rename.index("compose.py allow-start"))

    def test_completion_precedes_public_traffic(self):
        command = self.transport.start_committed_command("/opt/lixiangqi-beta")
        self.assertLess(command.index("compose.py allow-start"), command.index("--force-recreate lila"))
        self.assertLess(command.index("compose.py finish"), command.index("--force-recreate caddy"))

    def test_recovery_and_new_releases_refuse_pending_rename(self):
        for name in ("require_open_command", "recovery_command", "rollback_command"):
            command = getattr(self.transport, name)("/opt/lixiangqi-beta")
            self.assertTrue(command.startswith("test ! -e /opt/lixiangqi-beta.account-rename.pending"))
            self.assertIn("automatic rollback is disabled", command)


if __name__ == "__main__":
    unittest.main()
