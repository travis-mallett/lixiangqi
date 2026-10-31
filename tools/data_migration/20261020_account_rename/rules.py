"""Typed, deliberately one-account conversion rules. Unknown references block execution."""

from copy import deepcopy
from dataclasses import dataclass
from decimal import Decimal
import hashlib
import json
import re
from urllib.parse import urlsplit, urlunsplit


@dataclass(frozen=True)
class Identity:
    old: str = "testing"
    new: str = "chinesechessoutloud"
    display: str = "ChineseChessOutLoud"


IDENTITY = Identity()
MIGRATION = "20261020-testing-to-chinesechessoutloud-v1"

# Historical evidence is intentionally immutable, including external publisher request
# bodies whose digests are part of the publication protocol.
ARCHIVE_NAMES = {
    "__official_blogs_v1_backup",
    "__lixiangqi_migrations",
    "__lixiangqi_puzzle_playback_v1_backup",
    "__lixiangqi_puzzle_playback_v1_plans",
    "__lixiangqi_puzzle_publication_v1_backup",
    "__lixiangqi_puzzle_publication_v1_plans",
    "tournament2_pre_native_xiangqi_v1",
    "tournament_player_pre_native_xiangqi_v1",
    "user4_ranked_count_pre_native_xiangqi_v1",
    "user_perf_pre_native_xiangqi_v1",
    "ranking_pre_native_xiangqi_v1",
    "seek_pre_native_xiangqi_v1",
    "seek_archive_pre_native_xiangqi_v1",
    "puzzle2_publication",
}


def archived(name):
    return name in ARCHIVE_NAMES or bool(
        re.fullmatch(r"__lixiangqi_game_completion_backup_[a-f0-9]+", name)
    )


# Dot paths traverse arrays automatically. '*' means a BSON map, not arbitrary recursion.
FIELDS = {
    "user4": ("username",),
    "game5": ("us", "pl", "wid", "pgni.user"),
    "activity2": ("f.i.ids", "f.o.ids"),
    "eval_cache2": ("evals.by",),
    "fishnet_analysis": ("sender.userId",),
    "modlog": ("mod", "user"),
    "msg_msg": ("user",),
    "msg_thread": ("users", "del", "maskFor", "lastMsg.user", "maskWith.user"),
    "notify": (
        "notifies", "content.opponentId", "content.user", "content.userId",
        "content.invitedBy", "content.mentionedBy", "content.streamerId",
    ),
    "oauth2_access_token": ("userId",),
    "oauth2_authorization": ("userId",),
    "perf_stat": ("userId", "bestWins.results.opId", "worstLosses.results.opId"),
    "picfit_image": ("user",),
    "plan_charge": ("userId", "giftTo"),
    "plan_patron": ("free.by",),
    "player_assessment": ("userId",),
    "push_subscription": ("userId",),
    "push_device": ("userId",),
    "push_unifiedpush": ("userId",),
    "puzzle2_round": ("u",),
    "relation": ("u1", "u2"),
    "relation_subs": ("u", "s"),
    "security": ("user",),
    "study": ("ownerId", "uids", "likers"),
    "study_chapter_flat": ("ownerId",),
    "timeline_entry": ("users", "data.userId", "data.opponent", "data.u1", "data.u2"),
    "ublog_post": (
        "created.by", "updated.by", "lived.by", "featured.by",
        "automod.lockedBy", "likers",
    ),
    "video": ("createdBy", "updatedBy"),
    "video_view": ("u",),
    "bookmark": ("u",),
    "note": ("from", "to"),
    "team_member": ("user",),
    "team_request": ("user",),
    "tournament2": ("createdBy", "winner"),
    "tournament_player": ("uid",),
    "tournament_pairing": ("u",),
    "tournament_leaderboard": ("u",),
}
USER_IDS = {
    "user4", "user_perf", "history4", "pref", "notify_pref", "learn_progress",
    "notation_score", "analysis_requester", "plan_patron", "playban", "shutup",
    "study_user_topic", "coach", "streamer",
}
PREFIX_IDS = {
    "activity2": ":", "puzzle2_round": ":", "puzzle2_kids_rewards": ":",
    "perf_stat": "/", "storm_day": ":", "ranking": ":",
    "team_member": "@", "team_request": "@",
}

# Only these prose/provider fields may retain the old spelling. New unclassified
# occurrences fail closed. In particular, credentials are never recursively rewritten.
PROSE = {
    "user4": {
        "profile.links", "profile.bio", "profile.realName", "profile.location",
        "externalLogins[]",
    },
    "modlog": {"details"},
    "msg_msg": {"text"},
    "msg_thread": {"lastMsg.text", "maskWith.text"},
    "notify": {"content.text", "content.topicName", "content.studyName"},
    "study": {"name"},
    "study_chapter_flat": {"name"},
    "ublog_post": {"title", "intro", "markdown", "image.alt", "image.credit"},
    "ublog_blog": {"modNote"},
    "note": {"text"},
    "video": {"title", "description"},
}


