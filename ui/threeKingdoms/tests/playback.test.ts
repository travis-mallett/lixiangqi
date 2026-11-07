import { boardPresentation, createBoard, threeKingdoms } from '@lixiangqi/board';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { playbackTransition, position, transition } from '../src/board';
import { Tree } from '../src/tree';
import type { Rules } from '../src/types';
import { positionFixture } from './positionFixture';

const rules: Rules = (
  await import(new URL('../../../public/three-kingdoms-engine/main.js', import.meta.url).href)
).ThreeKingdoms;

test('the third player’s unrelated move preserves the check marker without repeating check feedback', () => {
  // The reported game: Black captures Red's rook on ply 21 and checks Green
  // through Green's elephant. Red's rook advance on ply 22 leaves that check intact.
  const moves = [
    'shu:4:3>shu:4:4',
    'wu:2:3>wu:2:4',
    'wei:2:0>wei:4:2',
    'shu:0:0>shu:0:1',
    'wu:1:0>wu:2:2',
    'wei:1:2>wei:1:3',
    'shu:0:1>shu:4:1',
    'wu:2:2>wu:1:0',
    'wei:1:3>wei:1:2',
    'shu:4:4>wu:4:4',
    'wu:1:0>wu:2:2',
    'wei:1:2>wei:1:3',
    'wu:4:4>wu:5:4',
    'wu:2:2>wu:1:0',
    'wei:1:3>wei:1:2',
    'shu:4:1>wu:4:3',
    'wu:2:0>wu:4:2',
    'wei:1:2>wei:1:3',
    'wu:4:3>wei:4:3',
    'wu:1:2>wu:1:1',
  ];
  const before = rules.inspect(moves.reduce((p, m) => rules.play(p, m), rules.initial()));
  const checked = rules.inspect(rules.play(before.position, 'wei:1:3>wei:4:3'));
  const unchanged = rules.inspect(rules.play(checked.position, 'shu:8:0>shu:8:1'));
  const checkingMove = transition(before, checked, '21');
  assert.deepEqual(checkingMove.effects, ['capture', 'check']);
  assert.deepEqual(checkingMove.effectRoutes?.check, [['black', 'green']]);
  const quietMove = transition(checked, unchanged, '22');
  assert.deepEqual(quietMove.effects, []);
  assert.deepEqual(quietMove.effectTargets?.check, []);
  assert.deepEqual(quietMove.effectRoutes?.check, []);
  assert.deepEqual(position(unchanged).checked, ['wu:4:0']);
  assert.deepEqual(playbackTransition(checked, unchanged, 'forward', '22'), quietMove);

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
    board.display(position(checked), checkingMove);
    assert.ok(root.querySelector('.xiangqi-board-animation'));
    board.display(position(unchanged), quietMove);
    assert.equal(root.querySelector('.xiangqi-board-animation'), null);
    assert.deepEqual(cues.at(-1), { move: true, effects: [] });
  } finally {
    board.destroy();
    root.remove();
  }

  // A new checking army still merits feedback, attributed to that army's river.
  const newlyChecked = transition(
    checked,
    { ...unchanged, checkSources: { green: ['black', 'red'] } },
    'new',
  );
  assert.deepEqual(newlyChecked.effectTargets?.check, ['green']);
  assert.deepEqual(newlyChecked.effectRoutes?.check, [['red', 'green']]);
  const replacedCheck = transition(checked, { ...unchanged, checkSources: { green: ['red'] } }, 'replaced');
  assert.deepEqual(replacedCheck.effectRoutes?.check, [['red', 'green']]);
});

test('recorded capture playback announces once, backward playback only sounds a move, and jumps are quiet', () => {
  const initial = positionFixture(rules, rules.initial(), '4:0k,1d:1k,2m:2k,1m:2r,19:1n,d:0a', 'red');
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
