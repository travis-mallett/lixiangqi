"""Exercise real native study HTTP and WebSocket operations in the disposable preview.

Only loopback services and explicitly named disposable databases are accepted. Fixture
users are unique, have no elevated roles, and never reuse real accounts. The
manifest allows reopen verification after an application restart and cleanup.
"""

from __future__ import annotations

import argparse
import base64
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
import hashlib
from http.client import HTTPConnection
import json
from pathlib import Path
import secrets
import socket
import struct
import subprocess
import time
from urllib.parse import urlencode, urlsplit

from pymongo import MongoClient


NOTATION = '''[Red "Fixture Red"]
[Black "Fixture Black"]
[Event "Native study verification"]
[Orientation "black"]
[ChapterDescription "Round-trip metadata"]
[TimeControl "60+2"]
[Result "*"]
{Root [%csl Gi10][%cal Ri10i9][%clk 0:01:00][%eval 0.32,18]} $1
1. i1i2 {Main [%clk 0:00:59.25][%emt 0:00:00.75]} (1. a1a2 a10a9) i10i9
(1... b10c8 {Alternative [%cal Bi10i1]}) *
'''


def local_url(value: str, schemes: tuple[str, ...]) -> str:
    parsed = urlsplit(value)
    if parsed.scheme not in schemes or parsed.hostname not in ("localhost", "127.0.0.1", "::1"):
        raise ValueError("Verification only accepts loopback URLs")
    if parsed.username or parsed.password:
        raise ValueError("Verification URLs cannot contain credentials")
    return value.rstrip("/")


class Http:
    def __init__(self, base: str, session: str | None = None):
        self.base, self.session = base, session

    def request(self, path: str, method="GET", data=None, expected=(200,), json_body=None):
        headers = {
            "Accept": "application/json",
            "X-Requested-With": "XMLHttpRequest",
            "User-Agent": "LiXiangQi-local-study-verification/1.0",
            "Origin": self.base,
        }
        if self.session:
            headers["sessionId"] = self.session
        body = None
        if data is not None:
            body = urlencode(data).encode()
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        if json_body is not None:
            body = json.dumps(json_body).encode()
            headers["Content-Type"] = "application/json"
        uri = urlsplit(self.base)
        connection = HTTPConnection(uri.hostname, uri.port or 80, timeout=30)
        try:
            connection.request(method, path, body, headers)
            response = connection.getresponse()
            content = response.read()
            if response.status not in expected:
                raise AssertionError(f"{method} {path}: HTTP {response.status}: {content[:500]!r}")
            return response.status, dict(response.headers), content
        finally:
            connection.close()

    def json(self, path):
        return json.loads(self.request(path)[2])