def occurrences(value, needle="testing", path=""):
    """Return paths only: never include message bodies, credentials, or tokens."""
    if isinstance(value, dict):
        for key, child in value.items():
            here = f"{path}.{key}" if path else key
            if needle.lower() in key.lower():
                yield here + ".<key>"
            yield from occurrences(child, needle, here)
    elif isinstance(value, list):
        for child in value:
            yield from occurrences(child, needle, path + "[]")
    elif isinstance(value, str) and needle.lower() in value.lower():
        yield path


def edit_path(value, parts, change):
    if not parts:
        if isinstance(value, list):
            return [change(item) for item in value]
        return change(value)
    if isinstance(value, list):
        return [edit_path(item, parts, change) for item in value]
    if not isinstance(value, dict):
        return value
    key, *rest = parts
    for field in list(value) if key == "*" else [key]:
        if field in value:
            value[field] = edit_path(value[field], rest, change)
    return value


def pair_key(value, identity, sort=False):
    if not isinstance(value, str):
        return value
    parts = value.split("/")
    if identity.old not in parts:
        return value
    if len(parts) != 2 or any(not p for p in parts):
        raise ValueError("Malformed two-user record ID")
    parts = [identity.new if p == identity.old else p for p in parts]
    if len(set(parts)) != 2:
        raise ValueError("Rename would collapse two users")
    return "/".join(sorted(parts) if sort else parts)


def profile_url(value, identity):
    if not isinstance(value, str):
        return value
    parsed = urlsplit(value)
    if parsed.netloc and parsed.netloc.lower() != "lixiangqi.com":
        return value
    prefix = f"/@/{identity.old}"
    if parsed.path == prefix or parsed.path.startswith(prefix + "/"):
        return urlunsplit(parsed._replace(path=f"/@/{identity.display}" + parsed.path[len(prefix):]))
    return value


def chapter_comments(value, identity):
    if isinstance(value, dict):
        # This shape is owned by study's Comment.Author BSON handler.
        author = value.get("by")
        if isinstance(author, dict) and author.get("kind") == "user" and author.get("id") == identity.old:
            author["id"] = identity.new
            name = author.get("name")
            if not isinstance(name, str):
                raise ValueError("Study author lacks display name")
            if name.split(" ")[-1].lower() != identity.old:
                raise ValueError("Unexpected study author display name")
            author["name"] = name[:-len(identity.old)] + identity.display
        for child in value.values():
            chapter_comments(child, identity)
    elif isinstance(value, list):
        for child in value:
            chapter_comments(child, identity)


def chat_line(line, identity):
    if not isinstance(line, str):
        raise ValueError("Non-string chat line")
    match = re.fullmatch(r"([\w~-]{2,})([ !?&:;])(.*)", line, re.DOTALL)
    if match:
        author, separator, text = match.groups()
        title, sep, name = author.rpartition("~")
        if name.lower() == identity.old:
            return (title + sep if sep else "") + identity.display + separator + text
    elif re.match(rf"^(?:[\w-]+~)?{re.escape(identity.old)}(?:\W|$)", line, re.IGNORECASE):
        raise ValueError("Unrecognized chat encoding for source author")
    return line


def puzzle_digest(doc):
    # Match PuzzlePublicationJson.authored/canonical, including managed themes and
    # plain decimal numbers. Runtime community votes/themes are outside this hash.
    fields = {
        "_id", "gameId", "gameSource", "fen", "line", "themes", "retired",
        "retirementReason", "sourceSnapshot", "playback",
    }
    authored = {k: v for k, v in doc.items() if k in fields}
    authored["themes"] = doc.get("managedThemes", doc.get("themes", []))
    authored.setdefault("retirementReason", None)

    def canonical(value):
        if isinstance(value, dict):
            return "{" + ",".join(
                json.dumps(k, ensure_ascii=False) + ":" + canonical(value[k]) for k in sorted(value)
            ) + "}"
        if isinstance(value, list):
            return "[" + ",".join(map(canonical, value)) + "]"
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            number = Decimal(str(value))
            if not number.is_finite():
                raise ValueError("Non-finite puzzle authored number")
            return format(number.normalize(), "f")
        return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))

    return hashlib.sha256(canonical(authored).encode()).hexdigest()


