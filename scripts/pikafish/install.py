#!/usr/bin/env python3
"""Install the checksum-pinned official engines and their matching network/notices."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = Path(__file__).with_name("release.json")
NOTICES = ("AUTHORS", "Copying.txt", "NNUE-License.md", "README.md")


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def verify(path: Path, expected: str) -> None:
    if digest(path) != expected:
        raise RuntimeError(f"SHA-256 verification failed: {path}")


def prepare_browser_network(
    target: Path, browser_dir: Path, release: dict, *, check: bool
) -> None:
    """Materialize the verified network as a build asset, preserving old hashed hard links."""
    network = release["files"]["pikafish.nnue"]
    source = target / network["path"]
    destination = browser_dir.resolve() / "pikafish.nnue"
    verify(source, network["sha256"])
    if destination.is_file() and digest(destination) == network["sha256"]:
        print(f"Verified browser network at {destination}")
        return
    if check:
        raise RuntimeError(f"Missing or outdated browser network: {destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=destination.parent, delete=False) as stream:
        temporary = Path(stream.name)
    try:
        shutil.copyfile(source, temporary)
        verify(temporary, network["sha256"])
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)
    print(f"Prepared browser network at {destination}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--archive", type=Path, help="Use an already downloaded official archive"
    )
    parser.add_argument("--target", type=Path, default=ROOT / ".tools/pikafish")
    parser.add_argument(
        "--browser-dir",
        type=Path,
        help="Also prepare this browser asset directory from the verified native network (no Git LFS)",
    )
    parser.add_argument(
        "--check", action="store_true", help="Verify installation without changing it"
    )
    args = parser.parse_args()
    release = json.loads(MANIFEST.read_text())
    target = args.target.resolve()
    expected = [
        (target / spec["path"], spec["sha256"]) for spec in release["files"].values()
    ]
    current = all(path.is_file() and digest(path) == sha for path, sha in expected)
    current = current and all(
        (target / name).is_file() for name in (*NOTICES, "SOURCE.txt")
    )
    if current:
        if args.browser_dir:
            prepare_browser_network(target, args.browser_dir, release, check=args.check)
        print(f"Verified {release['tag']} at {target}")
        return
    if args.check:
        raise RuntimeError(
            f"Missing or outdated Pikafish installation: {target}; run {__file__}"
        )
    # Validate the entire replacement before touching the installed engine/network.
    with tempfile.TemporaryDirectory(prefix="lixiangqi-pikafish-") as temporary:
        staging = Path(temporary)
        archive = (
            args.archive.resolve() if args.archive else staging / release["archive"]
        )
        if not args.archive:
            url = f"https://github.com/official-pikafish/Pikafish/releases/download/{release['tag']}/{release['archive']}"
            print(f"Downloading {url}", flush=True)
            with urlopen(url, timeout=120) as response, archive.open("wb") as output:
                shutil.copyfileobj(response, output)
        verify(archive, release["sha256"])
        if os.name == "nt":
            subprocess.run(
                ["tar.exe", "-xf", str(archive), "-C", str(staging)], check=True
            )
        else:
            extractor = shutil.which("7z") or shutil.which("7zz")
            if not extractor:
                raise RuntimeError(
                    "Install 7zip to extract the official Pikafish release"
                )
            subprocess.run(
                [extractor, "x", str(archive), f"-o{staging}"],
                check=True,
                stdout=subprocess.DEVNULL,
            )
        for name, spec in release["files"].items():
            verify(staging / name, spec["sha256"])
        for name in NOTICES:
            if not (staging / name).is_file():
                raise RuntimeError(f"Official archive is missing {name}")
        for name, spec in release["files"].items():
            destination = target / spec["path"]
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(staging / name, destination)
            if spec["path"].startswith("Linux/"):
                destination.chmod(0o755)
        for name in NOTICES:
            shutil.copyfile(staging / name, target / name)
        (target / "SOURCE.txt").write_text(
            f"Official Pikafish {release['tag']}\n"
            f"Exact native source: https://github.com/official-pikafish/Pikafish/tree/{release['commit']}\n"
            "Engine: GPL-3.0-or-later; see Copying.txt and AUTHORS.\n"
            "Network: separate terms in NNUE-License.md; commercial use requires permission.\n",
            encoding="utf-8",
        )
        for relative in ("Windows/pikafish-avx2.exe", "Linux/pikafish-avx2"):
            (target / relative).unlink(missing_ok=True)
        print(f"Installed {release['tag']} at {target}")
    if args.browser_dir:
        prepare_browser_network(target, args.browser_dir, release, check=False)


if __name__ == "__main__":
    main()
