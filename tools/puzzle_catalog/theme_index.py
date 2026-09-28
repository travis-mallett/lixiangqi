"""SQLite's indexed, multi-valued theme lookup for a puzzle table."""


def install(connection, *, schema, table, column, themes):
    # Callers supply schema identifiers and SQL expressions from source code,
    # never operator input. The same transaction installs and seeds the index.
    if connection.execute(
        f"SELECT 1 FROM {schema}.sqlite_master WHERE name='inventory_themes'"
    ).fetchone():
        return
    expression = themes.format(row="new.")
    connection.executescript(f"""
        BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS {schema}.inventory_themes(
            theme TEXT NOT NULL,puzzle_id TEXT NOT NULL,PRIMARY KEY(theme,puzzle_id)
        ) WITHOUT ROWID;
        CREATE INDEX IF NOT EXISTS {schema}.inventory_themes_by_puzzle ON inventory_themes(puzzle_id);
        INSERT OR IGNORE INTO {schema}.inventory_themes
            SELECT j.value,p.id FROM {schema}.{table} p,json_each({themes.format(row='p.')}) j;
        CREATE TRIGGER IF NOT EXISTS {schema}.inventory_themes_insert AFTER INSERT ON {table} BEGIN
            DELETE FROM inventory_themes WHERE puzzle_id=new.id;
            INSERT OR IGNORE INTO inventory_themes SELECT value,new.id FROM json_each({expression});
        END;
        CREATE TRIGGER IF NOT EXISTS {schema}.inventory_themes_update AFTER UPDATE OF id,{column} ON {table} BEGIN
            DELETE FROM inventory_themes WHERE puzzle_id IN (old.id,new.id);
            INSERT OR IGNORE INTO inventory_themes SELECT value,new.id FROM json_each({expression});
        END;
        CREATE TRIGGER IF NOT EXISTS {schema}.inventory_themes_delete AFTER DELETE ON {table} BEGIN
            DELETE FROM inventory_themes WHERE puzzle_id=old.id;
        END;
        COMMIT;
    """)
