"""Bounded discovery of published links, not guessed IDs or private APIs."""
from __future__ import annotations

from dataclasses import dataclass
from html import unescape
from html.parser import HTMLParser
import re
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit


@dataclass(frozen=True)
class Source:
    hosts: tuple[str, ...]
    seeds: tuple[str, ...]
    capability: str


SOURCES = {
    "dpxq": Source(("dpxq.com", "www.dpxq.com"), (
        "https://www.dpxq.com/hldcg/index_0_1_0_xm_u63ED_u68CB.html",
    ), "Tournament discovery; login may be required; reveal format unverified"),
    "xqipu": Source(("www.xqipu.com", "xqipu.com"), (
        "https://www.xqipu.com/search/qipu?keyword=%E6%8F%AD%E6%A3%8B",
        "https://www.xqipu.com/qipu/712c40ce-b6fc-4d00-8bd7-803b9f287613",
    ), "Jieqi position/move fragments; human verification may be required"),
    "gdchess": Source(("www.gdchess.com", "gdchess.com", "www.01xq.com", "01xq.com", "m.gdchess.com"), (
        "https://www.gdchess.com/article/list.asp?id=18117",
        "https://www.gdchess.com/XQData/EventInfo.asp?eid=100003561",
    ), "Tournament discovery; no verified full jieqi score archive"),
    "vietcotuong": Source(("vietcotuong.com", "explore.vietcotuong.com", "play.vietcotuong.com"), (
        "https://vietcotuong.com/",
    ), "Public links only; dynamic/authenticated game API unverified"),
    "xiangqiqipu": Source(("www.xiangqiqipu.com", "xiangqiqipu.com"), (
        "https://www.xiangqiqipu.com/Video/List-6-4.html",
    ), "Video references only; no automatic video transcription"),
    "pengfei": Source(("pf.stkme.com", "chess.stkme.com"), (
        "https://pf.stkme.com/Blog/View/1628/data.htm",
    ), "Software lead; no published human-game archive verified"),
    "zhongyi": Source(("www.jk1618.com", "jk1618.com"), (
        "http://www.jk1618.com/",
    ), "Historical platform; reachable homepage, no public score archive verified"),
    "xiuqipu": Source(("www.zbtool.store", "zbtool.store"), (
        "https://www.zbtool.store/show/",
    ), "Export-tool lead; jieqi support unverified; no third-party API calls"),
}
JIEQI = re.compile(r"揭棋|冚棋|jieqi|cờ\s*úp", re.I)


def canonical_url(source: str, url: str) -> str:
    parts = urlsplit(unescape(url.strip()))
    if (parts.scheme not in {"http", "https"} or parts.username or parts.password
            or parts.hostname not in SOURCES[source].hosts or parts.port not in {None, 80, 443}):
        raise ValueError(f"URL is outside the {source} public source allowlist")
    return urlunsplit((parts.scheme, parts.netloc.lower(), parts.path or "/",
                      urlencode(sorted(parse_qsl(parts.query, keep_blank_values=True))), ""))


class Page(HTMLParser):
    def __init__(self, document: str):
        super().__init__(convert_charrefs=True)
        self.links: list[tuple[str, str]] = []
        self.text: list[str] = []
        self.title = ""
        self._anchor: str | None = None
        self._label: list[str] = []
        self._title = False
        self._skip = 0
        self.feed(document)

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style"}:
            self._skip += 1
        if tag == "title":
            self._title = True
        if tag == "a":
            self._anchor = dict(attrs).get("href")
            self._label = []

    def handle_endtag(self, tag):
        if tag in {"script", "style"}:
            self._skip = max(0, self._skip - 1)
        if tag == "title":
            self._title = False
        if tag == "a" and self._anchor is not None:
            self.links.append((self._anchor, " ".join(self._label)))
            self._anchor = None

    def handle_data(self, data):
        if self._skip:
            return
        self.text.append(data)
        if self._title:
            self.title += data
        if self._anchor is not None:
            self._label.append(data)


def discover(source: str, url: str, document: str) -> list[str]:
    page = Page(document)
    result = set()
    relevant = bool(JIEQI.search(page.title))
    for href, label in page.links:
        try:
            target = canonical_url(source, urljoin(url, href))
        except ValueError:
            continue
        path = urlsplit(target).path.lower()
        # Never crawl executables, videos, arbitrary site navigation or login actions.
        if re.search(r"\.(zip|exe|apk|mp4|7z|rar)$", path) or re.search(r"login|logout|register|/add\b", path):
            continue
        named = bool(JIEQI.search(label))
        follow = False
        if source == "dpxq":
            follow = bool(re.search(r"/hldcg/(tour_\d+|search/(view_|list))", path)) and (relevant or named)
            follow |= "_xm_u63ed_u68cb" in path
        elif source == "xqipu":
            follow = (path.startswith("/qipu/") and (named or "/search/qipu" in url))
            query = dict(parse_qsl(urlsplit(target).query))
            # Faceted filters create a combinatorial crawl of the same games;
            # only the original search and its actual pagination are followed.
            follow |= path == "/search/qipu" and query.get("keyword") == "揭棋" and set(query) <= {"keyword", "page"}
        elif source == "gdchess":
            # On mixed articles, follow only explicitly named jieqi links. Once
            # on the jieqi event, follow only that event and its game-score links.
            current_eid = dict(parse_qsl(urlsplit(url).query)).get("eid")
            next_eid = dict(parse_qsl(urlsplit(target).query)).get("eid")
            follow = named and ("/article/" in path or "/xqdata/" in path)
            follow |= bool(current_eid and current_eid == next_eid and "/xqdata/" in path)
            follow |= bool(current_eid and relevant and "/xqgame/" in path)
        elif source == "xiangqiqipu":
            follow = path.startswith("/video/view-") and named
            follow |= path.startswith("/video/list-6-")
        elif source in {"vietcotuong", "zhongyi"}:
            follow = named and bool(re.search(r"games?/[^/]+|qipu|record|replay|catalog|library|share", path))
            if "下载" in label or "download" in label.lower():
                follow = False
        if follow:
            result.add(target)
    return sorted(result - {canonical_url(source, url)})


def blocked_reason(document: str) -> str | None:
    text = " ".join(Page(document).text)
    for marker in ("请先登陆", "请先登录", "正在进行人机验证", "Just a moment...", "Verify you are human"):
        if marker in text:
            return f"Access challenge: {marker}; supply an authorized session or saved page"
    return None
