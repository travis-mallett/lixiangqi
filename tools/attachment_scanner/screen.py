"""Bounded, fail-closed checks for one privately staged upload."""
import base64
import hashlib
import io
import json
import math
import os
import re
import socket
import struct
import subprocess
import video
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageOps, ImageSequence, UnidentifiedImageError

POLICY = "ugc-1"
MODEL = "omni-moderation-latest"
LIMIT = 4 * 1024 * 1024
MAX_PIXELS = 12_000_000
Image.MAX_IMAGE_PIXELS = MAX_PIXELS
IMAGE_TYPES = {".jpg": "JPEG", ".jpeg": "JPEG", ".png": "PNG", ".webp": "WEBP"}


class Rejected(Exception):
    """A deterministic policy decision."""


class Restricted(Exception):
    """Accessible only to designated child-safety responders."""


class Unavailable(Exception):
    """A fresh check is required before this item can be used."""


@dataclass(frozen=True)
class Checked:
    data: bytes
    mime: str
    detectors: dict
    reason: str | None = None


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        raise Unavailable("unexpected redirect")


def post_json(url, token, payload):
    if not url.startswith("https://") or not token:
        raise Unavailable("screening configuration")
    req = urllib.request.Request(url, json.dumps(payload).encode(), headers={
        "Content-Type": "application/json", "Authorization": "Bearer " + token,
    }, method="POST")
    with urllib.request.build_opener(NoRedirect).open(req, timeout=20) as response:
        raw = response.read(65_537)
        if response.status != 200 or len(raw) > 65_536:
            raise Unavailable("invalid response")
        return json.loads(raw)


def clamd_reply(conn):
    reply = bytearray()
    while len(reply) < 1024 and not reply.endswith(b"\0"):
        chunk = conn.recv(1024 - len(reply))
        if not chunk:
            break
        reply.extend(chunk)
    if not reply.endswith(b"\0"):
        raise Unavailable("malware scanner")
    return bytes(reply[:-1])


def malware(data, socket_path):
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as conn:
        conn.settimeout(12)
        conn.connect(socket_path)
        conn.sendall(b"zINSTREAM\0")
        for offset in range(0, len(data), 65536):
            chunk = data[offset:offset + 65536]
            conn.sendall(struct.pack(">I", len(chunk)) + chunk)
        conn.sendall(bytes(4))
        reply = clamd_reply(conn)
    if reply.endswith(b" FOUND"):
        raise Rejected("malware")
    if reply != b"stream: OK":
        raise Unavailable("malware scanner")
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as conn:
        conn.settimeout(5)
        conn.connect(socket_path)
        conn.sendall(b"zVERSION\0")
        version = re.match(rb"ClamAV ([\w.\-]+)/([0-9]+)/", clamd_reply(conn))
        if not version:
            raise Unavailable("malware signature version")
        return "/".join(v.decode("ascii") for v in version.groups())


