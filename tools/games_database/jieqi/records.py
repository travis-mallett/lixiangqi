"""Explicit jieqi records only. Never invent missing reveals or convert xiangqi by title."""
from __future__ import annotations

from dataclasses import asdict, dataclass
import hashlib
import json
import re

from tools.games_database.storage import canonical_hash, compact_json, line_hash
from tools.xiangqi_data.dpxq_import import dhtml_move_to_uci, parse_tags
from .sources import JIEQI, Page

START_FEN = "xxxxkxxxx/9/1x5x1/x1x1x1x1x/9/9/X1X1X1X1X/1X5X1/9/XXXXKXXXX w j - 0 1"
ROLES = "advisor|elephant|horse|chariot|cannon|soldier"
MOVE = re.compile(rf"[a-i](?:10|[1-9])[a-i](?:10|[1-9])(?:~(?:{ROLES})(?:~(?:{ROLES}))?|~~(?:{ROLES}))?")
FEN = re.compile(r"(?<![\w/])([rnbakcphexxRNBAKCPHEXX1-9/]+ [wb](?: j - \d+ \d+)?)(?!\w)")


class Unsupported(ValueError):
    """Preserve the original payload for review; it is not a validated game."""


@dataclass(frozen=True)
class Record:
    initial_fen: str
    moves: tuple[str, ...]
    red: str = ""
    black: str = ""
    result: str = "*"
    event: str = ""
    date: str = ""
    title: str = ""
    ruleset: str = "jieqi-v1"

    @property
    def kind(self):
        if self.initial_fen != START_FEN:
            return "fragment"
        return "game" if self.result != "*" else "unfinished"

    def hashes(self, source_url: str):
        # The full tokens include reveal AND captured-piece knowledge. Unknown
        # identities are not equated with known ones. Aliases are not guessed.
        line = line_hash(self.moves, variant=self.ruleset, initial_fen=self.initial_fen).hex()
        identity = canonical_hash(self.moves, variant=self.ruleset, initial_fen=self.initial_fen,
                                  red_name=self.red, black_name=self.black, result=self.result).hex()
        if not self.red or not self.black:
            identity = hashlib.sha256((identity + "\0" + source_url).encode()).hexdigest()
        return identity, line

    def json(self):
        return compact_json(asdict(self))


def normalize(value: dict) -> Record:
    if not isinstance(value, dict):
        raise Unsupported("Expected a record object")
    if value.get("variant") != "jieqi":
        raise Unsupported("An explicit variant=jieqi is required")
    if value.get("ruleset", "jieqi-v1") != "jieqi-v1":
        raise Unsupported("Unsupported jieqi ruleset; retain original without reinterpretation")
    fen = value.get("initial_fen", START_FEN)
    if not isinstance(fen, str):
        raise Unsupported("initial_fen must be a string")
    parts = fen.split()
    if len(parts) == 2:
        parts += ["j", "-", "0", "1"]
    if len(parts) != 6 or parts[2:4] != ["j", "-"]:
        raise Unsupported("Expected a public jieqi FEN")
    parts[0] = parts[0].translate(str.maketrans("heHE", "nbNB"))
    moves = value.get("moves")
    if not isinstance(moves, list) or not moves or any(not isinstance(m, str) or not MOVE.fullmatch(m) for m in moves):
        raise Unsupported("Missing/malformed 1-based coordinate moves with explicit ~role reveals")
    result = value.get("result", "*")
    if result not in {"*", "1-0", "0-1", "1/2-1/2"}:
        raise Unsupported("Invalid result")
    metadata = {key: value.get(key, "") for key in ("red", "black", "event", "date", "title")}
    if any(not isinstance(v, str) for v in metadata.values()):
        raise Unsupported("Record metadata must contain strings")
    return Record(" ".join(parts), tuple(moves), result=result, **metadata)


def parse_record(document: str) -> Record | None:
    if document.lstrip().startswith("{"):
        value = json.loads(document)
        if value.get("schema") != "lixiangqi-jieqi-record-v1":
            raise Unsupported("Unrecognized JSON schema; no guessed source field mapping")
        return normalize(value)
    if re.match(r'\[\s*(?:\{|\[|\]|"|\d|true|false|null)', document.lstrip()):
        raise Unsupported("JSON arrays are not individual records; split into one object per file")
    # Coordinate PGN exported by the native notation layer (one game per file).
    if re.search(r'\[Variant\s+"Jieqi"\]', document, re.I):
        headers = dict(re.findall(r'\[(\w+)\s+"([^"\r\n]*)"\]', document))
        if len(re.findall(r'\[Variant\s+', document, re.I)) != 1:
            raise Unsupported("Split multi-game PGN files before importing")
        body = re.sub(r'\[\w+\s+"[^"\r\n]*"\]', "", document)
        body = re.sub(r"\{[^}]*\}|;[^\n]*", " ", body)
        # Preserve unsupported branching notation in raw evidence, never flatten it silently.
        if "(" in body or ")" in body:
            raise Unsupported("PGN variations require a lossless source adapter")
        tokens = re.sub(r"\b\d+\.(?:\.\.)?", " ", body).split()
        result = tokens.pop() if tokens and tokens[-1] in {"*", "1-0", "0-1", "1/2-1/2"} else headers.get("Result", "*")
        if headers.get("Result", result) != result:
            raise Unsupported("Conflicting PGN results")
        return normalize(dict(variant="jieqi", initial_fen=headers.get("FEN", START_FEN), moves=tokens,
                              result=result, red=headers.get("Red", headers.get("White", "")),
                              black=headers.get("Black", ""), event=headers.get("Event", ""),
                              date=headers.get("Date", ""), ruleset=headers.get("Ruleset", "jieqi-v1")))
    page = Page(document)
    tags = parse_tags(document)
    if not JIEQI.search(page.title + " " + tags.get("title", "")):
        return None
    text = "\n".join(page.text)
    fens = [m.group(1) for m in FEN.finditer(text) if m.group(1).split()[0].count("/") == 9]
    # XQipu publishes an ICCS string followed by its starting FEN. Its ranks
    # are 0..9, unlike our native 1..10 notation.
    lines = re.findall(r"(?<![a-z0-9])(?:[a-i][0-9][a-i][0-9])+(?![a-z0-9])", text)
    if fens and len(set(fens)) == 1 and len(set(lines)) == 1:
        encoded = lines[0]
        moves = [f"{a}{int(b)+1}{c}{int(d)+1}" for a,b,c,d in
                 (encoded[i:i+4] for i in range(0, len(encoded), 4))]
        return normalize(dict(variant="jieqi", initial_fen=fens[0], moves=moves, title=page.title))
    if tags.get("movelist"):
        # DhtmlXQ has no verified jieqi reveal encoding. Only accept an explicit
        # all-revealed FEN fragment; never start ordinary coordinates as jieqi.
        fen = tags.get("fen", "")
        if not fen or "x" in fen.lower():
            raise Unsupported("DhtmlXQ jieqi reveals/initial position unavailable")
        encoded = tags["movelist"]
        if not re.fullmatch(r"(?:\d{4})+", encoded):
            raise Unsupported("Malformed DhtmlXQ moves")
        return normalize(dict(variant="jieqi", initial_fen=fen,
                              moves=[dhtml_move_to_uci(encoded[i:i+4]) for i in range(0,len(encoded),4)],
                              title=tags.get("title", ""), red=tags.get("red", ""), black=tags.get("black", "")))
    return None
