"""Normalize small private video clips and generate moderation sheets covering every output frame."""
import contextlib
import io
import json
import math
import os
from pathlib import Path
import subprocess
import tempfile

from PIL import Image

# Bound the decoder and model input independently of compressed upload size.
MAX_SECONDS = 60
FPS = 12
TILE = (192, 144)


class DownloadOnly(Exception):
    """Recognized file outside the inline clip policy."""


def container(data):
    if data[4:8] == b"ftyp":
        return "mov"
    if data.startswith(b"\x1aE\xdf\xa3"):
        return "matroska"
    return None


@contextlib.contextmanager
def seekable(data):
    # The production scanner has a read-only root and a 1 MiB /tmp.
    if hasattr(os, "memfd_create"):
        with os.fdopen(os.memfd_create("inbox-clip"), "w+b") as stream:
            stream.write(data)
            stream.flush()
            yield f"/proc/self/fd/{stream.fileno()}", {"pass_fds": (stream.fileno(),)}
    else:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "clip"
            path.write_bytes(data)
            yield str(path), {}


def run(args, handles):
    return subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                          check=True, timeout=35, **handles).stdout


def normalize(data, fmt, limit):
    with seekable(data) as (path, handles):
        source = ["-protocol_whitelist", "file", "-format_whitelist", fmt, "-f", fmt, "-i", path]
        info = json.loads(run(["ffprobe", "-v", "error", "-show_streams", "-show_format",
                               "-of", "json", *source], handles))
        streams = info["streams"]
        visual = next((s for s in streams if s["codec_type"] == "video" and
                       not s.get("disposition", {}).get("attached_pic")), None)
        duration = float(info["format"].get("duration", 0))
        if not visual or not 0 < duration <= MAX_SECONDS or not 0 < visual["width"] * visual["height"] <= 8_294_400:
            raise DownloadOnly()
        # Exclude subtitles, data streams, attachments, chapters and source metadata.
        cmd = ["ffmpeg", "-v", "error", "-nostdin", "-xerror", "-threads", "1", "-filter_threads", "1",
               *source, "-map", "0:" + str(visual["index"]), "-map", "0:a:0?", "-map_metadata", "-1",
               "-map_chapters", "-1", "-t", str(MAX_SECONDS + 1), "-vf",
               "fps=12,scale=w='min(720,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1",
               "-c:v", "libx264", "-preset", "veryfast", "-threads", "1", "-pix_fmt", "yuv420p",
               "-c:a", "aac", "-ac", "2", "-b:a", "64k", "-fs", str(limit + 1),
               "-movflags", "frag_keyframe+empty_moov", "-f", "mp4", "pipe:1"]
        clean = run(cmd, handles)
    if len(clean) > limit or not clean:
        raise ValueError("encoded clip too large")

    # Decode the exact published bytes. Each 4x3 sheet contains one second of video.
    # Bound output even when a container reports an inaccurate duration.
    width, height = TILE
    command = ["ffmpeg", "-v", "error", "-nostdin", "-xerror", "-threads", "1", "-filter_threads", "1",
               "-protocol_whitelist", "pipe", "-f", "mov", "-i", "pipe:0", "-map", "0:v:0", "-an",
               "-vf", f"scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2",
               "-frames:v", str(MAX_SECONDS * FPS + 1), "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"]
    pixels = subprocess.run(command, input=clean, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                            timeout=30, check=True).stdout
    stride = width * height * 3
    count, remainder = divmod(len(pixels), stride)
    if remainder or not 0 < count <= MAX_SECONDS * FPS or count + 2 < math.floor(duration * FPS):
        raise ValueError("incomplete clip")
    sheets = []
    for offset in range(0, count, FPS):
        sheet = Image.new("RGB", (width * 4, height * 3))
        for i in range(min(FPS, count - offset)):
            start = (offset + i) * stride
            frame = Image.frombytes("RGB", TILE, pixels[start:start + stride])
            sheet.paste(frame, (i % 4 * width, i // 4 * height))
        encoded = io.BytesIO()
        sheet.save(encoded, "WEBP", quality=82)
        sheets.append(encoded.getvalue())
    if sum(map(len, sheets)) > limit:
        raise ValueError("moderation image budget exceeded")
    return clean, "video/mp4", sheets
