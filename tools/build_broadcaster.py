"""Build the downloadable native companion from its canonical source."""

from pathlib import Path
import tempfile
import shutil
import zipapp

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    target = ROOT / "public/downloads/lixiangqi-broadcaster.pyz"
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as temp:
        source = Path(temp)
        shutil.copytree(ROOT / "external/xiangqi_broadcaster", source / "xiangqi_broadcaster", ignore=shutil.ignore_patterns("__pycache__", "test_*.py"))
        zipapp.create_archive(source, target, interpreter="/usr/bin/env python3", main="xiangqi_broadcaster.__main__:main", compressed=True)
    print(f"Built {target.name}")


if __name__ == "__main__":
    main()
