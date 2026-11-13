import assert from 'node:assert/strict';
import { test } from 'node:test';

import { boardPresentation, threeKingdoms } from '../src/definitions';
import { BoardFeedback } from '../src/feedback';
import type { BoardTransition } from '../src/types';

test('preloads enabled artwork once across boards and respects reduced motion', t => {
  const fetcher = t.mock.method(globalThis, 'fetch', async () => new Response('image bytes'));
  const root = document.createElement('div');
  const presentation = boardPresentation('replay', 'red');
  const prefix = '/feedback-preload-test/';
  const feedback = new BoardFeedback(root, { assetUrl: path => prefix + path });
  const reduced = new BoardFeedback(root, {
    assetUrl: path => '/reduced-preload-test/' + path,
    reducedMotion: () => true,
  });
  try {
    feedback.prepare({ ...presentation, feedback: { audio: false, effects: [] } });
    assert.equal(fetcher.mock.callCount(), 0);
    feedback.prepare(presentation);
    new BoardFeedback(root, { assetUrl: path => prefix + path }).prepare(presentation);
    assert.equal(fetcher.mock.callCount(), 3);
    reduced.prepare(presentation);
    assert.equal(fetcher.mock.callCount(), 3);
  } finally {
    feedback.destroy();
    reduced.destroy();
  }
});

test('shared feedback starts during travel, synchronizes paired effects and clears on navigation', async () => {
  const root = document.createElement('div');
  document.body.append(root);
  let sounds = 0;
  const feedback = new BoardFeedback(root, { assetUrl: path => path, sound: () => sounds++ });
  const presentation = boardPresentation('replay', 'red');
  const transition: BoardTransition = {
    kind: 'forward',
    id: 'move1',
    effects: ['capture', 'check'],
    effectRoutes: { capture: [['red', 'black']], check: [['red', 'black']] },
  };
  const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  try {
    const motion = document.createElement('span');
    motion.className = 'xiangqi-motion-piece';
    root.append(motion);
    feedback.present(transition, presentation, threeKingdoms.geometry);
    assert.equal(root.querySelectorAll('.xiangqi-board-animation__image').length, 2);
    assert.equal(sounds, 1);
    motion.remove();
    await frame();
    assert.equal(root.querySelectorAll('.xiangqi-board-animation__image').length, 2);
    assert.equal(sounds, 1);
    feedback.present(transition, presentation, threeKingdoms.geometry);
    assert.equal(sounds, 1);
    root.append(motion);
    feedback.present({ ...transition, id: 'move2' }, presentation, threeKingdoms.geometry);
    assert.equal(root.querySelectorAll('.xiangqi-board-animation__image').length, 2);
    feedback.present({ kind: 'jump' }, presentation, threeKingdoms.geometry);
    motion.remove();
    await frame();
    assert.equal(sounds, 2);
    assert.equal(root.querySelectorAll('.xiangqi-board-animation__image').length, 0);
  } finally {
    feedback.destroy();
    root.remove();
  }
});
