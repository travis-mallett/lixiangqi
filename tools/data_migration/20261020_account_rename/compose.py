"""Host-side adapter used only by push-local-live's explicit account-rename option."""

import argparse
import json
import os
from pathlib import Path
import subprocess
import time


WRITERS = {"lila", "lila-ws", "explorer", "pikafish-worker", "pikafish-analysis", "caddy"}


def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def running_services():
    rows = run(["docker", "compose", "ps", "--format", "json"], capture_output=True, text=True).stdout
    # Compose versions emit either one JSON array or newline-delimited objects.
    records = json.loads(rows) if rows.lstrip().startswith("[") else [json.loads(r) for r in rows.splitlines() if r]
    return {row["Service"] for row in records if row.get("State") == "running"}


def check_stopped():
    active = running_services() & WRITERS
    if active:
        raise RuntimeError("Writers still running: " + ", ".join(sorted(active)))
    count = run(
        ["docker", "compose", "exec", "-T", "redis", "redis-cli", "DBSIZE"],
        capture_output=True, text=True,
    ).stdout.strip()
    if count != "0":
        raise RuntimeError("Redis is no longer empty; inspect persistent keys before this one-account migration")


def write_state(path, state):
    temporary = path.with_suffix(path.suffix + ".partial")
    with temporary.open("w") as stream:
        json.dump(state, stream)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)
    fd = os.open(path.parent, os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def invoke(remote, backup, mode):
    # Resolve secrets without printing them or placing them in command-line arguments.
    configuration = json.loads(run(
        ["docker", "compose", "config", "--format", "json"], capture_output=True, text=True
    ).stdout)
    env = configuration["services"]["lila"]["environment"]
    key = env.get("LIXIANGQI_TRAFFIC_IDENTITY_KEY") or env["PLAY_SECRET"]
    child_env = {**os.environ, "LIXIANGQI_TRAFFIC_IDENTITY_KEY": key}
    command = [
        "docker", "compose", "run", "--rm", "--no-deps", "-T",
        "-e", "LIXIANGQI_TRAFFIC_IDENTITY_KEY",
        "-v", str(remote / "migrations/account-rename") + ":/rename:ro",
        "-v", str(backup.parent) + ":/recovery",
        "--entrypoint", "python", "explorer", "/rename/migrate.py", mode,
        "--backup", "/recovery/" + backup.name,
    ]
    if mode in {"prepare", "apply", "verify"}:
        command.append("--writers-stopped")
    run(command, env=child_env)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("prepare-apply", "allow-start", "finish"))
    parser.add_argument("--remote", type=Path, required=True)
    args = parser.parse_args()
    remote = args.remote
    if not remote.is_absolute() or remote.resolve() != remote or len(remote.parts) < 3:
        parser.error("Expected a resolved absolute release directory")
    os.chdir(remote)
    pending = Path(str(remote) + ".account-rename.pending")
    backup = Path(str(remote) + "-account-rename-v1-backup")
    if args.mode == "prepare-apply":
        check_stopped()
        # All interrupted attempts retain the same independent original snapshot.
        if not pending.exists():
            write_state(pending, {"phase": "preparing", "backup": str(backup)})
        state = json.loads(pending.read_text())
        if state.get("backup") != str(backup):
            raise RuntimeError("Unexpected recovery path")
        if state.get("phase") == "accountVerified":
            # Writers may already have advanced analytics after this durable gate.
            # Rechecking the old frozen post-images here would reject valid changes.
            return
        if not (backup / "manifest.json").exists():
            invoke(remote, backup, "prepare")
        invoke(remote, backup, "apply")
        invoke(remote, backup, "verify")
        write_state(pending, {"phase": "accountVerified", "backup": str(backup)})
    elif args.mode == "allow-start":
        if pending.exists() and json.loads(pending.read_text()).get("phase") != "accountVerified":
            raise RuntimeError("Account conversion is incomplete; writers must remain stopped")
    elif pending.exists():
        if json.loads(pending.read_text()).get("phase") != "accountVerified":
            raise RuntimeError("Account conversion is incomplete")
        # The normal worker reuses the existing report gate while replaying months.
        deadline = time.monotonic() + 1800
        while True:
            try:
                invoke(remote, backup, "finish")
                break
            except subprocess.CalledProcessError as error:
                if error.returncode != 2:
                    raise
                if time.monotonic() >= deadline:
                    raise RuntimeError("Analytics completion failed; keep Caddy stopped")
                time.sleep(10)
        pending.unlink()
        fd = os.open(pending.parent, os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)


if __name__ == "__main__":
    main()
