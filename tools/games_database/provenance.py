"""Source-witness and annotation persistence."""

from __future__ import annotations

import hashlib
import json
import sqlite3
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from .storage import compact_json, line_hash


@dataclass(frozen=True, slots=True)
class AnnotationValue:
    anchor_kind: str
    annotation_type: str
    body: str = ""
    anchor_ply: int | None = None
    anchor_path: str = ""
    payload: Mapping[str, Any] = field(default_factory=dict)
    source_key: str = ""


@dataclass(frozen=True, slots=True)
class AnnotationSeriesValue:
    series_type: str
    values: Sequence[Any]
    moves: Sequence[str] = ()
    metadata: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class AnnotationLayer:
    kind: str
    annotator: str = ""
    language: str = ""
    engine: str = ""
    engine_version: str = ""
    created_at: str = ""
    license: str = ""
    metadata: Mapping[str, Any] = field(default_factory=dict)
    annotations: Sequence[AnnotationValue] = ()
    series: Sequence[AnnotationSeriesValue] = ()


@dataclass(frozen=True, slots=True)
class SourceTreeNode:
    path: str
    ply: int
    move: str
    notation: str = ""
    position_key: str = ""
    is_mainline: bool = False
    child_order: int = 0
    canonical_ply: int | None = None


def _comment_anchor(key: str, move_count: int) -> tuple[str, int | None]:
    suffix = key.removeprefix("comment")
    if suffix.isdigit():
        ply = int(suffix)
        if ply == 0:
            return "root", 0
        if ply <= move_count:
            return "move", ply
    return "record", None


def _annotation_hash(body: str) -> bytes:
    return hashlib.sha256(" ".join(body.split()).encode("utf-8")).digest()


def record_ingest_failure(
    connection: sqlite3.Connection,
    *,
    source: str,
    collection: str,
    external_id: str,
    stage: str,
    error: Exception,
    parser_version: str,
    raw_checksum: str = "",
) -> None:
    failed_at = datetime.now(timezone.utc).isoformat()
    connection.execute(
        """
        INSERT INTO ingest_failures(
          source, collection, external_id, stage, error, raw_checksum,
          parser_version, first_failed_at, last_failed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source, collection, external_id) DO UPDATE SET
          stage = excluded.stage,
          error = excluded.error,
          raw_checksum = excluded.raw_checksum,
          parser_version = excluded.parser_version,
          last_failed_at = excluded.last_failed_at,
          attempts = ingest_failures.attempts + 1
        """,
        (
            source,
            collection,
            external_id,
            stage,
            str(error)[:2_000],
            raw_checksum,
            parser_version,
            failed_at,
            failed_at,
        ),
    )


def clear_ingest_failure(
    connection: sqlite3.Connection,
    *,
    source: str,
    collection: str,
    external_id: str,
) -> None:
    connection.execute(
        """
        DELETE FROM ingest_failures
        WHERE source = ? AND collection = ? AND external_id = ?
        """,
        (source, collection, external_id),
    )


def _insert_annotation_layer(
    connection: sqlite3.Connection,
    source_record_id: int,
    layer: AnnotationLayer,
) -> None:
    cursor = connection.execute(
        """
        INSERT INTO annotation_sets(
          source_record_id, kind, annotator, language, engine, engine_version,
          created_at, license, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            source_record_id,
            layer.kind,
            layer.annotator,
            layer.language,
            layer.engine,
            layer.engine_version,
            layer.created_at,
            layer.license,
            compact_json(layer.metadata),
        ),
    )
    annotation_set_id = int(cursor.lastrowid)
    for ordinal, annotation in enumerate(layer.annotations):
        connection.execute(
            """
            INSERT INTO annotations(
              annotation_set_id, anchor_kind, anchor_ply, anchor_path,
              annotation_type, body, payload_json, source_key, ordinal,
              content_hash
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                annotation_set_id,
                annotation.anchor_kind,
                annotation.anchor_ply,
                annotation.anchor_path.strip(),
                annotation.annotation_type,
                annotation.body,
                compact_json(annotation.payload),
                annotation.source_key,
                ordinal,
                _annotation_hash(annotation.body) if annotation.body else None,
            ),
        )
    for series in layer.series:
        connection.execute(
            """
            INSERT INTO annotation_series(
              annotation_set_id, series_type, values_json, moves_json,
              metadata_json
            ) VALUES (?, ?, ?, ?, ?)
            """,
            (
                annotation_set_id,
                series.series_type,
                compact_json(list(series.values)),
                compact_json(list(series.moves)),
                compact_json(series.metadata),
            ),
        )


