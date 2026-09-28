"""Resolve canonical IDs and retained source references through catalog provenance.

Published puzzles and existing game links retain source IDs after catalog
unification. They identify source witnesses, not rows in the canonical games table.
"""

from .catalog_index import ONLINE_SOURCE_IDS

CATALOG_SOURCE_ALIASES = {
    "dpxq": "dpxq",
    "gdchess": "gdchess_01xq",
    "gdchess_01xq": "gdchess_01xq",
    "xqdao": "xqdao",
}


def source_locator(game_id: str):
    if game_id.startswith("dpxq_online:"):
        collection, separator, external_id = game_id.removeprefix(
            "dpxq_online:"
        ).partition(":")
        if separator and collection in ONLINE_SOURCE_IDS and external_id:
            return "dpxq", collection, external_id
    for source in ("dpxq", "gdchess_01xq", "xqdao"):
        prefix = source + ":"
        if game_id.startswith(prefix) and game_id[len(prefix) :]:
            return source, None, game_id[len(prefix) :]
    return None


def resolve_catalog_game(connection, game_id: str, database: str | None = None):
    row = connection.execute(
        "SELECT g.*, COALESCE(json_extract(g.moves, '$[0]'), '') AS move FROM games g WHERE g.id=?",
        (game_id,),
    ).fetchone()
    if row is not None:
        return row
    source = CATALOG_SOURCE_ALIASES.get(database)
    external_id, collection = game_id, None
    locator = source_locator(game_id)
    if locator:
        identified_source, collection, external_id = locator
        if source and source != identified_source:
            raise ValueError(f"catalog source conflicts with game reference: {game_id}")
        source = identified_source
    conditions, parameters = ["s.external_id=?"], [external_id]
    if source:
        conditions.append("s.source=?")
        parameters.append(source)
    if collection:
        conditions.append("s.collection=?")
        parameters.append(collection)
    # Multiple witnesses of one canonical game are harmless. Different games
    # sharing a source locator must never be resolved by arbitrary row order.
    ids = connection.execute(
        "SELECT DISTINCT s.game_id FROM game_sources s WHERE "
        + " AND ".join(conditions)
        + " LIMIT 2",
        parameters,
    ).fetchall()
    if len(ids) > 1:
        raise ValueError(f"ambiguous catalog game reference: {game_id}")
    if not ids:
        return None
    return connection.execute(
        "SELECT g.*, COALESCE(json_extract(g.moves, '$[0]'), '') AS move FROM games g WHERE g.id=?",
        (ids[0][0],),
    ).fetchone()
