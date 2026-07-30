"""Scrape DPXQ's 13 ancient full-game manuals with comments and variations.

DPXQ publishes each manual as a bounded directory of DhtmlXQ records. This
scraper verifies the published record totals, keeps the original HTML, parses
the complete DhtmlXQ move tree, validates every root-to-leaf line with
Pikafish, and stores path-anchored Chinese commentary in the games database.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
import re
import sqlite3
import sys
import time
import urllib.parse
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Callable, Iterable, Sequence

from tools.xiangqi_data.dpxq_import import decode_html, dhtml_move_to_uci
from tools.xiangqi_data.dpxq_scrape import (
    DEFAULT_USER_AGENT,
    DownloadFailure,
    PersistentRecordFetcher,
)
from tools.xiangqi_data.pikafish_rules import (
    START_FEN,
    PikafishGameValidator,
    index_validated_line,
)

from .provenance import (
    AnnotationLayer,
    AnnotationValue,
    SourceTreeNode,
    clear_ingest_failure,
    record_ingest_failure,
    upsert_source_record,
)
from .storage import (
    canonical_hash,
    compact_json,
    database_path,
    first_position_occurrences,
    initialize,
    line_hash,
    stable_game_id,
)

COLLECTION = "ancient_manuals"
COLLECTION_NAME = "Ancient Manuals"
PARSER_VERSION = "dpxq-ancient-dhtmlxq-v1"
DEFAULT_OUTPUT = Path(__file__).resolve().parents[2] / "data" / "local" / "dpxq-ancient-html"
ANCIENT_ROOT = (
    "http://www.dpxq.com/hldcg/share/"
    "chess_%E8%B1%A1%E6%A3%8B%E8%B0%B1%E5%A4%A7%E5%85%A8/"
    "%E8%B1%A1%E6%A3%8B%E8%B0%B1%E5%A4%A7%E5%85%A8-"
    "%E5%8F%A4%E8%B0%B1%E5%85%A8%E5%B1%80/"
)
RECORD_URL = "http://www.dpxq.com/hldcg/search/view_{owner}_{id}.html"
MAX_INDEX_PAGES = 100


@dataclass(frozen=True, slots=True)
class Manual:
    slug: str
    title: str
    expected_records: int
    alternate_titles: tuple[str, ...] = ()

    def url(self, root: str = ANCIENT_ROOT) -> str:
        return urllib.parse.urljoin(root, urllib.parse.quote(self.title, safe="") + "/")

    def listing_url(self, root: str = ANCIENT_ROOT) -> str:
        return urllib.parse.urljoin(
            self.url(root), urllib.parse.quote("棋谱列表", safe="") + "/"
        )


# These are the 13 directories DPXQ publishes under 象棋谱大全-古谱全局.
# Counts are the collection's own catalog totals (424 records in all).
MANUALS: tuple[Manual, ...] = (
    Manual("zichudonglaiwudishou", "自出洞来无敌手", 35),
    Manual("yicheng", "奕乘", 138),
    Manual("wushimeihuapu", "吴氏梅花谱", 5),
    Manual("wushuangpinmeihuapu", "无双品梅花谱", 4),
    Manual("shilinguangji", "事林广记", 2),
    Manual("shanqingtang", "善庆堂重订梅花变", 17, ("善庆堂梅花变",)),
    Manual("meihuaquan", "梅花泉", 50),
    Manual("meihuapu", "梅花谱", 31),
    Manual("meihuabianfa", "梅花变法谱", 12),
    Manual("juzhongmi", "桔中秘", 51, ("橘中秘",)),
    Manual("jinpengshibabian", "金鹏十八变", 51),
    Manual("fanmeihuapu", "反梅花谱", 8),
    Manual("chongbentang", "崇本堂梅花谱", 20),
)
MANUAL_BY_KEY = {
    key: manual
    for manual in MANUALS
    for key in (
        manual.slug.casefold(),
        manual.title.casefold(),
        *(title.casefold() for title in manual.alternate_titles),
    )
}

DPXQ_TAG_PATTERN = re.compile(
    r"\[DhtmlXQ_(?P<name>[A-Za-z0-9_]+)\](?P<value>.*?)"
    r"\[/DhtmlXQ_(?P=name)\]",
    re.IGNORECASE | re.DOTALL,
)
LEGACY_TREE_PATTERN = re.compile(
    r"\[(?P<parent>\d+)_(?P<ply>\d+)_(?P<line>\d+)\]"
    r"(?P<moves>\d+)\[/\1_\2_\3\]",
    re.IGNORECASE | re.DOTALL,
)
MOVE_TAG_PATTERN = re.compile(r"^move_(\d+)_(\d+)_(\d+)$", re.IGNORECASE)
COMMENT_TAG_PATTERN = re.compile(r"^comment(?:(\d+)_)?(\d+)$", re.IGNORECASE)
VIEW_FILE_PATTERN = re.compile(r"view_([a-z])_(\d+)\.html", re.IGNORECASE)
VIEW_QUERY_PATTERN = re.compile(
    r"(?:^|[?&])owner=([a-z])(?:[&#].*?)?[?&]id=(\d+)|"
    r"(?:^|[?&])id=(\d+)(?:[&#].*?)?[?&]owner=([a-z])",
    re.IGNORECASE,
)
VIEW_CALL_PATTERN = re.compile(
    r"owner\s*=\s*([a-z])\s*&\s*id\s*=\s*(\d+)", re.IGNORECASE
)
INDEX_PAGE_PATTERN = re.compile(r"(?:(?:index[_-]?)?\d+)\.html", re.IGNORECASE)
PIECE_ORDER = "RNBAKABNRCCPPPPP" + "rnbakabnrccppppp"
RESULTS = {
    "红胜": 1,
    "黑胜": -1,
    "和棋": 0,
    "和": 0,
    "平": 0,
    "未知": 0,
    "": 0,
}


@dataclass(frozen=True, slots=True)
class RecordRef:
    owner: str
    external_id: str
    title: str
    url: str
    chapter_title: str = ""
    chapter_url: str = ""
    source_order: int = 0
    chapter_order: int = 0
    game_order: int = 0

    @property
    def key(self) -> tuple[str, str]:
        return self.owner, self.external_id


@dataclass(frozen=True, slots=True)
class ParsedManualRecord:
    manual: Manual
    reference: RecordRef
    title: str
    initial_fen: str
    result: int
    played_at: str
    tags: dict[str, str]
    mainline: tuple[str, ...]
    line_paths: dict[int, tuple[str, ...]]
    notation_text: str
    annotations: tuple[AnnotationValue, ...]
    tree_nodes: tuple[SourceTreeNode, ...]

    @property
    def source_external_id(self) -> str:
        return f"{self.manual.slug}:{self.reference.owner}:{self.reference.external_id}"

    @property
    def identity(self) -> bytes:
        return canonical_hash(
            self.mainline,
            red_name=self.manual.title,
            black_name=self.title,
            result=self.result,
            initial_fen=self.initial_fen,
        )


@dataclass(slots=True)
class _TreeNode:
    move: str
    path: tuple[str, ...]
    order: int
    children: list["_TreeNode"] = field(default_factory=list)


class _AnchorParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.anchors: list[tuple[str, str, str]] = []
        self._href = ""
        self._onclick = ""
        self._text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.casefold() != "a":
            return
        values = {name.casefold(): value or "" for name, value in attrs}
        self._href = values.get("href", "")
        self._onclick = values.get("onclick", "")
        self._text = []

    def handle_data(self, data: str) -> None:
        if self._href or self._onclick:
            self._text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag.casefold() == "a" and (self._href or self._onclick):
            self.anchors.append(
                (self._href, self._onclick, " ".join("".join(self._text).split()))
            )
            self._href = ""
            self._onclick = ""
            self._text = []


@dataclass(frozen=True, slots=True)
class _IndexCell:
    text: str
    anchors: tuple[tuple[str, str, str], ...]


class _IndexTableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.rows: list[tuple[_IndexCell, ...]] = []
        self._row: list[_IndexCell] | None = None
        self._cell_text: list[str] | None = None
        self._cell_anchors: list[tuple[str, str, str]] = []
        self._anchor_href = ""
        self._anchor_onclick = ""
        self._anchor_text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.casefold()
        if tag == "tr":
            self._row = []
        elif tag in {"td", "th"} and self._row is not None:
            self._cell_text = []
            self._cell_anchors = []
        elif tag == "a" and self._cell_text is not None:
            values = {name.casefold(): value or "" for name, value in attrs}
            self._anchor_href = values.get("href", "")
            self._anchor_onclick = values.get("onclick", "")
            self._anchor_text = []

    def handle_data(self, data: str) -> None:
        if self._cell_text is not None:
            self._cell_text.append(data)
        if self._anchor_href or self._anchor_onclick:
            self._anchor_text.append(data)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.casefold()
        if tag == "a" and (self._anchor_href or self._anchor_onclick):
            self._cell_anchors.append(
                (
                    self._anchor_href,
                    self._anchor_onclick,
                    " ".join("".join(self._anchor_text).split()),
                )
            )
            self._anchor_href = ""
            self._anchor_onclick = ""
            self._anchor_text = []
        elif tag in {"td", "th"} and self._row is not None and self._cell_text is not None:
            self._row.append(
                _IndexCell(
                    " ".join("".join(self._cell_text).split()),
                    tuple(self._cell_anchors),
                )
            )
            self._cell_text = None
            self._cell_anchors = []
        elif tag == "tr" and self._row is not None:
            if self._row:
                self.rows.append(tuple(self._row))
            self._row = None


def _clean_tag_value(value: str) -> str:
    value = re.sub(r"<br\s*/?>", "\n", value, flags=re.IGNORECASE)
    value = re.sub(r"<[^>]+>", "", value)
    return html.unescape(value).strip()


def parse_dhtmlxq_tags(document: str) -> dict[str, str]:
    tags: dict[str, str] = {}
    for match in DPXQ_TAG_PATTERN.finditer(document):
        tags[match.group("name").casefold()] = _clean_tag_value(match.group("value"))
    return tags


def _encoded_moves(value: str, *, source: str) -> tuple[str, ...]:
    encoded = re.sub(r"\s+", "", value)
    if not encoded or len(encoded) % 4 or not encoded.isdigit():
        raise ValueError(f"{source} has a missing or malformed move list")
    return tuple(dhtml_move_to_uci(encoded[index : index + 4]) for index in range(0, len(encoded), 4))


def _line_definitions(document: str, tags: dict[str, str]) -> dict[int, tuple[int, int, tuple[str, ...]]]:
    definitions: dict[int, tuple[int, int, tuple[str, ...]]] = {}
    for name, value in tags.items():
        match = MOVE_TAG_PATTERN.fullmatch(name)
        if not match:
            continue
        parent, ply, line = map(int, match.groups())
        definitions[line] = (
            parent,
            max(0, ply - 1),
            _encoded_moves(value, source=f"DhtmlXQ_{name}"),
        )
    for match in LEGACY_TREE_PATTERN.finditer(html.unescape(document)):
        parent, ply, line = map(int, match.group("parent", "ply", "line"))
        moves = _encoded_moves(match.group("moves"), source=f"legacy line {line}")
        if line == 0:
            continue
        candidate = (parent, max(0, ply - 1), moves)
        if line in definitions and definitions[line] != candidate:
            raise ValueError(f"conflicting DhtmlXQ definition for variation {line}")
        definitions[line] = candidate
    return definitions


def _mainline(document: str, tags: dict[str, str]) -> tuple[str, ...]:
    if tags.get("movelist"):
        return _encoded_moves(tags["movelist"], source="DhtmlXQ_movelist")
    for match in LEGACY_TREE_PATTERN.finditer(html.unescape(document)):
        if int(match.group("line")) == 0:
            return _encoded_moves(match.group("moves"), source="legacy mainline")
    raise ValueError("DhtmlXQ record has no main line")


def _resolve_line_paths(
    mainline: tuple[str, ...],
    definitions: dict[int, tuple[int, int, tuple[str, ...]]],
) -> dict[int, tuple[str, ...]]:
    paths: dict[int, tuple[str, ...]] = {0: mainline}
    pending = dict(definitions)
    while pending:
        progressed = False
        for line, (parent, anchor, moves) in sorted(tuple(pending.items())):
            parent_path = paths.get(parent)
            if parent_path is None:
                continue
            if not 0 <= anchor <= len(parent_path):
                raise ValueError(
                    f"variation {line} branches at ply {anchor}, "
                    f"outside parent {parent}'s {len(parent_path)} plies"
                )
            paths[line] = parent_path[:anchor] + moves
            del pending[line]
            progressed = True
        if not progressed:
            unresolved = ", ".join(str(line) for line in sorted(pending))
            raise ValueError(f"unresolved or cyclic DhtmlXQ variations: {unresolved}")
    return paths


def _build_tree(paths: dict[int, tuple[str, ...]]) -> list[_TreeNode]:
    roots: list[_TreeNode] = []
    by_path: dict[tuple[str, ...], _TreeNode] = {}
    next_order: dict[tuple[str, ...], int] = {}
    for line in sorted(paths):
        parent_path: tuple[str, ...] = ()
        siblings = roots
        for move in paths[line]:
            path = parent_path + (move,)
            node = by_path.get(path)
            if node is None:
                order = next_order.get(parent_path, 0)
                next_order[parent_path] = order + 1
                node = _TreeNode(move, path, order)
                siblings.append(node)
                by_path[path] = node
            siblings = node.children
            parent_path = path
    return roots


def _render_tree(siblings: Sequence[_TreeNode]) -> str:
    if not siblings:
        return ""
    main, *variations = siblings
    tokens = [main.move]
    for variation in variations:
        rendered = _render_branch(variation)
        tokens.append(f"({rendered})")
    continuation = _render_tree(main.children)
    if continuation:
        tokens.append(continuation)
    return " ".join(tokens)


def _render_branch(node: _TreeNode) -> str:
    continuation = _render_tree(node.children)
    return f"{node.move} {continuation}".strip()


def _leaf_paths(siblings: Sequence[_TreeNode]) -> list[tuple[str, ...]]:
    leaves: list[tuple[str, ...]] = []
    for node in siblings:
        if node.children:
            leaves.extend(_leaf_paths(node.children))
        else:
            leaves.append(node.path)
    return leaves


def _fen_with_turn(fen: str, turn: str) -> str:
    fields = fen.split()
    fields[1] = turn
    return " ".join(fields)


def binit_to_fen(value: str, first_move: str = "") -> str:
    encoded = re.sub(r"\s+", "", value)
    if not encoded:
        fen = START_FEN
    else:
        if len(encoded) != 64 or not encoded.isdigit():
            raise ValueError("DhtmlXQ_binit must contain 32 two-digit squares")
        board: dict[tuple[int, int], str] = {}
        for piece, square in zip(PIECE_ORDER, (encoded[i : i + 2] for i in range(0, 64, 2))):
            if square == "99":
                continue
            file_index, row = map(int, square)
            if file_index > 8 or row > 9:
                raise ValueError(f"DhtmlXQ_binit square is outside the board: {square}")
            if (file_index, row) in board:
                raise ValueError(f"DhtmlXQ_binit repeats square {square}")
            board[file_index, row] = piece
        ranks: list[str] = []
        for row in range(10):
            empty = 0
            rank = ""
            for file_index in range(9):
                piece = board.get((file_index, row))
                if piece is None:
                    empty += 1
                else:
                    if empty:
                        rank += str(empty)
                        empty = 0
                    rank += piece
            if empty:
                rank += str(empty)
            ranks.append(rank)
        fen = f"{'/'.join(ranks)} w - - 0 1"
    if first_move:
        origin = first_move[:2]
        file_index = ord(origin[0]) - ord("a")
        row = 10 - int(origin[1:])
        placement = fen.split()[0].split("/")
        square_piece = ""
        cursor = 0
        for token in placement[row]:
            if token.isdigit():
                cursor += int(token)
            else:
                if cursor == file_index:
                    square_piece = token
                    break
                cursor += 1
        if not square_piece:
            raise ValueError(f"first move has no piece at {origin}")
        fen = _fen_with_turn(fen, "w" if square_piece.isupper() else "b")
    return fen


def _comment_annotations(
    tags: dict[str, str], paths: dict[int, tuple[str, ...]]
) -> tuple[AnnotationValue, ...]:
    values: list[tuple[int, int, str, str]] = []
    for name, body in tags.items():
        match = COMMENT_TAG_PATTERN.fullmatch(name)
        if not match or not body:
            continue
        line = int(match.group(1) or 0)
        ply = int(match.group(2))
        values.append((line, ply, name, body.replace("||||", "\n\n").replace("||", "\n")))
    annotations: list[AnnotationValue] = []
    for line, ply, source_key, body in sorted(values, key=lambda item: (item[0], item[1], item[2])):
        path = paths.get(line)
        if path is None:
            raise ValueError(f"{source_key} refers to missing variation {line}")
        if not 0 <= ply <= len(path):
            raise ValueError(f"{source_key} refers to ply {ply}, beyond line {line}")
        anchor_path = " ".join(path[:ply])
        annotations.append(
            AnnotationValue(
                anchor_kind="root" if ply == 0 else "move" if line == 0 else "variation",
                anchor_ply=ply if line == 0 else None,
                anchor_path=anchor_path,
                annotation_type="comment",
                body=body.strip(),
                source_key=source_key,
                payload={"dhtmlLine": line, "dhtmlPly": ply},
            )
        )
    return tuple(annotations)


def _tree_nodes(
    roots: Sequence[_TreeNode],
    mainline: tuple[str, ...],
    initial_fen: str,
) -> tuple[SourceTreeNode, ...]:
    leaves = _leaf_paths(roots)
    indexed_by_path: dict[tuple[str, ...], tuple[int, str, str, str]] = {}
    for leaf in leaves:
        for position in index_validated_line(leaf, initial_fen):
            ply = position[0] + 1
            indexed_by_path.setdefault(leaf[:ply], position)
    nodes: list[SourceTreeNode] = []

    def visit(siblings: Sequence[_TreeNode]) -> None:
        for node in siblings:
            position = indexed_by_path[node.path]
            is_mainline = node.path == mainline[: len(node.path)]
            nodes.append(
                SourceTreeNode(
                    path=" ".join(node.path),
                    ply=len(node.path),
                    move=node.move,
                    notation=position[3],
                    position_key=position[1],
                    is_mainline=is_mainline,
                    child_order=node.order,
                    canonical_ply=len(node.path) if is_mainline else None,
                )
            )
            visit(node.children)

    visit(roots)
    return tuple(nodes)


def parse_manual_document(
    document: str,
    manual: Manual,
    reference: RecordRef,
) -> ParsedManualRecord:
    tags = parse_dhtmlxq_tags(document)
    mainline = _mainline(document, tags)
    definitions = _line_definitions(document, tags)
    paths = _resolve_line_paths(mainline, definitions)
    roots = _build_tree(paths)
    initial_fen = binit_to_fen(tags.get("binit", ""), mainline[0])
    result_text = tags.get("result", "")
    if result_text not in RESULTS:
        raise ValueError(f"unsupported DhtmlXQ result: {result_text}")
    played_at = tags.get("date", "0000-00-00") or "0000-00-00"
    played_at = played_at.replace(" ", "T", 1)
    title = tags.get("title") or reference.title or f"{manual.title} {reference.external_id}"
    return ParsedManualRecord(
        manual=manual,
        reference=reference,
        title=title,
        initial_fen=initial_fen,
        result=RESULTS[result_text],
        played_at=played_at,
        tags=tags,
        mainline=mainline,
        line_paths=paths,
        notation_text=_render_tree(roots),
        annotations=_comment_annotations(tags, paths),
        tree_nodes=_tree_nodes(roots, mainline, initial_fen),
    )


def validate_tree(record: ParsedManualRecord, validator: PikafishGameValidator) -> None:
    roots = _build_tree(record.line_paths)
    for leaf in _leaf_paths(roots):
        validator.validate(leaf, record.initial_fen)


def _record_from_anchor(
    href: str, onclick: str, title: str, base_url: str
) -> RecordRef | None:
    resolved = urllib.parse.urljoin(base_url, html.unescape(href))
    match = VIEW_FILE_PATTERN.search(resolved)
    if match:
        owner, external_id = match.group(1).casefold(), match.group(2)
        return RecordRef(owner, external_id, title, resolved)
    query_match = VIEW_QUERY_PATTERN.search(resolved)
    if query_match:
        owner = (query_match.group(1) or query_match.group(4)).casefold()
        external_id = query_match.group(2) or query_match.group(3)
        return RecordRef(
            owner,
            external_id,
            title,
            RECORD_URL.format(owner=owner, id=external_id),
        )
    call_match = VIEW_CALL_PATTERN.search(f"{href} {onclick}")
    if call_match:
        owner, external_id = call_match.group(1).casefold(), call_match.group(2)
        return RecordRef(
            owner,
            external_id,
            title,
            RECORD_URL.format(owner=owner, id=external_id),
        )
    return None


def _canonical_http_url(url: str) -> str:
    parts = urllib.parse.urlsplit(html.unescape(url))
    path = urllib.parse.quote(urllib.parse.unquote(parts.path), safe="/:@-._~!$&'()*+,;=")
    query = urllib.parse.quote(urllib.parse.unquote(parts.query), safe="=&/:@-._~!$'()*+,;")
    return urllib.parse.urlunsplit(
        (parts.scheme.casefold(), parts.netloc.casefold(), path, query, "")
    )


def parse_manual_index(
    document: str, *, page_url: str, manual_url: str
) -> tuple[list[RecordRef], list[str]]:
    parser = _AnchorParser()
    parser.feed(document)
    table_parser = _IndexTableParser()
    table_parser.feed(document)
    records: dict[tuple[str, str], RecordRef] = {}
    pages: set[str] = set()
    manual_parts = urllib.parse.urlsplit(manual_url)
    manual_path = urllib.parse.unquote(manual_parts.path).rstrip("/") + "/"
    manual_directory = urllib.parse.urljoin(manual_url, "../")
    for row in table_parser.rows:
        for cell in row:
            for href, onclick, title in cell.anchors:
                reference = _record_from_anchor(href, onclick, title, page_url)
                if reference is None:
                    continue
                chapter_title = row[4].text if len(row) > 4 else ""
                source_order_text = row[0].text if row else ""
                source_order = (
                    int(source_order_text) if source_order_text.isdigit() else 0
                )
                chapter_url = (
                    _canonical_http_url(
                        urllib.parse.urljoin(
                            manual_directory,
                            urllib.parse.quote(chapter_title, safe="") + "/",
                        )
                    )
                    if chapter_title
                    else ""
                )
                enriched = replace(
                    reference,
                    chapter_title=chapter_title,
                    chapter_url=chapter_url,
                    source_order=source_order,
                )
                existing = records.get(enriched.key)
                if existing is None or (
                    not existing.chapter_title and enriched.chapter_title
                ):
                    records[enriched.key] = enriched
    for href, onclick, title in parser.anchors:
        reference = _record_from_anchor(href, onclick, title, page_url)
        if reference:
            existing = records.get(reference.key)
            if existing is None or (not existing.title and reference.title):
                records[reference.key] = reference
            continue
        if not href or href.startswith(("#", "javascript:", "mailto:")):
            continue
        resolved = urllib.parse.urljoin(page_url, html.unescape(href))
        parts = urllib.parse.urlsplit(resolved)
        path = urllib.parse.unquote(parts.path)
        relative_path = (
            path[len(manual_path) :].strip("/") if path.startswith(manual_path) else ""
        )
        if (
            parts.scheme in {"http", "https"}
            and parts.netloc.casefold() == manual_parts.netloc.casefold()
            and path.startswith(manual_path)
            and (
                path.rstrip("/") == manual_path.rstrip("/")
                or INDEX_PAGE_PATTERN.fullmatch(relative_path)
            )
        ):
            pages.add(_canonical_http_url(resolved))
    return list(records.values()), sorted(pages)


def parse_manual_chapters(
    document: str, *, manual_url: str
) -> list[tuple[str, str]]:
    parser = _IndexTableParser()
    parser.feed(document)
    manual_parts = urllib.parse.urlsplit(manual_url)
    manual_path = urllib.parse.unquote(manual_parts.path).rstrip("/") + "/"
    chapters: dict[str, tuple[int, str]] = {}
    for row in parser.rows:
        if len(row) < 3 or not row[0].text.isdigit():
            continue
        for href, _onclick, anchor_title in row[2].anchors:
            resolved = urllib.parse.urljoin(manual_url, html.unescape(href))
            parts = urllib.parse.urlsplit(resolved)
            path = urllib.parse.unquote(parts.path)
            if (
                parts.netloc.casefold() != manual_parts.netloc.casefold()
                or not path.startswith(manual_path)
            ):
                continue
            relative = path[len(manual_path) :].strip("/")
            if not relative or "/" in relative or relative == "棋谱列表":
                continue
            title = anchor_title or row[2].text
            chapters[title] = (int(row[0].text), _canonical_http_url(resolved))
    # DPXQ numbers directory rows newest-first. Reverse that presentation order
    # so chapter sections remain stable as older directories precede newer ones.
    return [
        (title, source_url)
        for title, (_source_order, source_url) in sorted(
            chapters.items(), key=lambda item: item[1][0], reverse=True
        )
    ]


Fetch = Callable[..., bytes]


def _fetch_with_retry(
    fetch: Fetch,
    url: str,
    *,
    timeout: float,
    user_agent: str,
    retries: int,
    retry_backoff: float,
) -> bytes:
    for attempt in range(retries + 1):
        try:
            return fetch(url, timeout=timeout, user_agent=user_agent)
        except DownloadFailure as exc:
            if not exc.retryable or attempt >= retries:
                raise
            time.sleep(max(exc.retry_after, retry_backoff * (2**attempt)))
    raise AssertionError("unreachable")


def discover_manual_records(
    manual: Manual,
    *,
    fetch: Fetch,
    root: str = ANCIENT_ROOT,
    timeout: float = 30.0,
    user_agent: str = DEFAULT_USER_AGENT,
    retries: int = 4,
    retry_backoff: float = 2.0,
    verify_count: bool = True,
) -> list[RecordRef]:
    manual_directory_url = _canonical_http_url(manual.url(root))
    chapter_payload = _fetch_with_retry(
        fetch,
        manual_directory_url,
        timeout=timeout,
        user_agent=user_agent,
        retries=retries,
        retry_backoff=retry_backoff,
    )
    published_chapters = parse_manual_chapters(
        decode_html(chapter_payload), manual_url=manual_directory_url
    )
    published_chapter_order = {
        title: (order, source_url)
        for order, (title, source_url) in enumerate(published_chapters, start=1)
    }
    manual_url = _canonical_http_url(manual.listing_url(root))
    queue = [manual_url]
    visited: set[str] = set()
    records: dict[tuple[str, str], RecordRef] = {}
    while queue:
        page_url = queue.pop(0)
        if page_url in visited:
            continue
        if len(visited) >= MAX_INDEX_PAGES:
            raise RuntimeError(f"{manual.title} index exceeded {MAX_INDEX_PAGES} pages")
        visited.add(page_url)
        payload = _fetch_with_retry(
            fetch,
            page_url,
            timeout=timeout,
            user_agent=user_agent,
            retries=retries,
            retry_backoff=retry_backoff,
        )
        found, pages = parse_manual_index(
            decode_html(payload), page_url=page_url, manual_url=manual_url
        )
        for reference in found:
            existing = records.get(reference.key)
            if existing is None or (not existing.title and reference.title):
                records[reference.key] = reference
        queue.extend(page for page in pages if page not in visited and page not in queue)
    def record_key(item: RecordRef) -> tuple[int, str]:
        return (
            int(item.external_id) if item.external_id.isdigit() else 2**63,
            item.external_id,
        )

    grouped: dict[str, list[RecordRef]] = {}
    for reference in records.values():
        grouped.setdefault(reference.chapter_title or "Uncategorized", []).append(reference)
    ordered = []
    chapter_groups = sorted(
        grouped.items(),
        key=lambda item: (
            published_chapter_order.get(item[0], (2**31, ""))[0],
            min(record_key(reference) for reference in item[1]),
        ),
    )
    for chapter_order, (chapter_title, chapter_records) in enumerate(
        chapter_groups, start=1
    ):
        published_chapter_url = published_chapter_order.get(
            chapter_title, (0, "")
        )[1]
        for game_order, reference in enumerate(
            sorted(chapter_records, key=record_key), start=1
        ):
            ordered.append(
                replace(
                    reference,
                    chapter_url=published_chapter_url or reference.chapter_url,
                    chapter_order=chapter_order,
                    game_order=game_order,
                )
            )
    if verify_count and len(ordered) != manual.expected_records:
        raise RuntimeError(
            f"{manual.title}: DPXQ index exposed {len(ordered)} records; "
            f"expected {manual.expected_records}. Refusing an incomplete import."
        )
    return ordered


def _cached_record(
    path: Path, manual: Manual, reference: RecordRef
) -> ParsedManualRecord | None:
    try:
        return parse_manual_document(decode_html(path.read_bytes()), manual, reference)
    except (OSError, UnicodeError, ValueError):
        return None


def _save_record(payload: bytes, destination: Path, manual: Manual, reference: RecordRef) -> None:
    # Parse before the atomic rename so interrupted or error pages never become
    # trusted cache entries.
    parse_manual_document(decode_html(payload), manual, reference)
    partial_directory = destination.parent / ".partial"
    partial_directory.mkdir(parents=True, exist_ok=True)
    partial = partial_directory / f"{destination.name}.part"
    try:
        partial.write_bytes(payload)
        partial.replace(destination)
    finally:
        partial.unlink(missing_ok=True)


class AncientManualImporter:
    def __init__(self, database: Path, *, commit_each: bool = True) -> None:
        self.database = database
        self.commit_each = commit_each
        self.connection: sqlite3.Connection | None = None
        self.validator = PikafishGameValidator()
        self.counts = {"seen": 0, "imported": 0, "duplicate": 0, "invalid": 0}
        self.existing: set[str] = set()

    def __enter__(self) -> "AncientManualImporter":
        self.validator.start()
        self.database.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(self.database)
        initialize(self.connection)
        self.existing = {
            str(row[0])
            for row in self.connection.execute(
                "SELECT external_id FROM game_sources "
                "WHERE source = 'dpxq' AND collection = ?",
                (COLLECTION,),
            )
        }
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()

    def close(self) -> None:
        if self.connection is not None:
            self.connection.commit()
            self.connection.close()
            self.connection = None
        self.validator.close()

    def import_path(self, path: Path, manual: Manual, reference: RecordRef) -> None:
        if self.connection is None:
            raise RuntimeError("ancient-manual importer is not open")
        source_external_id = f"{manual.slug}:{reference.owner}:{reference.external_id}"
        self.counts["seen"] += 1
        if source_external_id in self.existing:
            self._update_existing_hierarchy(manual, reference)
            self.counts["duplicate"] += 1
            if self.commit_each:
                self.connection.commit()
            return
        savepoint = "dpxq_ancient_import"
        self.connection.execute(f"SAVEPOINT {savepoint}")
        try:
            document = decode_html(path.read_bytes())
            record = parse_manual_document(document, manual, reference)
            validate_tree(record, self.validator)
            self._store(record, path)
            self.connection.execute(f"RELEASE SAVEPOINT {savepoint}")
            self.existing.add(source_external_id)
            self.counts["imported"] += 1
        except (OSError, UnicodeError, ValueError, sqlite3.DatabaseError) as exc:
            self.connection.execute(f"ROLLBACK TO SAVEPOINT {savepoint}")
            self.connection.execute(f"RELEASE SAVEPOINT {savepoint}")
            checksum = hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else ""
            record_ingest_failure(
                self.connection,
                source="dpxq",
                collection=COLLECTION,
                external_id=source_external_id,
                stage="ancient_manual_import",
                error=exc,
                parser_version=PARSER_VERSION,
                raw_checksum=checksum,
            )
            self.counts["invalid"] += 1
            print(f"Rejected {manual.title} {reference.external_id}: {exc}", file=sys.stderr)
        if self.commit_each:
            self.connection.commit()

    @staticmethod
    def _hierarchy(
        manual: Manual,
        reference: RecordRef,
        *,
        fallback_chapter: str = "",
    ) -> dict[str, object]:
        chapter_title = (
            reference.chapter_title.strip()
            or fallback_chapter.strip()
            or "Uncategorized"
        )
        chapter_url = reference.chapter_url
        if not chapter_url and chapter_title != "Uncategorized":
            chapter_url = _canonical_http_url(
                urllib.parse.urljoin(
                    manual.url(),
                    urllib.parse.quote(chapter_title, safe="") + "/",
                )
            )
        return {
            "manual": manual.title,
            "manualSlug": manual.slug,
            "manualOrder": next(
                (
                    order
                    for order, published in enumerate(MANUALS, start=1)
                    if published.slug == manual.slug
                ),
                0,
            ),
            "manualUrl": manual.url(),
            "chapter": chapter_title,
            "chapterOrder": reference.chapter_order,
            "chapterUrl": chapter_url,
            "gameOrder": reference.game_order,
            "owner": reference.owner,
            "recordId": reference.external_id,
        }

    def _update_existing_hierarchy(
        self, manual: Manual, reference: RecordRef
    ) -> None:
        assert self.connection is not None
        source_external_id = f"{manual.slug}:{reference.owner}:{reference.external_id}"
        row = self.connection.execute(
            """
            SELECT id, metadata_json, locator_json
            FROM game_sources
            WHERE source = 'dpxq' AND collection = ? AND external_id = ?
            """,
            (COLLECTION, source_external_id),
        ).fetchone()
        if row is None:
            return
        hierarchy = self._hierarchy(manual, reference)
        metadata = json.loads(str(row[1]) or "{}")
        locator = json.loads(str(row[2]) or "{}")
        metadata.update(hierarchy)
        locator.update(hierarchy)
        self.connection.execute(
            """
            UPDATE game_sources
            SET metadata_json = ?, locator_json = ?, source_url = ?
            WHERE id = ?
            """,
            (
                compact_json(metadata),
                compact_json(locator),
                reference.url,
                int(row[0]),
            ),
        )

    def _store(self, record: ParsedManualRecord, path: Path) -> None:
        assert self.connection is not None
        # These fields identify a manual and a diagram, not two players. Keep
        # them losslessly searchable without pulling the optional multilingual
        # player-name romanization stack into this standalone scraper.
        red_name = " ".join(record.manual.title.split())
        black_name = " ".join(record.title.split())
        red_name_key = red_name.casefold()
        black_name_key = black_name.casefold()
        identity = record.identity
        game_id = stable_game_id(identity)
        positions = index_validated_line(record.mainline, record.initial_fen)
        year_text = record.played_at[:4]
        source_external_id = record.source_external_id
        cursor = self.connection.execute(
            """
            INSERT OR IGNORE INTO games(
              id, source, external_id, canonical_hash, line_hash, record_kind,
              statistical_eligible, initial_fen,
              red_name, red_name_romanized, red_name_romanization, red_name_key,
              black_name, black_name_romanized, black_name_romanization, black_name_key,
              result, played_at, year, month, event, round, opening, title,
              game_type, game_class, remark, author, reference, metadata_json,
              moves, notations, source_url
            ) VALUES (
              ?, 'dpxq_ancient_manuals', ?, ?, ?, 'manual_example', 0, ?,
              ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
              ?, ?, ?
            )
            """,
            (
                game_id,
                source_external_id,
                identity,
                line_hash(record.mainline, initial_fen=record.initial_fen),
                record.initial_fen,
                red_name,
                None,
                None,
                red_name_key,
                black_name,
                None,
                None,
                black_name_key,
                record.result,
                record.played_at,
                int(year_text) if year_text.isdigit() and year_text != "0000" else None,
                (
                    record.played_at[:7]
                    if re.fullmatch(r"\d{4}-\d{2}", record.played_at[:7])
                    and not record.played_at.startswith("0000-")
                    else None
                ),
                record.manual.title,
                record.tags.get("round", ""),
                record.tags.get("open", ""),
                record.title,
                record.tags.get("type", ""),
                record.tags.get("class", ""),
                record.tags.get("remark", ""),
                record.tags.get("author", ""),
                record.tags.get("refer", ""),
                "{}",
                json.dumps(record.mainline, separators=(",", ":")),
                json.dumps([position[3] for position in positions], ensure_ascii=False, separators=(",", ":")),
                record.reference.url,
            ),
        )
        if cursor.rowcount:
            self.connection.executemany(
                """
                INSERT INTO game_positions(game_id, ply, position_key, move, notation)
                VALUES (?, ?, ?, ?, ?)
                """,
                ((game_id, *position) for position in first_position_occurrences(positions)),
            )
        else:
            row = self.connection.execute(
                "SELECT id FROM games WHERE canonical_hash = ?", (identity,)
            ).fetchone()
            if row is None:
                raise RuntimeError("canonical manual game disappeared during import")
            game_id = str(row[0])

        work_id = f"dpxq:ancient:{record.manual.slug}"
        edition_id = f"{work_id}:online"
        self.connection.execute(
            """
            INSERT INTO works(
              id, title, alternate_titles_json, language, metadata_json
            )
            VALUES (?, ?, ?, 'zh', ?)
            ON CONFLICT(id) DO UPDATE SET
              title = excluded.title,
              alternate_titles_json = excluded.alternate_titles_json
            """,
            (
                work_id,
                record.manual.title,
                compact_json(list(record.manual.alternate_titles)),
                compact_json({"dpxqExpectedRecords": record.manual.expected_records}),
            ),
        )
        self.connection.execute(
            """
            INSERT INTO editions(id, work_id, title, language, source_url, metadata_json)
            VALUES (?, ?, ?, 'zh', ?, '{}')
            ON CONFLICT(id) DO UPDATE SET
              title = excluded.title, source_url = excluded.source_url
            """,
            (
                edition_id,
                work_id,
                f"{record.manual.title} — online edition",
                record.manual.url(),
            ),
        )
        raw = path.read_bytes()
        acquired_at = datetime.fromtimestamp(
            path.stat().st_mtime, tz=timezone.utc
        ).isoformat()
        metadata = {
            key: value
            for key, value in record.tags.items()
            if not key.startswith("comment") and not key.startswith("move_") and key != "movelist"
        }
        hierarchy = self._hierarchy(
            record.manual,
            record.reference,
            fallback_chapter=record.tags.get("round", ""),
        )
        metadata.update(hierarchy)
        metadata.update(
            {
                "dhtmlVariationCount": max(0, len(record.line_paths) - 1),
                "dhtmlCommentCount": len(record.annotations),
            }
        )
        layer = AnnotationLayer(
            kind="historical_commentary",
            annotator=record.tags.get("author", ""),
            language="zh",
            metadata={
                "format": "DhtmlXQ",
                "manual": record.manual.title,
            },
            annotations=record.annotations,
        )
        source_record_id = upsert_source_record(
            self.connection,
            source="dpxq",
            collection=COLLECTION,
            collection_name=COLLECTION_NAME,
            external_id=source_external_id,
            game_id=game_id,
            source_url=record.reference.url,
            metadata=metadata,
            moves=record.mainline,
            parser_version=PARSER_VERSION,
            raw_checksum=hashlib.sha256(raw).hexdigest(),
            acquired_at=acquired_at,
            notation_text=record.notation_text,
            annotation_layers=(layer,) if record.annotations else (),
            tree_nodes=record.tree_nodes if len(record.line_paths) > 1 else None,
        )
        self.connection.execute(
            """
            UPDATE game_sources
            SET edition_id = ?, locator_json = ?
            WHERE id = ?
            """,
            (
                edition_id,
                compact_json(
                    hierarchy
                ),
                source_record_id,
            ),
        )
        clear_ingest_failure(
            self.connection,
            source="dpxq",
            collection=COLLECTION,
            external_id=source_external_id,
        )


def _selected_manuals(values: Sequence[str]) -> list[Manual]:
    if not values:
        return list(MANUALS)
    selected: list[Manual] = []
    for raw in values:
        for value in raw.split(","):
            key = value.strip().casefold()
            if not key:
                continue
            manual = MANUAL_BY_KEY.get(key)
            if manual is None:
                raise argparse.ArgumentTypeError(f"unknown ancient manual: {value}")
            if manual not in selected:
                selected.append(manual)
    return selected


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--manual",
        action="append",
        default=[],
        help="manual slug/title; repeat or comma-separate (default: all 13)",
    )
    parser.add_argument("--database", type=Path, default=database_path())
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--root-url", default=ANCIENT_ROOT)
    parser.add_argument("--download-only", action="store_true")
    parser.add_argument("--discovery-only", action="store_true")
    parser.add_argument("--overwrite", action="store_true")
    parser.add_argument("--limit-per-manual", type=int)
    parser.add_argument("--skip-count-check", action="store_true")
    parser.add_argument("--delay", type=float, default=1.0)
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument("--retries", type=int, default=4)
    parser.add_argument("--retry-backoff", type=float, default=2.0)
    parser.add_argument("--user-agent", default=DEFAULT_USER_AGENT)
    parser.add_argument(
        "--cookie",
        default=os.environ.get("DPXQ_COOKIE", ""),
        help="optional DPXQ session cookie; prefer the DPXQ_COOKIE environment variable",
    )
    args = parser.parse_args(argv)
    try:
        manuals = _selected_manuals(args.manual)
    except argparse.ArgumentTypeError as exc:
        parser.error(str(exc))
    if args.delay < 0.25:
        parser.error("--delay must be at least 0.25 seconds")
    if args.timeout <= 0 or args.retries < 0 or args.retry_backoff < 0:
        parser.error("timeout must be positive and retry values cannot be negative")
    if args.limit_per_manual is not None and args.limit_per_manual <= 0:
        parser.error("--limit-per-manual must be positive")

    fetcher = PersistentRecordFetcher(cookie=args.cookie)
    importer: AncientManualImporter | None = None
    if not args.download_only and not args.discovery_only:
        importer = AncientManualImporter(args.database)
        importer.__enter__()
    summary: list[dict[str, object]] = []
    failed = 0
    try:
        for manual_index, manual in enumerate(manuals):
            references = discover_manual_records(
                manual,
                fetch=fetcher,
                root=args.root_url,
                timeout=args.timeout,
                user_agent=args.user_agent,
                retries=args.retries,
                retry_backoff=args.retry_backoff,
                verify_count=not args.skip_count_check,
            )
            selected = (
                references[: args.limit_per_manual]
                if args.limit_per_manual is not None
                else references
            )
            downloaded = cached = 0
            if not args.discovery_only:
                for index, reference in enumerate(selected, start=1):
                    destination = (
                        args.output
                        / manual.slug
                        / f"view_{reference.owner}_{reference.external_id}.html"
                    )
                    parsed = None if args.overwrite else _cached_record(destination, manual, reference)
                    if parsed is None:
                        try:
                            payload = _fetch_with_retry(
                                fetcher,
                                reference.url,
                                timeout=args.timeout,
                                user_agent=args.user_agent,
                                retries=args.retries,
                                retry_backoff=args.retry_backoff,
                            )
                            destination.parent.mkdir(parents=True, exist_ok=True)
                            _save_record(payload, destination, manual, reference)
                            downloaded += 1
                        except (DownloadFailure, OSError, UnicodeError, ValueError) as exc:
                            failed += 1
                            print(
                                f"Failed {manual.title} {reference.external_id}: {exc}",
                                file=sys.stderr,
                                flush=True,
                            )
                            continue
                    else:
                        cached += 1
                    if importer:
                        importer.import_path(destination, manual, reference)
                    if index < len(selected) and args.delay:
                        time.sleep(args.delay)
            summary.append(
                {
                    "slug": manual.slug,
                    "title": manual.title,
                    "expected": manual.expected_records,
                    "discovered": len(references),
                    "selected": len(selected),
                    "downloaded": downloaded,
                    "cached": cached,
                }
            )
            if manual_index + 1 < len(manuals) and args.delay:
                time.sleep(args.delay)
    except KeyboardInterrupt:
        return 130
    finally:
        fetcher.close()
        if importer:
            importer.close()
    result: dict[str, object] = {
        "collection": COLLECTION,
        "manuals": summary,
        "failed": failed,
    }
    if importer:
        result["import"] = importer.counts
        result["database"] = str(args.database.resolve())
    print(json.dumps(result, ensure_ascii=False, indent=2), flush=True)
    return 1 if failed or (importer and importer.counts["invalid"]) else 0


if __name__ == "__main__":
    raise SystemExit(main())
