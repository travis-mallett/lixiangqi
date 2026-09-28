import unittest
from dataclasses import replace
from unittest.mock import Mock

from tools.xiangqi_data.pikafish_rules import default_executable
from tools.xiangqi_data.puzzle_mining import (
    final_move_mates as final,
    headhunter_cannon as headhunter,
)
from tools.xiangqi_data.puzzle_mining.engine import OfflinePikafish, EngineProtocolError
from tools.xiangqi_data.puzzle_mining.models import SearchContext, fen_side
from tools.xiangqi_data.puzzle_mining.patterns import (
    TerminalPosition,
    STALEMATE_THEME,
    LEISURELY_STROLL_THEME,
    HEADHUNTER_CANNON_THEME,
    CROSS_CHECK_THEME,
    matching_assessed_themes,
)
from tools.xiangqi_data.puzzle_mining.position import decode_position
from tools.xiangqi_data.puzzle_mining.classification import TacticalClassifier
from tools.xiangqi_data.puzzle_mining.classification_job import (
    _evaluate_category,
    _save_category,
    taxonomy_versions,
)
from tools.xiangqi_data.tests.test_puzzle_throat_cutting import trace_for

STALE = "5k3/9/7N1/9/2N6/9/9/9/9/4K4 w - - 0 1"
STROLL = "5kbnC/4P4/9/9/9/9/9/9/9/3K5 w - - 0 1"
HEAD = "2bakab2/R8/8N/9/9/9/9/9/9/3KC4 w - - 0 1"
CROSS = {"e1": "K", "e10": "k", "e3": "r", "a3": "R", "d8": "R", "f8": "R"}


def trace(fen=STROLL, move="d1d2", mirror=False, stale=True):
    t = trace_for(decode_position(fen), (move,), mirror)
    return replace(t, terminal=replace(t.terminal, checked=not stale))


def terminal(t):
    return TerminalPosition(
        t.terminal.fen, t.checkmate, fen_side(t.terminal.fen), t.stalemate
    )


