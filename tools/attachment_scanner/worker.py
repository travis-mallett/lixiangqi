"""One bounded worker process. A claimed job survives restarts. No publication side effects."""
import hashlib
import io
import logging
import os
import time
import uuid
from datetime import datetime, timedelta, timezone

from PIL import Image
from pymongo import MongoClient, ReturnDocument

from screen import POLICY, Rejected, Restricted, screen, post_json


def now():
    return datetime.now(timezone.utc)


def claim(coll):
    at = now()
    return coll.find_one_and_update(
        {"state": "checking", "policy": POLICY, "nextCheck": {"$lte": at}, "hold": {"$ne": True}},
        {"$set": {"lease": uuid.uuid4().hex, "nextCheck": at + timedelta(minutes=4)}},
        sort=[("nextCheck", 1)], return_document=ReturnDocument.AFTER,
    )


def finish(coll, row):
    at = now()
    try:
        checked = screen(row)
        values = {"state": "blocked" if checked.reason else "ready", "bytes": checked.data,
                  "size": len(checked.data), "mime": checked.mime, "detectors": checked.detectors,
                  "digest": hashlib.sha256(checked.data).hexdigest(), "reason": checked.reason}
    except Restricted:
        values = {"state": "restricted", "hold": True, "reason": "restricted", "urgent": True}
    except Rejected as exc:
        values = {"state": "blocked", "reason": str(exc), "bytes": b""}
    except Exception as exc:
        logging.warning("screening unavailable (%s)", type(exc).__name__)
        values = {"state": "retry", "reason": "scannerUnavailable"}
    selector = {"_id": row["_id"], "state": "checking", "lease": row["lease"],
                "sourceDigest": row["sourceDigest"], "policy": POLICY}
    return coll.update_one(selector, {"$set": {**values, "checkedAt": at}, "$unset": {"lease": ""}}).modified_count and values["state"]


def referenced(db, row):
    parent = row.get("parent")
    if not parent:
        return False
    surface, _, dest = row["audience"].partition("/")
    if surface == "msg":
        return db.msg_msg.find_one({"_id": parent, "attachments": row["_id"], "deletedAt": {"$exists": False},
                                    "$expr": {"$lt": [{"$size": {"$ifNull": ["$del", []]}}, 2]}}, {"_id": 1})
    if surface == "forum":
        return db.f_post.find_one({"_id": parent, "attachments": row["_id"], "erasedAt": {"$exists": False}}, {"_id": 1})
    raise ValueError("unknown surface")


def cleanup(db):
    at = now()
    for row in db.ugc_attachment.find({"expiresAt": {"$lt": at}, "hold": {"$ne": True}}, {"bytes": 0}).limit(100):
        sel = {"_id": row["_id"], "expiresAt": row["expiresAt"], "hold": {"$ne": True},
               "$or": [{"evidenceUntil": {"$exists": False}}, {"evidenceUntil": {"$lte": at}}]}
        if referenced(db, row):
            db.ugc_attachment.update_one(sel, {"$set": {"expiresAt": at + timedelta(days=1)}})
        else:
            db.ugc_attachment.delete_one(sel)


def alert(db, kind, item=None):
    # Only opaque IDs leave the server. Persist delivery state and retry failed notifications.
    key = item or kind
    db.ugc_alert.update_one({"_id": key}, {"$setOnInsert": {"kind": kind, "at": now(), "sent": False}}, upsert=True)


def check_services():
    # A small synthetic board square exercises decode, clamd and both detectors while the queue is empty.
    image = io.BytesIO()
    Image.new("RGB", (32, 32), (46, 102, 71)).save(image, format="PNG")
    data = image.getvalue()
    try:
        return screen({"name": "probe.png", "bytes": data, "sourceDigest": hashlib.sha256(data).hexdigest()}).reason is None
    except Exception as exc:
        logging.error("screening probe failed (%s)", type(exc).__name__)
        return False


