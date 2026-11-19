"""Global room, private delivery and notification contracts on a disposable staged site."""
import hashlib
import secrets
import time
import uuid
from datetime import datetime, timedelta, timezone


def verify_global_chat(site):
    alice, bob, quiet, subscriber, moderator = [
        site.user(name) for name in ("globalalice", "globalbob", "globalquiet", "globalfan", "globalmod")
    ]
    for mod in [moderator, site.user("globalmodbasic")]:
        site.db.user4.update_one({"_id": mod}, {"$set": {"roles": ["ROLE_CHAT_TIMEOUT"], "totp": secrets.token_bytes(20)}})
    site.db.user4.update_one({"_id": alice}, {"$set": {"totp": secrets.token_bytes(20)}})
    for actor in (moderator, alice):
        site.db.oauth2_access_token.update_one({"_id": hashlib.sha256(site.tokens[actor].encode()).hexdigest()},
                                               {"$addToSet": {"scopes": "mobile:moderateGlobalChat"}})
    room = "~" + "0" * 32
    path = "/inbox/group/" + room
    preview = "/inbox/public/global"

    def post(author, text):
        return site.json(path, author, {"text": text, "nonce": uuid.uuid4().hex})["msg"]

    def setting(user, key, value, status=200):
        return site.call("/inbox/settings/organize", user, {"chat": room, "action": key, "value": value}, status=status)

    def edit(user, message, action, text="", status=200):
        return site.call(f"{path}/messages/{message['id']}", user, {
            "action": action, "revision": str(message["revision"]), "value": text,
        }, status=status)

    inbox = site.json("/inbox", alice)
    assert inbox["contacts"][0]["user"]["id"] == room
    assert inbox["organization"]["states"][room] == {"pin": True, "mentions": True, "mute": True}
    assert site.json(preview)["msgs"] == []
    site.call(path, form={"text": "guest", "nonce": uuid.uuid4().hex}, status=(401, 403))
    setting(alice, "pin", "false", 422)
    setting(alice, "archive", "true", 422)
    setting(quiet, "mentions", "false")
    setting(subscriber, "mute", "false")
    assert site.json(path, moderator)["convo"]["canModerate"]
    assert not site.json(path, "globalmodbasic")["convo"]["canModerate"]
    assert not site.json(path, alice)["convo"]["canModerate"]

    direct = site.json("/inbox/" + bob, alice, {"text": "private only", "nonce": uuid.uuid4().hex})["msg"]
    assert direct.get("deliveredAt") is None and direct.get("readAt") is None
    assert direct["id"] in {m["id"] for m in site.json("/inbox/delivery/pending", bob)["msgs"]}
    assert direct["id"] not in {m["id"] for m in site.json("/inbox/delivery/pending", quiet)["msgs"]}
    receipt = {"ids": direct["id"], "read": "false"}
    delivered = site.json("/inbox/" + alice + "/receipt", bob, receipt)["receipts"][0]
    assert delivered["deliveredAt"] and not delivered.get("readAt")
    assert not site.json("/inbox/delivery/pending", bob)["msgs"]
    assert not site.json(preview)["msgs"]
    receipt["read"] = "true"
    read = site.json("/inbox/" + alice + "/receipt", bob, receipt)["receipts"][0]
    assert read["deliveredAt"] == delivered["deliveredAt"] and read["readAt"]

    def private(author, recipient, text):
        return site.json("/inbox/" + recipient, author, {"text": text, "nonce": uuid.uuid4().hex})["msg"]

    def await_bell(query):
        deadline = time.monotonic() + 15
        while not site.db.notify.find_one(query):
            assert time.monotonic() < deadline, f"Missing notification for {query}"
            time.sleep(.1)

    dm_alert = {"notifies": bob, "content.user": alice, "content.thread": {"$exists": False}}
    new_direct = private(alice, bob, "Direct alert while away")
    await_bell({**dm_alert, "content.text": new_direct["text"], "read": False})
    site.json("/inbox/" + alice + "/receipt", bob, {"ids": new_direct["id"], "read": "true"})
    assert site.db.notify.find_one({**dm_alert, "content.text": new_direct["text"]})["read"]
    site.call("/inbox/settings/organize", bob, {"chat": alice, "action": "mute", "value": "true"})
    muted_direct = private(alice, bob, "Muted direct alert")
    control = private(alice, subscriber, "Direct alert control")
    await_bell({"notifies": subscriber, "content.text": control["text"]})
    assert not site.db.notify.find_one({**dm_alert, "content.text": muted_direct["text"]})

    message = post(alice, f"Hello @{bob} and @{quiet}")
    followup = post(alice, "Everyone can read this.")
    assert site.json(preview)["msgs"][0]["id"] == followup["id"]
    assert not {"audience", "history", "requestDigest", "reads"} & site.json(preview)["msgs"][0].keys()
    note = {"content.messageId": message["id"]}
    expected = {bob, subscriber}
    deadline = time.monotonic() + 15
    while {n["notifies"] for n in site.db.notify.find(note)} != expected:
        assert time.monotonic() < deadline, "Global mentions and explicit subscriptions must honor preferences"
        time.sleep(.1)
    site.json(path + "/receipt", bob, {"ids": message["id"], "read": "true"})
    assert site.db.notify.find_one({**note, "notifies": bob})["read"]
    await_bell({"notifies": subscriber, "content.messageId": followup["id"]})
    assert not site.db.notify.find_one({"notifies": {"$in": [bob, quiet]}, "content.messageId": followup["id"]})
    active_read = post(alice, f"Already here @{bob}")
    site.json(path + "/receipt", bob, {"ids": active_read["id"], "read": "true"})
    await_bell({"notifies": subscriber, "content.messageId": active_read["id"]})
    assert not site.db.notify.find_one({"notifies": bob, "content.messageId": active_read["id"]})

    edit(bob, message, "edit", "someone else's edit", 400)
    edit(bob, message, "deleteEveryone", status=400)
    edit("globalmodbasic", message, "deleteEveryone", status=400)
    edit(moderator, message, "edit", "moderator edit", 400)
    edit(alice, message, "edit", "Updated opening")
    assert not site.db.notify.find_one(note)
    current = next(m for m in site.json(path, bob)["convo"]["msgs"] if m["id"] == message["id"])
    assert current["revision"] == 1 and current["text"] == "Updated opening"
    site.db.msg_msg.update_one({"_id": current["id"]}, {"$set": {"date": datetime.now(timezone.utc) - timedelta(days=2)}})
    edit(alice, current, "deleteEveryone", status=400)
    edit(moderator, current, "deleteEveryone")
    edit(alice, followup, "deleteEveryone")
    assert all(m["id"] != current["id"] for m in site.json(preview)["msgs"])
    assert site.db.msg_msg.find_one({"_id": current["id"]})["deletedAt"]

    from worker import now
    site.db.ugc_scanner.update_one({"_id": "worker"}, {"$set": {"at": now()}})
    media = "/attachment/msg/" + room
    assert site.json(media + "/policy", bob)["enabled"]
    handle = site.json(media + "/upload", bob, data=b"Global notes", name="notes.txt", status=201)["id"]
    site.call("/attachment/msg/item/" + handle, status=404)
    site.screen_document()
    payload = {"text": "", "attachments": handle, "nonce": uuid.uuid4().hex, "replyTo": active_read["id"]}
    rich = site.json(path, bob, payload)["msg"]
    assert rich["reply"]["id"] == active_read["id"] and rich["attachments"] == [handle]
    assert site.json(path, bob, payload)["msg"]["id"] == rich["id"]
    assert site.call("/attachment/msg/item/" + handle)[0] == b"Global notes"
    copy = site.json("/inbox/" + alice, quiet, {
        "text": "", "forwardUser": room, "forwardId": rich["id"], "nonce": uuid.uuid4().hex,
    })["msg"]
    assert copy["forwarded"] and copy["attachments"] != [handle]
    site.call("/attachment/msg/item/" + copy["attachments"][0], status=404)
    forwarded = site.json(path, alice, {
        "text": "", "forwardUser": quiet, "forwardId": copy["id"], "nonce": uuid.uuid4().hex,
    })["msg"]
    assert site.call("/attachment/msg/item/" + forwarded["attachments"][0])[0] == b"Global notes"
    edit(quiet, rich, "react", "👍")
    assert next(m for m in site.json(preview)["msgs"] if m["id"] == rich["id"])["reactions"] == {"👍": 1}
    assert [handle] in [m["attachments"] for m in site.json("/inbox/history/" + room + "?files=true", quiet)["msgs"]]
    updated = next(m for m in site.json(path, bob)["convo"]["msgs"] if m["id"] == rich["id"])
    edit(bob, updated, "deleteEveryone")
    site.call("/attachment/msg/item/" + handle, status=404)

    for n in range(13):
        post(alice, f"Post {n}" if n < 12 else "Long text " * 100)
    _, headers = site.call(preview)
    assert headers.get("ETag") and headers.get("Cache-Control") == "public, max-age=3"
    site.call(preview, extra_headers={"If-None-Match": headers["ETag"]}, status=304)
    assert len(site.json(preview)["msgs"][0]["text"]) < 330
    assert len(site.json(preview)["msgs"]) == 12
    assert len(site.json(path, quiet)["convo"]["msgs"]) > 12
    assert not site.db.msg_group.find_one({"_id": room})
