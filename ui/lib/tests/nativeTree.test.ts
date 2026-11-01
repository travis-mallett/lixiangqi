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

for (const toMainline of [false, true]) {
  test(`promotion matches server ordering with forced siblings before the main line (mainline=${toMainline})`, () => {
    const root = node(0);
    const before = { ...node(1, 'a4a5'), forceVariation: true, clock: 99 };
    const after = { ...node(1, 'c4c5'), forceVariation: true, clock: 98 };
    const sibling = { ...node(2, 'a7a6'), forceVariation: true, clock: 97 };
    const selected = { ...node(2, 'i7i6'), forceVariation: true, clock: 4321 };
    const main = { ...node(1, 'i4i5'), children: [sibling, selected], clock: 1234 };
    root.children = [before, main, after];
    const tree = makeTree(completeNode(root));
    const untouched = JSON.stringify([before, after, sibling]);
    tree.promoteAt('i4i5/i7i6', toMainline);
    assert.deepEqual(
      root.children.map(n => n.id),
      toMainline ? ['i4i5', 'a4a5', 'c4c5'] : ['a4a5', 'i4i5', 'c4c5'],
    );
    assert.deepEqual(
      main.children.map(n => n.id),
      ['i7i6', 'a7a6'],
    );
    assert.equal(JSON.stringify([before, after, sibling]), untouched);
    assert.equal(main.clock, 1234);
    assert.equal(selected.clock, 4321);
    assert.equal(selected.forceVariation, false);
    assert.equal(tree.pathIsMainline('i4i5/i7i6'), true);
  });

  test(`promotion clears a forced only child (mainline=${toMainline})`, () => {
    const root = node(0);
    root.children = [{ ...node(1, 'a1a2'), forceVariation: true }];
    const tree = makeTree(completeNode(root));
    tree.promoteAt('a1a2', toMainline);
    assert.equal(tree.nodeAtPath('a1a2').forceVariation, false);
    assert.equal(tree.pathIsMainline('a1a2'), true);
    tree.promoteAt('a1a2', toMainline);
    assert.deepEqual(
      tree.root.children.map(n => n.id),
      ['a1a2'],
    );
  });

  test(`nested forced promotion preserves its scope and annotations (mainline=${toMainline})`, () => {
    const root = node(0);
    const parent = { ...node(1, 'a1a2'), forceVariation: true };
    const child = { ...node(2, 'i10i9'), forceVariation: true, clock: 120, children: [node(3, 'a2a3')] };
    parent.children = [node(2, 'i10i8'), child];
    root.children = [node(1, 'a1a3'), parent];
    const tree = makeTree(completeNode(root));
    tree.promoteAt('a1a2/i10i9/a2a3', toMainline);
    assert.equal(child.forceVariation, false);
    assert.equal(child.clock, 120);
    assert.deepEqual(
      parent.children.map(n => n.id),
      ['i10i9', 'i10i8'],
    );
    assert.equal(parent.forceVariation, !toMainline);
    assert.deepEqual(
      root.children.map(n => n.id),
      toMainline ? ['a1a2', 'a1a3'] : ['a1a3', 'a1a2'],
    );
    assert.equal(tree.pathIsMainline('a1a2/i10i9/a2a3'), toMainline);
    if (!toMainline) {
      tree.promoteAt('a1a2/i10i9/a2a3', false);
      assert.equal(tree.pathIsMainline('a1a2/i10i9/a2a3'), true);
    }
  });
}
