"""The pinned installer must reject incomplete replacements before changing the installation."""

from contextlib import ExitStack
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "pikafish_install", Path(__file__).parents[1] / "install.py"
)
install = importlib.util.module_from_spec(spec)
spec.loader.exec_module(install)


class InstallTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.target = self.root / "installed"
        self.browser = self.root / "public/pikafish-web"
        self.archive = self.root / "official.7z"
        self.archive.write_bytes(b"verified archive")
        self.files = {
            "engine.exe": ("Windows/pikafish.exe", b"windows"),
            "engine": ("Linux/pikafish", b"linux"),
            "pikafish.nnue": ("pikafish.nnue", b"network"),
        }
        self.manifest = self.root / "release.json"
        self.manifest.write_text(
            json.dumps(
                {
                    "tag": "test-release",
                    "commit": "test-commit",
                    "archive": self.archive.name,
                    "sha256": install.digest(self.archive),
                    "files": {
                        name: {"path": path, "sha256": hashlib.sha256(data).hexdigest()}
                        for name, (path, data) in self.files.items()
                    },
                }
            )
        )

    def run_install(self, *, check=False, corrupt=None, missing=None, browser=False):
        def extract(command, **kwargs):
            directory = Path(
                command[-1] if command[0] == "tar.exe" else command[-1][2:]
            )
            for name, (_, data) in self.files.items():
                (directory / name).write_bytes(b"corrupt" if name == corrupt else data)
            for name in install.NOTICES:
                if name != missing:
                    (directory / name).write_text(name)

        args = [
            "install.py",
            "--archive",
            str(self.archive),
            "--target",
            str(self.target),
        ]
        if check:
            args.append("--check")
        if browser:
            args.extend(("--browser-dir", str(self.browser)))
        with ExitStack() as stack:
            stack.enter_context(patch.object(install, "MANIFEST", self.manifest))
            stack.enter_context(patch("sys.argv", args))
            stack.enter_context(
                patch.object(install.shutil, "which", return_value="7z")
            )
            run = stack.enter_context(
                patch.object(install.subprocess, "run", side_effect=extract)
            )
            install.main()
            return run.call_count

    def test_install_is_verified_idempotent_and_removes_obsolete_binary(self):
        old = self.target / "Windows/pikafish-avx2.exe"
        old.parent.mkdir(parents=True)
        old.write_bytes(b"old")
        self.assertEqual(self.run_install(), 1)
        self.assertFalse(old.exists())
        self.assertEqual(self.run_install(check=True), 0)
        self.assertEqual(self.run_install(), 0)
        for _, (name, data) in self.files.items():
            self.assertEqual((self.target / name).read_bytes(), data)

    def test_wrong_archive_never_extracts_or_creates_installation(self):
        self.archive.write_bytes(b"wrong")
        with self.assertRaisesRegex(RuntimeError, "SHA-256"):
            self.run_install()
        self.assertFalse(self.target.exists())

    def test_corrupt_replacement_and_missing_notice_preserve_old_installation(self):
        old = self.target / "pikafish.nnue"
        self.target.mkdir()
        old.write_bytes(b"old network")
        for options in ({"corrupt": "engine"}, {"missing": "NNUE-License.md"}):
            with self.subTest(options=options), self.assertRaises(RuntimeError):
                self.run_install(**options)
            self.assertEqual(old.read_bytes(), b"old network")
            self.assertEqual(list(self.target.iterdir()), [old])

    def test_check_never_repairs_a_mismatched_installation(self):
        with self.assertRaisesRegex(RuntimeError, "Missing or outdated"):
            self.run_install(check=True)
        self.assertFalse(self.target.exists())

    def test_fresh_install_prepares_browser_without_lfs(self):
        self.assertEqual(self.run_install(browser=True), 1)
        self.assertEqual((self.browser / "pikafish.nnue").read_bytes(), b"network")
        self.assertEqual(self.run_install(browser=True, check=True), 0)

    def test_current_native_installation_repairs_missing_browser_without_download(self):
        self.run_install()
        with patch.object(
            install, "urlopen", side_effect=AssertionError("no download needed")
        ):
            self.assertEqual(self.run_install(browser=True), 0)
        self.assertEqual((self.browser / "pikafish.nnue").read_bytes(), b"network")

    def test_stale_browser_replacement_preserves_old_hashed_asset(self):
        self.run_install()
        self.browser.mkdir(parents=True)
        network = self.browser / "pikafish.nnue"
        network.write_bytes(b"old network")
        hashed = self.root / "oldhash.nnue"
        hashed.hardlink_to(network)
        with self.assertRaisesRegex(RuntimeError, "browser network"):
            self.run_install(browser=True, check=True)
        self.assertEqual(network.read_bytes(), b"old network")
        self.assertEqual(self.run_install(browser=True), 0)
        self.assertEqual(network.read_bytes(), b"network")
        self.assertEqual(hashed.read_bytes(), b"old network")

    def test_failed_browser_copy_preserves_destination_and_cleans_temporary(self):
        self.run_install()
        self.browser.mkdir(parents=True)
        network = self.browser / "pikafish.nnue"
        network.write_bytes(b"previous")

        def interrupted(source, destination):
            destination.write_bytes(b"partial")
            raise OSError("interrupted")

        with patch.object(install.shutil, "copyfile", side_effect=interrupted):
            with self.assertRaisesRegex(OSError, "interrupted"):
                self.run_install(browser=True)
        self.assertEqual(network.read_bytes(), b"previous")
        self.assertEqual(list(self.browser.iterdir()), [network])

    def test_browser_check_never_creates_missing_asset(self):
        self.run_install()
        with self.assertRaisesRegex(RuntimeError, "browser network"):
            self.run_install(browser=True, check=True)
        self.assertFalse(self.browser.exists())
