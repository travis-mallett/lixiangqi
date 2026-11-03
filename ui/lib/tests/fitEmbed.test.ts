import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fitEmbed } from '../src/fitEmbed';

test('fits a tall board with both captions and padding, then grows when the viewport grows', () => {
  const element = document.createElement('div');
  const board = document.createElement('span');
  board.className = 'cg-wrap';
  element.append(board);
  Object.defineProperties(element, {
    offsetWidth: { value: 408 },
    offsetHeight: { value: 510 },
  });
  Object.defineProperties(board, {
    offsetWidth: { value: 396 },
    offsetHeight: { value: 440 },
  });
  const originalHeight = window.innerHeight;
  try {
    window.innerHeight = 400;
    fitEmbed(element);
    assert.equal(element.style.maxWidth, '309px');
    window.innerHeight = 600;
    fitEmbed(element);
    assert.equal(element.style.maxWidth, '');
  } finally {
    window.innerHeight = originalHeight;
  }
});

test('an empty TV channel does not acquire a bogus board size', () => {
  const element = document.createElement('div');
  element.textContent = 'No game found';
  fitEmbed(element);
  assert.equal(element.style.maxWidth, '');
});
