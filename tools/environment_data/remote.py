"""Capture production state over SSH. There is deliberately no upload-data action."""

from __future__ import annotations
import argparse
from collections import deque
import json
import os
from pathlib import Path
import posixpath
import re
import shlex
import tempfile
import uuid

from .snapshot import capture, verify_snapshot


def capture_command(remote: str, staging: str, snapshot_id: str, origin: str) -> str:
    if (
        not re.fullmatch(r"[0-9a-f]{32}", snapshot_id)
        or not remote.startswith("/opt/")
        or posixpath.normpath(remote) != remote
        or staging != remote + "-snapshots/" + snapshot_id
    ):
        raise ValueError("invalid production snapshot path")
    q = shlex.quote
    manifest_code = """import datetime,hashlib,json,pathlib,sys
r=pathlib.Path(sys.argv[1]); files={}
for name in ('mongo.archive.gz','native-games.jsonl','puzzle-inventory.json'):
 h=hashlib.sha256()
 with (r/name).open('rb') as f:
  for chunk in iter(lambda:f.read(1048576),b''): h.update(chunk)
 files[name]=h.hexdigest()
(r/'manifest.json').write_text(json.dumps(dict(schemaVersion=1,snapshotId=sys.argv[2],origin='production',productionOrigin=sys.argv[3],createdAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),files=files)),encoding='utf-8')
"""
    body = (
        f"set -e; cd {q(remote)}; "
        f"if [ -f {q(remote + '.operation.json')} ]; then python3 -c "
        + q(
            "import json,sys; assert json.load(open(sys.argv[1]))['phase']=='open', 'deployment recovery is pending'"
        )
        + f" {q(remote + '.operation.json')}; fi; "
        + f"timeout --signal=TERM 1500 bash {q(staging + '/capture_online.sh')} {q(staging)} {q(snapshot_id)} {q(origin)}; "
        + f"python3 -c {q(manifest_code)} {q(staging)} {q(snapshot_id)} {q(origin)}"
    )
    return f"flock -n {q(remote + '.data.lock')} sh -c {q(body)}"


def refresh(
    destination: Path, deployment_root: Path, server: str, remote: str, origin: str
) -> Path:
    import paramiko

    credentials = {}
    for line in (
        (deployment_root / "authorized_keys.txt")
        .read_text(encoding="utf-8")
        .splitlines()
    ):
        if ":" in line:
            key, value = line.split(":", 1)
            credentials[key.strip()] = value.strip()
    if not credentials.get("username") or not credentials.get("password"):
        raise ValueError("deployment credentials are not configured")
    client = paramiko.SSHClient()
    client.load_system_host_keys()
    # A production data copy must not silently trust an unknown SSH host.
    client.set_missing_host_key_policy(paramiko.RejectPolicy())
    client.connect(
        server,
        username=credentials["username"],
        password=credentials["password"],
        look_for_keys=False,
        allow_agent=False,
        timeout=30,
    )
    sid = uuid.uuid4().hex
    staging = remote + "-snapshots/" + sid
    destination.mkdir(parents=True, exist_ok=True)
    try:
        _, out, err = client.exec_command("umask 077; mkdir -p " + shlex.quote(staging))
        if out.channel.recv_exit_status():
            raise RuntimeError(err.read().decode())
        with client.open_sftp() as sftp:
            for name in ("export_snapshot.js", "capture_online.sh"):
                # Bash scripts must use LF even on Windows checkouts.
                with sftp.open(staging + "/" + name, "w") as target:
                    target.write(
                        Path(__file__).with_name(name).read_text(encoding="utf-8")
                    )
        _, out, err = client.exec_command(
            capture_command(remote, staging, sid, origin), timeout=1800
        )
        out.channel.set_combine_stderr(True)
        # Drain the combined stream to avoid a full stderr buffer deadlock.
        error = "".join(deque(out, maxlen=40))
        if out.channel.recv_exit_status():
            raise RuntimeError("production snapshot failed: " + error)
        with tempfile.TemporaryDirectory(prefix="download-", dir=destination) as tmp:
            with client.open_sftp() as sftp:
                for name in (
                    "manifest.json",
                    "mongo.archive.gz",
                    "native-games.jsonl",
                    "puzzle-inventory.json",
                ):
                    sftp.get(staging + "/" + name, str(Path(tmp) / name))
            verify_snapshot(Path(tmp))
            completed = destination / sid
            capture(Path(tmp), completed)
            pointer = destination / "current.json.partial"
            pointer.write_text(json.dumps({"snapshotId": sid}) + "\n", encoding="utf-8")
            os.replace(pointer, destination / "current.json")
            return completed
    finally:
        client.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--destination", type=Path, required=True)
    parser.add_argument("--deployment-root", type=Path, required=True)
    parser.add_argument("--server", default="144.126.147.80")
    parser.add_argument("--remote", default="/opt/lixiangqi-beta")
    parser.add_argument("--origin", default="https://lixiangqi.com")
    args = parser.parse_args()
    print(
        refresh(
            args.destination,
            args.deployment_root,
            args.server,
            args.remote,
            args.origin,
        )
    )


if __name__ == "__main__":
    main()
