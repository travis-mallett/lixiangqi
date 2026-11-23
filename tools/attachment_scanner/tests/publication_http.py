"""Exercise the staged server against a dedicated loopback Mongo replica set and Redis."""
import argparse
import hashlib
import http.client
import json
import os
import secrets
import socket
import statistics
import subprocess
import sys
import tempfile
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing, contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch
from urllib import parse

from pymongo import MongoClient

from global_chat import verify_global_chat

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "tools" / "attachment_scanner"))
import screen
import worker
from test_scanner import general, png
from profile_pictures import verify_profile_pictures


class Site:
    def __init__(self, db, port):
        self.db = db
        self.port = port
        self.tokens = {}

    def user(self, username):
        now = datetime.now(timezone.utc)
        token = "lip_" + secrets.token_hex(24)
        self.tokens[username] = token
        self.db.user4.insert_one({
            "_id": username, "username": username, "enabled": True, "lang": "en",
            "count": {"game": 8, "win": 4, "loss": 4, "rated": 0, "draw": 0},
            "createdAt": now - timedelta(days=100), "seenAt": now,
        })
        self.db.oauth2_access_token.insert_one({
            "_id": hashlib.sha256(token.encode()).hexdigest(), "userId": username,
            "scopes": ["mobile:inbox", "mobile:forum", "msg:write"],
        })
        return username

    def call(self, path, user=None, form=None, *, data=None, name=None, method=None, json_body=None, status=200, extra_headers=None):
        headers = {"Accept": "application/json", "User-Agent": "LiXiangQi integration test", **(extra_headers or {})}
        if user:
            headers["Authorization"] = "Bearer " + self.tokens[user]
        if form is not None:
            headers["Content-Type"] = "application/x-www-form-urlencoded"
            data = parse.urlencode(form).encode()
        if json_body is not None:
            headers['Content-Type'] = 'application/json'
            data = json.dumps(json_body).encode()
        if name:
            headers.update({"Content-Type": "application/octet-stream", "X-Attachment-Name": parse.quote(name)})
        with closing(http.client.HTTPConnection("127.0.0.1", self.port, timeout=15)) as connection:
            connection.request(method or ("POST" if data is not None else "GET"), path, body=data, headers=headers)
            with connection.getresponse() as response:
                body = response.read()
                expected = status if isinstance(status, tuple) else (status,)
                assert response.status in expected, (path, response.status, expected, body[:240])
                return body, response.headers

    def json(self, *args, **kwargs):
        return json.loads(self.call(*args, **kwargs)[0])

    def screen_document(self):
        # Only the antivirus transport is replaced. The real worker checks type, policy and lease.
        with patch.object(screen, "malware", return_value="test-signatures"), patch.dict(
            os.environ, {"UGC_CLAMD_SOCKET": "fixture"}
        ):
            row = worker.claim(self.db.ugc_attachment)
            assert row is not None and worker.finish(self.db.ugc_attachment, row) == "ready"


