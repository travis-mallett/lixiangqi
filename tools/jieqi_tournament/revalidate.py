"""Recover an experiment after referee/tooling fixes without silently mixing engines."""

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import threading
import zipfile

from .processes import Referee, engine_move, observation_fen


def verify_record(record, referee, expected_deal):
    if record["deal"] != expected_deal:
        raise ValueError("Saved deal differs from its seed")
    state = referee.request({"deal": record["deal"]})
    for index, move in enumerate(record["moves"]):
        engine = record["red"] if state["turn"] == "red" else record["black"]
        if move["engine"] != engine or move["move"] not in state["legalMoves"]:
            raise ValueError(f"Invalid saved player/move at ply {index + 1}")
        if move["engineFen"] != observation_fen(state):
            raise ValueError(f"Public engine input changed at ply {index + 1}")
        saved_legal = move["go"].split(" searchmoves ")[1].split()
        if set(saved_legal) != {engine_move(m) for m in state["legalMoves"]}:
            raise ValueError(f"Legal engine inputs changed at ply {index + 1}")
        state = referee.request({"move": move["move"]})
        before = dict(move["after"])
        current = dict(state)
        before["legalMoves"] = sorted(before["legalMoves"])
        current["legalMoves"] = sorted(current["legalMoves"])
        if before != current:
            raise ValueError(f"Native game state changed at ply {index + 1}")
    if state["fen"] != record["finalFen"]:
        raise ValueError("Final position changed")
    if record["status"] == "completed" and (
        state["result"] != record["result"] or state["termination"] != record["termination"]
    ):
        raise ValueError("Game result or termination changed")
    if record["status"] == "censored" and state["result"] != "*":
        raise ValueError("Censored game has become terminal")


def check_compatible(saved, signature):
    if saved["nodeVersion"] != signature["nodeVersion"] or saved["pythonVersion"] != signature["pythonVersion"]:
        raise ValueError("Use the original Node and Python versions to preserve this experiment")
    engine_paths = {p for p in saved["sha256"] if p.startswith("public/jieqi-engine/") or p == "scripts/jieqi-engine/uci.mjs"}
    new_paths = {p for p in signature["sha256"] if p.startswith("public/jieqi-engine/") or p == "scripts/jieqi-engine/uci.mjs"}
    if engine_paths != new_paths or any(saved["sha256"][p] != signature["sha256"][p] for p in engine_paths):
        raise ValueError("Engines or networks changed; start a separate experiment")
    if any(saved["config"][k] != v for k, v in signature["config"].items() if k != "workers"):
        raise ValueError("Experimental settings changed; start a separate experiment")


def revalidate(directory, saved, signature, node, java, root, make_deal):
    check_compatible(saved, signature)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup_dir = directory.parent / (directory.name + "-backups")
    backup_dir.mkdir(exist_ok=True)
    backup = backup_dir / (stamp + ".zip")
    with zipfile.ZipFile(backup, "x", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(directory.rglob("*")):
            if path.is_file() and path.name != "run.lock":
                archive.write(path, path.relative_to(directory))
    with zipfile.ZipFile(backup) as archive:
        if archive.testzip() is not None:
            raise ValueError("Recovery backup failed its integrity check")
    print(f"Preserved pre-revalidation files: {backup}", flush=True)
    referee = Referee([java, "-Xmx512m", "-XX:ActiveProcessorCount=1", "--class-path",
                       str(root / "target/universal/stage/lib/*"), str(Path(__file__).with_name("JieqiReferee.java"))],
                      threading.Event(), root)
    paths = sorted((directory / "games").glob("*.json"))
    try:
        for index, path in enumerate(paths):
            record = json.loads(path.read_text(encoding="utf-8"))
            try:
                verify_record(record, referee, make_deal(saved["config"]["seed"], record["dealIndex"]))
            except Exception as error:
                raise ValueError(f"{path.name}: {error}; original manifest unchanged") from error
            print(f"Revalidated {index + 1}/{len(paths)}: {path.stem}", flush=True)
    finally:
        referee.close()
    with backup.open("rb") as stream:
        backup_sha = hashlib.file_digest(stream, "sha256").hexdigest()
    return {**saved, **signature, "config": saved["config"],
            "revalidations": saved.get("revalidations", []) + [{
                "at": stamp, "backup": str(backup), "backupSha256": backup_sha,
                "verifiedGames": len(paths),
                "checks": "All public states, legal roots, engine FENs, moves, results and terminations replay identically",
                "changedArtifacts": sorted(p for p in set(saved["sha256"]) | set(signature["sha256"])
                                           if saved["sha256"].get(p) != signature["sha256"].get(p)),
            }]}
