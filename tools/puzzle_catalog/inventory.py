"""Small covering index for navigation without reading embedded source histories."""

SCHEMA = """
CREATE INDEX IF NOT EXISTS catalog_inventory_index ON catalog_puzzles(
    id,json_extract(document,'$.gameId'),json_extract(document,'$.themes'),
    COALESCE(json_extract(document,'$.gameSource.database'),json_extract(document,'$.gameSource.origin'),''),
    json_extract(document,'$.retired'),json_extract(evidence,'$.status'),
    CASE WHEN json_type(document,'$.line')='array' THEN json_array_length(document,'$.line')
        ELSE length(json_extract(document,'$.line'))-length(replace(json_extract(document,'$.line'),' ',''))+1 END,
    json_extract(document,'$.fen'),json_extract(document,'$.line'));
CREATE VIEW IF NOT EXISTS catalog_inventory AS
    SELECT id,json_extract(document,'$.gameId') AS game_id,json_extract(document,'$.themes') AS themes,
        COALESCE(json_extract(document,'$.gameSource.database'),json_extract(document,'$.gameSource.origin'),'') AS source,
        json_extract(document,'$.retired') AS retired,json_extract(evidence,'$.status') AS evidence_status,
        CASE WHEN json_type(document,'$.line')='array' THEN json_array_length(document,'$.line')
            ELSE length(json_extract(document,'$.line'))-length(replace(json_extract(document,'$.line'),' ',''))+1 END AS line_length,
        json_extract(document,'$.fen') AS fen,json_extract(document,'$.line') AS line
    FROM catalog_puzzles INDEXED BY catalog_inventory_index;
"""


def install(connection, *, schema="main"):
    if schema not in {"main", "authored"}:
        raise ValueError("Invalid inventory schema")
    connection.executescript(
        SCHEMA.replace("IF NOT EXISTS ", f"IF NOT EXISTS {schema}.")
    )
    from .theme_index import install as install_themes

    install_themes(
        connection,
        schema=schema,
        table="catalog_puzzles",
        column="document",
        themes="json_extract({row}document,'$.themes')",
    )
    from .publication_inventory import install as install_publication

    install_publication(connection, schema=schema)