@contextmanager
def staged_site(java, mongo_port, redis_port, *, libraries=None):
    uri = f"mongodb://127.0.0.1:{mongo_port}"
    with MongoClient(uri, serverSelectionTimeoutMS=8000) as connection, tempfile.TemporaryDirectory() as tmp:
        assert connection.admin.command("hello").get("setName"), "start a dedicated replica set"
        name = "ugc_http_test_" + uuid.uuid4().hex
        db = connection[name]
        directory = Path(tmp)
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        config = directory / "fixture.conf"
        config.write_text("\n".join([
            f'include file("{(ROOT / "conf/base.conf").as_posix()}")',
            'user.password.bpass.secret="dGVzdHBhc3N3b3Jkc2FsdA=="',
            f'net.domain="127.0.0.1:{port}"', f'mongodb.uri="{uri}/{name}"',
            f'traffic.mongodb_uri="{uri}/{name}"', 'traffic.enabled=false',
            f'redis.uri="redis://127.0.0.1:{redis_port}"',
            'api.influx_event.endpoint="http://127.0.0.1:1"',
            'attachments.msg=true', 'attachments.forum=true', 'attachments.profile=true',
        ]), encoding="utf8")
        with (directory / "server.log").open("w+", encoding="utf8") as log:
            proc = subprocess.Popen([
                java, "-XX:ActiveProcessorCount=4", "-Xmx1600m", f"-Dconfig.file={config}",
                f"-Dplay.server.http.port={port}", "-Dplay.server.http.address=127.0.0.1",
                f"-Djdk.net.unixdomain.tmpdir={directory / 'no-domain-sockets'}",
                "-cp", str(libraries or ROOT / "target/universal/stage/lib/*"), "lila.app.Lila", str(ROOT),
            ], cwd=ROOT, stdout=log, stderr=subprocess.STDOUT,
               creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            try:
                deadline = time.monotonic() + 90
                while time.monotonic() < deadline:
                    if proc.poll() is not None:
                        log.seek(0)
                        raise RuntimeError("Staged server failed to start.\n" + log.read()[-3000:])
                    try:
                        with socket.create_connection(("127.0.0.1", port), .5):
                            break
                    except OSError:
                        time.sleep(.25)
                else:
                    raise RuntimeError("Timed out starting staged server")
                yield Site(db, port)
            finally:
                if proc.poll() is None:
                    proc.terminate()
                    try:
                        proc.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        proc.kill()
                        proc.wait()
                connection.drop_database(name)


def verify(site):
    db = site.db
    alice, bob, other = [site.user(name) for name in ("alicefixture", "bobfixture", "otherfixture")]
    def nonce():
        return uuid.uuid4().hex

    def send(key, text, extra=None, status=200):
        return site.json("/inbox/" + bob, alice, {"nonce": key, "text": text, **(extra or {})}, status=status)

    assert send(nonce(), "Good game")["ok"]
    samples = []
    for _ in range(12):
        start = time.perf_counter_ns()
        assert send(nonce(), "Good game")["ok"]
        samples.append((time.perf_counter_ns() - start) / 1e6)
    print(f"12 authenticated loopback sends. Median {statistics.median(samples):.1f} ms, max {max(samples):.1f} ms.")

    # A rejected first message cannot create an inbox, a notification, or an unread thread.
    site.json("/inbox/" + other, bob, {"nonce": nonce(), "text": "Try https://chess-bot.com"}, status=422)
    assert db.msg_thread.find_one({"_id": "/".join(sorted([bob, other]))}) is None
    assert db.msg_msg.find_one({"tid": "/".join(sorted([bob, other]))}) is None
    assert db.notify.find_one({"notifies": other}) is None
    before = db.msg_msg.count_documents({})
    key = nonce()
    with ThreadPoolExecutor(2) as pool:
        copies = list(pool.map(lambda _: send(key, "duplicate retry"), range(2)))
    assert copies[0]["msg"]["id"] == copies[1]["msg"]["id"]
    assert send(key, "different", status=409)["error"] == "conflict"
    assert send(nonce(), "Xem https://chess-bot.com", status=422)["error"] == "unsafeLink"

    inbox = f"/attachment/msg/{bob}"
    policy = site.json(inbox + "/policy", alice)
    assert policy["enabled"] and policy["maxCount"] == 8
    content = b"local game notes"
    def upload(base, status=201):
        return site.json(base + "/upload", alice, data=content, name="notes.txt", status=status)

    assert upload(inbox, 422)["error"] == "scannerUnavailable"
    db.ugc_scanner.insert_one({"_id": "worker", "policy": screen.POLICY, "healthy": True, "at": worker.now()})
    handle = upload(inbox)["id"]
    url = "/attachment/msg/item/" + handle
    for user in (alice, bob, other, None):
        site.call(url, user, status=404)
    assert send(nonce(), "", {"attachments": handle}, status=422)["error"] == "attachmentsUnavailable"
    site.screen_document()
    assert db.msg_msg.count_documents({}) == before + 1
    site.call(url, bob, status=404)
    source = send(nonce(), "", {"attachments": handle})["msg"]
    assert source["attachments"] == [handle]

    # Publish a full album and arbitrary document, preserving order and download filenames.
    album = []
    for n in range(7):
        photo = site.json(inbox + "/upload", alice, data=png(), name=f"board-{n}.png", status=201)
        with patch.object(screen, "post_json", return_value=general()), patch.dict(os.environ, {"UGC_OPENAI_KEY":"fixture"}):
            site.screen_document()
        album.append(photo["id"])
    archive = b"PK\x03\x04 fixture"
    album.append(site.json(inbox + "/upload", alice, data=archive, name="game.zip", status=201)["id"])
    site.screen_document()
    assert send(nonce(), "Album", {"attachments": ",".join(album)})["msg"]["attachments"] == album
    first = "/attachment/msg/item/" + album[0]
    assert site.call(first, bob)[1]["Content-Disposition"].startswith("inline")
    saved, headers = site.call(first + "?download=1", bob)
    assert saved[:4] == b"RIFF" and headers["Content-Disposition"].startswith("attachment")
    assert "board-0.webp" in headers["Content-Disposition"]
    assert "no-store" in headers["Cache-Control"]
    photo_meta = first + "?meta=1&photoCache=1"
    tag = site.json(photo_meta, bob)["photoTag"]
    cached, headers = site.call(first + "?photoCache=1", bob)
    assert cached == saved and headers["ETag"] == tag == '"' + hashlib.sha256(saved).hexdigest() + '"'
    assert headers["Cache-Control"] == "private, no-cache, must-revalidate"
    assert "photoTag" not in site.json(first + "?meta=1", bob)
    assert "photoTag" not in site.json(url + "?meta=1&photoCache=1", bob)
    site.call(photo_meta, other, status=404)
    zip_bytes, headers = site.call("/attachment/msg/item/" + album[-1], bob)
    assert zip_bytes == archive and headers["Content-Type"].startswith("application/octet-stream")
    assert "game.zip" in headers["Content-Disposition"]
    site.call(first + "?download=1", other, status=404)
    for user in (alice, bob):
        body, headers = site.call(url, user)
        assert body == content and "no-store" in headers["Cache-Control"]
        assert headers["Content-Disposition"].startswith("attachment")
    for user in (other, None):
        site.call(url, user, status=404)
    for kid in (alice, bob):
        db.user4.update_one({"_id": kid}, {"$set": {"kid": True}})
        for user in (alice, bob):
            site.call(url, user, status=404)
            site.call(url + "?meta=1", user, status=404)
            site.call(photo_meta, user, status=404)
        assert not site.json(inbox + "/policy", alice)["enabled"]
        upload(inbox, 403)
        db.user4.update_one({"_id": kid}, {"$set": {"kid": False}})

    edit = f"/inbox/{bob}/messages/{source['id']}"
    site.call(edit, alice, {"action": "edit", "value": "看 https://chess-bot.com", "revision": 0}, status=422)
    assert db.msg_msg.find_one({"_id": source["id"]})["text"] == ""
    def change(value):
        site.call(edit, alice, {"action": "edit", "value": value, "revision": 0}, status=(200, 409))
    with ThreadPoolExecutor(2) as pool:
        list(pool.map(change, ("first revision", "other revision")))
    record = db.msg_msg.find_one({"_id": source["id"]})
    assert record["revision"] == 1 and record["text"] in ("first revision", "other revision")
    db.user4.update_one({"_id": bob}, {"$set": {"kid": True}})
    pinned = site.json(edit, alice, {"action": "pin", "value": "true", "revision": 1})["msg"]
    assert pinned["attachments"] == [] and pinned["revision"] == 2
    db.user4.update_one({"_id": bob}, {"$set": {"kid": False}})
    forward = site.json("/inbox/" + other, bob, {
        "nonce": nonce(), "text": "", "forwardUser": alice, "forwardId": source["id"],
    })["msg"]["attachments"][0]
    assert forward != handle and site.call("/attachment/msg/item/" + forward, other)[0] == content

    assert not site.json("/attachment/forum/diagnostic~new/policy", alice)["enabled"]
    forum = "/attachment/forum/game-analysis~new"
    assert site.json(forum + "/policy", alice)["enabled"]
    public_handle = upload(forum)["id"]
    site.screen_document()
    topic = {
        "name": "Game notes", "post.text": "", "post.nonce": nonce(), "post.attachments": public_handle,
        "post.gameId": "00000000", "post.move": "a3 e3",  # The repository's seeded test position.
    }
    public_url = "/attachment/forum/item/" + public_handle
    site.call(public_url, status=404)
    for _ in range(2):
        site.call("/forum/game-analysis/new", alice, topic, status=(302, 303))
    assert db.f_post.count_documents({"attachments": public_handle}) == 1
    post = db.f_post.find_one({"attachments": public_handle})
    assert site.call(public_url)[0] == content
    site.call("/forum/post/" + post["_id"], alice, {"changes": "https://chess-bot.com", "revision": 0}, status=422)
    assert db.f_post.find_one({"_id": post["_id"]})["text"] == ""
    site.json("/report/flag", bob, {
        "username": alice, "resource": "forum/" + post["_id"], "text": "review", "revision": 0, "attachment": public_handle,
    })
    report = {
        "username": alice, "resource": "msg", "text": "review",
        "item": source["id"], "revision": pinned["revision"], "attachment": handle,
    }
    site.call("/report/flag", other, report, status=404)
    site.call("/report/flag", bob, {**report, "revision": 0}, status=404)
    site.json("/report/flag", bob, {**report, "block": "true"})
    assert db.ugc_evidence.count_documents({"item.parent": source["id"], "item.revision": pinned["revision"]}) == 1
    assert db.ugc_attachment.find_one({"_id": handle}).get("evidenceUntil")
    site.call(url, bob, status=404)


def verify_group_inbox(site):
    alice, bob, chen, observer = [site.user(name) for name in ("clubalice", "clubbob", "clubchen", "clubguest")]
    for friend in (bob,):
        for first, second in ((alice, friend), (friend, alice)):
            site.db.relation.insert_one({"_id": f"{first}/{second}", "u1": first, "u2": second, "r": True})

    assert {user["name"] for user in site.json("/inbox/contacts/friends", alice)["friends"]} == {bob}
    group = site.json("/inbox/groups/create", alice, {"name": "League", "members": f"{bob},{chen}"}, status=201)["id"]
    path = f"/inbox/group/{group}"
    empty = site.json(path, chen)["convo"]
    assert empty["admins"] == [alice] and not empty["msgs"]
    site.call(path, observer, status=404)
    site.call(f"{path}/manage", bob, {"action": "promote", "value": bob}, status=422)
    site.call(f"{path}/manage", alice, {"action": "promote", "value": bob})
    site.call(f"{path}/manage", bob, {"action": "describe", "value": "Practice at lunch"})
    info = site.json(path, chen)["convo"]
    assert set(info["admins"]) == {alice, bob} and info["description"] == "Practice at lunch"

    for member in (alice, chen):
        site.json("/inbox/settings/organize", member, {"chat": group, "action": "mute", "value": "true"})
    message = site.json(path, bob, {"text": f"@{chen} cannon practice", "nonce": uuid.uuid4().hex})["msg"]
    site.json(path, bob, {"text": "One more idea", "nonce": uuid.uuid4().hex})
    note = {"content.type": "privateMessage", "content.thread": group}
    deadline = time.monotonic() + 15
    while not site.db.notify.find_one({**note, "notifies": chen, "read": False}):
        assert time.monotonic() < deadline, "Mention in a muted group must notify the named member"
        time.sleep(.1)
    assert not site.db.notify.find_one({**note, "notifies": alice})
    for member in (alice, chen):
        site.json(f"{path}/receipt", member, {"ids": message["id"], "read": "true"})
    assert site.db.notify.find_one({**note, "notifies": chen, "read": True})
    latest = next(m for m in site.json(path, bob)["convo"]["msgs"] if m["id"] == message["id"])
    assert latest["id"] == message["id"] and latest["readAt"]
    assert site.json(f"/inbox/history/{group}?q=cannon", chen)["msgs"][0]["id"] == message["id"]
    site.json("/inbox/settings/organize", chen, {"chat": group, "action": "archive", "value": "true"})
    assert any(c["user"]["id"] == group for c in site.json("/inbox/settings/chats?scope=archive", chen)["contacts"])
    assert not site.json("/inbox/settings/chats?scope=archive", bob)["contacts"]
    site.call(f"{path}/manage", chen, {"action": "leave"})
    site.call(path, chen, status=404)

    assert not site.json(path, alice)["convo"].get("inviteToken")
    site.call(path + "/manage", alice, {"action": "linkOn"})
    invite = "/inbox/invite/" + group + "/" + site.json(path, alice)["convo"]["inviteToken"]
    assert site.json(invite, observer)["name"] == "League"
    site.call(path + "/manage", alice, {"action": "approval", "value": "true"})
    assert not site.json(invite, observer, {})["joined"]
    site.call(path, observer, status=404)
    site.call(path + "/manage", bob, {"action": "approve", "value": observer})
    assert not site.json(path, observer)["convo"]["msgs"]
    assert not site.json(path, observer)["convo"].get("inviteToken")
    site.call(path + "/manage", alice, {"action": "remove", "value": observer})
    site.call(invite, observer, {}, status=404)
    site.call(path + "/manage", bob, {"action": "linkReset"})
    site.call(invite, chen, {}, status=404)
    invite = "/inbox/invite/" + group + "/" + site.json(path, bob)["convo"]["inviteToken"]
    site.call(path + "/manage", bob, {"action": "approval", "value": "false"})
    assert site.json(invite, chen, {})["joined"]
    site.call(path + "/manage", bob, {"action": "linkOff"})
    site.call(invite, chen, status=404)
    message_path = f"{path}/messages/{latest['id']}"
    delete = {"action": "deleteEveryone", "value": "", "revision": latest["revision"]}
    site.call(message_path, alice, delete, status=400)
    site.call(message_path, bob, delete)
    site.db.user4.update_one({"_id": chen}, {"$set": {"kid": True}})
    dest = "/attachment/msg/" + group
    assert site.json(dest + "/policy", alice)["enabled"]
    assert not site.json(dest + "/policy", chen)["enabled"]
    site.db.ugc_scanner.update_one({"_id": "worker"}, {"$set": {"at": worker.now()}})
    handle = site.json(dest + "/upload", alice, data=b"Team notes", name="notes.txt", status=201)["id"]
    site.screen_document()
    rich = site.json(path, alice, {"text": "", "attachments": handle, "nonce": uuid.uuid4().hex})["msg"]
    assert rich["attachments"] == [handle]
    assert site.call("/attachment/msg/item/" + handle, chen)[0] == b"Team notes"
    site.call("/attachment/msg/item/" + handle, observer, status=404)
    site.call("/attachment/msg/item/" + handle, status=404)
    site.call(dest + "/upload", chen, data=b"Child upload", name="notes.txt", status=403)

    endpoint = "/inbox/device/registration"
    fid = "a" * 22
    kid = site.user("clubchild")
    site.db.user4.update_one({"_id": kid}, {"$set": {"kid": True}})
    site.call(endpoint, kid, method="PUT", json_body={"fid": "b" * 22}, status=400)
    site.call(endpoint, alice, method="PUT", json_body={"fid": fid}, status=204)
    session = hashlib.sha256(site.tokens[alice].encode()).hexdigest()
    assert site.db.push_device.find_one({"_id": fid})["session"] == session
    replacement = "c" * 22
    site.call(endpoint, alice, method="PUT", json_body={"fid": replacement}, status=204)
    assert site.db.push_device.find_one({"_id": fid}) is None
    assert site.db.push_device.find_one({"_id": replacement})["session"] == session
    site.call(endpoint, alice, method="DELETE", status=204)
    assert site.db.push_device.find_one({"_id": replacement}) is None
    site.call(endpoint, alice, method="PUT", json_body={"fid": fid}, status=204)
    site.call("/api/token", alice, method="DELETE", status=204)
    deadline = time.monotonic() + 5
    while site.db.push_device.find_one({"_id": fid}):
        assert time.monotonic() < deadline, "Revoking the account token must unregister the installation"
        time.sleep(.05)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--java", default="java")
    parser.add_argument("--mongo-port", type=int, required=True)
    parser.add_argument("--redis-port", type=int, required=True)
    args = parser.parse_args()
    with staged_site(args.java, args.mongo_port, args.redis_port) as app:
        verify(app)
        verify_group_inbox(app)
        verify_global_chat(app)
        verify_profile_pictures(app)
    print("Forum, inbox, reports and revocation HTTP checks passed.")
