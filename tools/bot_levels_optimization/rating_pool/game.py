"""Production moves and book policy, with one isolated runtime per worker."""

from external.pikafish_worker.ai import MoveWork
from external.pikafish_worker.opening import choose_opening_move
from external.xiangqi_explorer.explorer import master_book_moves
from tools.xiangqi_data.pikafish_rules import START_FEN

from ..native_rules import NativeRules
from ..runtime import CalibrationEngine


def profile_seed_level(bot_id: str) -> int:
    """Return the profile identity used to seed deterministic move sampling."""
    if bot_id.startswith("level-"):
        return int(bot_id.removeprefix("level-"))
    if bot_id == "endpoint-low":
        return 1
    if bot_id == "endpoint-high":
        return 9
    return 10 + int(bot_id[4:])


class GameRuntime:
    def __init__(self, java=None, class_path=None):
        self.engine = CalibrationEngine()
        self.rules = NativeRules(java, class_path)

    def close(self):
        try:
            self.engine.close()
        finally:
            self.rules.close()

    def play(
        self, plan, red, black, max_plies, full_logs=False, replay_book=None, stop=None
    ):
        moves = ()
        record = {
            **plan,
            "initialFen": START_FEN,
            "ruleset": "tiantian-v1",
            "status": "failed",
            "result": None,
            "book": {},
            "plies": 0,
        }
        book_failed = False

        def lookup(fen):
            nonlocal book_failed
            try:
                response = (
                    replay_book[fen]
                    if replay_book is not None
                    else master_book_moves(fen)
                )
                record["book"][fen] = response
                return response
            except Exception:
                book_failed = True
                raise

        stage = "rules"
        try:
            for ply in range(max_plies + 1):
                if stop is not None and stop.is_set():
                    record.update(status="interrupted", termination="user_interrupt")
                    break
                stage = "rules"
                state = self.rules.position(START_FEN, moves)
                record["finalFen"] = state["fen"]
                if state["gameResult"] != "*":
                    record.update(
                        status="completed",
                        result=state["gameResult"],
                        termination=state.get("termination"),
                    )
                    break
                if ply == max_plies:
                    record.update(status="censored", termination="maximum_plies")
                    break
                bot = red if state["turn"] == "red" else black
                identity = profile_seed_level(bot.id)
                work = MoveWork(
                    plan["gameId"],
                    identity,
                    START_FEN,
                    moves,
                    ruleset="tiantian-v1",
                    legal_moves=tuple(state["legalMoves"]),
                )
                stage = "opening"
                move = choose_opening_move(work, self.engine, book_lookup=lookup)
                if book_failed:
                    raise RuntimeError("Opening book lookup failed; game excluded")
                if move is None:
                    stage = "search"
                    self.engine.available_count = False
                    self.engine.invalid_output = False
                    move = self.engine.best_move(work, bot.profile())
                    if self.engine.invalid_output:
                        raise RuntimeError("Engine returned an invalid or missing move")
                if move not in work.legal_moves:
                    raise RuntimeError("Move not legal under native rules")
                moves += (move,)
                record["plies"] = len(moves)
        except Exception as error:  # noqa: BLE001 - infrastructure failures must never be scored
            record["failure"] = {
                "stage": stage,
                "type": type(error).__name__,
                "message": str(error),
                "timeout": isinstance(error, TimeoutError),
            }
            self.close()
        if full_logs:
            record["moves"] = moves
        return record
