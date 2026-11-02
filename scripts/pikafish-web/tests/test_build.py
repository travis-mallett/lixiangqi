"""Publishing a rebuilt engine must preserve the previous content-hashed assets."""

import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "pikafish_build", Path(__file__).parents[1] / "build.py"
)
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)


class PublishTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / "rebuilt.wasm"
        self.source.write_bytes(b"new engine")
        self.destination = self.root / "engine.wasm"
        self.destination.write_bytes(b"old engine")
        self.hashed = self.root / "engine.oldhash.wasm"
        self.hashed.hardlink_to(self.destination)

    def test_replacement_preserves_hardlinked_hash_and_source(self):
        build.publish(self.source, self.destination)
        self.assertEqual(self.destination.read_bytes(), b"new engine")
        self.assertEqual(self.source.read_bytes(), b"new engine")
        self.assertEqual(self.hashed.read_bytes(), b"old engine")

    def test_failed_copy_keeps_previous_asset_and_removes_temporary_file(self):
        def interrupted(source, destination):
            destination.write_bytes(b"partial")
            raise OSError("interrupted")

        with patch.object(build.shutil, "copy2", side_effect=interrupted):
            with self.assertRaisesRegex(OSError, "interrupted"):
                build.publish(self.source, self.destination)
        self.assertEqual(self.destination.read_bytes(), b"old engine")
        self.assertEqual(self.hashed.read_bytes(), b"old engine")
        self.assertEqual(len(list(self.root.iterdir())), 3)
