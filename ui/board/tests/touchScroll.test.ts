import assert from 'node:assert/strict';
import { test } from 'node:test';

import { makeRenderer, startDrag, computeSquareCenter } from './support/renderer';

test('display pieces and nearby empty squares allow touch scrolling, including after play is disabled', () => {
  const element = document.createElement('div');
  document.body.append(element);
  const board = makeRenderer(element, { movableColor: 'white', moveEvent: 2 });
  const bounds = { left: 0, top: 0, width: 360, height: 400 } as DOMRect;
  board.state.dom.bounds = Object.assign(() => bounds, { clear() {} });
  const touch = (key: 'a1' | 'a2' | 'e5', count = 1) => {
    let prevented = false;
    const [clientX, clientY] = computeSquareCenter(key, true, bounds, board.state.dimensions);
    startDrag(board.state, {
      isTrusted: true,
      type: 'touchstart',
      touches: Array.from({ length: count }, () => ({ clientX, clientY })),
      targetTouches: [{ clientX, clientY }],
      target: element,
      cancelable: true,
      preventDefault() {
        prevented = true;
      },
    } as unknown as Parameters<typeof startDrag>[1]);
    board.cancelMove();
    return prevented;
  };
  try {
    for (const drawing of [false, true]) {
      board.set({
        draggable: { enabled: false },
        selectable: { enabled: false },
        drawable: { enabled: drawing },
      });
      assert.equal(touch('a1'), false, 'a display piece allows scrolling');
      assert.equal(touch('a2'), false, 'an empty square near a display piece allows scrolling');
      assert.equal(touch('e5'), false, 'an empty square away from pieces allows scrolling');
    }
    for (const [selectable, draggable] of [
      [true, false],
      [false, true],
      [true, true],
    ]) {
      board.set({ selectable: { enabled: selectable }, draggable: { enabled: draggable } });
      assert.equal(touch('a1'), true, 'interactive pieces retain their touch gesture');
      assert.equal(touch('a1', 2), false, 'two-finger zoom remains available');
    }
    board.set({ draggable: { enabled: false }, selectable: { enabled: false } });
    assert.equal(touch('a1'), false, 'switching back to display restores scrolling');
  } finally {
    board.destroy();
    element.remove();
  }
});
