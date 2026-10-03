import assert from 'node:assert/strict';
import { test } from 'node:test';

import { makeTree } from 'lib/tree/tree';

import { makeXiangqiNode } from '../src/xiangqi.ts';
import { fixturePositions } from './positionFixtures.ts';

test('puzzle display and analysis use the canonical native tree with notation-independent paths', () => {
  const fen = '4k4/9/9/9/4p4/9/9/9/9/R3K4 w - - 0 1';
  const positions = fixturePositions(fen, ['a1a2', 'e10d10']);
  const root = makeXiangqiNode(positions[0], '', '');
  root.ruleset = 'unrestricted-v1';
  const move = makeXiangqiNode(positions[1], 'a1a2', 'R9+1');
  move.chineseNotation = '车九进一';
  move.children = [makeXiangqiNode(positions[2], 'e10d10', 'K5+1')];
  root.children = [move];
  const tree = makeTree(root);
  assert.equal(tree.root.state.fen, fen);
  assert.equal(tree.root.children[0].notation, 'R9+1');
  assert.equal(tree.root.children[0].chineseNotation, '车九进一');
  assert.equal(tree.nodeAtPath('a1a2/e10d10').uci, 'e10d10');
  assert.deepEqual(tree.positionAt('a1a2/e10d10'), {
    initialFen: fen,
    moves: ['a1a2', 'e10d10'],
    ruleset: 'unrestricted-v1',
  });
});
