import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { VNode } from 'lib/view';

import { scrollSelectedEvent } from '../src/view/eventScroll';

test('selected events become visible on either axis and root returns to the start', () => {
  const original = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = callback => {
    callback(0);
    return 0;
  };
  const list = document.createElement('ol');
  const selected = document.createElement('li');
  selected.className = 'a1t';
  list.append(selected);
  Object.defineProperties(list, {
    clientTop: { value: 2 },
    clientLeft: { value: 2 },
    clientHeight: { value: 196 },
    clientWidth: { value: 196 },
  });
  list.getBoundingClientRect = () => ({ top: 100, bottom: 300, left: 50, right: 250 }) as DOMRect;
  selected.getBoundingClientRect = () => ({ top: 400, bottom: 430, left: 350, right: 450 }) as DOMRect;
  const vnode = { elm: list } as VNode;
  try {
    scrollSelectedEvent(vnode);
    assert.equal(list.scrollTop, 132);
    assert.equal(list.scrollLeft, 202);
    selected.getBoundingClientRect = () => ({ top: 80, bottom: 110, left: 20, right: 120 }) as DOMRect;
    scrollSelectedEvent(vnode);
    assert.equal(list.scrollTop, 110);
    assert.equal(list.scrollLeft, 170);
    selected.getBoundingClientRect = () => ({ top: 120, bottom: 150, left: 70, right: 170 }) as DOMRect;
    scrollSelectedEvent(vnode);
    assert.equal(list.scrollTop, 110);
    assert.equal(list.scrollLeft, 170);
    selected.remove();
    scrollSelectedEvent(vnode);
    assert.equal(list.scrollTop, 0);
    assert.equal(list.scrollLeft, 0);
  } finally {
    globalThis.requestAnimationFrame = original;
  }
});