class TerminalMotifsTest(unittest.TestCase):
    def test_stalemate_and_stroll_both_colors(self):
        for mirror in (False, True):
            stroll = trace(mirror=mirror)
            horse = trace(STALE, "c6d8", mirror)
            for t in (stroll, horse):
                self.assertEqual(
                    matching_assessed_themes(terminal(t), {}, {STALEMATE_THEME}),
                    {STALEMATE_THEME},
                )
            self.assertTrue(final.leisurely_stroll(stroll))
            self.assertFalse(final.leisurely_stroll(horse))
            self.assertFalse(final.leisurely_stroll(replace(horse, decisions=())))
            self.assertFalse(
                final.leisurely_stroll(
                    replace(stroll, terminal=replace(stroll.terminal, checked=True))
                )
            )
            live = replace(
                stroll, terminal=replace(stroll.terminal, legal_moves=("f10f9",))
            )
            self.assertFalse(final.leisurely_stroll(live))
            self.assertFalse(
                matching_assessed_themes(terminal(live), {}, {STALEMATE_THEME})
            )
            self.assertFalse(final.leisurely_stroll(replace(stroll, verified=False)))

    def test_headhunter_clear_center_file_both_terminal_types_and_colors(self):
        for mirror in (False, True):
            for stale in (False, True):
                t = trace(HEAD, "i8g9", mirror, stale)
                self.assertTrue(headhunter.candidate(terminal(t)))
                base = decode_position(HEAD)
                for piece in ("p", "P", "a", "R", "N", "c"):
                    blocked = trace_for({**base, "e5": piece}, ("i8g9",), mirror)
                    self.assertFalse(headhunter.candidate(terminal(blocked)))
                for origin, target in (("e1", "d2"), ("e10", "f9")):
                    board = dict(base)
                    board[target] = board.pop(origin)
                    shifted = trace_for(board, ("i8g9",), mirror)
                    self.assertFalse(headhunter.candidate(terminal(shifted)))
                self.assertFalse(
                    headhunter.candidate(
                        replace(terminal(t), checkmate=False, stalemate=False)
                    )
                )

    def test_headhunter_rejects_any_checking_cannon_and_reuses_evidence(self):
        for mirror in (False, True):
            t = terminal(trace(HEAD, "i8g9", mirror, False))
            horse, cannon = ("g2", "e10") if mirror else ("g9", "e1")
            for checkers, expected in (
                ((horse,), "key"),
                ((cannon,), "not_key"),
                ((horse, cannon), "not_key"),
                ((), "inconclusive"),
                ((horse, horse), "inconclusive"),
            ):
                engine = Mock()
                engine.checking_pieces.return_value = (t.fen, checkers)
                record = headhunter.assess(engine, t)
                self.assertEqual(record["outcome"], expected)
                self.assertEqual(
                    headhunter.evidence_outcome(t, record),
                    None if expected == "inconclusive" else expected,
                )
                self.assertIsNone(
                    headhunter.evidence_outcome(t, {**record, "logic_version": "1.0"})
                )
            engine = Mock()
            stale = replace(t, checkmate=False, stalemate=True)
            self.assertEqual(headhunter.assess(engine, stale)["outcome"], "key")
            engine.checking_pieces.assert_not_called()
            engine.checking_pieces.side_effect = EngineProtocolError("failed")
            self.assertEqual(headhunter.assess(engine, t)["outcome"], "inconclusive")

    @unittest.skipUnless(default_executable().is_file(), "local Pikafish required")
    def test_real_headhunter_alignment_with_another_cannon_check_is_rejected(self):
        engine = OfflinePikafish(default_executable())
        self.addCleanup(engine.close)
        for mirror in (False, True):
            for extra in ({}, {"a10": "R"}):
                board = {
                    "e10": "k",
                    "e7": "C",
                    "e2": "C",
                    "d9": "R",
                    "f9": "R",
                    "d1": "K",
                    **extra,
                }
                t = trace_for(board, ("e2e3",), mirror)
                self.assertTrue(
                    engine.inspect(SearchContext(t.terminal.fen, ())).checkmate
                )
                self.assertTrue(headhunter.candidate(terminal(t)))
                self.assertEqual(
                    headhunter.assess(engine, terminal(t))["outcome"], "not_key"
                )

    def test_headhunter_category_persistence_and_reuse(self):
        from tools.xiangqi_data.tests.test_puzzle_storage_lifecycle import (
            PuzzleStorageLifecycleTest,
        )
        from tools.xiangqi_data.puzzle_mining.solver import VerifiedBranch

        f = PuzzleStorageLifecycleTest()
        f.setUp(themes=None)
        self.addCleanup(f.tearDown)
        t = trace(HEAD, "i8g9", stale=False)
        f.verify(
            result=f.result(
                branches=(VerifiedBranch(t.moves, t.terminal, decisions=t.decisions),)
            )
        )
        row = f.current()
        current = {
            "candidate_id": row["id"],
            "current_verification_id": row["current_verification_id"],
        }
        engine = Mock()
        engine.checking_pieces.return_value = (t.terminal.fen, ("g9",))
        outcome, proofs = _evaluate_category(
            f.connection,
            current,
            (t,),
            TacticalClassifier(),
            HEADHUNTER_CANNON_THEME,
            engine,
            None,
        )
        self.assertEqual(outcome, "match")
        self.assertTrue(
            _save_category(
                f.connection,
                current,
                HEADHUNTER_CANNON_THEME,
                taxonomy_versions(),
                outcome,
                proofs,
            )
        )
        reused, _ = _evaluate_category(
            f.connection,
            current,
            (t,),
            TacticalClassifier(),
            HEADHUNTER_CANNON_THEME,
            None,
            None,
        )
        self.assertEqual(reused, "match")
        engine.checking_pieces.assert_called_once()

    def test_incomplete_final_move_evidence_is_inconclusive(self):
        t = trace()
        for bad in (
            replace(t, decisions=()),
            replace(t, moves=("bad",)),
            replace(t, decisions=(replace(t.decisions[0], position_fen=""),)),
            replace(t, decisions=(replace(t.decisions[0], selected_move="d1e1"),)),
            replace(
                t,
                terminal=replace(t.terminal, fen=t.terminal.fen.replace(" b ", " w ")),
            ),
        ):
            self.assertIsNone(final.leisurely_stroll(bad))

    def test_cross_check_evidence_requires_pre_move_enemy_check(self):
        for mirror in (False, True):
            t = trace_for(CROSS, ("a3e3",), mirror)
            enemy, friendly = ("e8", "a8") if mirror else ("e3", "a3")
            engine = Mock()
            for checkers, expected in (
                ((enemy,), "key"),
                ((), "not_key"),
                ((friendly,), "inconclusive"),
                ((enemy, enemy), "inconclusive"),
                (("a10",), "inconclusive"),
            ):
                engine.checking_pieces.return_value = (
                    t.decisions[-1].position_fen,
                    checkers,
                )
                record = final.assess(engine, t)
                self.assertEqual(record["outcome"], expected)
            engine.checking_pieces.return_value = (
                t.decisions[-1].position_fen,
                (enemy,),
            )
            record = final.assess(engine, t)
            for field, value in (
                ("logic_version", "old"),
                ("previous_fen", "old"),
                ("terminal_fen", "old"),
                ("move", "old"),
            ):
                self.assertIsNone(final.evidence_outcome(t, {**record, field: value}))
            engine.checking_pieces.side_effect = EngineProtocolError("failed")
            self.assertEqual(final.assess(engine, t)["outcome"], "inconclusive")
            engine.reset_mock()
            for bad in (
                replace(t, verified=False),
                replace(t, terminal=replace(t.terminal, checked=False)),
            ):
                self.assertEqual(final.assess(engine, bad)["outcome"], "not_key")
            self.assertEqual(
                final.assess(engine, replace(t, decisions=()))["outcome"],
                "inconclusive",
            )
            engine.checking_pieces.assert_not_called()

    @unittest.skipUnless(default_executable().is_file(), "local Pikafish required")
    def test_real_positions_both_colors(self):
        engine = OfflinePikafish(default_executable())
        self.addCleanup(engine.close)
        for mirror in (False, True):
            for t, theme in (
                (trace(STALE, "c6d8", mirror), STALEMATE_THEME),
                (trace(mirror=mirror), LEISURELY_STROLL_THEME),
                (trace(HEAD, "i8g9", mirror, False), HEADHUNTER_CANNON_THEME),
                (trace_for(CROSS, ("a3e3",), mirror), CROSS_CHECK_THEME),
            ):
                before = engine.inspect(t.decisions[-1].context)
                self.assertIn(t.moves[-1], before.legal_moves)
                status = engine.inspect(SearchContext(t.terminal.fen, ()))
                self.assertEqual(status.checkmate, t.checkmate)
                self.assertEqual(status.stalemate, t.stalemate)
                if theme == CROSS_CHECK_THEME:
                    self.assertTrue(before.checked)
                    self.assertEqual(final.assess(engine, t)["outcome"], "key")
                elif theme == HEADHUNTER_CANNON_THEME:
                    self.assertEqual(
                        headhunter.assess(engine, terminal(t))["outcome"], "key"
                    )
                elif theme == LEISURELY_STROLL_THEME:
                    self.assertTrue(final.leisurely_stroll(t))
                else:
                    self.assertEqual(
                        matching_assessed_themes(terminal(t), {}, {theme}), {theme}
                    )

    @unittest.skipUnless(default_executable().is_file(), "local Pikafish required")
    def test_cross_check_uses_the_last_decision_not_the_initial_position(self):
        engine = OfflinePikafish(default_executable())
        self.addCleanup(engine.close)
        for mirror in (False, True):
            board = {s: p for s, p in CROSS.items() if s not in {"e3", "a3"}}
            board.update({"e4": "r", "e2": "P", "a3": "R"})
            t = trace_for(board, ("a3a2", "e4e2", "a2e2"), mirror)
            self.assertFalse(engine.inspect(t.decisions[0].context).checked)
            self.assertTrue(engine.inspect(t.decisions[-1].context).checked)
            for decision in t.decisions:
                self.assertIn(
                    decision.selected_move, engine.inspect(decision.context).legal_moves
                )
            self.assertTrue(engine.inspect(SearchContext(t.terminal.fen, ())).checkmate)
            self.assertEqual(final.assess(engine, t)["outcome"], "key")
            ordinary = trace_for({**CROSS, "e3": "n"}, ("a3e3",), mirror)
            before = engine.inspect(ordinary.decisions[0].context)
            self.assertFalse(before.checked)
            self.assertIn(ordinary.moves[-1], before.legal_moves)
            self.assertTrue(
                engine.inspect(SearchContext(ordinary.terminal.fen, ())).checkmate
            )
            self.assertEqual(final.assess(engine, ordinary)["outcome"], "not_key")

    def test_direct_categories_and_stroll_branch_consensus_without_engine(self):
        good = trace()
        bad = trace(STALE, "c6d8")
        for theme, branches, expected in (
            (LEISURELY_STROLL_THEME, (good,), "match"),
            (LEISURELY_STROLL_THEME, (good, bad), "conflict"),
            (LEISURELY_STROLL_THEME, (bad,), "no_match"),
            (LEISURELY_STROLL_THEME, (replace(good, decisions=()),), "inconclusive"),
            (STALEMATE_THEME, (good, bad), "match"),
            (HEADHUNTER_CANNON_THEME, (trace(HEAD, "i8g9", stale=True),), "match"),
        ):
            db, engine = Mock(), Mock()
            self.assertEqual(
                _evaluate_category(
                    db,
                    {"current_verification_id": 1},
                    branches,
                    TacticalClassifier(),
                    theme,
                    engine,
                    None,
                ),
                (expected, {}),
            )
            self.assertFalse(db.mock_calls)
            self.assertFalse(engine.mock_calls)

    def test_cross_check_saved_proof_reuse_and_branch_conflict(self):
        from tools.xiangqi_data.tests.test_puzzle_storage_lifecycle import (
            PuzzleStorageLifecycleTest,
        )
        from tools.xiangqi_data.puzzle_mining.solver import VerifiedBranch
        from tools.xiangqi_data.puzzle_mining.category_status import pool_counts

        f = PuzzleStorageLifecycleTest()
        f.setUp(themes=None)
        self.addCleanup(f.tearDown)
        t = trace_for(CROSS, ("a3e3",))
        f.verify(
            result=f.result(
                branches=(VerifiedBranch(t.moves, t.terminal, decisions=t.decisions),)
            )
        )
        row = f.current()
        current = {
            "candidate_id": row["id"],
            "current_verification_id": row["current_verification_id"],
        }
        engine = Mock()
        engine.checking_pieces.return_value = (t.decisions[-1].position_fen, ("e3",))
        versions = taxonomy_versions()
        outcome, proofs = _evaluate_category(
            f.connection,
            current,
            (t,),
            TacticalClassifier(),
            CROSS_CHECK_THEME,
            engine,
            None,
        )
        self.assertEqual(outcome, "match")
        self.assertTrue(
            _save_category(
                f.connection, current, CROSS_CHECK_THEME, versions, outcome, proofs
            )
        )
        reused, _ = _evaluate_category(
            f.connection,
            current,
            (t,),
            TacticalClassifier(),
            CROSS_CHECK_THEME,
            None,
            None,
        )
        self.assertEqual(reused, "match")
        engine.checking_pieces.assert_called_once()
        selected = {
            k: v
            for k, v in versions.items()
            if k in {CROSS_CHECK_THEME, "__consensus__"}
        }
        self.assertEqual(pool_counts(f.connection, selected)["pending_checks"], 0)
        conflict, _ = _evaluate_category(
            f.connection,
            current,
            (t, trace()),
            TacticalClassifier(),
            CROSS_CHECK_THEME,
            None,
            None,
        )
        self.assertEqual(conflict, "conflict")


if __name__ == "__main__":
    unittest.main()
