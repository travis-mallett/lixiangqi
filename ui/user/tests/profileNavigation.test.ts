import assert from 'node:assert/strict';
import { test } from 'node:test';

import { syncProfileNavigation } from '../src/profileNavigation';

test('profile angle navigation keeps the full-page title and current sign-in referrer', () => {
  document.body.innerHTML = `<a class="signin" href="/login?referrer=%2F%40player">Sign in</a>
    <div class="angle-content"><nav id="games" data-page-title="player Mini Xiangqi • lixiangqi.org"></nav></div>`;
  const signIn = document.querySelector<HTMLAnchorElement>('.signin')!;

  syncProfileNavigation(document, '/@player/minixiangqi', 'https://lixiangqi.org/@player/xiangqi');
  assert.equal(document.title, 'player Mini Xiangqi • lixiangqi.org');
  assert.equal(new URL(signIn.href).searchParams.get('referrer'), '/@player/minixiangqi');

  document
    .querySelector('#games')!
    .setAttribute('data-page-title', 'player Jieqi (揭棋) - page 2 • lixiangqi.org');
  syncProfileNavigation(document, '/@player/jieqi?page=2', 'https://lixiangqi.org/@player/minixiangqi');
  assert.equal(document.title, 'player Jieqi (揭棋) - page 2 • lixiangqi.org');
  assert.equal(new URL(signIn.href).searchParams.get('referrer'), '/@player/jieqi');

  document.body.innerHTML = `<a class="signin" href="${signIn.href}">Sign in</a>
    <div class="angle-content"><div data-page-title="player : Activity • lixiangqi.org"></div></div>`;
  syncProfileNavigation(document, '/@player', 'https://lixiangqi.org/@player/jieqi');
  assert.equal(document.title, 'player : Activity • lixiangqi.org');
  assert.equal(
    new URL(document.querySelector<HTMLAnchorElement>('.signin')!.href).searchParams.get('referrer'),
    '/@player',
  );
});
