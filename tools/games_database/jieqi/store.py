"""Transactional frontier, immutable raw evidence and conservative game identities."""
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import time

from tools.games_database.storage import compact_json

DEFAULT_DIRECTORY = Path(__file__).resolve().parents[3] / "data/local/jieqi-games"


@contextmanager
def exclusive(directory: Path):
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / "collector.lock").open("a+b") as handle:
        handle.seek(0)
        handle.write(b"0")
        handle.flush()
        handle.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            raise RuntimeError("Another jieqi collector owns this directory") from error
        try:
            yield
        finally:
            handle.seek(0)
            if os.name == "nt":
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


class Store:
    def __init__(self, directory: Path):
        directory.mkdir(parents=True, exist_ok=True)
        self.directory = directory
        self.db = sqlite3.connect(directory / "collection.sqlite3")
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=FULL")
        version = self.db.execute("PRAGMA user_version").fetchone()[0]
        if version not in {0, 1}:
            self.db.close()
            raise ValueError(f"Unsupported jieqi collection schema {version}")
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS jobs (
              id INTEGER PRIMARY KEY, source TEXT NOT NULL, url TEXT NOT NULL,
              depth INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
              attempts INTEGER NOT NULL DEFAULT 0, next_attempt REAL NOT NULL DEFAULT 0,
              error TEXT NOT NULL DEFAULT '', raw_hash TEXT, classification TEXT,
              UNIQUE(source,url));
            CREATE INDEX IF NOT EXISTS frontier ON jobs(state,next_attempt,id);
            CREATE TABLE IF NOT EXISTS blobs (
              hash TEXT PRIMARY KEY, body BLOB NOT NULL);
            CREATE TABLE IF NOT EXISTS responses (
              id INTEGER PRIMARY KEY, job_id INTEGER NOT NULL REFERENCES jobs(id),
              fetched_at REAL NOT NULL, status INTEGER NOT NULL, content_type TEXT NOT NULL,
              raw_hash TEXT NOT NULL REFERENCES blobs(hash));
            CREATE TABLE IF NOT EXISTS records (
              identity TEXT PRIMARY KEY, line_hash TEXT NOT NULL, kind TEXT NOT NULL,
              record_json TEXT NOT NULL, validation TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS record_lines ON records(line_hash);
            CREATE TABLE IF NOT EXISTS witnesses (
              job_id INTEGER NOT NULL REFERENCES jobs(id), raw_hash TEXT NOT NULL REFERENCES blobs(hash),
              identity TEXT NOT NULL REFERENCES records(identity), parser_version INTEGER NOT NULL,
              PRIMARY KEY(job_id,raw_hash,identity));
            PRAGMA user_version=1;
        """)

    def close(self):
        self.db.close()

    def enqueue(self, source, url, depth=0):
        self.db.execute("INSERT INTO jobs(source,url,depth) VALUES(?,?,?) ON CONFLICT(source,url) DO UPDATE SET depth=min(depth,excluded.depth)", (source, url, depth))

    def cache(self, job_id, body, status=200, content_type="text/html"):
        digest = hashlib.sha256(body).hexdigest()
        with self.db:
            self.db.execute("INSERT OR IGNORE INTO blobs VALUES(?,?)", (digest, body))
            self.db.execute("INSERT INTO responses(job_id,fetched_at,status,content_type,raw_hash) VALUES(?,?,?,?,?)", (job_id, time.time(), status, content_type, digest))
            self.db.execute("UPDATE jobs SET raw_hash=? WHERE id=?", (digest, job_id))
        return digest

    def body(self, digest):
        body = self.db.execute("SELECT body FROM blobs WHERE hash=?", (digest,)).fetchone()[0]
        if hashlib.sha256(body).hexdigest() != digest:
            raise ValueError("Cached response checksum mismatch")
        return body

    def finish(self, job, record, links, classification):
        # Record, provenance, newly discovered work and completion marker commit
        # together. A crash can never leave a finished page with lost children.
        with self.db:
            if record:
                identity, line = record.hashes(job["url"])
                self.db.execute("INSERT OR IGNORE INTO records VALUES(?,?,?,?,?)", (identity, line, record.kind, record.json(), "native-jieqi-v1"))
                self.db.execute("INSERT OR IGNORE INTO witnesses VALUES(?,?,?,1)", (job["id"], job["raw_hash"], identity))
            for url in links:
                self.enqueue(job["source"], url, job["depth"] + 1)
            self.db.execute("UPDATE jobs SET state='done', classification=?, error='' WHERE id=?", (classification, job["id"]))

    def summary(self):
        sources = {}
        for row in self.db.execute("SELECT source,state,classification,count(*) AS n FROM jobs GROUP BY source,state,classification"):
            key = row["state"] + (":" + row["classification"] if row["classification"] else "")
            sources.setdefault(row["source"], {})[key] = row["n"]
        kinds = dict(self.db.execute("SELECT kind,count(*) FROM records GROUP BY kind"))
        return dict(sources=sources, unique_records=sum(kinds.values()), records_by_kind=kinds,
                    witnesses=self.db.execute("SELECT count(*) FROM witnesses").fetchone()[0],
                    possible_duplicate_lines=self.db.execute("SELECT count(*) FROM (SELECT line_hash FROM records GROUP BY line_hash HAVING count(*)>1)").fetchone()[0],
                    problems=[dict(r) for r in self.db.execute("SELECT source,url,state,error FROM jobs WHERE state IN ('blocked','failed','review') ORDER BY id")])

    def export(self, destination: Path):
        destination = destination.resolve()
        if destination.parent == self.directory.resolve() and destination.name.startswith(("collection.sqlite3", "collector.lock")):
            raise ValueError("Export cannot overwrite collector state")
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_name(destination.name + ".tmp")
        try:
            with temporary.open("w", encoding="utf-8", newline="\n") as output:
                for row in self.db.execute("SELECT * FROM records ORDER BY identity"):
                    witnesses = [dict(r) for r in self.db.execute("SELECT j.source,j.url,w.raw_hash FROM witnesses w JOIN jobs j ON j.id=w.job_id WHERE w.identity=? ORDER BY j.source,j.url,w.raw_hash", (row["identity"],))]
                    output.write(compact_json(dict(schema="lixiangqi-jieqi-record-v1", variant="jieqi",
                                                   identity=row["identity"], kind=row["kind"],
                                                   validation=row["validation"], witnesses=witnesses,
                                                   **json.loads(row["record_json"]))) + "\n")
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, destination)
        finally:
            temporary.unlink(missing_ok=True)