def vault_restricted(db, vault):
    for row in db.ugc_attachment.find({"state": "restricted", "vaulted": {"$ne": True}}).limit(4):
        # A crash between these writes replays the same idempotent copy. The item is already unreadable.
        vault.update_one({"_id": row["_id"], "sourceDigest": row["sourceDigest"]}, {"$setOnInsert": {
            "owner": row["owner"], "at": row["checkedAt"], "sourceDigest": row["sourceDigest"],
            "policy": row["policy"], "original": row["bytes"]}}, upsert=True)
        db.ugc_attachment.update_one({"_id": row["_id"], "state": "restricted", "sourceDigest": row["sourceDigest"]},
            {"$set": {"vaulted": True}, "$unset": {"bytes": ""}})


def main():
    db = MongoClient(os.environ["UGC_MONGO"], serverSelectionTimeoutMS=5000).get_default_database()
    coll = db.ugc_attachment
    coll.create_index([("state", 1), ("policy", 1), ("nextCheck", 1)])
    coll.create_index("expiresAt")
    db.ugc_evidence.create_index('expiresAt', expireAfterSeconds=0)
    coll.create_index([("owner", 1), ("audience", 1)])
    coll.create_index("audience")
    vault_uri = os.getenv('UGC_RESTRICTED_MONGO')
    vault = MongoClient(vault_uri, serverSelectionTimeoutMS=5000).get_default_database().restricted_evidence if vault_uri else None
    last = next_probe = 0
    services_ok = False
    while True:
        try:
            configured = all(os.getenv(key) for key in ("UGC_CLAMD_SOCKET", "UGC_CHILD_URL", "UGC_CHILD_TOKEN", "UGC_OPENAI_KEY", "UGC_ALERT_URL", "UGC_ALERT_TOKEN", "UGC_RESTRICTED_MONGO"))
            if configured and time.monotonic() >= next_probe:
                services_ok = check_services()
                next_probe = time.monotonic() + (3600 if services_ok else 120)
            if time.monotonic() - last >= 15:
                stalled = coll.find_one({"state": "checking", "createdAt": {"$lt": now() - timedelta(minutes=10)}}, {"_id": 1}) is not None
                broken = coll.find_one({"state": "retry", "checkedAt": {"$gt": now() - timedelta(minutes=2)}}, {"_id": 1}) is not None
                db.ugc_scanner.update_one({"_id": "worker"}, {"$set": {"policy": POLICY, "at": now(), "healthy": bool(configured) and services_ok and not stalled and not broken,
                    "status": "disabled" if not configured else "stalled" if stalled else "error" if broken or not services_ok else "running"}}, upsert=True)
                if stalled or broken or (configured and not services_ok):
                    alert(db, "backlog-" + now().strftime("%Y%m%d%H"))
                for row in coll.find({"urgent": True}, {"_id": 1}).limit(10):
                    alert(db, "restricted", row["_id"])
                    coll.update_one({"_id": row["_id"]}, {"$unset": {"urgent": ""}})
                cleanup(db)
                if vault is not None:
                    vault_restricted(db, vault)
                if configured:
                    for event in db.ugc_alert.find({"sent": False}).limit(4):
                        response = post_json(os.environ["UGC_ALERT_URL"], os.environ["UGC_ALERT_TOKEN"], {"case": event["_id"], "kind": event["kind"]})
                        if isinstance(response, dict) and response.get("accepted") is True:
                            db.ugc_alert.update_one({"_id": event["_id"]}, {"$set": {"sent": True}})
                last = time.monotonic()
            row = claim(coll) if configured and services_ok else None
            if row:
                state = finish(coll, row)
                if state:
                    db.ugc_outcome.update_one({"_id": now().strftime("%Y-%m-%d") + "/" + POLICY + "/" + state},
                                              {"$inc": {"count": 1}}, upsert=True)
            else:
                time.sleep(2)
        except Exception as exc:
            logging.error("worker unavailable (%s)", type(exc).__name__)
            time.sleep(5)


if __name__ == "__main__":
    main()
