from dataclasses import replace
import json
import random
import unittest
from unittest.mock import Mock, call

from external.pikafish_worker.ai import MoveWork, PikafishMoveEngine, STRENGTH_PROFILES
from external.pikafish_worker.kids import prefer_candidate, board_after, valid_profile
from external.pikafish_worker.opening import choose_opening_move
from external.pikafish_worker.selection import Candidate

FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1'


class KidsBotsTest(unittest.TestCase):
    def test_preference_cannot_exchange_quality_or_a_forced_win(self):
        candidates = {1: Candidate('a0a1', 'cp', 100), 2: Candidate('b2e2', 'cp', 90)}
        self.assertEqual('b2e2', prefer_candidate('v1/he-he', FEN, (), candidates, 'a0a1', random.Random(1)))
        candidates[2] = Candidate('b2e2', 'cp', -100)
        self.assertEqual('a0a1', prefer_candidate('v1/he-he', FEN, (), candidates, 'a0a1', random.Random(1)))
        candidates[1] = Candidate('a0a1', 'mate', 3)
        self.assertEqual('a0a1', prefer_candidate('v1/he-he', FEN, (), candidates, 'a0a1', random.Random(1)))

    def test_reconstruction_uses_all_history_and_both_sides(self):
        board = board_after(FEN, ('b3e3', 'b8e8'))
        self.assertEqual(board['e', 2], 'c')
        self.assertEqual(board['e', 7], 'c')
        self.assertNotIn(('b', 2), board)
        self.assertNotIn(('b', 7), board)

    def test_work_profile_is_validated_and_included_in_identity(self):
        work = MoveWork('kids0001', 1, FEN, (), ruleset='tiantian-v1', legal_moves=('a4a5',), bot_profile='v1/dou-dou')
        self.assertNotEqual(work.computed_turn_key, replace(work, bot_profile='v1/kou-kou').computed_turn_key)
        payload = dict(version=2, type='move', requestId='request12345', gameId=work.game_id,
                       level=1, botProfile=work.bot_profile, turnKey=work.computed_turn_key,
                       position=dict(variant='xiangqi', ruleset=work.ruleset, initialFen=FEN, moves=[], legalMoves=['a4a5']))
        self.assertEqual(MoveWork.parse_v2(json.dumps(payload)).bot_profile, work.bot_profile)
        payload['botProfile'] = 'v9/untrusted'
        with self.assertRaises(ValueError): MoveWork.parse_v2(json.dumps(payload))
        self.assertFalse(valid_profile('v9/dou-dou'))

    def test_style_never_expands_the_server_legal_move_set_or_node_budget(self):
        engine = PikafishMoveEngine()
        engine._ensure_started = Mock(); engine._send = Mock(); engine._read_until = Mock()
        engine._read_line = Mock(side_effect=['info depth 1 multipv 1 score cp 0 pv b2e2', 'bestmove b2e2'])
        work = MoveWork('kids0001', 187, FEN, (), ruleset='tiantian-v1', legal_moves=('a4a5',), bot_profile='v1/he-he')
        self.assertEqual(engine.best_move(work, STRENGTH_PROFILES[186]), 'a4a5')
        self.assertIn(call(f'go nodes {STRENGTH_PROFILES[186].nodes} searchmoves a3a4'), engine._send.call_args_list)

    def test_beginner_does_not_enter_master_book_or_book_miss_search(self):
        work = MoveWork('kids0001', 1, FEN, (), bot_profile='v1/dou-dou')
        engine = Mock(); fallback = Mock()
        self.assertIsNone(choose_opening_move(work, engine, missing_book_fallback=fallback))
        engine.book_position.assert_not_called(); fallback.assert_not_called()


if __name__ == '__main__': unittest.main()
