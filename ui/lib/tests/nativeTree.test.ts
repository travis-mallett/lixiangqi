import assert from 'node:assert/strict';
import { test } from 'node:test';

import { serializeMoveTree, deserializeMoveTree } from '../src/tree/native.ts';
import { completeNode } from '../src/tree/node.ts';
import { mainlineNodeList } from '../src/tree/ops.ts';
import { makeTree } from '../src/tree/tree.ts';
import type { TreeNodeBase } from '../src/tree/types.ts';

const fen = '4k4/9/9/9/4p4/9/9/9/9/R3K4 w - - 0 1';
const node = (ply: number, uci?: string): TreeNodeBase => ({
  fen,
  ply,
  uci,
  notation: uci,
  children: [],
  state: { fen, ply, turn: ply % 2 ? 'black' : 'red', check: false, legalMoves: [], gameResult: '*' },
});

test('browser JSON parsing and canonical hydration preserve a 600-ply native wire tree', () => {
  const root = node(0);
  root.ruleset = 'tiantian-v1';
  const moves = Array.from({ length: 600 }, (_, index) => ['a1a2', 'i10i9', 'a2a1', 'i9i10'][index % 4]);
  let parent = root;
  moves.forEach((move, index) => {
    const child = node(index + 1, move);
    parent.children = [child];
    parent = child;
  });
  const parsed = JSON.parse(JSON.stringify({ tree: root })) as { tree: TreeNodeBase };
  const tree = makeTree(completeNode(parsed.tree));
  const path = moves.join('/');
  assert.equal(mainlineNodeList(tree.root).length, 601);
  assert.equal(tree.nodeAtPath(path).ply, 600);
  assert.equal(tree.nodeAtPath(path).path, path);
  assert.deepEqual(tree.positionAt(path), { initialFen: fen, moves, ruleset: 'tiantian-v1' });
  const restored = deserializeMoveTree(JSON.parse(JSON.stringify(serializeMoveTree(tree, fen, path))), fen);
  assert.equal(restored.activePath, path);
  assert.equal(restored.tree.nodeAtPath(path).ply, 600);
});

test('full canonical transport preserves forced sibling order and all annotations through reload', () => {
  const root = node(0);
  root.ruleset = 'tiantian-v1';
  root.metadata = { ChapterName: 'Rank ten', Result: '1/2-0' };
  root.comments = [{ id: 'root', by: { kind: 'external', name: 'author' }, text: 'Root comment' }];
  const forced = {
    ...node(1, 'i10i9'),
    forceVariation: true,
    gamebook: { hint: 'hint', deviation: 'feedback' },
    shapes: [{ brush: 'red', orig: 'i10', dest: 'i1' }],
    glyphs: [{ id: 255, symbol: '$255', name: '$255' }],
    clock: 120,
    elapsed: 20,
    evaluation: { cp: 23, depth: 18 },
    result: '0-0',
  };
  root.children = [forced, node(1, 'a1a2')];
  const tree = makeTree(completeNode(JSON.parse(JSON.stringify(root))));
  assert.deepEqual(
    tree.root.children.map(child => child.id),
    ['i10i9', 'a1a2'],
  );
  assert.deepEqual(
    mainlineNodeList(tree.root).map(child => child.id),
    ['', 'a1a2'],
  );
  const restored = deserializeMoveTree(
    JSON.parse(JSON.stringify(serializeMoveTree(tree, fen, 'i10i9'))),
    fen,
  );
  assert.equal(restored.activePath, 'i10i9');
  const branch = restored.tree.nodeAtPath('i10i9');
  assert.deepEqual(branch.gamebook, forced.gamebook);
  assert.deepEqual(branch.shapes, forced.shapes);
  assert.deepEqual(branch.glyphs, forced.glyphs);
  assert.deepEqual(branch.evaluation, forced.evaluation);
  assert.equal(branch.clock, 120);
  assert.equal(branch.elapsed, 20);
  assert.equal(branch.result, '0-0');
  assert.deepEqual(restored.tree.root.metadata, root.metadata);
  assert.deepEqual(restored.tree.positionAt('i10i9'), {
    initialFen: fen,
    moves: ['i10i9'],
    ruleset: 'tiantian-v1',
  });
});