def normalize(data, ext, private=False):
    if not data or len(data) > LIMIT:
        raise Rejected("unsupportedFile")
    if private:
        # Detect raster photos by content even when the file has no extension.
        try:
            with Image.open(io.BytesIO(data), formats=["JPEG", "PNG", "WEBP", "GIF", "BMP", "TIFF", "AVIF"]) as probe:
                photo_format = probe.format
        except UnidentifiedImageError:
            if fmt := video.container(data):
                try:
                    return video.normalize(data, fmt, LIMIT)
                except video.DownloadOnly:
                    return data, "application/octet-stream", []
                except (subprocess.CalledProcessError, subprocess.TimeoutExpired, ValueError, KeyError) as exc:
                    raise Rejected("unsupportedFile") from exc
            if ext not in IMAGE_TYPES and ext not in {".txt", ".pgn"}:
                return data, "application/octet-stream", []
            photo_format = None
        except (OSError, ValueError, Image.DecompressionBombError) as exc:
            raise Rejected("unsupportedFile") from exc
    else:
        photo_format = IMAGE_TYPES.get(ext)
    if not photo_format and ext in {".txt", ".pgn"}:
        try:
            text = data.decode("utf-8-sig")
        except UnicodeError:
            raise Rejected("unsupportedFile") from None
        if re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", text) or re.match(
            r"\s*(?:<(!doctype|html|script|svg|\?xml)|#!|%PDF-)", text, re.I
        ):
            raise Rejected("unsupportedFile")
        if ext == ".pgn" and not re.search(r'(?m)^\[(?:Event|Game|FEN|Site|Variant) "[^"\r\n]*"\]', text):
            raise Rejected("unsupportedFile")
        return data, "text/plain", []
    if not photo_format:
        raise Rejected("unsupportedFile")
    try:
        with Image.open(io.BytesIO(data), formats=[photo_format]) as image:
            count = getattr(image, "n_frames", 1)
            if count > (32 if private else 1) or count * image.width * image.height > MAX_PIXELS:
                raise Rejected("unsupportedFile")
            frames, durations, moderation = [], [], []
            pixels = 0
            for frame in ImageSequence.Iterator(image):
                pixels += frame.width * frame.height
                if pixels > MAX_PIXELS:
                    raise Rejected("unsupportedFile")
                oriented = ImageOps.exif_transpose(frame)
                oriented.thumbnail((2048, 2048))
                clean = oriented.convert("RGBA" if "A" in oriented.getbands() or "transparency" in oriented.info else "RGB")
                clean.info.clear()
                if frames and frames[0].size != clean.size:
                    raise Rejected("unsupportedFile")
                frames.append(clean)
                durations.append(max(10, min(60000, int(frame.info.get("duration", 100)))))
                out = io.BytesIO()
                clean.save(out, format="WEBP", quality=84, method=3)
                moderation.append(out.getvalue())
            result = moderation[0]
            if len(frames) > 1:
                out = io.BytesIO()
                frames[0].save(out, format="WEBP", save_all=True, append_images=frames[1:],
                               duration=durations, loop=image.info.get("loop", 0), quality=84, method=3)
                result = out.getvalue()
            if len(result) > LIMIT or sum(map(len, moderation)) > LIMIT:
                raise Rejected("unsupportedFile")
            return result, "image/webp", moderation
    except (OSError, ValueError, Image.DecompressionBombError, UnidentifiedImageError) as exc:
        raise Rejected("unsupportedFile") from exc


def general_verdict(result):
    if not isinstance(result, dict) or not isinstance(result.get("model"), str) or not re.fullmatch(
        r"omni-moderation-(?:latest|\d{4}-\d{2}-\d{2}(?:-\d+)?)", result["model"]
    ):
        raise Unavailable("unexpected moderation model")
    items = result.get("results")
    if not isinstance(items, list) or len(items) != 1 or not isinstance(items[0], dict):
        raise Unavailable("invalid moderation result")
    item = items[0]
    cats, scores = item.get("categories"), item.get("category_scores")
    required = {"sexual", "violence", "violence/graphic", "self-harm"}
    if (type(item.get("flagged")) is not bool or not isinstance(cats, dict) or not required <= cats.keys()
        or not isinstance(scores, dict) or scores.keys() != cats.keys()
        or not all(type(v) is bool for v in cats.values()) or any(cats.values()) != item["flagged"]
        or not all(type(v) in (int, float) and math.isfinite(v) and 0 <= v <= 1 for v in scores.values())):
        raise Unavailable("invalid moderation categories")
    if cats.get("sexual/minors"):
        raise Restricted()
    return result["model"], sorted(k for k, v in cats.items() if v)


def screen(row, env=os.environ):
    if row.get("hold") or row.get("state") == "restricted":
        raise Restricted()
    data = bytes(row["bytes"])
    if row["sourceDigest"] != hashlib.sha256(data).hexdigest():
        raise Unavailable("identity mismatch")
    av = malware(data, env["UGC_CLAMD_SOCKET"])
    clean, mime, photos = normalize(data, Path(row["name"]).suffix.lower(), row.get("audience", "").startswith("msg/"))
    detectors = {"clamav": av}
    if not photos:
        return Checked(clean, mime, detectors)
    inputs = [{"type": "image_url", "image_url": {"url": "data:image/webp;base64," + base64.b64encode(frame).decode("ascii")}}
              for frame in photos]
    result = post_json("https://api.openai.com/v1/moderations", env["UGC_OPENAI_KEY"], {
        "model": MODEL, "input": inputs,
    })
    version, flags = general_verdict(result)
    detectors.update({"pipeline": "video-openai-1" if mime == "video/mp4" else "photo-openai-1", "model": version, "categories": flags})
    return Checked(clean, mime, detectors, "imagePolicy" if flags else None)
