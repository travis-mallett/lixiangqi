"""Load native sources only from a verified production snapshot."""

from __future__ import annotations
import hashlib
import json
from pathlib import Path
import re
from tools.environment_data.snapshot import verify_snapshot
from .storage import now, seed_game_job
from .discovery_settings import DEFAULT_DEPTH
from .sources import native_source_database


def import_snapshot(
    connection, root: Path, discovery_version="2", *, depth=DEFAULT_DEPTH
):
    manifest = verify_snapshot(root)
    origin = manifest["productionOrigin"]
    sid = manifest["snapshotId"]
    source = native_source_database(origin)
    digest = hashlib.sha256((root / "manifest.json").read_bytes()).hexdigest()
    stamp = now()
    count = 0
    connection.execute("BEGIN IMMEDIATE")
    try:
        old = connection.execute(
            "SELECT manifest_digest FROM source_snapshots WHERE snapshot_id=?", (sid,)
        ).fetchone()
        if old and old[0] != digest:
            raise ValueError("snapshot identity changed")
        connection.execute(
            "INSERT OR IGNORE INTO source_snapshots VALUES (?,?,?,?)",
            (sid, origin, digest, stamp),
        )
        seen = set()
        with (root / "native-games.jsonl").open(encoding="utf-8") as f:
            for raw in f:
                if not raw.strip():
                    continue
                v = json.loads(raw)
                if (
                    set(v) != {"id", "initialFen", "moves", "players", "completedAt"}
                    or not isinstance(v["id"], str)
                    or not re.fullmatch("[A-Za-z0-9]{8}", v["id"])
                    or v["id"] in seen
                ):
                    raise ValueError("invalid native source identity")
                if (
                    not isinstance(v["initialFen"], str)
                    or not isinstance(v["moves"], list)
                    or not all(
                        isinstance(m, str)
                        and re.fullmatch(r"[a-i](?:10|[1-9])[a-i](?:10|[1-9])", m)
                        for m in v["moves"]
                    )
                    or not isinstance(v["players"], list)
                    or not all(isinstance(p, str) for p in v["players"])
                    or type(v["completedAt"]) is not int
                ):
                    raise ValueError("invalid native source data")
                seen.add(v["id"])
                moves = json.dumps(v["moves"])
                players = json.dumps(v["players"])
                url = origin + "/" + v["id"]
                payload = json.dumps(v, sort_keys=True, separators=(",", ":"))
                checksum = hashlib.sha256((source + payload).encode()).hexdigest()
                existing = connection.execute(
                    "SELECT initial_fen,moves_json FROM native_games WHERE source_database=? AND game_id=?",
                    (source, v["id"]),
                ).fetchone()
                if existing and (
                    existing[0] != v["initialFen"]
                    or json.loads(existing[1]) != v["moves"]
                ):
                    raise ValueError(
                        "production source moves changed; reconcile explicitly"
                    )
                connection.execute(
                    "INSERT INTO native_games(source_database,origin,game_id,initial_fen,moves_json,players_json,source_url,payload_json,payload_checksum,snapshot_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source_database,game_id) DO UPDATE SET snapshot_id=excluded.snapshot_id,players_json=excluded.players_json,payload_json=excluded.payload_json,payload_checksum=excluded.payload_checksum",
                    (
                        source,
                        origin,
                        v["id"],
                        v["initialFen"],
                        moves,
                        players,
                        url,
                        payload,
                        checksum,
                        sid,
                        stamp,
                    ),
                )
                seed_game_job(
                    connection,
                    source,
                    v["id"],
                    url,
                    discovery_version=discovery_version,
                    depth=depth,
                    commit=False,
                )
                count += 1
        verify_snapshot(root)
        connection.commit()
        return count
    except BaseException:
        connection.rollback()
        raise
