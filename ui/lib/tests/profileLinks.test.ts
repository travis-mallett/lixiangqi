import assert from 'node:assert/strict';
import { test } from 'node:test';

import { expandProfileLinks, profileLinkName } from '../src/view/profileLinks';

test('profile links recognize account names without decorating prose or external links', () => {
  const origin = 'https://lixiangqi.com';
  assert.equal(profileLinkName('/@/Lunps28', 'Lunps28', origin), 'Lunps28');
  assert.equal(profileLinkName('/@/Lunps28', '@lunps28', origin), 'Lunps28');
  assert.equal(profileLinkName('/@/%E8%B1%A1%E6%A3%8B', '象棋', origin), '象棋');
  for (const href of ['https://example.com/@/Lunps28', '/@/Lunps28/blog', '/@/Lunps28?x=1', '/@/%xx'])
    assert.equal(profileLinkName(href, 'Lunps28', origin), undefined);
  assert.equal(profileLinkName('/@/Lunps28', 'read the profile', origin), undefined);
});

test('repeated mentions share a lookup and render current identity through the shared user link', async t => {
  const root = document.createElement('div');
  root.innerHTML =
    '<p><a href="/@/Lunps28">Lunps28</a> won. <a href="/@/lunps28">@Lunps28</a> played.</p><a href="/@/Missing">Missing</a><code><a href="/@/Example">Example</a></code>';
  document.body.append(root);
  t.after(() => root.remove());
  t.mock.method(site.asset, 'url', (path: string) => '/assets/' + path);
  const originalFlairSrc = site.asset.flairSrc;
  site.asset.flairSrc = (flair: string) => '/assets/flair/' + flair + '.webp';
  t.after(() => {
    site.asset.flairSrc = originalFlairSrc;
  });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    calls++;
    assert.equal(url, '/api/users');
    assert.equal(options.body, 'lunps28,missing');
    return new Response(
      JSON.stringify([
        {
          id: 'lunps28',
          username: 'Lunps28',
          flair: 'activity.atom-symbol',
          patronColor: 3,
          profile: { flag: 'BR' },
          perfs: { xiangqi: { rank: '学1-3' } },
        },
      ]),
    );
  });
  await expandProfileLinks(root);
  assert.equal(calls, 1);
  const mentions = root.querySelectorAll<HTMLAnchorElement>('a.user-link');
  assert.equal(mentions.length, 2);
  for (const mention of mentions) {
    assert.equal(mention.getAttribute('href'), '/@/Lunps28');
    assert.ok(mention.querySelector('.patron.paco3'));
    assert.equal(
      mention.querySelector('.uflair')?.getAttribute('src'),
      '/assets/flair/activity.atom-symbol.webp',
    );
    assert.equal(mention.querySelector('.flag')?.getAttribute('src'), '/assets/flags/BR.webp');
    assert.equal(mention.querySelector('.user-rank')?.textContent?.trim(), '(学1-3)');
  }
  assert.equal(root.querySelector('a[href="/@/Missing"]')?.textContent, 'Missing');
  assert.equal(root.querySelector('code a')?.className, '');
});

test('lookup failures preserve usable profile links', async t => {
  const root = document.createElement('div');
  root.innerHTML = '<a href="/@/Lunps28">Lunps28</a>';
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 429 }));
  await assert.rejects(expandProfileLinks(root), /Too many requests/);
  assert.equal(root.innerHTML, '<a href="/@/Lunps28">Lunps28</a>');
});
