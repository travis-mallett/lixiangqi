import assert from 'node:assert/strict';
import { test } from 'node:test';

import { updateThemeEmbeds } from '../src/embed';

test('appearance updates preserve the variant frame and apply the latest choice after load', () => {
  const frame = document.createElement('iframe');
  frame.dataset.themeEmbed = '';
  frame.src = '/tv/threeKingdoms/frame';
  document.body.append(frame);
  try {
    const doc = frame.contentDocument!;
    doc.open();
    doc.write('<body><div id="game"></div></body>');
    doc.close();
    const game = doc.getElementById('game');
    const changes = new window.MutationObserver(() => {});
    changes.observe(frame, { attributes: true });
    for (const board of ['wood', 'paper']) updateThemeEmbeds(target => (target.body.dataset.board = board));
    assert.equal(doc.body.dataset.board, 'paper');
    delete doc.body.dataset.board;
    frame.dispatchEvent(new window.Event('load'));
    assert.equal(doc.body.dataset.board, 'paper');
    assert.equal(doc.getElementById('game'), game);
    assert.equal(changes.takeRecords().length, 0);
    changes.disconnect();
  } finally {
    frame.remove();
  }
});
test('board color changes reach opted-in embeds without navigation', async () => {
  const { updateBoardColorEmbeds } = await import('../src/embed');
  const frame = document.createElement('iframe');
  frame.dataset.themeEmbed = '';
  document.body.append(frame);
  frame.src = window.location.href;
  frame.contentDocument!.open();
  frame.contentDocument!.write('<body></body>');
  frame.contentDocument!.close();
  const src = frame.src;
  try {
    document.body.style.setProperty('---board-brightness', '42');
    document.body.classList.remove('simple-board');
    updateBoardColorEmbeds();
    assert.equal(frame.contentDocument!.body.style.getPropertyValue('---board-brightness'), '42');
    assert.equal(frame.src, src);
    document.body.classList.add('simple-board');
    updateBoardColorEmbeds();
    assert.ok(frame.contentDocument!.body.classList.contains('simple-board'));
  } finally {
    document.body.style.removeProperty('---board-brightness');
    document.body.classList.remove('simple-board');
    frame.remove();
  }
});
