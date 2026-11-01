import gzip
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

from tools.traffic import geoip


class GeoIPTest(unittest.TestCase):
    def test_published_release_download_and_cache(self):
        # The publisher can still serve December after the UTC year rolls over.
        page = b'<a href="https://download.db-ip.com/free/dbip-city-lite-2025-12.mmdb.gz">MMDB</a>'
        database = b"database\xab\xcd\xefMaxMind.com"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(geoip.urllib.request, "urlopen", side_effect=[
                io.BytesIO(page), io.BytesIO(gzip.compress(database)), io.BytesIO(page)
            ]) as download:
                target = geoip.prepare(root)
                self.assertEqual(target.read_bytes(), database)
                record = json.loads((root / "dbip-city-lite.json").read_text())
                self.assertEqual(record["month"], "2025-12")
                self.assertEqual(record["sha256"], geoip.digest(target))
                self.assertEqual(download.call_args_list[1].args[0].full_url, record["url"])
                self.assertEqual(geoip.prepare(root), target)
                self.assertEqual(download.call_count, 3)
            self.assertEqual(sorted(p.name for p in root.iterdir()), ["dbip-city-lite.json", "dbip-city-lite.mmdb"])

    def test_explicit_month_does_not_discover_or_fall_back(self):
        error = HTTPError("https://download.db-ip.com", 404, "Not Found", {}, None)
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(geoip, "published_month") as discover:
                with patch.object(geoip.urllib.request, "urlopen", side_effect=error):
                    with self.assertRaises(HTTPError):
                        geoip.prepare(Path(directory), "2026-11")
                discover.assert_not_called()
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_discovery_rejects_unexpected_links(self):
        page = b'''<a href="https://example.com/dbip-city-lite-2026-10.mmdb.gz">Wrong host</a>
            <a href="https://download.db-ip.com/free/dbip-city-lite-2026-10.csv.gz">CSV</a>'''
        with patch.object(geoip.urllib.request, "urlopen", return_value=io.BytesIO(page)):
            with self.assertRaisesRegex(ValueError, "No DB-IP Lite MMDB release"):
                geoip.published_month()

    def test_discovery_is_bounded(self):
        with patch.object(geoip.urllib.request, "urlopen", return_value=io.BytesIO(b"x" * 2_000_001)):
            with self.assertRaisesRegex(ValueError, "size budget"):
                geoip.published_month()


if __name__ == "__main__":
    unittest.main()
