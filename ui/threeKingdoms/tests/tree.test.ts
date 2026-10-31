import assert from 'node:assert/strict';
import { test } from 'node:test';

import { interaction, position, transition } from '../src/board';
import { Tree } from '../src/tree';
import type { Rules } from '../src/types';

// Exercise the production rules compiled from Scala, not a second move generator.
const moduleUrl = new URL('../../../public/three-kingdoms-engine/main.js', import.meta.url).href;
const rules: Rules = (await import(moduleUrl)).ThreeKingdoms;

test('a recorded elimination replays ownership, continues the duel and round-trips annotations', () => {
  const tree = new Tree(rules, rules.initial());
  tree.play('resign', 'green');
  assert.deepEqual(tree.current.state.active, ['black', 'red']);
  assert.deepEqual(tree.current.state.controllers, ['black', null, 'red']);
  const move = tree.current.state.moves[0];
  tree.play(move);
  tree.current.comment = 'The duel continues.';
  tree.current.marks = [{ from: move.split('>')[0], to: move.split('>')[1], brush: 'green' }];
  const copy = Tree.import(rules, JSON.stringify(tree.export()));
  assert.deepEqual(copy.export(), tree.export());
  assert.equal(copy.current.state.position, tree.current.state.position);
  assert.throws(() => copy.play('resign', 'green'), /not active/);
});

test('analysis branches restore the parent before replaying each alternative', () => {
  const tree = new Tree(rules, rules.initial());
  const alternatives = tree.current.state.moves.slice(0, 2);
  tree.play(alternatives[0]);
  const first = tree.current.state.position;
  tree.cursor = 0;
  tree.play(alternatives[1]);
  const second = tree.current.state.position;
  assert.notEqual(first, second);
  const copy = Tree.import(rules, JSON.stringify(tree.export()));
  assert.deepEqual(copy.children(0), [1, 2]);
  assert.equal(copy.nodes[1].state.position, first);
  assert.equal(copy.nodes[2].state.position, second);
});

test('imports reject wrong actors, cycles, duplicate branches, and unbounded records', () => {
  const tree = new Tree(rules, rules.initial());
  tree.play(tree.current.state.moves[0]);
  for (const corrupt of [
    (record: ReturnType<Tree['export']>) => {
      record.nodes[1].actor = 'green';
    },
    (record: ReturnType<Tree['export']>) => {
      record.nodes[1].parent = 1;
    },
    (record: ReturnType<Tree['export']>) => {
      record.nodes.push(record.nodes[1]);
    },
    (record: ReturnType<Tree['export']>) => {
      record.nodes = [];
    },
    (record: ReturnType<Tree['export']>) => {
      record.nodes[0].comment = 'a'.repeat(10001);
    },
  ]) {
    const record = tree.export();
    corrupt(record);
    assert.throws(() => Tree.import(rules, JSON.stringify(record)));
  }
  assert.throws(() => Tree.import(rules, ' '.repeat(2_000_001)), /too large/);
});

test('captured armies retain their piece appearance and become movable by the new controller', () => {
  // Three generals, a Shu chariot capturing Wu, a Wu horse and a Wei palace screen.
  const encoded = rules.edit(rules.initial(), '4:0k,1d:1k,2m:2k,1m:2r,19:1n,d:0a', 'red');
  const before = rules.inspect(encoded);
  const after = rules.inspect(rules.play(encoded, 'wu:4:1>wu:4:0'));
  assert.deepEqual(after.controllers, ['black', 'red', 'red']);
  const board = position(after);
  assert.deepEqual(board.pieces.get('wu:0:0'), {
    face: 'up',
    participant: 'green',
    role: 'horse',
    controller: 'red',
    inactive: false,
  });
  assert.equal(interaction(after, () => {}, 'green').mode, 'display');
  assert.deepEqual(transition(before, after, 'capture').effectTargets?.checkmate, ['green']);
});

test('an appropriated piece capture targets its original army’s river', () => {
  const before = rules.inspect(rules.initial());
  const moving = { location: 'wu:1:0', army: 'black', role: 'chariot', controller: 'black' } as const;
  before.pieces = [moving, { location: 'wu:0:0', army: 'green', role: 'horse', controller: 'red' }];
  const after = {
    ...before,
    ply: before.ply + 1,
    pieces: [{ ...moving, location: 'wu:0:0' }],
    lastMove: 'wu:1:0>wu:0:0',
  };
  assert.deepEqual(transition(before, after, 'capture').effectTargets?.capture, ['green']);
});

test('draw agreement and resignation do not replay capture or checkmate effects', () => {
  const initial = rules.inspect(rules.initial());
  const moved = rules.inspect(rules.play(initial.position, initial.moves[0]));
  const drawn = rules.inspect(rules.event(moved.position, moved.turn, 'draw'));
  assert.deepEqual(transition(moved, drawn, 'draw').effects, []);
  const resigned = rules.inspect(rules.event(moved.position, 'green', 'resign'));
  assert.deepEqual(transition(moved, resigned, 'resign').effects, ['defeat']);
});