def _replace_source_tree(
    connection: sqlite3.Connection,
    source_record_id: int,
    nodes: Sequence[SourceTreeNode],
) -> None:
    connection.execute(
        "DELETE FROM source_tree_nodes WHERE source_record_id = ?",
        (source_record_id,),
    )
    ids_by_path: dict[str, int] = {}
    for node in sorted(nodes, key=lambda item: (item.ply, item.child_order, item.path)):
        path = " ".join(node.path.split())
        if not path or path in ids_by_path:
            raise ValueError("source tree paths must be non-empty and unique")
        parent_path = path.rpartition(" ")[0]
        parent_id = ids_by_path.get(parent_path)
        cursor = connection.execute(
            """
            INSERT INTO source_tree_nodes(
              source_record_id, parent_id, path, ply, move, notation,
              position_key, is_mainline, child_order, canonical_ply
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                source_record_id,
                parent_id,
                path,
                node.ply,
                node.move,
                node.notation,
                node.position_key,
                int(node.is_mainline),
                node.child_order,
                node.canonical_ply,
            ),
        )
        ids_by_path[path] = int(cursor.lastrowid)


def upsert_source_record(
    connection: sqlite3.Connection,
    *,
    source: str,
    collection: str,
    collection_name: str,
    external_id: str,
    game_id: str,
    source_url: str,
    metadata: Mapping[str, Any],
    moves: Sequence[str],
    parser_version: str,
    raw_checksum: str = "",
    acquired_at: str = "",
    notation_text: str = "",
    annotation_layers: Sequence[AnnotationLayer] = (),
    tree_nodes: Sequence[SourceTreeNode] | None = None,
) -> int:
    """Upsert a witness and replace its derived annotation projection.

    The original downloaded page remains the lossless source. Recognized dense
    annotations are removed from the generic JSON copy so the database does not
    store the same large arrays twice.
    """

    comments = {
        str(key): str(value)
        for key, value in metadata.items()
        if str(key).startswith("comment") and value not in (None, "")
    }
    remark = metadata.get("remark")
    ai_scores = metadata.get("ai_scores")
    ai_moves = metadata.get("ai_moves")
    structured_keys = {*comments, "ai_scores", "ai_moves"}
    if remark:
        structured_keys.add("remark")
    residual = {str(key): value for key, value in metadata.items() if key not in structured_keys}

    connection.execute(
        """
        INSERT INTO game_sources(
          source, collection, collection_name, external_id, game_id, source_url,
          metadata_json, raw_checksum, parser_version, acquired_at, mainline_hash,
          notation_text
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source, collection, external_id) DO UPDATE SET
          collection_name = excluded.collection_name,
          game_id = excluded.game_id,
          source_url = excluded.source_url,
          metadata_json = excluded.metadata_json,
          raw_checksum = CASE
            WHEN excluded.raw_checksum <> '' THEN excluded.raw_checksum
            ELSE game_sources.raw_checksum
          END,
          parser_version = excluded.parser_version,
          acquired_at = CASE
            WHEN excluded.acquired_at <> '' THEN excluded.acquired_at
            ELSE game_sources.acquired_at
          END,
          mainline_hash = excluded.mainline_hash,
          notation_text = CASE
            WHEN excluded.notation_text <> '' THEN excluded.notation_text
            ELSE game_sources.notation_text
          END
        """,
        (
            source,
            collection,
            collection_name,
            external_id,
            game_id,
            source_url,
            compact_json(residual),
            raw_checksum,
            parser_version,
            acquired_at,
            line_hash(moves),
            notation_text,
        ),
    )
    source_record_id = int(
        connection.execute(
            """
            SELECT id FROM game_sources
            WHERE source = ? AND collection = ? AND external_id = ?
            """,
            (source, collection, external_id),
        ).fetchone()[0]
    )
    connection.execute(
        "DELETE FROM annotation_sets WHERE source_record_id = ?", (source_record_id,)
    )

    if comments or remark:
        cursor = connection.execute(
            """
            INSERT INTO annotation_sets(
              source_record_id, kind, annotator, language, metadata_json
            ) VALUES (?, 'source_commentary', ?, ?, '{}')
            """,
            (
                source_record_id,
                str(metadata.get("author") or metadata.get("annotator") or ""),
                str(metadata.get("language") or "zh"),
            ),
        )
        annotation_set_id = int(cursor.lastrowid)
        ordinal = 0
        for key, body in sorted(
            comments.items(),
            key=lambda item: (
                int(item[0].removeprefix("comment"))
                if item[0].removeprefix("comment").isdigit()
                else 2**31,
                item[0],
            ),
        ):
            anchor_kind, anchor_ply = _comment_anchor(key, len(moves))
            connection.execute(
                """
                INSERT INTO annotations(
                  annotation_set_id, anchor_kind, anchor_ply, annotation_type,
                  body, source_key, ordinal, content_hash
                ) VALUES (?, ?, ?, 'comment', ?, ?, ?, ?)
                """,
                (
                    annotation_set_id,
                    anchor_kind,
                    anchor_ply,
                    body,
                    key,
                    ordinal,
                    _annotation_hash(body),
                ),
            )
            ordinal += 1
        if remark:
            body = str(remark)
            connection.execute(
                """
                INSERT INTO annotations(
                  annotation_set_id, anchor_kind, annotation_type, body,
                  source_key, ordinal, content_hash
                ) VALUES (?, 'record', 'remark', ?, 'remark', ?, ?)
                """,
                (annotation_set_id, body, ordinal, _annotation_hash(body)),
            )

    if isinstance(ai_scores, list) and ai_scores:
        cursor = connection.execute(
            """
            INSERT INTO annotation_sets(
              source_record_id, kind, annotator, language, engine, metadata_json
            ) VALUES (?, 'engine_analysis', 'GDChess/01xq', '', 'unknown', '{}')
            """,
            (source_record_id,),
        )
        connection.execute(
            """
            INSERT INTO annotation_series(
              annotation_set_id, series_type, values_json, moves_json
            ) VALUES (?, 'evaluation', ?, ?)
            """,
            (
                int(cursor.lastrowid),
                json.dumps(ai_scores, separators=(",", ":")),
                json.dumps(ai_moves if isinstance(ai_moves, list) else [], separators=(",", ":")),
            ),
        )

    for layer in annotation_layers:
        _insert_annotation_layer(connection, source_record_id, layer)

    if tree_nodes is not None:
        if tree_nodes and not notation_text.strip():
            raise ValueError(
                "a source variation tree requires lossless notation_text"
            )
        _replace_source_tree(connection, source_record_id, tree_nodes)

    # Source membership determines the public explorer categories. Merge the
    # canonical game into newly visible categories in the same transaction.
    from .explorer_index import update_game

    update_game(connection, game_id)
    return source_record_id
