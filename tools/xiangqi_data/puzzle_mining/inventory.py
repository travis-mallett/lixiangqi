"""Covering SQLite indexes for live inventory reads, separate from proof payloads.

These are database indexes, maintained atomically by SQLite for every writer.
Installing them is additive and does not migrate or back up puzzle data.
"""

SCHEMA = """
CREATE INDEX IF NOT EXISTS assessments_verification_guard ON candidate_assessments(
    candidate_id,accepted,coverage);
CREATE INDEX IF NOT EXISTS candidates_inventory ON candidates(
    id,candidate_key,candidate_type,current_verification_id,current_classification_id,
    status,source_database,game_id,updated_at,themes_json,pre_fen,played_move);
CREATE VIEW IF NOT EXISTS candidate_inventory AS
    SELECT id,candidate_key,candidate_type,current_verification_id,current_classification_id,
        status,source_database,game_id,updated_at,themes_json,pre_fen,played_move
    FROM candidates INDEXED BY candidates_inventory;

CREATE INDEX IF NOT EXISTS assessments_inventory ON candidate_assessments(
    id,candidate_id,coverage,accepted,solution_plies,
    (solution_json IS NOT NULL),(branches_json IS NOT NULL),
    (CASE WHEN json_valid(verification_settings_json)
        THEN json_extract(verification_settings_json,'$.history_policy') END));
CREATE VIEW IF NOT EXISTS assessment_inventory AS
    SELECT id,candidate_id,coverage,accepted,solution_plies,
        solution_json IS NOT NULL AS has_solution,branches_json IS NOT NULL AS has_branches,
        CASE WHEN json_valid(verification_settings_json)
            THEN json_extract(verification_settings_json,'$.history_policy') END AS history_policy
    FROM candidate_assessments INDEXED BY assessments_inventory;

CREATE INDEX IF NOT EXISTS taxonomy_inventory_index ON taxonomy_assessments(
    id,verification_assessment_id,json_extract(taxonomy_version,'$.versions'),status);
CREATE VIEW IF NOT EXISTS taxonomy_inventory AS
    SELECT id,verification_assessment_id,json_extract(taxonomy_version,'$.versions') AS versions,status
    FROM taxonomy_assessments INDEXED BY taxonomy_inventory_index;

CREATE INDEX IF NOT EXISTS puzzles_inventory ON puzzles(
    id,candidate_id,game_id,themes,solution_plies,mate_in,created_at,verification_status,fen,line);
CREATE VIEW IF NOT EXISTS puzzle_inventory AS
    SELECT id,candidate_id,game_id,themes,solution_plies,mate_in,created_at,verification_status,fen,line
    FROM puzzles INDEXED BY puzzles_inventory;

CREATE INDEX IF NOT EXISTS category_inventory ON category_assessments(
    candidate_id,verification_assessment_id,consensus_version,category,category_version,outcome);
"""


def install(connection, *, schema="main"):
    if schema not in {"main", "mining"}:
        raise ValueError("Invalid inventory schema")
    connection.executescript(
        SCHEMA.replace("IF NOT EXISTS ", f"IF NOT EXISTS {schema}.")
    )
    from tools.puzzle_catalog.theme_index import install as install_themes

    install_themes(
        connection,
        schema=schema,
        table="puzzles",
        column="themes",
        themes="{row}themes",
    )
