"""Registration and profile-picture HTTP contracts against the isolated site."""
import os
import secrets
import uuid
from unittest.mock import patch

import screen
import worker
from test_scanner import general, png


def multipart(fields, photo):
    boundary = uuid.uuid4().hex
    parts = [
        f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode()
        for key, value in fields.items()
    ]
    parts.extend([
        (f'--{boundary}\r\nContent-Disposition: form-data; name="picture"; filename="photo.png"\r\n'
         'Content-Type: image/png\r\n\r\n').encode(),
        photo,
        f'\r\n--{boundary}--\r\n'.encode(),
    ])
    return b''.join(parts), {"Content-Type": "multipart/form-data; boundary=" + boundary}


def verify_profile_pictures(site):
    alice = site.user("pictureowner")
    bob = site.user("picturevisitor")
    site.db.oauth2_access_token.update_many(
        {"userId": {"$in": [alice, bob]}}, {"$addToSet": {"scopes": "preference:write"}}
    )
    upload = "/account/profile/picture"

    def stage(photo):
        return site.json(upload, alice, data=photo, status=202)["id"]

    def verdict(expected, flagged=False):
        with (
            patch.object(screen, "malware", return_value="test-signatures"),
            patch.dict(os.environ, {"UGC_OPENAI_KEY": "test", "UGC_CLAMD_SOCKET": "test"}),
            patch.object(screen, "post_json", return_value=general(flagged)),
        ):
            row = worker.claim(site.db.ugc_attachment)
            assert row and worker.finish(site.db.ugc_attachment, row) == expected

    health = site.db.ugc_scanner
    health.update_one(
        {"_id": "worker"}, {"$set": {"at": worker.now(), "healthy": False, "policy": screen.POLICY}}, upsert=True
    )
    assert site.json(upload, alice, data=png(), status=422)["error"] == "profilePictureUnavailable"
    health.update_one({"_id": "worker"}, {"$set": {"healthy": True}})
    # Exercise an image larger than the regular attachment limit at both upload entry points.
    large_photo = png() + bytes(5 * 1024 * 1024)
    first = stage(large_photo)
    path = "/profile/picture/" + first
    site.call(path, status=404)
    site.call(upload + "/" + first, bob, status=404)
    assert site.json(upload + "/" + first, alice)["state"] == "checking"
    verdict("ready")
    content, headers = site.call(path)
    assert headers["Content-Type"] == "image/webp" and content[:4] == b"RIFF"
    assert site.json("/api/user/" + alice)["picture"] == path
    users = site.json("/api/users", data=alice.encode(), extra_headers={"Content-Type": "text/plain"})
    assert users[0]["picture"] == path

    rejected = stage(png())
    verdict("blocked", flagged=True)
    site.call("/profile/picture/" + rejected, status=404)
    assert site.call(path)[0] == content
    replacement = stage(png())
    verdict("ready")
    site.call(path, status=404)
    site.call("/profile/picture/" + replacement)
    site.db.user4.update_one({"_id": alice}, {"$set": {"kid": True}})
    site.call("/profile/picture/" + replacement, status=404)
    site.call(upload, alice, data=png(), status=403)

    body, headers = multipart({}, png())
    invalid = site.json("/api/mobile/auth/register", data=body, extra_headers=headers, status=400)
    assert invalid["error"] == "validation_error" and "username" in invalid["fields"]

    origin = f"http://127.0.0.1:{site.port}"
    fields = {
        "username": "WillowRiver",
        "email": "willow.fixture@gmail.com",
        "password": "fixture-" + secrets.token_hex(12),
        "country.optOut": "true",
        **{"agreement." + key: "true" for key in ("assistance", "nice", "account")},
    }
    body, headers = multipart(fields, large_photo)
    site.call("/signup", data=body, extra_headers={**headers, "Origin": origin, "Accept": "text/html"},
              status=(302, 303))
    account = site.db.user4.find_one({"_id": "willowriver"})
    pending = account["pendingPicture"]
    site.call("/profile/picture/" + pending, status=404)
    verdict("ready")
    assert site.json("/api/user/willowriver")["picture"] == "/profile/picture/" + pending
