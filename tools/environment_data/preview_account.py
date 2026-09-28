"""Repeatable credentials for the disposable, loopback-only preview database."""

import argparse
import base64
from datetime import datetime, UTC
import hashlib
from pathlib import Path
import subprocess
from uuid import uuid4
from .snapshot import PREVIEW_DATABASE, PREVIEW_URI

USERNAME = "testing123"
PASSWORD = "testing123"
# Public fixture credential, not a production secret. Never use outside preview.
TOKEN = "lip_" + hashlib.sha256(b"lixiangqi-local-preview-testing123").hexdigest()[:32]
ROLES = ["ROLE_ADMIN", "ROLE_PUZZLE_CURATOR"]


def provision(database, password_hash, backup_dir):
    from bson import Binary, json_util

    if database.name != PREVIEW_DATABASE:
        raise ValueError("Test accounts may only be installed in lixiangqi_preview")
    if len(password_hash) != 39:
        raise ValueError("Invalid application password hash")
    token_id = hashlib.sha256(TOKEN.encode()).hexdigest()
    previous = database.user4.find_one({"_id": USERNAME})
    previous_token = database.oauth2_access_token.find_one({"_id": token_id})
    backup_dir = Path(backup_dir)
    backup_dir.mkdir(parents=True, exist_ok=True)
    backup = backup_dir / (uuid4().hex + ".json")
    with backup.open("x", encoding="utf-8") as stream:
        stream.write(
            json_util.dumps(
                {
                    "database": PREVIEW_DATABASE,
                    "user": previous,
                    "token": previous_token,
                }
            )
        )
        stream.flush()
        import os

        os.fsync(stream.fileno())
    now = datetime.now(UTC)
    database.user4.update_one(
        {"_id": USERNAME},
        {
            "$set": {
                "username": USERNAME,
                "enabled": True,
                "roles": ROLES,
                "bpass": Binary(password_hash),
                "email": "testing123@preview.invalid",
            },
            "$unset": {
                k: ""
                for k in [
                    "mustConfirmEmail",
                    "totp",
                    "salt",
                    "sha512",
                    "marks",
                    "delete",
                    "foreverClosed",
                ]
            },
            "$setOnInsert": {
                "createdAt": now,
                "count": {k: 0 for k in ["draw", "game", "loss", "rated", "win"]},
            },
        },
        upsert=True,
    )
    database.oauth2_access_token.replace_one(
        {"_id": token_id},
        {
            "_id": token_id,
            "plain": TOKEN,
            "userId": USERNAME,
            "created": now,
            "description": "Disposable preview puzzle publishing",
            "scopes": ["puzzle:publish"],
        },
        upsert=True,
    )
    user = database.user4.find_one({"_id": USERNAME})
    token = database.oauth2_access_token.find_one({"_id": token_id})
    if (
        not user
        or user["roles"] != ROLES
        or bytes(user["bpass"]) != password_hash
        or not user["enabled"]
        or token["plain"] != TOKEN
        or token["scopes"] != ["puzzle:publish"]
    ):
        raise ValueError(
            "Preview account verification failed; previous documents retained in "
            + str(backup)
        )
    return backup


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--java", required=True, type=Path)
    parser.add_argument("--classpath", required=True)
    parser.add_argument("--backup-dir", required=True, type=Path)
    args = parser.parse_args()
    result = subprocess.run(
        [
            str(args.java),
            "--class-path",
            args.classpath,
            str(Path(__file__).with_name("PreviewPassword.java")),
        ],
        check=True,
        input=PASSWORD,
        capture_output=True,
        text=True,
    )
    password_hash = base64.b64decode(result.stdout.strip(), validate=True)
    from pymongo import MongoClient

    with MongoClient(PREVIEW_URI, serverSelectionTimeoutMS=5000) as client:
        provision(client[PREVIEW_DATABASE], password_hash, args.backup_dir)
    print(
        "Preview account ready: testing123 / testing123; admin and puzzle publishing enabled."
    )


if __name__ == "__main__":
    main()
