import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import { bindMouseDragging } from '../src/view/mouseDragScroll';

const pointerEvent = (type: string, pointerId: number, clientX: number) => {
  const event = new window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    pointerType: { value: 'mouse' },
    button: { value: 0 },
    clientX: { value: clientX },
  });
  return event;
};

describe('correspondence deck mouse dragging', () => {
  let track: HTMLElement;
  let captured: number[];
  let released: number[];

  beforeEach(() => {
    track = document.createElement('div');
    track.innerHTML = '<a href="/game-id">Game</a>';
    captured = [];
    released = [];
    Object.defineProperties(track, {
      setPointerCapture: { value: (id: number) => captured.push(id) },
      hasPointerCapture: { value: (id: number) => captured.includes(id) && !released.includes(id) },
      releasePointerCapture: { value: (id: number) => released.push(id) },
    });
    bindMouseDragging(track);
  });

  test('leaves a normal card click to the native link', () => {
    const link = track.querySelector('a')!;
    link.dispatchEvent(pointerEvent('pointerdown', 1, 100));
    link.dispatchEvent(pointerEvent('pointerup', 1, 100));
    const click = new window.MouseEvent('click', { bubbles: true, cancelable: true });

    link.dispatchEvent(click);

    assert.deepEqual(captured, []);
    assert.equal(click.defaultPrevented, false);
  });

  test('captures an intentional drag and suppresses its resulting click', () => {
    const link = track.querySelector('a')!;
    track.scrollLeft = 20;
    link.dispatchEvent(pointerEvent('pointerdown', 2, 100));
    link.dispatchEvent(pointerEvent('pointermove', 2, 80));
    link.dispatchEvent(pointerEvent('pointerup', 2, 80));
    const click = new window.MouseEvent('click', { bubbles: true, cancelable: true });

    link.dispatchEvent(click);

    assert.deepEqual(captured, [2]);
    assert.deepEqual(released, [2]);
    assert.equal(track.scrollLeft, 40);
    assert.equal(click.defaultPrevented, true);
    assert.equal(track.classList.contains('is-dragging'), false);
  });
});