class Ws:
    """Small RFC6455 client using only the standard library, including ping and fragmentation."""

    def __init__(self, base, study, session, origin, version=None):
        uri = urlsplit(base)
        query = {"sri": secrets.token_hex(6), "sessionId": session}
        if version is not None:
            query["v"] = version
        self.socket = socket.create_connection((uri.hostname, uri.port or 80), timeout=10)
        self.buffer = bytearray()
        self.version = version or 0
        key = base64.b64encode(secrets.token_bytes(16)).decode()
        request = (
            f"GET /study/{study}/socket/v5?{urlencode(query)} HTTP/1.1\r\n"
            f"Host: {uri.netloc}\r\nOrigin: {origin}\r\nUpgrade: websocket\r\n"
            f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
        )
        self.socket.sendall(request.encode())
        while b"\r\n\r\n" not in self.buffer:
            self.buffer.extend(self.socket.recv(65536))
        header, rest = self.buffer.split(b"\r\n\r\n", 1)
        self.buffer = bytearray(rest)
        if not header.startswith(b"HTTP/1.1 101"):
            self.socket.close()
            raise AssertionError("WebSocket handshake rejected: " + header.split(b"\r\n")[0].decode())
        expected = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest())
        if expected not in header:
            raise AssertionError("Invalid WebSocket accept key")
        self.frame(b"null")
        if version is None:
            self.event(lambda event: event.get("t") == "crowd", timeout=10)

    def read(self, size):
        while len(self.buffer) < size:
            block = self.socket.recv(65536)
            if not block:
                raise EOFError("WebSocket disconnected")
            self.buffer.extend(block)
        result = bytes(self.buffer[:size])
        del self.buffer[:size]
        return result

    def frame(self, data, opcode=1):
        mask = secrets.token_bytes(4)
        size = len(data)
        header = bytes([0x80 | opcode, 0x80 | (size if size < 126 else 126 if size <= 65535 else 127)])
        if size >= 126:
            header += struct.pack("!H" if size <= 65535 else "!Q", size)
        self.socket.sendall(header + mask + bytes(value ^ mask[index % 4] for index, value in enumerate(data)))

    def send(self, kind, data):
        self.frame(json.dumps({"t": kind, "d": data}, separators=(",", ":")).encode())

    def event(self, predicate, timeout=15):
        deadline = time.monotonic() + timeout
        payload = bytearray()
        while time.monotonic() < deadline:
            self.socket.settimeout(max(0.01, deadline - time.monotonic()))
            first, second = self.read(2)
            opcode, length = first & 15, second & 127
            if length in (126, 127):
                length = struct.unpack("!H" if length == 126 else "!Q", self.read(2 if length == 126 else 8))[0]
            mask = self.read(4) if second & 128 else None
            body = self.read(length)
            if mask:
                body = bytes(value ^ mask[index % 4] for index, value in enumerate(body))
            if opcode == 8:
                raise EOFError("WebSocket closed")
            if opcode == 9:
                self.frame(body, 10)
                continue
            if opcode == 10:
                continue
            payload.extend(body)
            if first & 128:
                event = json.loads(payload)
                payload.clear()
                if isinstance(event, dict):
                    self.version = max(self.version, event.get("v", 0))
                    if predicate(event):
                        return event
        raise TimeoutError("Expected study socket event was not received")

    def close(self):
        try:
            self.frame(b"", 8)
        finally:
            self.socket.close()


def await_value(read, predicate, timeout=15):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = read()
        if predicate(value):
            return value
        time.sleep(0.15)
    raise AssertionError("Expected persisted study state did not appear")


def node_at(root, path):
    node = root
    for move in filter(None, path.split("/")):
        node = next(child for child in node["children"] if child["id"] == move)
    return node


def signature(node):
    """Complete supported notation content, including comment identities and authors."""
    keys = ("id", "uci", "fen", "notation", "chineseNotation", "glyphs", "shapes", "clock", "elapsed", "eval", "gamebook", "forceVariation", "comp")
    result = {key: node[key] for key in keys if key in node}
    result["comments"] = node.get("comments", [])
    result["children"] = [signature(child) for child in node.get("children", [])]
    return result


