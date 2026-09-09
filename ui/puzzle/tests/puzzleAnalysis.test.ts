import assert from 'node:assert/strict';
import { test } from 'node:test';

import { makeXiangqiNode, puzzleAnalysisTree } from '../src/xiangqi.ts';
import { linePositions } from '../src/xiangqiAdjudication.ts';

test('analysis exports only played puzzle moves, accepted first and failures as variations', () => {
  const fen = '4k4/9/9/9/4p4/9/9/9/9/R3K4 w - - 0 1';
  const positions = linePositions(fen, ['a1a2', 'e10d10', 'a2a3']);
  const root = makeXiangqiNode(positions[0], '', '', 0);
  const accepted = makeXiangqiNode(positions[1], 'a1a2', 'R9+1', 0);
  accepted.played = { notation: 'R9+1', chineseNotation: '车九进一', result: 'good' };
  const reply = makeXiangqiNode(positions[2], 'e10d10', 'K5+1', 0);
  reply.played = { notation: 'K5+1', chineseNotation: '' };
  accepted.children = [reply];
  const unplayedAnswer = makeXiangqiNode(positions[3], 'a2a3', '', 0);
  reply.children = [unplayedAnswer];
  const failed = makeXiangqiNode(linePositions(fen, ['a1a4'])[1], 'a1a4', '', 1);
  failed.played = { notation: 'R9+3', chineseNotation: '', result: 'fail' };
  // Revealing the solution may reorder the display tree and overwrite its annotations.
  failed.puzzle = 'good';
  root.children = [failed, accepted];
  const tree = puzzleAnalysisTree(root);
  assert.equal(tree.root.state.fen, fen);
  assert.deepEqual(
    tree.root.children.map(node => node.uci),
    ['a1a2', 'a1a4'],
  );
  assert.equal(tree.root.children[1].forceVariation, true);
  assert.equal(tree.root.children[0].chineseNotation, '车九进一');
  assert.deepEqual(
    tree.root.children[0].children.map(node => node.uci),
    ['e10d10'],
  );
  assert.deepEqual(tree.root.children[0].children[0].children, []);
  assert.equal(root.children[0], failed);
});
