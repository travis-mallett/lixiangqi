"""Sequential, throttled public GETs with host-scoped credentials and redirects."""
import email.utils
import http.client
import os
import socket
import time
import urllib.error
import urllib.request
from urllib.parse import urlsplit

from .sources import canonical_url

MAX_BYTES = 4_000_000
USER_AGENT = "Lixiangqi-Jieqi-Collector/1.0 (+https://lixiangqi.org)"


class FetchError(Exception):
    def __init__(self, message, *, blocked=False, retryable=False, retry_after=0):
        super().__init__(message)
        self.blocked = blocked
        self.retryable = retryable
        self.retry_after = retry_after


class ScopedRedirect(urllib.request.HTTPRedirectHandler):
    def __init__(self, source):
        self.source = source

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        try:
            canonical_url(self.source, newurl)
        except ValueError as error:
            raise FetchError("Redirect left the source allowlist", blocked=True) from error
        if urlsplit(req.full_url).scheme == "https" and urlsplit(newurl).scheme != "https":
            raise FetchError("Refusing HTTPS downgrade", blocked=True)
        redirected = super().redirect_request(req, fp, code, msg, headers, newurl)
        if urlsplit(req.full_url).hostname != urlsplit(newurl).hostname:
            redirected.remove_header("Cookie")
        return redirected


def retry_after(headers):
    value = headers.get("Retry-After", "0")
    try:
        return max(0, float(value))
    except ValueError:
        try:
            return max(0, email.utils.parsedate_to_datetime(value).timestamp() - time.time())
        except (ValueError, TypeError, OverflowError):
            return 0


class Fetcher:
    def __init__(self, delay=2.0, timeout=30.0):
        self.delay, self.timeout = delay, timeout
        self.last = 0.0

    def __call__(self, source, url):
        canonical_url(source, url)
        time.sleep(max(0, self.last + self.delay - time.monotonic()))
        self.last = time.monotonic()
        headers = {"User-Agent": USER_AGENT, "Accept-Encoding": "identity"}
        # Cookie env vars are per exact host, never logged or saved in evidence.
        host = urlsplit(url).hostname
        env = "JIEQI_COOKIE_" + host.upper().replace(".", "_")
        if os.environ.get(env):
            headers["Cookie"] = os.environ[env]
        try:
            opener = urllib.request.build_opener(ScopedRedirect(source))
            with opener.open(urllib.request.Request(url, headers=headers), timeout=self.timeout) as response:
                body = response.read(MAX_BYTES + 1)
                if len(body) > MAX_BYTES:
                    raise FetchError("Response exceeds 4 MB; use an explicit local record import")
                if response.status != 200:
                    raise FetchError(f"Unexpected HTTP {response.status}")
                return body, response.status, response.headers.get("Content-Type", "")
        except urllib.error.HTTPError as error:
            raise FetchError(f"HTTP {error.code}", blocked=error.code in {401,403},
                             retryable=error.code in {408,429} or error.code >= 500,
                             retry_after=retry_after(error.headers)) from error
        except (urllib.error.URLError, socket.timeout, OSError, http.client.HTTPException) as error:
            raise FetchError(type(error).__name__ + ": network request failed", retryable=True) from error
