"""Opt-in real MongoDB check: LIXIANGQI_TEST_MONGO_TOOLS points at the tools tree.

Uses temporary databases, loopback ports, and only processes created by this test.
"""

from datetime import datetime, timezone
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import threading
import time
import unittest


@unittest.skipUnless(
    os.environ.get("LIXIANGQI_TEST_MONGO_TOOLS"), "MongoDB integration test is opt-in"
)
class OnlineMongoTests(unittest.TestCase):
    def test_writes_during_dump_replay_to_one_point_and_exports_stay_frozen(self):
        from pymongo import MongoClient

        tools = Path(os.environ["LIXIANGQI_TEST_MONGO_TOOLS"])
        suffix = ".exe" if os.name == "nt" else ""
        bins = {
            name: str(next(tools.rglob(name + suffix)))
            for name in ("mongod", "mongodump", "mongorestore", "mongosh")
        }
        processes = []
        clients = []
        stopped = threading.Event()
        writer = None

        def run(name, *args):
            return subprocess.run(
                [bins[name], *args], check=True, capture_output=True, text=True
            )

        with tempfile.TemporaryDirectory(prefix="online-snapshot-test-") as tmp:
            root = Path(tmp)

            def start(name, replica=False):
                with socket.socket() as sock:
                    sock.bind(("127.0.0.1", 0))
                    port = sock.getsockname()[1]
                data = root / name
                data.mkdir()
                argv = [
                    bins["mongod"],
                    "--dbpath",
                    str(data),
                    "--port",
                    str(port),
                    "--bind_ip",
                    "127.0.0.1",
                    "--wiredTigerCacheSizeGB",
                    "0.25",
                    "--setParameter",
                    "ttlMonitorEnabled=false",
                    "--logpath",
                    str(root / (name + ".log")),
                ]
                if replica:
                    argv += ["--replSet", "snapshotTest"]
                processes.append(
                    subprocess.Popen(
                        argv,
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                        creationflags=(
                            subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
                        ),
                    )
                )
                uri = f"mongodb://127.0.0.1:{port}/?directConnection=true"
                client = MongoClient(uri, serverSelectionTimeoutMS=500)
                clients.append(client)
                for _ in range(120):
                    try:
                        client.admin.command("ping")
                        break
                    except Exception:
                        time.sleep(0.1)
                else:
                    self.fail("MongoDB startup timed out")
                if replica:
                    client.admin.command(
                        "replSetInitiate",
                        {
                            "_id": "snapshotTest",
                            "members": [{"_id": 0, "host": f"127.0.0.1:{port}"}],
                        },
                    )
                    for _ in range(120):
                        if client.admin.command("hello").get("isWritablePrimary"):
                            break
                        time.sleep(0.1)
                    else:
                        self.fail("Primary election timed out")
                    # Refresh driver topology after initiating the replica set.
                    client.close()
                    client = MongoClient(uri, serverSelectionTimeoutMS=5000)
                    clients.append(client)
                return client, uri

            try:
                live, uri = start("live", replica=True)
                clone, clone_uri = start("clone")
                with self.assertRaises(subprocess.CalledProcessError):
                    run(
                        "mongodump",
                        "--uri=" + clone_uri,
                        "--oplog",
                        "--archive=" + str(root / "unsupported.archive"),
                    )
                db = live.lichess
                db.profiles.insert_one({"_id": "player", "version": 0})
                db.history.insert_one({"_id": "player", "version": 0})
                # Make the dump long enough for multiple writes to overlap it.
                db.padding.insert_many(
                    {"_id": i, "data": os.urandom(2048)} for i in range(8000)
                )
                db.game5.insert_one(
                    {
                        "_id": "native01",
                        "xv": 1,
                        "s": 30,
                        "co": datetime.now(timezone.utc),
                        "us": ["player"],
                        "xg": {"initialFen": "fixture", "moves": []},
                    }
                )
                errors = []
                commits = []

                def write():
                    try:
                        with live.start_session() as session:
                            while not stopped.is_set():
                                version = len(commits) + 1
                                with session.start_transaction():
                                    db.profiles.update_one(
                                        {"_id": "player"},
                                        {"$set": {"version": version}},
                                        session=session,
                                    )
                                    db.history.update_one(
                                        {"_id": "player"},
                                        {"$set": {"version": version}},
                                        session=session,
                                    )
                                commits.append(version)
                                time.sleep(0.005)
                    except Exception as exc:
                        errors.append(exc)

                writer = threading.Thread(target=write)
                writer.start()
                raw = root / "online.archive.gz"
                run(
                    "mongodump",
                    "--uri=" + uri,
                    "--oplog",
                    "--numParallelCollections=1",
                    "--gzip",
                    "--archive=" + str(raw),
                )
                stopped.set()
                writer.join(timeout=10)
                self.assertFalse(writer.is_alive())
                self.assertFalse(errors, errors)
                self.assertGreater(len(commits), 1)
                run(
                    "mongorestore",
                    "--uri=" + clone_uri,
                    "--stopOnError",
                    "--oplogReplay",
                    "--gzip",
                    "--archive=" + str(raw),
                )
                profile = clone.lichess.profiles.find_one()["version"]
                self.assertEqual(profile, clone.lichess.history.find_one()["version"])
                self.assertGreater(profile, 0)
                db.profiles.update_one({"_id": "player"}, {"$set": {"version": 999999}})
                self.assertEqual(clone.lichess.profiles.find_one()["version"], profile)
                export = Path(__file__).parents[1] / "export_snapshot.js"
                import json

                js = f'require({json.dumps(export.resolve().as_posix())}).exportSnapshot(db,{json.dumps((root / "export").as_posix())},"https://example.org")'
                run(
                    "mongosh",
                    clone_uri.replace("/?", "/lichess?"),
                    "--quiet",
                    "--eval",
                    js,
                )
                self.assertIn(
                    "native01", (root / "export/native-games.jsonl").read_text()
                )
                # Publication captured halfway through its multi-step update is rejected.
                clone.lichess.puzzle2_publication.insert_one(
                    {"_id": "control", "operation": "pending"}
                )
                with self.assertRaises(subprocess.CalledProcessError):
                    run(
                        "mongosh",
                        clone_uri.replace("/?", "/lichess?"),
                        "--quiet",
                        "--eval",
                        js,
                    )
            finally:
                stopped.set()
                if writer:
                    writer.join(timeout=10)
                for client in clients:
                    client.close()
                for process in processes:
                    process.terminate()
                    process.wait(timeout=20)


if __name__ == "__main__":
    unittest.main()