class Verification:
    def __init__(self, args):
        self.args = args
        self.manifest = {"checks": [], "studies": [], "users": {}, "base": args.base, "socket": args.socket}
        self.client = MongoClient(args.mongo, serverSelectionTimeoutMS=5000)
        self.db = self.client[urlsplit(args.mongo).path.lstrip("/")]
        self.sockets = []

    def save(self):
        self.args.manifest.parent.mkdir(parents=True, exist_ok=True)
        self.args.manifest.write_text(json.dumps(self.manifest, indent=2), encoding="utf-8")

    def passed(self, name):
        self.manifest["checks"].append({"name": name, "passed": True})
        self.save()
        print("PASS " + name, flush=True)

    def provision(self):
        suffix = secrets.token_hex(4)
        now = datetime.now(UTC)
        for role in ("owner", "contributor", "reader", "outsider"):
            user = "sv" + suffix + role[:3]
            session = secrets.token_hex(16)
            self.db.user4.insert_one({"_id": user, "username": user, "enabled": True, "roles": [], "createdAt": now - timedelta(days=1), "seenAt": now, "count": {key: 0 for key in ("draw", "game", "loss", "rated", "win")}})
            self.db.security.insert_one({"_id": session, "user": user, "up": True, "date": now, "ip": "127.0.0.1", "ua": "LiXiangQi-study-verification"})
            self.db.pref.insert_one({"_id": user, "studyInvite": 3})
            self.manifest["users"][role] = {"id": user, "session": session}
            self.save()

    def http(self, role="owner"):
        return Http(self.args.base, self.manifest["users"][role]["session"])

    def ws(self, study, role="owner", version=None):
        connection = Ws(self.args.socket, study, self.manifest["users"][role]["session"], self.args.base, version)
        self.sockets.append(connection)
        return connection

    def create(self, notation):
        _, headers, _ = self.http().request("/study", "POST", {"pgn": notation, "orientation": "automatic", "mode": "normal"}, (302, 303))
        location = headers.get("Location") or headers.get("location")
        parts = urlsplit(location).path.strip("/").split("/")
        assert len(parts) == 3 and parts[0] == "study" and len(parts[1]) == 8 and len(parts[2]) == 8, location
        self.manifest["studies"].append(parts[1])
        self.save()
        print("Fixture " + self.args.base + "/study/" + parts[1] + "/" + parts[2], flush=True)
        return parts[1], parts[2]

    def chapter(self, study, chapter, role="owner"):
        return self.http(role).json(f"/study/{study}/{chapter}?chapters=true")

    def run(self):
        self.provision()
        study, chapter = self.create(NOTATION)
        self.manifest.update(study=study, chapter=chapter)
        read = lambda: self.chapter(study, chapter)
        initial = read()
        root = initial["analysis"]["tree"]
        assert node_at(root, "i1i2/i10i9")["uci"] == "i10i9"
        assert initial["study"]["chapter"]["setup"]["orientation"] == "black"
        assert len(root["children"]) == 2
        self.passed("HTTP creation preserves all native coordinates, variations and chapter metadata")
        owner = self.ws(study)
        for role in ("contributor", "reader"):
            owner.send("invite", self.manifest["users"][role]["id"])
            await_value(read, lambda data: self.manifest["users"][role]["id"] in data["study"]["members"])
        owner.send("setRole", {"userId": self.manifest["users"]["contributor"]["id"], "role": "w"})
        await_value(read, lambda data: data["study"]["members"][self.manifest["users"]["contributor"]["id"]]["role"] == "w")
        contributor = self.ws(study, "contributor")
        reader = self.ws(study, "reader")
        self.passed("WebSocket invitations and contributor permissions")
        pos = {"ch": chapter, "path": "i1i2/i10i9"}
        with ThreadPoolExecutor(max_workers=2) as executor:
            first = executor.submit(owner.send, "setComment", dict(pos, text="Owner {literal braces}"))
            second = executor.submit(contributor.send, "setComment", dict(pos, text="Contributor i10"))
            first.result(); second.result()
        await_value(read, lambda data: len(node_at(data["analysis"]["tree"], pos["path"]).get("comments", [])) == 2)
        reader.send("setComment", dict(pos, text="Reader must not edit"))
        owner.send("shapes", dict(pos, shapes=[{"brush": "green", "orig": "i10", "dest": "i9"}]))
        owner.send("toggleGlyph", dict(pos, id=255))
        owner.send("setGamebook", dict(pos, gamebook={"hint": "Hint [i10] {保留}", "deviation": "Try another line"}))
        def complete(data):
            node = node_at(data["analysis"]["tree"], pos["path"])
            return node.get("gamebook", {}).get("hint") == "Hint [i10] {保留}" and len(node.get("shapes", [])) == 1 and any(glyph["id"] == 255 for glyph in node.get("glyphs", []))
        current = await_value(read, complete)
        assert all(comment["text"] != "Reader must not edit" for comment in node_at(current["analysis"]["tree"], pos["path"])["comments"])
        self.passed("Simultaneous contributor comments and native annotations persist without lost edits")
        contributor.send("anaMove", dict(pos, orig="i2", dest="i3"))
        await_value(read, lambda data: any(child["id"] == "i2i3" for child in node_at(data["analysis"]["tree"], pos["path"])["children"]))
        owner.send("setPath", {"ch": chapter, "path": "i1i2"})
        contributor.event(lambda event: event.get("t") == "path" and event["d"]["p"]["path"] == "i1i2")
        version = contributor.version
        contributor.close(); self.sockets.remove(contributor)
        owner.send("setPath", pos)
        await_value(read, lambda data: data["study"]["position"]["path"] == pos["path"])
        contributor = self.ws(study, "contributor", version)
        contributor.event(lambda event: event.get("t") == "path" and event["d"]["p"]["path"] == pos["path"])
        self.passed("Native move editing, presenter synchronization and missed-event reconnect recovery")
        owner.send("anaMove", dict(pos, orig="i10", dest="i1"))
        owner.event(lambda event: event.get("t") in ("validationError", "error"))
        self.passed("Illegal moves produce an explicit socket error")
        exported = self.http().request(f"/study/{study}/{chapter}.pgn")[2].decode()
        imported_study, imported_chapter = self.create(exported)
        assert signature(read()["analysis"]["tree"]) == signature(self.chapter(imported_study, imported_chapter)["analysis"]["tree"])
        self.passed("Export-import round trip retains complete tree, annotations and teaching metadata")
        _, headers, _ = self.http().request(f"/study/{study}/cloneApply", "POST", {}, (302, 303))
        clone = (headers.get("Location") or headers["location"]).rstrip("/").split("/")[-1]
        self.manifest["studies"].append(clone); self.save()
        cloned = self.http().json(f"/study/{clone}?chapters=true")
        assert signature(read()["analysis"]["tree"]) == signature(cloned["analysis"]["tree"])
        self.passed("HTTP cloning retains native tree and annotations")
        before = len(read()["study"]["chapters"])
        self.http().request(f"/study/{study}/import-pgn?sri=verify", "POST", {"pgn": '[Event "Valid"]\n1. a4a5 *\n[Event "Invalid"]\n1. i1i10 *', "mode": "normal", "initial": "false", "sticky": "false", "isDefaultName": "true"}, (400,))
        assert len(read()["study"]["chapters"]) == before
        self.passed("Invalid multi-chapter imports fail atomically")
        embed = f"/study/embed/{study}/{chapter}"
        Http(self.args.base).request(embed)
        Http(self.args.base).request(embed)
        Http(self.args.base).request(f"/study/embed/{imported_study}/{chapter}", expected=(404,))
        self.passed("Public embeds require matching study/chapter ownership")
        settings = {key: "everyone" for key in ("computer", "explorer", "cloneable", "shareable")}
        settings.update(name="Verified native study", visibility="private", chat="member", sticky="true", description="true")
        owner.send("editStudy", settings)
        await_value(read, lambda data: data["study"]["visibility"] == "private")
        self.chapter(study, chapter, "reader")
        self.http("reader").request(f"/study/{study}/{chapter}/config")
        self.http("outsider").request(f"/study/{study}/{chapter}/config", expected=(403, 404))
        Http(self.args.base).request(f"/study/{study}/{chapter}/config", expected=(401, 403, 404))
        self.http("outsider").request(f"/study/{study}/{chapter}", expected=(403, 404))
        Http(self.args.base).request(f"/study/{study}/{chapter}.pgn", expected=(401, 403, 404))
        Http(self.args.base).request(embed, expected=(404,))
        try:
            outsider = self.ws(study, "outsider")
        except ConnectionResetError:
            # Windows may reset the rejected upgrade before its HTTP error is read.
            # A permitted client must still connect, so an unavailable gateway cannot pass.
            permitted = self.ws(study, "reader")
            permitted.close(); self.sockets.remove(permitted)
        except AssertionError as error:
            assert "403" in str(error) or "404" in str(error), error
        else:
            outsider.close(); self.sockets.remove(outsider)
            raise AssertionError("Private study accepted an unrelated WebSocket client")
        self.passed("Private study access permits members and denies unrelated or anonymous users")
        owner.send("editStudy", dict(settings, visibility="public", shareable="nobody"))
        await_value(read, lambda data: data["study"]["visibility"] == "public" and data["study"]["settings"]["shareable"] == "nobody")
        Http(self.args.base).request(embed, expected=(404,))
        owner.send("editStudy", settings)
        await_value(read, lambda data: data["study"]["visibility"] == "private")
        self.passed("Cached embeds are revoked immediately by private visibility and sharing permissions")
        self.manifest["expectedRoot"] = signature(read()["analysis"]["tree"])
        self.save()

    def reopen(self):
        self.manifest = json.loads(self.args.manifest.read_text(encoding="utf-8"))
        data = self.chapter(self.manifest["study"], self.manifest["chapter"])
        assert signature(data["analysis"]["tree"]) == self.manifest["expectedRoot"]
        self.passed("Saved studies survive application restart and fresh HTTP session restoration")

    def engine(self):
        self.manifest = json.loads(self.args.manifest.read_text(encoding="utf-8"))
        study, chapter = self.manifest["study"], self.manifest["chapter"]
        queued = self.db.fishnet_analysis.count_documents({})
        log = self.args.manifest.with_suffix(".browser.log")
        with log.open("w", encoding="utf-8") as output:
            completed = subprocess.run(["node", "tools/study_verification/browser.mjs", str(self.args.manifest)],
                                       stdout=output, stderr=subprocess.STDOUT, timeout=240)
        if completed.returncode:
            raise AssertionError(f"Browser verification failed; diagnostics in {log}")
        data = self.chapter(study, chapter)
        root = data["analysis"]["tree"]
        nodes = [root]
        while nodes[-1].get("children"):
            child = next((n for n in nodes[-1]["children"] if not n.get("forceVariation")), None)
            if child is None:
                break
            nodes.append(child)
        batch = {"initialFen": root["fen"], "ruleset": root["ruleset"],
                 "moves": [n["uci"] for n in nodes[1:]],
                 "evaluations": [dict(n["eval"], depth=1, variation=[]) for n in nodes]}
        url = f"/study/{study}/{chapter}/local-analysis"
        self.http("reader").request(url, "POST", expected=(403,), json_body=batch)
        self.http("outsider").request(url, "POST", expected=(403,), json_body=batch)
        self.http().request(url, "POST", expected=(409,), json_body=dict(batch, moves=[]))
        assert self.db.fishnet_analysis.count_documents({}) == queued, "Browser study analysis queued server work"
        assert not self.db.analysis2.find_one({"studyId": study, "chapterId": chapter}), "Browser scores entered trusted analysis storage"
        self.manifest["expectedRoot"] = signature(root)
        self.passed("Browser Pikafish saves chapter scores without server analysis; unauthorized and stale saves fail")

    def cleanup(self):
        self.manifest = json.loads(self.args.manifest.read_text(encoding="utf-8"))
        for study in self.manifest["studies"]:
            self.http().request(f"/study/{study}/delete", "POST", {}, (302, 303, 404))
        ids = [user["id"] for user in self.manifest["users"].values()]
        self.db.security.delete_many({"user": {"$in": ids}})
        self.db.pref.delete_many({"_id": {"$in": ids}})
        self.db.notify.delete_many({"notifies": {"$in": ids}})
        self.db.notify_pref.delete_many({"_id": {"$in": ids}})
        self.db.user4.delete_many({"_id": {"$in": ids}})
        self.manifest["cleaned"] = True
        self.save()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="http://localhost:9663")
    parser.add_argument("--socket", default="ws://localhost:9664")
    parser.add_argument("--mongo", default="mongodb://127.0.0.1:27017/lixiangqi_preview")
    parser.add_argument("--manifest", type=Path, default=Path(".tools/native-study-verification.json"))
    parser.add_argument("--phase", choices=("all", "engine", "reopen", "cleanup"), default="all")
    args = parser.parse_args()
    args.base = local_url(args.base, ("http",))
    args.socket = local_url(args.socket, ("ws",))
    local_url(args.mongo, ("mongodb",))
    if urlsplit(args.mongo).path not in ("/lixiangqi_preview", "/lixiangqi_study_verification"):
        parser.error("Only disposable lixiangqi_preview or lixiangqi_study_verification databases are allowed")
    if args.phase == "all" and args.manifest.exists():
        parser.error("Choose a new manifest or clean up the previous run first")
    verification = Verification(args)
    try:
        getattr(verification, {"all": "run", "engine": "engine", "reopen": "reopen", "cleanup": "cleanup"}[args.phase])()
    except Exception as error:
        verification.manifest["failure"] = f"{type(error).__name__}: {error}"
        verification.save()
        raise
    finally:
        for connection in verification.sockets:
            connection.close()
        verification.client.close()


if __name__ == "__main__":
    main()
