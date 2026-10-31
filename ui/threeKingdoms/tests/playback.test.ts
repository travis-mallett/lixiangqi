import { boardPresentation, createBoard, threeKingdoms } from '@lixiangqi/board';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { playbackTransition, position, transition } from '../src/board';
import { Tree } from '../src/tree';
import type { Rules } from '../src/types';

const rules: Rules = (
  await import(new URL('../../../public/three-kingdoms-engine/main.js', import.meta.url).href)
).ThreeKingdoms;

test('recorded capture playback announces once, backward playback only sounds a move, and jumps are quiet', () => {
  const initial = rules.edit(rules.initial(), '4:0k,1d:1k,2m:2k,1m:2r,19:1n,d:0a', 'red');
  const before = rules.inspect(initial);
  const after = rules.inspect(rules.play(initial, 'wu:4:1>wu:4:0'));
  const root = document.createElement('div');
  document.body.append(root);
  const cues: unknown[] = [];
  const board = createBoard(root, {
    definition: threeKingdoms,
    position: position(before),
    presentation: { ...boardPresentation('replay', 'red'), motion: { duration: 0 } },
    interaction: { mode: 'display' },
    services: { assetUrl: path => path, sound: cue => cues.push(cue) },
  });
  try {
    const forward = playbackTransition(before, after, 'forward', 'game:1');
    assert.equal(forward.kind, 'forward');
    assert.ok(forward.effects?.includes('capture'));
    assert.ok(forward.effects?.includes('checkmate'));
    board.display(position(after), forward);
    board.display(position(after), { ...forward, kind: 'confirmation' });
    assert.equal(cues.length, 1);
    assert.ok(root.querySelector('.xiangqi-board-animation'));
    const backward = playbackTransition(after, before, 'backward', 'game:0');
    assert.deepEqual(backward, { kind: 'backward', id: 'game:0', effects: [] });
    board.display(position(before), backward);
    assert.deepEqual(cues.at(-1), { move: true, effects: [] });
    assert.equal(root.querySelector('.xiangqi-board-animation'), null);
    board.display(position(after), playbackTransition(before, after, 'jump', 'game:1'));
    assert.equal(cues.length, 2);
    board.display(position(before), playbackTransition(after, before, 'backward', 'game:0'));
    board.display(position(after), forward);
    assert.equal(cues.length, 4, 'revisiting a move should play its feedback again');
  } finally {
    board.destroy();
    root.remove();
  }
});

test('resignation and draw events cannot replay the preceding piece movement or move sound', () => {
  const tree = new Tree(rules, rules.initial());
  tree.play(tree.current.state.moves[0]);
  const moved = tree.current.state;
  tree.play('resign', 'green');
  const resigned = tree.current.state;
  assert.equal(transition(moved, resigned, 'resign').kind, 'confirmation');
  assert.deepEqual(transition(moved, resigned, 'resign').effects, ['defeat']);
  assert.deepEqual(playbackTransition(resigned, moved, 'backward', 'undo'), { kind: 'jump' });
  const drawn = rules.inspect(rules.event(moved.position, moved.turn, 'draw'));
  assert.equal(transition(moved, drawn, 'draw').kind, 'confirmation');
  assert.deepEqual(playbackTransition(moved, drawn, 'jump', 'load'), { kind: 'jump' });
});

test('a sibling variation and a multiple-move navigation remain quiet even when ply numbers suggest motion', () => {
  const tree = new Tree(rules, rules.initial());
  const root = tree.current;
  tree.play(root.state.moves[0]);
  const first = tree.current;
  tree.cursor = 0;
  tree.play(root.state.moves[1]);
  const sibling = tree.current;
  assert.deepEqual(playbackTransition(first.state, sibling.state, 'jump', 'branch'), { kind: 'jump' });
  tree.play(sibling.state.moves[0]);
  assert.deepEqual(playbackTransition(root.state, tree.current.state, 'jump', 'last'), { kind: 'jump' });
});
