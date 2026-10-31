"""Bounded, resumable public-source downloads with immutable evidence files."""
from __future__ import annotations

import hashlib
import json
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

HOSTS = {'www.wxf-xiangqi.org', 'www.sport.gov.cn', 'www.xiangqiqipu.com', 'news.cctv.com'}


class Fetcher:
    def __init__(self, directory: Path, *, offline=False, refresh_days=30, delay=1.0):
        self.directory = directory
        directory.mkdir(parents=True, exist_ok=True)
        self.offline, self.refresh_days, self.delay = offline, refresh_days, delay
        self.last_request = 0.0

    def get(self, url: str) -> tuple[bytes, dict]:
        if urlsplit(url).scheme != 'https' or urlsplit(url).hostname not in HOSTS:
            raise ValueError(f'Unsupported player source URL: {url}')
        key = hashlib.sha256(url.encode()).hexdigest()
        index = self.directory / (key + '.json')
        meta = json.loads(index.read_text(encoding='utf-8')) if index.exists() else None
        if meta:
            data = (self.directory / meta['sha256']).read_bytes()
            if hashlib.sha256(data).hexdigest() != meta['sha256']:
                raise ValueError(f'Corrupt cached evidence: {url}')
            if self.offline or time.time() - meta['checkedAt'] < self.refresh_days * 86400:
                return data, meta
        if self.offline:
            raise ValueError(f'No cached evidence for {url}')
        time.sleep(max(0, self.delay - (time.monotonic() - self.last_request)))
        headers = {'User-Agent': 'LiXiangQi-PlayerCatalog/1.0 (+https://lixiangqi.com)'}
        if meta and meta.get('etag'):
            headers['If-None-Match'] = meta['etag']
        if meta and meta.get('lastModified'):
            headers['If-Modified-Since'] = meta['lastModified']
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=45) as response:
                if urlsplit(response.url).hostname not in HOSTS:
                    raise ValueError('Unexpected player source redirect')
                data = response.read(10 * 1024 * 1024 + 1)
                if len(data) > 10 * 1024 * 1024:
                    raise ValueError('Player source exceeds 10 MiB')
                meta = {'url': url, 'sha256': hashlib.sha256(data).hexdigest(),
                        'observedAt': datetime.now(timezone.utc).isoformat(),
                        'etag': response.headers.get('ETag'),
                        'lastModified': response.headers.get('Last-Modified')}
                evidence = self.directory / meta['sha256']
                if not evidence.exists():
                    evidence.write_bytes(data)
        except urllib.error.HTTPError as error:
            if error.code != 304 or not meta:
                raise
        finally:
            self.last_request = time.monotonic()
        meta['checkedAt'] = time.time()
        temporary = index.with_suffix('.tmp')
        temporary.write_text(json.dumps(meta), encoding='utf-8')
        temporary.replace(index)
        return data, meta
