import assert from 'node:assert/strict';
import { test } from 'node:test';

import { makeXiangqiNode, puzzleNotationTree } from '../src/xiangqi.ts';
import { linePositions } from '../src/xiangqiAdjudication.ts';

test('notation and analysis share the displayed puzzle tree and map navigation paths', () => {
  const fen = '4k4/9/9/9/4p4/9/9/9/9/R3K4 w - - 0 1';
  const positions = linePositions(fen, ['a1a2', 'e10d10']);
  const root = makeXiangqiNode(positions[0], '', '', 0);
  const move = makeXiangqiNode(positions[1], 'a1a2', '车九进一', 0);
  move.wxfNotation = 'R9+1';
  move.chineseNotation = '车九进一';
  const reply = makeXiangqiNode(positions[2], 'e10d10', 'K5+1', 0);
  move.children = [reply];
  root.children = [move];
  const { tree, paths } = puzzleNotationTree(root, 'setup');
  assert.equal(tree.root.state.fen, fen);
  assert.equal(tree.root.children[0].notation, '车九进一');
  assert.equal(tree.root.children[0].wxfNotation, 'R9+1');
  assert.equal(tree.root.children[0].chineseNotation, '车九进一');
  assert.equal(paths.get(tree.root.children[0].children[0].path), 'setup' + move.id + reply.id);
  assert.equal(paths.get(''), 'setup');
});
