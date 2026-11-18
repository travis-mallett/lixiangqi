import assert from 'node:assert/strict';
import { test } from 'node:test';

import { boardPresentation, createBoard, supportedBoards, threeKingdoms, type BoardEffect } from '../src';
import { BoardFeedback } from '../src/feedback';

const effects: BoardEffect[] = ['capture', 'check', 'checkmate'];
const subset = (mask: number) => effects.filter((_, index) => mask & (1 << index));

test('every two-player renderer applies one priority before animation settings, for every combination', t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('bytes'));
  for (const definition of supportedBoards.filter(board => board.participants.length === 2)) {
    const root = document.createElement('div');
    document.body.append(root);
    const cues: { move: boolean; effects: readonly BoardEffect[] }[] = [];
    const board = createBoard(root, {
      definition,
      position: { active: 'red', pieces: new Map() },
      presentation: boardPresentation('replay', 'red'),
      interaction: { mode: 'display' },
      services: { assetUrl: path => path, sound: cue => cues.push(cue) },
    });
    try {
      for (let mask = 0; mask < 8; mask++)
        for (let enabled = 0; enabled < 8; enabled++) {
          const supplied = subset(mask);
          const primary = supplied.at(-1);
          board.setPresentation({
            ...board.getPresentation(),
            feedback: { audio: true, effects: subset(enabled) },
          });
          board.presentTransition({ kind: 'forward', effects: supplied });
          assert.deepEqual(cues.at(-1), { move: true, effects: primary ? [primary] : [] });
          const visible = primary && subset(enabled).includes(primary);
          assert.equal(root.querySelectorAll('.xiangqi-board-animation').length, visible ? 1 : 0);
          if (visible) assert.ok(root.querySelector(`.xiangqi-board-animation--${primary}`));
        }
    } finally {
      board.destroy();
      root.remove();
    }
  }
});

test('optimistic captures wait for authoritative priority, including mate, without replaying movement', t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('bytes'));
  for (let mask = 0; mask < 8; mask++) {
    const root = document.createElement('div');
    const cues: unknown[] = [];
    const feedback = new BoardFeedback(root, { assetUrl: path => path, sound: cue => cues.push(cue) });
    const presentation = boardPresentation('interactive', 'red');
    const supplied = subset(mask),
      primary = supplied.at(-1);
    // Even an optimistic caller supplying a provisional capture cannot announce it.
    feedback.present({ kind: 'optimistic', id: 'move', effects: ['capture'] }, presentation);
    assert.equal(root.childElementCount, 0);
    assert.deepEqual(cues, [{ move: true, effects: [] }]);
    feedback.present({ kind: 'confirmation', id: 'move', effects: supplied }, presentation);
    assert.deepEqual(cues, [
      { move: true, effects: [] },
      ...(primary ? [{ move: false, effects: [primary] }] : []),
    ]);
    const overlay = root.firstElementChild;
    for (const repeated of [supplied, [...supplied].reverse(), supplied.slice(0, -1)])
      feedback.present({ kind: 'confirmation', id: 'move', effects: repeated }, presentation);
    assert.equal(cues.length, primary ? 2 : 1);
    assert.equal(root.firstElementChild, overlay);
    feedback.present({ kind: 'backward', effects: supplied }, presentation);
    assert.deepEqual(cues.at(-1), { move: true, effects: [] });
    assert.equal(root.childElementCount, 0);
    feedback.present({ kind: 'forward', id: 'move', effects: supplied }, presentation);
    assert.deepEqual(cues.at(-1), { move: true, effects: primary ? [primary] : [] });
    feedback.destroy();
  }
});

test('Three Kingdoms retains paired river and territory visuals but selects one semantic sound', t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('bytes'));
  const root = document.createElement('div');
  const cues: unknown[] = [];
  const feedback = new BoardFeedback(root, { assetUrl: path => path, sound: cue => cues.push(cue) });
  feedback.present(
    { kind: 'optimistic', id: 'move', effects, winners: ['black'] },
    boardPresentation('replay', 'red'),
    threeKingdoms.geometry,
  );
  assert.equal(root.childElementCount, 0);
  feedback.present(
    {
      kind: 'confirmation',
      id: 'move',
      effects,
      effectRoutes: { capture: [['black', 'green']], check: [['black', 'red']] },
      effectTargets: { checkmate: ['green'] },
      winners: ['black'],
    },
    boardPresentation('replay', 'red'),
    threeKingdoms.geometry,
  );
  assert.equal(root.querySelectorAll('.xiangqi-board-animation__image').length, 4);
  assert.deepEqual(cues, [
    { move: true, effects: [] },
    { move: false, effects: ['checkmate'] },
  ]);
  feedback.destroy();
});
