"""Transactionally indexed publication membership, maintained by the catalog.

The reader never decodes release archives or builds its own copy of membership.
Only a change of the authoritative baseline/release rebuilds this small index.
"""


def install(connection, *, schema="main"):
    if connection.execute(
        f"SELECT 1 FROM {schema}.sqlite_master WHERE name='published_inventory'"
    ).fetchone():
        return
    release = "(SELECT nullif(json_extract(value,'$'),'') FROM catalog_metadata WHERE key='deployedReleaseId')"
    fill = f"""INSERT INTO published_inventory(id,document)
        SELECT json_extract(value,'$._id'),json_object(
            '_id',json_extract(value,'$._id'),'themes',json_extract(value,'$.themes'),
            'retired',json_extract(value,'$.retired'))
        FROM json_each(CASE WHEN {release} IS NOT NULL
            THEN (SELECT json_extract(document,'$.puzzles') FROM catalog_releases WHERE id={release})
            ELSE (SELECT value FROM catalog_metadata WHERE key='baseline') END);"""
    validate = f"""SELECT CASE WHEN {release} IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM catalog_releases WHERE id={release}) THEN
        RAISE(ABORT,'Confirmed production release is missing from the local catalog') END;"""
    statements = [
        f"""BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS {schema}.published_inventory(id TEXT PRIMARY KEY,document TEXT NOT NULL);"""
    ]
    for operation, row in (("INSERT", "new"), ("UPDATE", "new"), ("DELETE", "old")):
        statements.append(
            f"""CREATE TRIGGER IF NOT EXISTS {schema}.published_inventory_meta_{operation.lower()}
            AFTER {operation} ON catalog_metadata WHEN {row}.key IN ('baseline','deployedReleaseId') BEGIN
            {validate}
            DELETE FROM published_inventory;
            {fill}
        END;"""
        )
    for operation, row in (("INSERT", "new"), ("UPDATE", "new"), ("DELETE", "old")):
        statements.append(
            f"""CREATE TRIGGER IF NOT EXISTS {schema}.published_inventory_release_{operation.lower()}
            AFTER {operation} ON catalog_releases WHEN {row}.id={release} BEGIN
            {validate}
            DELETE FROM published_inventory;
            {fill}
        END;"""
        )

    def qualified(sql):
        return (
            sql.replace(
                "INTO published_inventory", f"INTO {schema}.published_inventory"
            )
            .replace("FROM catalog_metadata", f"FROM {schema}.catalog_metadata")
            .replace("FROM catalog_releases", f"FROM {schema}.catalog_releases")
        )

    try:
        connection.executescript("\n".join(statements))
        if connection.execute(
            qualified(
                f"SELECT {release} IS NOT NULL AND NOT EXISTS(SELECT 1 FROM catalog_releases WHERE id={release})"
            )
        ).fetchone()[0]:
            raise ValueError(
                "Confirmed production release is missing from the local catalog"
            )
        connection.execute(qualified(fill))
        connection.commit()
    except BaseException:
        connection.rollback()
        raise
