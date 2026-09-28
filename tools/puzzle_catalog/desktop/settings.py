"""Local operator preferences; never credentials or production database settings."""

from __future__ import annotations

from dataclasses import asdict, dataclass, fields
import json
import os
from pathlib import Path
import sys
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[3]
STATE = ROOT / "data/local/puzzle-studio"


# Recognized only to migrate existing preferences; engine settings belong to scripts.
RETIRED_ENGINE_SETTINGS = frozenset(
    (
        "verifier_hash_mb",
        "verifier_nodes",
        "engine_threads",
        "discovery_hash_mb",
        "categorizer_hash_mb",
        "screen_nodes",
        "validation_nodes",
        "categorizer_nodes",
    )
)


RETIRED_PREFERENCES = RETIRED_ENGINE_SETTINGS | {
    "deployment_root",
    "release_dir",
    "include_uncategorized",
}


@dataclass
class Settings:
    python: str = (
        str(ROOT / ".venv/Scripts/python.exe") if os.name == "nt" else sys.executable
    )
    mining_db: str = str(ROOT / "data/local/xiangqi-puzzle-mining.sqlite3")
    catalog_db: str = str(ROOT / "data/local/puzzle-catalog.sqlite3")
    source_catalog: str = str(ROOT / "data/local/xiangqi-games.sqlite3")
    snapshot_dir: str = str(ROOT / "data/local/production-snapshots")
    publication_origin: str = "https://lixiangqi.com"
    preview_publication_origin: str = "http://localhost:9663"
    engine: str = str(
        ROOT
        / ".tools/pikafish"
        / ("Windows/pikafish-avx2.exe" if os.name == "nt" else "Linux/pikafish-avx2")
    )
    discovery_workers: int = max(1, min(4, (os.cpu_count() or 4) // 4))
    categorizer_workers: int = max(1, min(2, (os.cpu_count() or 4) // 4))
    verifier_workers: int = 1
    poll_seconds: int = 15
    discovery_interval: int = 300
    refresh_seconds: int = 5
    page_size: int = 100

    @classmethod
    def load(cls, path: Path):
        if not path.exists():
            return cls()
        data = json.loads(path.read_text(encoding="utf-8"))
        allowed = {f.name for f in fields(cls)}
        if not isinstance(data, dict) or set(data) - allowed - RETIRED_PREFERENCES:
            raise ValueError(
                "Unknown settings fields; restore or correct the settings file"
            )
        value = cls(**{key: item for key, item in data.items() if key in allowed})
        update_loopback = value.preview_publication_origin == "http://127.0.0.1:9663"
        if update_loopback:
            value.preview_publication_origin = "http://localhost:9663"
        value.validate()
        if set(data) & RETIRED_PREFERENCES or update_loopback:
            backup = path.with_name(
                f"{path.name}.before-script-defaults-{uuid4().hex}.bak"
            )
            with backup.open("xb") as stream:
                stream.write(path.read_bytes())
                stream.flush()
                os.fsync(stream.fileno())
            value.save(path)
        return value

    def validate(self):
        for f in fields(self):
            value = getattr(self, f.name)
            if isinstance(f.default, bool):
                if type(value) is not bool:
                    raise ValueError(f"{f.name} must be a boolean")
            elif isinstance(f.default, int):
                if type(value) is not int or value < 1:
                    raise ValueError(f"{f.name} must be a positive integer")
            elif not isinstance(value, str) or not value.strip():
                raise ValueError(f"{f.name} cannot be empty")
        if (
            max(
                self.discovery_workers,
                self.categorizer_workers,
                self.verifier_workers,
            )
            > 128
        ):
            raise ValueError("Worker counts must be at most 128")
        if self.poll_seconds > 3600 or self.page_size > 500:
            raise ValueError(
                "Polling must be at most 3600 seconds; page size at most 500"
            )
        paths = [
            Path(self.mining_db).resolve(),
            Path(self.catalog_db).resolve(),
            Path(self.source_catalog).resolve(),
        ]
        if len(set(paths)) != 3:
            raise ValueError(
                "Mining, authoring, and source databases must be separate files"
            )
        if any(
            not Path(getattr(self, name)).is_absolute()
            for name in (
                "python",
                "mining_db",
                "catalog_db",
                "source_catalog",
                "snapshot_dir",
                "engine",
            )
        ):
            raise ValueError("Use absolute paths in settings")

    def save(self, path: Path):
        self.validate()
        path.parent.mkdir(parents=True, exist_ok=True)
        temp = path.with_suffix(".tmp")
        temp.write_text(json.dumps(asdict(self), indent=2) + "\n", encoding="utf-8")
        temp.replace(path)

    def preflight(self, network=False):
        required = {
            "Python": self.python,
            "Pikafish": self.engine,
            "Games catalog": self.source_catalog,
        }
        return [
            f"{label} is missing: {path}"
            for label, path in required.items()
            if not Path(path).is_file()
        ]


def atomic_json(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    with temporary.open("w", encoding="utf-8") as stream:
        json.dump(value, stream)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


def current_snapshot(settings: Settings) -> Path:
    root = Path(settings.snapshot_dir)
    pointer = json.loads((root / "current.json").read_text(encoding="utf-8"))
    sid = pointer["snapshotId"]
    result = (root / sid).resolve()
    if result.parent != root.resolve():
        raise ValueError("Invalid snapshot pointer")
    return result
