import assert from 'node:assert/strict';
import { test } from 'node:test';

import { boardPresentation, threeKingdoms } from '../src/definitions';
import { BoardFeedback } from '../src/feedback';
import type { BoardTransition } from '../src/types';

test('shared feedback waits for arrival, synchronizes paired effects and cancels stale pending events', async () => {
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
    assert.equal(root.querySelectorAll('.xiangqi-board-animation__image').length, 0);
    assert.equal(sounds, 0);
    motion.remove();
    await frame();
    assert.equal(root.querySelectorAll('.xiangqi-board-animation__image').length, 2);
    assert.equal(sounds, 1);
    feedback.present(transition, presentation, threeKingdoms.geometry);
    assert.equal(sounds, 1);
    root.append(motion);
    feedback.present({ ...transition, id: 'move2' }, presentation, threeKingdoms.geometry);
    assert.equal(root.querySelectorAll('.xiangqi-board-animation__image').length, 0);
    feedback.present({ kind: 'jump' }, presentation, threeKingdoms.geometry);
    motion.remove();
    await frame();
    assert.equal(sounds, 1);
    assert.equal(root.querySelectorAll('.xiangqi-board-animation__image').length, 0);
  } finally {
    feedback.destroy();
    root.remove();
  }
});
