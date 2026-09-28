"""Admit inherited live positions to mining without inventing verification evidence.

The master site's reconciled inventory remains the source. Imports preserve
history and are transactional and idempotent; saved lines are publication
history, never proof. Routine imports do not copy the local mining database.
"""

from tools.xiangqi_data.puzzle_mining.models import (
    CandidateRecord,
    EngineScore,
    fen_side,
)
from tools.xiangqi_data.puzzle_mining.position import (
    candidate_key,
    normalized_fen,
    position_hash,
    replay_fens,
)
from tools.xiangqi_data.puzzle_mining.queue_priority import live_inventory
from tools.xiangqi_data.puzzle_mining.sources import native_source_database
from tools.xiangqi_data.puzzle_mining.storage import _json, insert_candidate, now

from .catalog import fen_ply, validate_puzzle


def import_live_positions(connection, catalog_path):
    inventory = live_inventory(catalog_path)
    if not any(
        not connection.execute(
            "SELECT 1 FROM puzzles WHERE id=?", (p["_id"],)
        ).fetchone()
        for p in inventory
    ):
        return 0
    imported = 0
    connection.execute("BEGIN IMMEDIATE")
    try:
        for puzzle in inventory:
            if connection.execute(
                "SELECT 1 FROM puzzles WHERE id=?", (puzzle["_id"],)
            ).fetchone():
                continue
            p = validate_puzzle(puzzle)
            snap = p["sourceSnapshot"]
            offset = fen_ply(p["fen"]) - fen_ply(snap["initialFen"])
            history = tuple(snap["moves"][: offset + 1])
            fens = replay_fens(list(history), snap["initialFen"])
            if normalized_fen(fens[-2]) != normalized_fen(p["fen"]):
                raise ValueError(f"Published puzzle {p['_id']} source position differs")
            key = candidate_key(fens[-1], history, snap["initialFen"])
            owner = connection.execute(
                "SELECT candidate_key FROM candidates WHERE position_hash=?",
                (position_hash(fens[-1]),),
            ).fetchone()
            if owner and owner[0] != key:
                # The position is already reserved. In particular, do not
                # reimport retired duplicates from an older live inventory.
                continue
            row = connection.execute(
                "SELECT id FROM candidates WHERE candidate_key=?", (key,)
            ).fetchone()
            if row:
                candidate_id = row[0]
            else:
                source = p["gameSource"]
                database = (
                    source["database"]
                    if source["type"] == "catalog"
                    else native_source_database(source["origin"])
                )
                candidate_id = insert_candidate(
                    connection,
                    CandidateRecord(
                        candidate_key=key,
                        source_database=database,
                        game_id=p["gameId"],
                        source_url=snap.get("sourceUrl", ""),
                        ply=len(history),
                        side_to_move=fen_side(fens[-1]),
                        pre_fen=p["fen"],
                        position_fen=fens[-1],
                        position_hash=position_hash(fens[-1]),
                        played_move=history[-1],
                        best_move=p["line"].split()[1],
                        before_score=EngineScore("unassessed", 0),
                        after_score=EngineScore("unassessed", 0),
                        evaluation_loss=0,
                        candidate_type=(
                            "checkmate_candidate"
                            if "mate" in p.get("themes", [])
                            else "tactic_candidate"
                        ),
                        engine_version="published-source",
                        nnue="",
                        search_settings={"origin": "published-source"},
                    ),
                    commit=False,
                )
            if connection.execute(
                "SELECT 1 FROM puzzles WHERE candidate_id=? AND verification_status='active'",
                (candidate_id,),
            ).fetchone():
                # Prefer the real public identity over an unpublished duplicate.
                # Preserve the superseded row and all assessment history.
                connection.execute(
                    "UPDATE puzzles SET verification_status='withdrawn',retired_at=?,retirement_reason='merged with existing live puzzle' WHERE candidate_id=? AND verification_status='active'",
                    (now(), candidate_id),
                )
                connection.execute(
                    "UPDATE candidates SET current_classification_id=NULL WHERE id=?",
                    (candidate_id,),
                )
            line = p["line"].split()
            connection.execute(
                """INSERT INTO puzzles(
                id,candidate_id,game_id,source_url,fen,display_fen,initial_ply,line,solution,
                solution_plies,mate_in,themes,engine,nnue,engine_nodes,engine_depth,generator_version,created_at)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,0,?)""",
                (
                    p["_id"],
                    candidate_id,
                    p["gameId"],
                    snap.get("sourceUrl", ""),
                    p["fen"],
                    fens[-1],
                    fen_ply(p["fen"]),
                    _json(line),
                    _json(line[1:]),
                    len(line) - 1,
                    len(line) // 2 if "mate" in p.get("themes", []) else None,
                    _json(p["themes"]),
                    "published-source",
                    "",
                    now(),
                ),
            )
            imported += 1
        connection.commit()
        return imported
    except BaseException:
        connection.rollback()
        raise
