import assert from 'node:assert/strict';
import { test } from 'node:test';

import { updateThemeEmbeds } from '../src/embed';

test('theme embeds retain their channel and update all appearance preferences only when changed', () => {
  const frame = document.createElement('iframe');
  frame.dataset.themeEmbed = '';
  frame.src = '/tv/threeKingdoms/frame?boardTheme=wood&pieceSet=wood&uiTheme=dark';
  document.body.append(frame);
  try {
    const theme = { boardTheme: 'paper', pieceSet: 'symbols', uiTheme: 'light' };
    updateThemeEmbeds(theme);
    const url = new URL(frame.src);
    assert.equal(url.pathname, '/tv/threeKingdoms/frame');
    for (const [key, value] of Object.entries(theme)) assert.equal(url.searchParams.get(key), value);
    const observer = new window.MutationObserver(() => {});
    observer.observe(frame, { attributes: true });
    updateThemeEmbeds(theme);
    assert.equal(observer.takeRecords().length, 0);
    observer.disconnect();
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
