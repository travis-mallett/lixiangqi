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
