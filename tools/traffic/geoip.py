"""Prepare a local DB-IP Lite MMDB; visitors' IP addresses never leave the site.

Data: https://db-ip.com/db/download/ip-to-city-lite (CC BY 4.0).
The report includes the required attribution. Run during release preparation,
not on a web request. Downloads and decompression have explicit size budgets.
"""

import argparse
import datetime as dt
import gzip
import hashlib
from html.parser import HTMLParser
import io
import json
import os
from pathlib import Path
import tempfile
import re
import urllib.request


DOWNLOAD_PAGE = "https://db-ip.com/db/download/ip-to-city-lite"
USER_AGENT = "LiXiangQi-GeoIP-Updater/1.0 (+https://lixiangqi.com)"


class ReleaseLinks(HTMLParser):
    def __init__(self):
        super().__init__()
        self.months = set()

    def handle_starttag(self, tag, attrs):
        if tag != "a":
            return
        for name, value in attrs:
            if name == "href" and value:
                match = re.fullmatch(
                    r"https://download\.db-ip\.com/free/dbip-city-lite-(\d{4}-\d{2})\.mmdb\.gz", value
                )
                if match:
                    dt.datetime.strptime(match[1], "%Y-%m")
                    self.months.add(match[1])


def published_month() -> str:
    request = urllib.request.Request(DOWNLOAD_PAGE, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        page = io.BytesIO()
        copy_bounded(response, page, 2_000_000)
    links = ReleaseLinks()
    links.feed(page.getvalue().decode("utf-8"))
    if not links.months:
        raise ValueError(f"No DB-IP Lite MMDB release found on {DOWNLOAD_PAGE}")
    return max(links.months)


def prepare(directory: Path, month: str | None = None) -> Path:
    month = published_month() if month is None else month
    if not re.fullmatch(r"\d{4}-\d{2}", month):
        raise ValueError("GeoIP release month must use YYYY-MM format")
    dt.datetime.strptime(month, "%Y-%m")
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / "dbip-city-lite.mmdb"
    metadata = directory / "dbip-city-lite.json"
    if metadata.exists() and target.exists():
        previous = json.loads(metadata.read_text(encoding="utf-8"))
        if previous.get("month") == month and digest(target) == previous.get("sha256"):
            return target
    url = f"https://download.db-ip.com/free/dbip-city-lite-{month}.mmdb.gz"
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=directory, suffix=".gz", delete=False) as compressed:
            temporary = Path(compressed.name)
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=60) as response:
                copy_bounded(response, compressed, 150_000_000)
        unpacked = temporary.with_suffix(".mmdb")
        try:
            with gzip.open(temporary, "rb") as source, unpacked.open("wb") as destination:
                copy_bounded(source, destination, 300_000_000)
            with unpacked.open("rb") as source:
                source.seek(max(0, unpacked.stat().st_size - 131072))
                if b"\xab\xcd\xefMaxMind.com" not in source.read():
                    raise ValueError("The downloaded file is not an MMDB database")
            record = {"month": month, "url": url, "sha256": digest(unpacked), "license": "CC-BY-4.0", "provider": "DB-IP"}
            os.replace(unpacked, target)
            metadata.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
        finally:
            unpacked.unlink(missing_ok=True)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return target


def copy_bounded(source, destination, maximum):
    total = 0
    while chunk := source.read(1024 * 1024):
        total += len(chunk)
        if total > maximum:
            raise ValueError("GeoIP file exceeded the download size budget")
        destination.write(chunk)


def digest(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--month")
    args = parser.parse_args()
    print(prepare(args.directory, args.month))