def transform(collection, original, identity=IDENTITY):
    doc = deepcopy(original)
    replace = lambda v: identity.new if v == identity.old else v
    for path in FIELDS.get(collection, ()):
        edit_path(doc, path.split("."), replace)
    old_id = doc["_id"]
    if collection in USER_IDS:
        doc["_id"] = replace(old_id)
    if collection in PREFIX_IDS and isinstance(old_id, str):
        prefix = identity.old + PREFIX_IDS[collection]
        if old_id.startswith(prefix):
            doc["_id"] = identity.new + old_id[len(identity.old):]
    if collection in {"bookmark", "game_note"} and isinstance(old_id, str):
        if old_id[8:] == identity.old:
            doc["_id"] = old_id[:8] + identity.new
    if collection == "ai_challenge_stats" and isinstance(old_id, str):
        prefix = f"user/{identity.old}/"
        if old_id.startswith(prefix):
            doc["_id"] = f"user/{identity.new}/" + old_id[len(prefix):]
    if collection == "cache" and old_id == f"game:imported:{identity.old}":
        doc["_id"] = f"game:imported:{identity.new}"
    if collection in {"crosstable2", "matchup", "msg_thread"}:
        doc["_id"] = pair_key(old_id, identity, sort=True)
    if collection in {"relation", "relation_subs"}:
        doc["_id"] = pair_key(old_id, identity)
    if collection == "msg_msg":
        doc["tid"] = pair_key(doc["tid"], identity, sort=True)
    if collection in {"video_view", "directory_player_follower"} and isinstance(old_id, str):
        prefix, sep, user = old_id.rpartition("/")
        if sep and user == identity.old:
            doc["_id"] = prefix + "/" + identity.new
    if collection == "ublog_blog" and old_id == f"user:{identity.old}":
        doc["_id"] = f"user:{identity.new}"
    if collection == "ublog_post" and doc.get("blog") == f"user:{identity.old}":
        doc["blog"] = f"user:{identity.new}"
    if collection == "user4" and original["_id"] == identity.old:
        if original.get("username", "").lower() != identity.old:
            raise ValueError("Account ID/display name mismatch")
        doc["username"] = identity.display
    if collection == "security" and original.get("user") == identity.old:
        doc["up"] = False
    if collection == "msg_thread" and doc != original:
        doc["users"] = sorted(doc["users"])
        if "/".join(doc["users"]) != doc["_id"]:
            raise ValueError("Message thread ID/users disagree")
    if collection in {"crosstable2", "matchup"} and doc["_id"] != old_id:
        a, b = old_id.split("/")
        if a >= b:
            raise ValueError("Unsorted source crosstable")
        if replace(a) > replace(b):
            # Missing scores mean zero, but retain the original presence/absence.
            a_score, b_score = doc.pop("s1", None), doc.pop("s2", None)
            if a_score is not None:
                doc["s2"] = a_score
            if b_score is not None:
                doc["s1"] = b_score
            if collection == "crosstable2":
                def flip(result):
                    if not isinstance(result, str) or not re.fullmatch(r"[a-zA-Z0-9]{8}[-=]?", result):
                        raise ValueError("Malformed crosstable result")
                    return result if result.endswith("=") else (
                        result[:-1] if result.endswith("-") else result + "-"
                    )
                doc["r"] = [flip(r) for r in doc.get("r", [])]
    if collection == "study":
        members = doc.get("members", {})
        if identity.old in members:
            if identity.new in members:
                raise ValueError("Destination study member already exists")
            members[identity.new] = members.pop(identity.old)
    if collection == "study_chapter_flat":
        chapter_comments(doc.get("root", {}), identity)
    if collection == "chat":
        doc["l"] = [chat_line(line, identity) for line in doc.get("l", [])]
    if collection == "picfit_image" and "context" in doc:
        doc["context"] = profile_url(doc["context"], identity)
    if collection == "puzzle2_puzzle":
        for player in doc.get("sourceSnapshot", {}).get("players", []):
            if player.get("userId") == identity.old:
                source = doc.get("gameSource", {})
                if source.get("type") != "native" or source.get("origin") != "https://lixiangqi.com":
                    raise ValueError("Ambiguous puzzle source identity")
                player["userId"] = identity.new
                if player.get("name", "").lower() == identity.old:
                    player["name"] = identity.display
        if doc != original and "contentDigest" in original:
            if puzzle_digest(original) != original["contentDigest"]:
                raise ValueError("Existing puzzle authored digest mismatch")
            doc["contentDigest"] = puzzle_digest(doc)
    return doc


def unexplained(collection, doc, identity=IDENTITY):
    allowed = PROSE.get(collection, set())
    for path in occurrences(doc, identity.old):
        if path in allowed:
            continue
        if collection == "chat" and path == "l[]":
            # Only message text may retain the spelling; an unconverted author blocks.
            if any(chat_line(line, identity) != line for line in doc["l"]):
                yield path
            continue
        if collection == "study_chapter_flat" and path.endswith(".co[].text"):
            continue
        yield path
