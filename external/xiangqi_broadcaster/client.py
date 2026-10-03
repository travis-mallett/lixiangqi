"""The server owns parsing, validation, synchronization and broadcast delays."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

MAX_BYTES = 2_000_000


def destination(value: str) -> tuple[str, str]:
    parsed = urlsplit(value.strip())
    if parsed.scheme == "lixiangqi-broadcaster":
        if parsed.netloc != "open" or parsed.path or parsed.fragment:
            raise ValueError("Invalid broadcaster link")
        query = parse_qs(parsed.query, strict_parsing=True)
        if set(query) != {"url"} or len(query["url"]) != 1:
            raise ValueError("Invalid broadcaster destination")
        parsed = urlsplit(query["url"][0])
    local = parsed.hostname in {"127.0.0.1", "localhost", "::1"}
    if parsed.scheme != "https" and not (local and parsed.scheme == "http"):
        raise ValueError("Use an HTTPS round URL (HTTP is allowed only for local verification)")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("The round URL must not include credentials, query parameters or a fragment")
    match = re.fullmatch(r"/broadcast/[^/]+/[^/]+/([A-Za-z0-9]{8})/?", parsed.path)
    if not match or not parsed.hostname:
        raise ValueError("Use the complete broadcast round URL")
    return f"{parsed.scheme}://{parsed.netloc}", match[1]


def snapshot(paths: list[Path]) -> bytes:
    if not paths:
        raise ValueError("Select one or more Xiangqi score files")
    chunks: list[bytes] = []
    size = 0
    for path in paths:
        before = path.stat()
        if not path.is_file() or before.st_size > MAX_BYTES:
            raise ValueError(f"Invalid or oversized score file: {path.name}")
        with path.open("rb") as source:
            raw = source.read(MAX_BYTES + 1)
        after = path.stat()
        if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            raise ValueError(f"Waiting for the writer to finish: {path.name}")
        text = raw.decode("utf-8-sig").strip()
        if not text:
            raise ValueError(f"Score file is empty: {path.name}")
        chunk = text.encode("utf-8")
        size += len(chunk) + 2
        if size > MAX_BYTES:
            raise ValueError("Combined score files exceed the 2 MB upload limit")
        chunks.append(chunk)
    return b"\n\n".join(chunks)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # A bearer token must never follow a redirect to another destination.
        return None


class Broadcaster:
    def __init__(self, round_url: str, token: str, paths: list[Path]):
        self.origin, self.round_id = destination(round_url)
        if not token or any(c.isspace() for c in token):
            raise ValueError("Enter an access token with study:write permission")
        self.token, self.paths = token, paths
        self._accepted: bytes | None = None
        local = urlsplit(self.origin).hostname in {"127.0.0.1", "localhost", "::1"}
        self._opener = build_opener(NoRedirect(), *([ProxyHandler({})] if local else []))

    def tick(self) -> int | None:
        payload = snapshot(self.paths)
        digest = hashlib.sha256(payload).digest()
        if digest == self._accepted:
            return None
        request = Request(
            f"{self.origin}/api/broadcast/round/{self.round_id}/push",
            data=payload,
            headers={
                "Authorization": f"Bearer {self.token}",
                "Content-Type": "text/plain; charset=utf-8",
                "Accept": "application/json",
                "User-Agent": "Lixiangqi Broadcaster/1.0",
            },
        )
        try:
            with self._opener.open(request, timeout=20) as response:
                result = json.load(response)
        except HTTPError as error:
            detail = error.read(16_000).decode("utf-8", errors="replace")
            raise ValueError(f"Upload failed (HTTP {error.code}): {detail}") from error
        games = result.get("games") if isinstance(result, dict) else result
        if not isinstance(games, list) or not games:
            raise ValueError("The server did not acknowledge any games")
        errors = [g.get("error") for g in games if isinstance(g, dict) and g.get("error")]
        if errors:
            raise ValueError("\n".join(str(error) for error in errors))
        if not all(isinstance(g, dict) and isinstance(g.get("moves"), int) for g in games):
            raise ValueError("Invalid server acknowledgement")
        self._accepted = digest
        return len(games)
