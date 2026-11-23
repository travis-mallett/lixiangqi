import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

import { boardThemeCss } from './fixtures/board-theme';

const { build } = createRequire(resolve('ui/.build/package.json'))('esbuild');
let server: Server, origin: string, script: string;
const translations = Object.fromEntries(
  ['site', 'inbox', 'timeago', 'challenge'].map(name => {
    const xml = readFileSync(`translation/source/${name}.xml`, 'utf8');
    return [
      name,
      Object.fromEntries(
        [...xml.matchAll(/<(string|plurals) name="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g)].map(m => [
          m[2],
          m[1] === 'plurals'
            ? (/<item quantity="other">([\s\S]*?)<\/item>/.exec(m[3])?.[1] ?? m[2])
            : m[3].replaceAll('&amp;', '&'),
        ]),
      ),
    ];
  }),
);

test.beforeAll(async () => {
  const manifest = JSON.parse(readFileSync('public/compiled/manifest.json', 'utf8'));
  const css = ['lib.theme.all', 'site', 'lobby', 'msg', 'bits.dialog']
    .map(name => readFileSync(`public/css/${name}.${manifest.css[name]}.css`, 'utf8').replace(/^\uFEFF/, ''))
    .join('\n');
  script = (
    await build({
      stdin: {
        resolveDir: process.cwd(),
        contents: `
    import { initModule } from './ui/msg/src/msg';
    import { pubsub } from './ui/lib/src/pubsub';
    pubsub.complete('polyfill.dialog');
    window.inboxEvent = (type, data) => pubsub.emit('socket.in.' + type, data);
    const card = document.querySelector('.lobby__global-chat__room');
    initModule(card ? { card } : { data: window.fixture });
  `,
      },
      bundle: true,
      conditions: ['source'],
      write: false,
      format: 'iife',
    })
  ).outputFiles[0].text;
  server = createServer((request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    const asset = path.startsWith('/assets/')
      ? path.slice(8)
      : path.startsWith('/hashed/')
        ? path.slice(1)
        : undefined;
    if (asset && !asset.includes('..')) {
      try {
        if (asset.endsWith('.js')) response.setHeader('Content-Type', 'text/javascript');
        if (asset.endsWith('.svg')) response.setHeader('Content-Type', 'image/svg+xml');
        response.end(readFileSync(resolve('public', asset)));
        return;
      } catch {
        response.writeHead(404);
        response.end();
        return;
      }
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(`<html lang="en" class="dark"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
      @font-face {font-family:lichess;src:url('/assets/font/lichess.woff2') format('woff2')}
      ${boardThemeCss()}${css}</style>
      <body class="dark" data-theme="dark"><div id="main-wrap"><main class="msg-app"></main></div></body></html>`);
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Inbox fixture unavailable');
  origin = `http://127.0.0.1:${address.port}`;
});
test('Global Chat precedes other pins and offers only public moderation and notification controls', async ({
  page,
}) => {
  await inbox(page, 1100, false, undefined, true);
  const contacts = page.locator('.msg-app__side__contact');
  await expect(contacts.first()).toContainText('Global Chat');
  await contacts.first().click();
  await page.locator('.msg-app__convo__head summary').click();
  await expect(page.getByText('Unmute notifications', { exact: true })).toBeVisible();
  await expect(page.getByText('Unpin chat', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Leave group', { exact: true })).toHaveCount(0);
  await page.getByText('Group settings', { exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Notify for mentions when muted' })).toBeChecked();
  await page.locator('.msg-panel').getByRole('button', { name: 'Close' }).click();
  await page.locator('[data-message-id="theirs"]').click({ button: 'right' });
  const actions = page.getByRole('dialog');
  await expect(actions.getByRole('button', { name: 'Delete message', exact: true })).toBeVisible();
  await expect(actions.getByRole('button', { name: translations.inbox.edit, exact: true })).toHaveCount(0);
  await expect(actions.getByRole('button', { name: 'Reply', exact: true })).toBeVisible();
});

test('chat menu links and buttons share the same hover highlight', async ({ page }) => {
  await inbox(page, 1100);
  await page.locator('.msg-app__convo__head summary').click();
  const menu = page.locator('.msg-app__convo__head .msg-dropdown');
  const report = menu.getByRole('link', { name: 'Report', exact: true });
  const mute = menu.getByRole('button', { name: 'Mute notifications' });
  await report.hover();
  const color = await report.evaluate(el => window.getComputedStyle(el).backgroundColor);
  expect(color).not.toBe('rgba(0, 0, 0, 0)');
  await mute.hover();
  await expect(mute).toHaveCSS('background-color', color);
  await expect(report).not.toHaveCSS('background-color', color);
});

test('a signed-in page acknowledges offline and live deliveries without opening the inbox', async ({
  page,
}) => {
  const batches: { path: string; ids: string; read: string }[] = [];
  let pending = 0;
  await page.route('**/inbox/delivery/pending', route => {
    const msgs =
      pending++ === 0
        ? Array.from({ length: 100 }, (_, i) => ({ id: 'first-' + i, user: 'alice', text: 'offline' }))
        : [{ id: 'next', user: 'bob', text: 'offline' }];
    return route.fulfill({ json: { msgs } });
  });
  await page.route('**/inbox/**/receipt', route => {
    const request = route.request();
    const fields = new Map(
      [...request.postData()!.matchAll(/name="([^"]+)"\r\n\r\n([^\r]*)/g)].map(m => [m[1], m[2]]),
    );
    batches.push({
      path: new URL(request.url()).pathname,
      ids: fields.get('ids')!,
      read: fields.get('read')!,
    });
    return route.fulfill({ json: { receipts: [] } });
  });
  await page.goto(origin + '/fixture');
  const bootstrap = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
      import { initInboxDelivery } from './ui/site/src/inboxDelivery';
      import { pubsub } from './ui/lib/src/pubsub';
      initInboxDelivery('me');
      window.incoming = () => pubsub.emit('socket.in.msgChanged', { user: 'alice', kind: 'new', msg: {user:'alice', id:'live'} });
    `,
    },
    bundle: true,
    conditions: ['source'],
    write: false,
    format: 'iife',
  });
  await page.addScriptTag({ content: bootstrap.outputFiles[0].text });
  await expect.poll(() => batches.length).toBe(2);
  await page.evaluate(() => (window as any).incoming());
  await expect.poll(() => batches.length).toBe(3);
  expect(batches.map(b => [b.path, b.ids.split(',').length, b.read])).toEqual([
    ['/inbox/alice/receipt', 100, 'false'],
    ['/inbox/bob/receipt', 1, 'false'],
    ['/inbox/alice/receipt', 1, 'false'],
  ]);
});

test.afterAll(async () => {
  await server?.[Symbol.asyncDispose]();
});

async function inbox(
  page: Page,
  width: number,
  legacyPreview = false,
  attachments?: string[],
  publicRoom = false,
  card?: 'auth' | 'guest',
) {
  await page.setViewportSize({ width, height: 850 });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.stack ?? error.message));
  const now = Date.now();
  let messages: any[] = [
    {
      id: 'mine',
      text: attachments ? '' : 'That cannon move was excellent.',
      attachments,
      user: legacyPreview ? 'alice' : 'me',
      date: now - 1000,
      revision: 0,
      history: [],
      reactions: [],
      readAt: now - 500,
      deliveredAt: now - 800,
      canEditUntil: now + 86400000,
      canDeleteUntil: now + 86400000,
    },
    {
      id: 'theirs',
      text: 'Shall we play another game?',
      user: 'alice',
      date: now - 2000,
      revision: 0,
      history: [],
      reactions: [],
    },
  ];
  const groupId = '~' + (publicRoom ? '0' : 'a').repeat(32);
  let group: { id: string; name: string; group: boolean } | undefined;
  if (publicRoom) group = { id: groupId, name: 'Global Chat', group: true };
  const admins = new Set(['me']);
  let description = '';
  const org: {
    states: Record<string, Record<string, unknown>>;
    folders: { id: string; name: string; chats: string[] }[];
  } = { states: {}, folders: [] };
  if (publicRoom) {
    org.states[groupId] = { pin: true, mute: true, mentions: true };
    org.states.alice = { pin: true };
  }
  const data = () => ({
    me: { id: 'me', name: 'Me', bot: false },
    names: {},
    organization: org,
    contacts: [
      ...(group
        ? [
            {
              user: group,
              lastMsg: { id: 'group-first', text: 'Hello', user: 'alice', date: now + 1, read: false },
            },
          ]
        : []),
      {
        user: { name: 'Alice', online: true },
        lastMsg: { ...messages[0], id: legacyPreview ? undefined : messages[0]?.id, read: !legacyPreview },
      },
      {
        user: { name: 'Bob', online: false },
        lastMsg: { id: 'bob', text: 'Good game!', user: 'bob', date: now - 60000, read: true },
      },
    ],
    convo: {
      user: { name: 'Alice', online: true },
      msgs: messages,
      postable: true,
      relations: {},
      pinned: messages.filter(m => m.pinnedAt),
    },
  });
  await page.route('**/api/users', route =>
    route.fulfill({
      json: (route.request().postData() ?? '').split(',').map(id => ({
        id,
        username: id.charAt(0).toUpperCase() + id.slice(1),
        ...(id === 'alice'
          ? { patron: true, patronColor: 2, profile: { flag: 'cn' }, perfs: { xiangqi: { rank: '5d' } } }
          : {}),
      })),
    }),
  );
  const requests: { path: string; fields: Record<string, string> }[] = [];
  await page.route(
    url => url.pathname === '/inbox' || url.pathname.startsWith('/inbox/'),
    async route => {
      const request = route.request(),
        path = new URL(request.url()).pathname;
      const fields = Object.fromEntries(
        [...(request.postData() ?? '').matchAll(/name="([^"]+)"\r\n\r\n([\s\S]*?)(?=\r\n--)/g)].map(m => [
          m[1],
          m[2],
        ]),
      );
      requests.push({ path, fields });
      let result: any = data();
      if (path === '/inbox/public/global') {
        const followup = {
          ...messages[1],
          id: 'followup',
          text: 'Thanks for suggesting this feature.',
          date: now - 1500,
        };
        result = {
          msgs: [messages[0], followup, messages[1]].map(m => ({
            ...m,
            reactions: m.id === 'mine' ? { '👍': 2 } : {},
          })),
        };
      } else if (path === '/inbox/contacts/friends')
        result = { friends: [{ name: 'Alice' }, { name: 'Bob' }] };
      else if (path === '/inbox/groups/create') {
        group = { id: groupId, name: fields.name, group: true };
        result = { id: groupId };
      } else if (path === '/inbox/group/' + groupId + '/manage') {
        if (fields.action === 'promote') admins.add(fields.value);
        if (fields.action === 'demote') admins.delete(fields.value);
        if (fields.action === 'describe') description = fields.value;
        result = {};
      } else if (path === '/inbox/group/' + groupId && request.method() === 'GET') {
        result.convo = {
          user: group,
          admins: publicRoom ? undefined : [...admins],
          canModerate: publicRoom,
          description,
          members: [{ name: 'Me' }, { name: 'Alice' }, { name: 'Bob' }],
          postable: true,
          relations: {},
          msgs: publicRoom ? messages : [],
          pinned: [],
        };
      } else if (path === '/inbox/settings/organize') {
        if (fields.action === 'folder')
          org.folders.push({ id: 'testfolder1234567', name: fields.value, chats: fields.members.split(',') });
        else {
          const state = (org.states[fields.chat] ??= {});
          state[fields.action] = fields.action === 'archive' ? Date.now() + 1000 : fields.value === 'true';
        }
        result = org;
      } else if (path === '/inbox/settings/chats') result = { contacts: data().contacts, before: null };
      else if (path.startsWith('/inbox/history/'))
        result = { msgs: [{ ...messages[0], id: 'older-match', text: 'A result from last season' }] };
      else if (path.endsWith('/receipt')) {
        const ids = fields.ids.split(',');
        const at = Date.now();
        messages = messages.map(m =>
          ids.includes(m.id)
            ? {
                ...m,
                deliveredAt: m.deliveredAt ?? at,
                ...(fields.read === 'true' ? { readAt: m.readAt ?? at } : {}),
              }
            : m,
        );
        result = {
          receipts: messages
            .filter(m => ids.includes(m.id))
            .map(({ id, deliveredAt, readAt }) => ({ id, deliveredAt, readAt })),
        };
      } else if (path.includes('/messages/')) {
        const id = path.split('/').pop()!,
          previous = messages.find(m => m.id === id);
        const msg = { ...previous, revision: previous.revision + 1 };
        if (fields.action === 'edit') {
          msg.history = [...msg.history, { text: msg.text, date: msg.date }];
          msg.text = fields.value;
          msg.editedAt = Date.now();
        }
        if (fields.action === 'react')
          msg.reactions = fields.value ? [{ user: 'me', emoji: fields.value }] : [];
        if (fields.action === 'pin') msg.pinnedAt = fields.value === 'true' ? Date.now() : undefined;
        if (fields.action === 'deleteEveryone') {
          msg.deleted = true;
          msg.text = '';
          msg.history = [];
          msg.reactions = [];
        }
        messages =
          fields.action === 'deleteMe'
            ? messages.filter(m => m.id !== id)
            : messages.map(m => (m.id === id ? msg : m));
        result = { msg };
      } else if (path.endsWith('/typing')) result = { ok: true };
      else if (path === '/inbox/bob' && request.method() === 'GET') {
        result.convo.user = { name: 'Bob', online: false };
        result.convo.msgs = [];
      } else if (path.endsWith('/search')) {
        const q = new URL(request.url()).searchParams.get('q')?.toLowerCase();
        result = { contacts: [], friends: [], users: [{ name: q === 'che' ? 'Chen' : 'Bob' }] };
      } else if (request.method() === 'POST') {
        const reply = messages.find(m => m.id === fields.replyTo);
        const msg = {
          id: `me_${fields.nonce}`,
          user: 'me',
          date: Date.now(),
          text: fields.text,
          card: fields.card && JSON.parse(fields.card),
          attachments: fields.attachments?.split(','),
          revision: 0,
          history: [],
          reactions: [],
          reply: reply && { id: reply.id, text: reply.text, user: reply.user },
        };
        messages.unshift(msg);
        result = { msg };
      }
      await route.fulfill({ json: result });
    },
  );
  await page.goto(`${origin}/fixture`);
  await page.addScriptTag({ path: 'public/javascripts/vendor/cash.min.js' });
  await page.evaluate(
    ({ translations, data }) => {
      const w = window as any;
      w.site = {
        sri: 'fixture',
        asset: {
          url: (path: string) => `/assets/${path}`,
          loadCssPath: async () => {},
          removeCssPath: () => {},
        },
        socket: { send: () => {} },
        sound: { preloadBoardSounds: () => {}, move: () => {} },
      };
      w.$html = (strings: TemplateStringsArray, ...values: unknown[]) =>
        strings.reduce((s, p, i) => s + p + (values[i] ?? ''), '');
      w.i18n = Object.fromEntries(
        Object.entries(translations).map(([name, keys]) => [
          name,
          Object.fromEntries(
            Object.entries(keys).map(([key, value]) => {
              const str = new DOMParser().parseFromString(value, 'text/html').documentElement.textContent;
              return [
                key,
                str.includes('%')
                  ? (...args: unknown[]) => {
                      let i = 0;
                      return str.replace(/%(?:(\d+)\$)?[sd]/g, (_, n) =>
                        String(args[n ? Number(n) - 1 : i++]),
                      );
                    }
                  : str,
              ];
            }),
          ),
        ]),
      );
      w.fixture = data;
    },
    { translations, data: data() },
  );
  if (card)
    await page.evaluate(auth => {
      const host = document.querySelector('main')!;
      host.className = 'lobby';
      host.innerHTML =
        '<div class="lobby__center-rail"><section class="lobby__global-chat lobby__rail-card"><h2 class="lobby__rail-title">LiXiangQi Global Chat</h2><div class="lobby__global-chat__room"></div></section></div>';
      const room = host.querySelector<HTMLElement>('.lobby__global-chat__room')!;
      room.dataset.auth = String(auth);
      if (!auth)
        room.insertAdjacentHTML(
          'afterend',
          '<a class="lobby__global-chat__signin" href="/login">Sign in</a>',
        );
    }, card === 'auth');
  await page.addScriptTag({ content: script });
  expect(errors, 'inbox initialization').toEqual([]);
  await expect(page.locator('.msg-row')).toHaveCount(card === 'guest' ? 3 : 2);
  return { errors, requests };
}

test('Three Kingdoms chat sends a territorial annotation at the chosen event', async ({ page }) => {
  const { errors } = await inbox(page, 820);
  const link = 'https://lixiangqi.com/three-kingdoms/game/sO7KUrjr';
  const frames = await page.evaluate(async () => {
    const url = '/assets/three-kingdoms-engine/main.js';
    const rules = (await import(url)).ThreeKingdoms;
    const initial = rules.initial();
    const move = rules.inspect(initial).moves[0];
    const next = rules.event(initial, 'red', move);
    return [initial, next, rules.event(next, 'green', 'draw')].map((fen, ply) => ({
      fen,
      ply,
      move: [undefined, move, 'draw'][ply],
      turn: rules.inspect(fen).turn,
      shapes: [],
      check: false,
      checkmate: false,
      capture: false,
    }));
  });
  await page.route('**/inbox/board-preview', route =>
    route.fulfill({ json: { frames, start: 2, orientation: 'red' } }),
  );
  const composer = page.locator('.msg-composer');
  await composer.locator('textarea').fill(link);
  await composer.getByRole('button', { name: 'Previous', exact: true }).click();
  await composer.getByRole('button', { name: 'Start from this position' }).click();
  await composer.getByRole('button', { name: 'Draw on board' }).click();
  await composer.locator('.graph-board__location[data-location="wu:4:0"]').click();
  await expect(composer.locator('.cg-shapes circle')).toHaveCount(1);
  const sent = page.waitForRequest(
    request => request.url().endsWith('/inbox/alice') && request.method() === 'POST',
  );
  await composer.locator('[data-testid="msg-send-button"]').click();
  const card = JSON.parse(/name="card"\r\n\r\n([^\r\n]+)/.exec((await sent).postData()!)![1]);
  expect(card.boards[0]).toMatchObject({
    source: { kind: 'link', value: link },
    start: 1,
    end: 2,
    marks: [{ ply: 1, fen: frames[1].fen, shapes: [{ orig: 'wu:4:0', brush: 'green' }] }],
  });
  expect(errors).toEqual([]);
});

for (const width of [360, 820, 1440]) {
  test(`chat sends drawings at their own replay positions at ${width}px`, async ({ page }) => {
    const { errors } = await inbox(page, width);
    const pgn = '[Event "Inbox"]\n\n1. h3e3 h8e8 *';
    const board = {
      title: 'Inbox replay',
      ...(width === 820 ? { path: '/GameIdXX/white#2' } : {}),
      start: 0,
      orientation: 'red',
      frames: [
        { fen: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1', ply: 0, turn: 'red' },
        {
          fen: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/9/RNBAKABNR b - - 1 1',
          ply: 1,
          turn: 'black',
          move: 'h3e3',
        },
        {
          fen: 'rnbakabnr/9/1c2c4/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/9/RNBAKABNR w - - 2 2',
          ply: 2,
          turn: 'red',
          move: 'h8e8',
        },
      ].map(frame => ({ ...frame, shapes: [], capture: false, check: false, checkmate: false })),
    };
    await page.route('**/inbox/board-preview', route => route.fulfill({ json: board }));
    let request: any;
    await page.route('**/inbox/alice', route => {
      const payload = route.request().postData() ?? '';
      const card = /name="card"\r\n\r\n([^\r\n]+)/.exec(payload)?.[1];
      if (!card) return route.fallback();
      request = JSON.parse(card).boards[0];
      return route.fulfill({
        json: {
          msg: {
            id: 'sent-board',
            user: 'me',
            text: 'Look at this:\n' + pgn,
            date: Date.now(),
            history: [],
            reactions: [],
            revision: 0,
            card: {
              boards: [
                {
                  ...board,
                  start: request.start,
                  inline: pgn,
                  frames: board.frames.map(frame => ({
                    ...frame,
                    shapes: request.marks.find((mark: any) => mark.ply === frame.ply)?.shapes ?? [],
                  })),
                },
              ],
            },
          },
        },
      });
    });
    const composer = page.locator('.msg-composer');
    const previewResponse = page.waitForResponse(response => response.url().endsWith('/inbox/board-preview'));
    await composer.locator('textarea').fill('Look at this:\n' + pgn);
    expect((await previewResponse).ok(), errors.join('\n')).toBe(true);
    const preview = composer.locator('.msg-board-draft');
    const surface = preview.locator('cg-board');
    await expect(surface).toBeVisible();
    await preview.getByRole('button', { name: 'Draw on board' }).click();
    await surface.click({ position: { x: 31, y: 36 } });
    await preview.getByRole('button', { name: 'Next', exact: true }).click();
    await surface.click({ position: { x: 62, y: 68 } });
    await preview.getByRole('button', { name: 'Start from this position' }).click();
    await composer.locator('[data-testid="msg-send-button"]').click();
    const sent = page.locator('[data-message-id="sent-board"]');
    await expect(sent).toContainText('Look at this:');
    await expect(sent).not.toContainText('[Event');
    expect(request.start).toBe(1);
    expect(request.marks.map((mark: { ply: number }) => mark.ply)).toEqual([0, 1]);
    await expect(sent.getByRole('button', { name: 'Previous', exact: true })).toBeEnabled();
    await expect(sent.locator('.cg-shapes circle')).toHaveCount(1);
    await sent.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(sent.locator('.cg-shapes circle')).toHaveCount(0);
    await sent.getByRole('button', { name: 'Previous', exact: true }).click();
    await expect(sent.locator('.cg-shapes circle')).toHaveCount(1);
    expect((await sent.locator('cg-board').boundingBox())!.width).toBeLessThan(width);
    await expect(sent.locator('.msg-board-header')).toContainText('Inbox replay');
    if (width === 820)
      await expect(sent.getByRole('link', { name: 'Open original' })).toHaveAttribute(
        'href',
        '/GameIdXX/white#2',
      );
    else {
      await page.evaluate(() => {
        Object.defineProperty(navigator, 'clipboard', {
          value: {
            writeText: async (value: string) => {
              document.body.dataset.copied = value;
            },
          },
        });
        window.site.announce = () => {};
      });
      await sent.getByRole('button', { name: 'Copy', exact: true }).click();
      await expect(page.locator('body')).toHaveAttribute('data-copied', pgn);
    }
    const inlineWidth = (await sent.locator('cg-board').boundingBox())!.width;
    await sent.locator('.msg-board-enlarge').click();
    const expanded = page.getByRole('dialog', { name: 'Inbox replay' });
    await expect(expanded.locator('.cg-shapes circle')).toHaveCount(1);
    expect((await expanded.locator('cg-board').boundingBox())!.width).toBeGreaterThan(inlineWidth);
    await expanded.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(expanded.locator('.cg-shapes circle')).toHaveCount(0);
    await expanded.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(sent.locator('.xiangqi-viewer')).toHaveCount(1);
    await expect(sent.locator('.xiangqi-viewer__moves')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

for (const width of [320, 960, 1440]) {
  for (const mode of ['auth', 'guest'] as const) {
    test(`homepage Global Chat bubbles and player identities at ${width}px (${mode})`, async ({
      page,
    }, info) => {
      await page.route('**/attachment/msg/*/policy', route =>
        route.fulfill({ json: { enabled: true, maxCount: 8, maxBytes: 4194304 } }),
      );
      const { errors, requests } = await inbox(page, width, false, undefined, true, mode);
      const room = page.locator('.lobby__global-chat__room');
      const row = room.locator('.msg-row').filter({ hasText: 'Shall we play another game?' });
      await expect(row.locator('.msg-author')).toContainText('Alice (5d)');
      await expect(row.locator('.msg-author .patron')).toHaveCount(1);
      await expect(row.locator('.msg-author img.flag')).toHaveCount(1);
      const avatar = row.locator('..').locator('.msg-author-avatar');
      await expect(avatar).toHaveText('A', { ignoreCase: true });
      const a = (await avatar.boundingBox())!,
        b = (await row.locator('.msg-bubble').boundingBox())!;
      expect(a.x + a.width).toBeLessThanOrEqual(b.x + 1);
      expect(b.x + b.width).toBeLessThanOrEqual(width);
      await expect(room.locator('textarea')).toHaveCount(mode === 'auth' ? 1 : 0);
      if (mode === 'auth') {
        await room.locator('.attachment-plus').click();
        await expect(room.getByRole('menuitem', { name: 'Photos & videos' })).toBeVisible();
        await room.locator('.attachment-plus').click();
        await row.click({ button: 'right' });
        await page.getByRole('dialog').getByRole('button', { name: 'Reply', exact: true }).click();
        await room.locator('textarea').fill('Homepage reply');
        await room.locator('textarea').press('Enter');
        await expect.poll(() => requests.some(r => r.fields.replyTo === 'theirs')).toBe(true);
      }
      if (mode === 'guest') {
        const groups = room.locator('group');
        await expect(groups).toHaveCount(2);
        await expect(groups.first().locator('.msg-author')).toHaveCount(1);
        await expect(groups.first().locator('.msg-reactions')).toHaveCount(0);
        await expect(groups.last().locator('.msg-reactions')).toHaveText('👍 2');
        const [first, second, third] = await room.locator('.msg-bubble').evaluateAll(els =>
          els.map(el => {
            const r = el.getBoundingClientRect();
            return { top: r.top, bottom: r.bottom, left: r.left };
          }),
        );
        expect(second.left).toBe(first.left);
        const within = second.top - first.bottom;
        expect(within).toBeGreaterThan(0);
        expect(third.top - second.bottom).toBeGreaterThan(within);
        const footer = (await page.locator('.lobby__global-chat__signin').boundingBox())!;
        expect(footer.y - third.bottom).toBeLessThan(36);
        await page
          .locator('.lobby__global-chat')
          .screenshot({ path: info.outputPath('signed-out-chat.png') });
      }
      expect(new URL(page.url()).pathname).toBe('/fixture');
      expect(errors).toEqual([]);
    });
  }
}

test('a full signed-out chat preview scrolls inside the card', async ({ page }) => {
  await inbox(page, 960, false, undefined, true, 'guest');
  const messages = Array.from({ length: 12 }, (_, i) => ({
    id: 'public-' + i,
    user: i % 2 ? 'alice' : 'bob',
    text: ('Message ' + i + ' ').repeat(16),
    date: Date.now() - i * 60000,
    reactions: {},
  }));
  await page.route('**/inbox/public/global', route => route.fulfill({ json: { msgs: messages } }));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  const list = page.locator('.msg-app__convo__msgs');
  await expect(list.locator('.msg-row')).toHaveCount(messages.length);
  await expect
    .poll(() => list.evaluate(el => el.scrollHeight > el.clientHeight && el.scrollTop > 0))
    .toBe(true);
  const footer = page.locator('.lobby__global-chat__signin');
  const before = await footer.boundingBox();
  await list.evaluate(el => {
    el.scrollTop = 0;
  });
  expect(await footer.boundingBox()).toEqual(before);
  await expect(list.locator('.msg-row').first()).toContainText('Message 11');
});

for (const width of [320, 768, 1440]) {
  test(`responsive conversation, typing, reply and message menu at ${width}px`, async ({ page }, info) => {
    const { errors, requests } = await inbox(page, width);
    const chats = page.locator('.msg-app__side');
    if (width >= 680) await expect(chats).toBeVisible();
    else await expect(chats).toBeHidden();
    if (width >= 680) {
      const search = chats.getByRole('searchbox');
      await search.click();
      await expect(search).toBeFocused();
      await expect(search).toHaveCSS('padding-inline-start', '8px');
    }
    await page.getByRole('button', { name: 'Search in chat' }).click();
    const chatSearch = page.getByRole('searchbox', { name: 'Search in chat' });
    await expect(chatSearch).toBeFocused();
    expect(
      await chatSearch.evaluate(input => {
        const panel = input.parentElement!;
        return input.getBoundingClientRect().bottom <= panel.getBoundingClientRect().top + panel.clientHeight;
      }),
    ).toBe(true);
    await chatSearch.locator('..').getByRole('button', { name: 'Close' }).click();
    await expect(page.locator('.msg-receipt')).toHaveAttribute('aria-label', 'Read');
    await expect(page.locator('.msg-receipt .msg-glyph')).toHaveText('\uE047');
    const loaded = await page.evaluate(async () => {
      const faces = await document.fonts.load('400 17px "Signal Inbox"', '\uE047');
      return faces.some(face => face.status === 'loaded');
    });
    expect(loaded).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.evaluate(() => (window as any).inboxEvent('msgTyping', { user: 'alice', active: true }));
    await expect(page.locator('.msg-typing i')).toHaveCount(3);
    const incoming = page.locator('[data-message-id="theirs"]');
    await incoming.hover();
    await expect(incoming.locator('.msg-toolbar')).toHaveCSS('opacity', '1');
    await page.screenshot({ path: info.outputPath(`inbox-initial-${width}.png`) });
    if (width < 600) {
      await incoming.getByRole('button', { name: 'Message options' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Reply', exact: true }).click();
    } else await incoming.getByRole('button', { name: 'Reply', exact: true }).click();
    await expect(page.locator('.msg-compose-context')).toContainText('Shall we play');
    await page.getByTestId('msg-textarea').fill('Yes, let’s play!');
    await page.getByTestId('msg-send-button').click();
    await expect(page.locator('.msg-row')).toHaveCount(3);
    await expect.poll(() => requests.some(r => r.fields.replyTo === 'theirs')).toBe(true);
    const sent = page.locator('.msg-row').filter({ hasText: 'Yes, let’s play!' });
    const receipt = sent.locator('.msg-receipt');
    await expect(receipt).toHaveAttribute('aria-label', 'Sent');
    await expect(receipt.locator('.msg-glyph')).toHaveText('\uE022');
    const id = await sent.getAttribute('data-message-id');
    await page.evaluate(
      id =>
        (window as any).inboxEvent('msgReceipt', {
          user: 'alice',
          receipts: [{ id, deliveredAt: Date.now() }],
        }),
      id,
    );
    await expect(receipt).toHaveAttribute('aria-label', 'Delivered');
    await expect(receipt.locator('.msg-glyph')).toHaveText('\uE046');
    await page.locator('[data-message-id="mine"]').click({ button: 'right' });
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
    await expect(
      page.getByRole('dialog').getByRole('button', { name: 'Delete message', exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: info.outputPath(`inbox-${width}.png`) });
    expect(errors).toEqual([]);
  });
}

test.describe('touch Inbox', () => {
  test.use({ hasTouch: true });

  test('message buttons stay beside bubbles and blank space dismisses the menu', async ({ page }) => {
    await inbox(page, 390);
    for (const row of await page.locator('.msg-row').all()) {
      const [button, bubble] = await row.evaluate(el =>
        ['.msg-toolbar button:last-child', '.msg-bubble'].map(selector =>
          el.querySelector(selector)!.getBoundingClientRect().toJSON(),
        ),
      );
      expect(button.x >= bubble.x + bubble.width || button.x + button.width <= bubble.x).toBe(true);
      expect(button.y + button.height / 2).toBeCloseTo(bubble.y + bubble.height / 2, 0);
    }

    const more = page.locator('[data-message-id="mine"]').getByRole('button', { name: 'Message options' });
    const dialog = page.getByRole('dialog');
    await more.tap();
    const menu = dialog.locator('.msg-context-menu');
    await expect(menu).toBeVisible();
    const context = (await dialog.locator('.msg-context').boundingBox())!;
    const panel = (await menu.boundingBox())!;
    expect(panel.x).toBeGreaterThan(context.x);
    await page.touchscreen.tap((context.x + panel.x) / 2, panel.y + panel.height / 2);
    await expect(dialog).toBeHidden();
    await more.tap();
    await dialog.getByRole('button', { name: 'Reply', exact: true }).tap();
    await expect(page.locator('.msg-compose-context')).toContainText('That cannon move');
  });
});

test('edits expose history; reactions and deletion after read update both bubble and menu', async ({
  page,
}) => {
  const { errors } = await inbox(page, 1440);
  const mine = page.locator('[data-message-id="mine"]');
  await mine.click({ button: 'right' });
  await page.getByRole('dialog').getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByTestId('msg-textarea').fill('The horse move was excellent.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(mine).toContainText('The horse move');
  expect(errors, 'after edit').toEqual([]);
  await mine.getByRole('button', { name: 'Edited', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('That cannon move');
  await page.keyboard.press('Escape');
  expect(errors, 'after history').toEqual([]);
  await mine.hover();
  await mine.getByRole('button', { name: 'React', exact: true }).click();
  await page.getByRole('button', { name: 'React ❤️', exact: true }).click();
  await expect(mine.locator('.msg-reactions button')).toHaveText('❤️');
  const bubble = (await mine.locator('.msg-bubble').boundingBox())!;
  const badge = (await mine.locator('.msg-reactions button').boundingBox())!;
  expect(badge.y).toBeLessThan(bubble.y + bubble.height);
  expect(badge.y + badge.height).toBeGreaterThan(bubble.y + bubble.height);
  expect(badge.x).toBeLessThan(bubble.x + bubble.width / 2);
  expect(errors, 'after reaction').toEqual([]);
  await mine.click({ button: 'right' });
  await page.getByRole('dialog').getByRole('button', { name: 'Delete message', exact: true }).click();
  await page.getByRole('button', { name: 'Delete for everyone', exact: true }).click();
  await expect(mine).toContainText('This message was deleted');
  await expect(mine).not.toContainText('horse move');
  expect(errors).toEqual([]);
});

test('pins, searchable emoji, multi-select and delete for me', async ({ page }) => {
  const { errors, requests } = await inbox(page, 1440);
  const incoming = page.locator('[data-message-id="theirs"]');
  await incoming.click({ button: 'right' });
  await page.getByRole('button', { name: 'Pin', exact: true }).click();
  await expect(page.locator('.msg-pins')).toContainText('Shall we play');
  await incoming.hover();
  await incoming.getByRole('button', { name: 'React', exact: true }).click();
  await page.getByRole('button', { name: 'More emoji', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search emoji' }).fill('ok hand');
  await expect(page.getByRole('button', { name: 'OK hand', exact: true })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search emoji' }).fill('horse face');
  await page.getByRole('button', { name: 'horse face', exact: true }).click();
  await expect(incoming.locator('.msg-reactions')).toContainText('🐴');
  await incoming.click({ button: 'right' });
  await page.getByRole('dialog').getByRole('button', { name: 'Select', exact: true }).click();
  await page.locator('[data-message-id="mine"]').click();
  await expect(page.locator('.msg-selection-bar')).toContainText('2 selected');
  await page.locator('.msg-selection-bar').getByRole('button', { name: 'Delete message' }).click();
  await expect(page.getByRole('button', { name: 'Delete for everyone', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Delete for me', exact: true }).click();
  await expect(page.locator('.msg-row')).toHaveCount(0);
  expect(requests.filter(r => r.fields.action === 'deleteMe')).toHaveLength(2);
  expect(errors).toEqual([]);
});

test('forward uses the original participant and message id', async ({ page }) => {
  const { errors, requests } = await inbox(page, 1440);
  await page.locator('[data-message-id="theirs"]').click({ button: 'right' });
  await page.getByRole('dialog').getByRole('button', { name: 'Forward', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Bob', exact: true }).click();
  await expect(page.locator('.msg-app__convo__head')).toContainText('Bob');
  expect(
    requests.some(
      r =>
        r.path === '/inbox/bob' &&
        r.fields.forwardId === 'theirs' &&
        r.fields.forwardUser === 'alice' &&
        r.fields.nonce.length >= 16,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test('cached chat opens before a held refresh and newer events win', async ({ page }) => {
  const { errors } = await inbox(page, 1440);
  const snapshot = await page.evaluate(() => (window as any).fixture);
  await page.getByRole('button', { name: 'Bob', exact: true }).click();
  await expect(page.locator('.msg-app__convo__head')).toContainText('Bob');
  let release!: () => void;
  const held = new Promise<void>(done => {
    release = done;
  });
  await page.route('**/inbox/alice', async route => {
    if (route.request().method() !== 'GET') return route.fallback();
    await held;
    await route.fulfill({ json: snapshot });
  });
  const requested = page.waitForRequest(r => r.method() === 'GET' && r.url().endsWith('/inbox/alice'));
  await page.getByRole('button', { name: 'Alice', exact: true }).click();
  await requested;
  await expect(page.locator('.msg-row')).toHaveCount(2);
  await page.evaluate(msg => {
    const event = (window as any).inboxEvent;
    event('msgChanged', { user: 'alice', kind: 'update', msg: { ...msg, text: 'Latest edit', revision: 2 } });
    event('msgChanged', { user: 'alice', kind: 'update', msg: { ...msg, text: 'Stale edit', revision: 1 } });
  }, snapshot.convo.msgs[0]);
  const refreshed = page.waitForResponse(
    r => r.url().endsWith('/inbox/alice') && r.request().method() === 'GET',
  );
  release();
  await refreshed;
  await expect(page.locator('[data-message-id="mine"]')).toContainText('Latest edit');
  await expect(page.locator('[data-message-id="mine"]')).not.toContainText('Stale edit');
  expect(errors).toEqual([]);
});

test('receipts clear legacy thread previews without message ids', async ({ page }) => {
  await page.addInitScript(() => {
    document.hasFocus = () => false;
  });
  const { errors } = await inbox(page, 1440, true);
  await expect(page.locator('.msg-unread-dot')).toHaveCount(1);
  await page.evaluate(() =>
    (window as any).inboxEvent('msgReceipt', {
      user: 'alice',
      receipts: [{ id: 'mine', deliveredAt: Date.now(), readAt: Date.now() }],
    }),
  );
  await expect(page.locator('.msg-unread-dot')).toHaveCount(0);
  expect(errors).toEqual([]);
});

const pixel = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64');
const attachmentId = (n: number) => n.toString(16).padStart(32, '0');

for (const [count, width] of [
  [1, 320],
  [2, 768],
  [3, 1440],
  [4, 320],
  [5, 768],
  [7, 1440],
]) {
  test('album of ' + count + ' at ' + width + 'px', async ({ page }, info) => {
    const ids = Array.from({ length: count }, (_, i) => attachmentId(i + 1));
    const samples = await page.evaluate(
      n =>
        Array.from({ length: n }, (_, i) => {
          const canvas = document.createElement('canvas');
          canvas.width = 180;
          canvas.height = 120;
          const ctx = canvas.getContext('2d')!;
          ctx.fillStyle = ['#557d98', '#b76656', '#63876b', '#b99058', '#567575', '#635e8c', '#966b80'][i];
          ctx.fillRect(0, 0, 180, 120);
          ctx.fillStyle = 'rgba(255,255,255,.65)';
          ctx.beginPath();
          ctx.arc(45 + 10 * i, 46, 22, 0, 2 * Math.PI);
          ctx.fill();
          ctx.fillStyle = 'rgba(0,0,0,.25)';
          ctx.fillRect(0, 80, 180, 40);
          return canvas.toDataURL('image/webp').split(',')[1];
        }),
      count,
    );
    await page.route('**/attachment/msg/item/**', route => {
      const url = new URL(route.request().url());
      const index = ids.indexOf(url.pathname.split('/').pop()!) + 1;
      return url.searchParams.has('meta')
        ? route.fulfill({
            json: {
              name: 'Photo ' + index + '.jpg',
              size: Buffer.from(samples[index - 1], 'base64').length,
              mime: 'image/webp',
            },
          })
        : route.fulfill({ body: Buffer.from(samples[index - 1], 'base64'), contentType: 'image/webp' });
    });
    await page.route('**/attachment/msg/*/policy', route =>
      route.fulfill({ json: { enabled: true, maxCount: 8, maxBytes: 4194304 } }),
    );
    const { errors } = await inbox(page, width, false, ids);
    await expect(page.locator('.attachment-plus')).toBeVisible();
    await expect(page.locator('.msg-app__side__contact__msg').first()).toHaveText(
      translations.site.mediaFiles,
    );
    const tiles = page.locator('.msg-album button');
    await expect(tiles).toHaveCount(Math.min(count, 5));
    const rects = await tiles.evaluateAll(els => els.map(el => el.getBoundingClientRect().toJSON()));
    expect(rects[0].width).toBeGreaterThan(65);
    if (count === 3) {
      expect(rects[0].width / rects[1].width).toBeCloseTo(2, 1);
      expect(rects[1].left).toEqual(rects[2].left);
    }
    if (count >= 4) {
      expect(rects[0].top).toEqual(rects[1].top);
      expect(rects[2].top).toBeGreaterThan(rects[0].top);
      expect(rects[2].width / rects[0].width).toBeCloseTo(count === 4 ? 1 : 2 / 3, 1);
    }
    await page.screenshot({ path: info.outputPath('album.png') });
    await tiles.first().click();
    const dialog = page.getByRole('dialog');
    const mainImage = dialog.locator('.msg-lightbox-stage img');
    await expect(mainImage).toBeVisible();
    const imageBox = await mainImage.boundingBox();
    const stageBox = await dialog.locator('.msg-lightbox-stage').boundingBox();
    expect(Math.abs(imageBox!.x + imageBox!.width / 2 - width / 2)).toBeLessThan(2);
    expect(Math.abs(imageBox!.y + imageBox!.height / 2 - stageBox!.y - stageBox!.height / 2)).toBeLessThan(2);
    await expect(dialog.getByRole('button', { name: translations.inbox.forward })).toBeVisible();
    await expect(dialog.locator('header time')).toBeVisible();
    if (count > 1) {
      await page.keyboard.press('ArrowRight');
      await expect(mainImage).toHaveAttribute('alt', 'Photo 2.jpg');
      await expect(dialog.locator('[download]')).toHaveAttribute('download', 'Photo 2.webp');
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test('a delivered clip opens the authenticated MP4 in the lightbox', async ({ page }) => {
  const clip = readFileSync('tests/fixtures/inbox-clip.mp4');
  await page.route('**/attachment/msg/item/**', route =>
    new URL(route.request().url()).searchParams.has('meta')
      ? route.fulfill({ json: { name: 'game.mov', size: clip.length, mime: 'video/mp4' } })
      : route.fulfill({ body: clip, contentType: 'video/mp4' }),
  );
  const { errors } = await inbox(page, 768, false, [attachmentId(1)]);
  await page.locator('.msg-video-tile').click();
  const dialog = page.getByRole('dialog');
  const player = dialog.locator('video');
  await expect(player).toBeVisible();
  await expect(player).toHaveJSProperty('controls', true);
  await expect.poll(() => player.evaluate(el => el.readyState)).toBeGreaterThanOrEqual(2);
  await expect(dialog.locator('[download]')).toHaveAttribute('download', 'game.mp4');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Send uploads the final edited photo and file together', async ({ page }) => {
  const fileNames: string[] = [];
  await page.route('**/attachment/msg/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/policy'))
      return route.fulfill({ json: { enabled: true, maxCount: 8, maxBytes: 4194304 } });
    if (url.pathname.endsWith('/upload')) {
      fileNames.push(decodeURIComponent(route.request().headers()['x-attachment-name']));
      return route.fulfill({ json: { id: attachmentId(fileNames.length), state: 'ready' } });
    }
    const photo = url.pathname.endsWith(attachmentId(1));
    return url.searchParams.has('meta')
      ? route.fulfill({
          json: {
            name: photo ? 'board.webp' : 'analysis.zip',
            size: 2048,
            mime: photo ? 'image/webp' : 'application/octet-stream',
          },
        })
      : route.fulfill({ body: pixel, contentType: 'application/octet-stream' });
  });
  const { errors, requests } = await inbox(page, 768);
  const send = page.getByTestId('msg-send-button');
  await expect(send).toBeHidden();
  await expect(page.locator('.attachment-plus')).toBeVisible();
  await expect(page.locator('input[capture]')).toHaveCount(0);
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 96;
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const inputs = page.locator('.attachment-menu input');
  await inputs
    .first()
    .setInputFiles({ name: 'board.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  const editor = page.locator('.msg-photo-editor');
  await expect(page.locator('.photo-tile')).toHaveCount(1);
  await expect(editor).toHaveCount(0);
  await page.locator('[data-action=edit0]').click();
  const canvas = editor.locator('.photo-surface > canvas');
  const done = editor.getByRole('button', { name: 'Done', exact: true });
  await editor.locator('[data-mode=marker]').click();
  await expect(editor.getByRole('slider')).toHaveAttribute('aria-label', translations.inbox.photoColor);
  await editor.locator('summary[aria-label=Pen]').click();
  await editor.getByRole('button', { name: 'Highlighter' }).click();
  await editor.locator('summary[aria-label=Regular]').click();
  await editor.getByRole('button', { name: 'Heavy' }).click();
  await canvas.click();
  await done.click();
  await editor.locator('[data-mode=text]').click();
  await editor.getByRole('textbox').fill('River');
  await done.click();
  await editor.locator('[data-mode=sticker]').click();
  await editor.getByRole('button', { name: /Arabic/ }).click();
  await editor.locator('[data-mode=crop]').click();
  await editor.getByRole('button', { name: '9:16' }).click();
  await expect(editor.locator('[data-corner]')).toHaveCount(4);
  const before = await canvas.getAttribute('width');
  await editor.getByRole('button', { name: /rotate/i }).click();
  await expect(canvas).toHaveAttribute('height', before!);
  await done.click();
  await done.click();
  await expect(editor).toHaveCount(0);
  expect(fileNames).toEqual([]);
  await inputs.last().setInputFiles({
    name: 'analysis.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from([80, 75, 3, 4]),
  });
  await expect(page.locator('.attachment-item')).toHaveCount(2);
  expect(fileNames).toEqual([]);
  await expect(send).toBeEnabled();
  await send.click();
  await expect(page.locator('.msg-file')).toContainText('analysis.zip');
  expect(fileNames).toEqual(['board.webp', 'analysis.zip']);
  expect(requests.some(req => req.fields.attachments === [attachmentId(1), attachmentId(2)].join(','))).toBe(
    true,
  );
  await expect(page.locator('.msg-file')).toHaveAttribute('download', 'analysis.zip');
  const sent = page.locator('.msg-row').filter({ has: page.locator('.msg-file') });
  await sent.hover();
  await sent
    .locator('.msg-toolbar')
    .getByRole('button', { name: /download/i })
    .click();
  await expect(page.getByRole('dialog').locator('[download]')).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('download requested while metadata loads opens the complete attachment chooser', async ({ page }) => {
  const ids = [attachmentId(1), attachmentId(2)];
  let release!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  await page.route('**/attachment/msg/item/**', async route => {
    await gate;
    const id = new URL(route.request().url()).pathname.split('/').pop()!;
    await route.fulfill({ json: { name: id + '.zip', size: 42, mime: 'application/octet-stream' } });
  });
  const { errors } = await inbox(page, 1440, false, ids);
  const message = page.locator('[data-message-id="mine"]');
  await message.hover();
  await message.getByRole('button', { name: /download/i }).click();
  release();
  await expect(page.getByRole('dialog').locator('[download]')).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('two local photos stay editable until Send', async ({ page }) => {
  const uploaded: string[] = [];
  await page.route('**/attachment/msg/**', route => {
    if (route.request().url().endsWith('/policy'))
      return route.fulfill({ json: { enabled: true, maxCount: 8, maxBytes: 4194304 } });
    if (route.request().method() === 'GET') return route.fulfill({ contentType: 'image/webp', body: pixel });
    uploaded.push(decodeURIComponent(route.request().headers()['x-attachment-name']));
    return route.fulfill({ json: { id: attachmentId(uploaded.length), state: 'ready' } });
  });
  const { errors } = await inbox(page, 320);
  const input = page.locator('.attachment-menu input').first();
  await input.setInputFiles(
    ['first', 'second'].map(name => ({ name: name + '.webp', mimeType: 'image/webp', buffer: pixel })),
  );
  await expect(page.locator('.attachment-item')).toHaveCount(2);
  expect(uploaded).toEqual([]);
  await expect(page.locator('.photo-tile')).toHaveCount(2);
  const send = page.getByTestId('msg-send-button');
  await expect(send).toBeEnabled();
  await send.click();
  await expect.poll(() => uploaded.slice().sort()).toEqual(['first.webp', 'second.webp']);
  expect(errors).toEqual([]);
});

test('new group, mentions, chat folders, archive and full-history search', async ({ page }) => {
  const { requests, errors } = await inbox(page, 1440);
  const side = page.locator('.msg-app__side');
  await side.getByRole('button', { name: 'New chat', exact: true }).click();
  await expect(side.getByText('Friends', { exact: true })).toBeVisible();
  await side.getByRole('button', { name: 'New group' }).click();
  await side.getByRole('textbox', { name: 'Group name' }).fill('Club analysis');
  await side.getByRole('button', { name: /Alice/ }).click();
  await side.getByRole('searchbox').fill('Che');
  await side.getByRole('button', { name: /Chen/ }).click();
  await side.getByRole('button', { name: 'Done' }).click();
  const convo = page.locator('.msg-app__convo');
  await expect(convo.locator('.msg-group-title')).toContainText('Club analysis');
  expect(requests.find(r => r.path === '/inbox/groups/create')?.fields.members).toBe('alice,chen');
  await convo.locator('.msg-group-title').click();
  const settings = convo.locator('.msg-group-settings');
  await settings.getByRole('textbox', { name: 'Group description' }).fill('Review our games');
  await settings.locator('form').last().getByRole('button', { name: 'Done' }).click();
  await expect
    .poll(() => requests.some(r => r.fields.action === 'describe' && r.fields.value === 'Review our games'))
    .toBe(true);
  const alice = settings.locator('.msg-member').filter({ hasText: 'Alice' });
  await alice.getByRole('button', { name: 'Make admin' }).click();
  await expect
    .poll(() => requests.some(r => r.fields.action === 'promote' && r.fields.value === 'alice'))
    .toBe(true);
  await expect(alice.getByRole('button', { name: 'Remove admin' })).toBeVisible();
  await convo.getByRole('button', { name: 'Close', exact: true }).click();
  await convo.locator('textarea').fill('@Al');
  await convo.getByRole('button', { name: '@Alice' }).click();
  await expect(convo.locator('textarea')).toHaveValue('@Alice ');
  await convo.getByRole('button', { name: 'Search in chat' }).click();
  await convo.getByRole('searchbox').fill('last season');
  await expect(convo.locator('.msg-body')).toContainText('A result from last season');
  await convo.getByRole('button', { name: 'Close', exact: true }).click();
  const more = convo.locator('summary');
  await more.click();
  await convo.getByRole('button', { name: 'Archive', exact: true }).click();
  await side.locator('summary').click();
  await side.locator('.msg-dropdown-list').getByRole('button', { name: 'View archive' }).click();
  await expect(side.locator('.msg-app__side__contact')).toContainText('Club analysis');
  await side.locator('.msg-list-head button').first().click();
  await side.locator('summary').click();
  await side.getByRole('button', { name: 'Add chat folder' }).click();
  await side.getByRole('textbox', { name: 'Folder name' }).fill('League');
  await side.getByRole('button', { name: /Bob/ }).click();
  await side.getByRole('button', { name: 'Done' }).click();
  await side.getByRole('button', { name: 'League' }).click();
  await expect(side.locator('.msg-app__side__contact')).toHaveCount(1);
  await expect(side.locator('.msg-app__side__contact')).toContainText('Bob');
  expect(errors).toEqual([]);
});

test('attachment menu sends a poll and a contact while retaining the text draft', async ({ page }) => {
  await page.route('**/attachment/msg/*/policy', route =>
    route.fulfill({ json: { enabled: true, maxCount: 8, maxBytes: 4194304 } }),
  );
  const { requests, errors } = await inbox(page, 768);
  const draft = page.getByTestId('msg-textarea');
  await draft.fill('saved draft');
  await page.locator('.attachment-plus').click();
  await expect(page.getByRole('menuitem').first()).toHaveCSS('font-size', '13px');
  await expect(page.locator('.attachment-menu')).toHaveCSS('min-width', 'min(200px, 100%)');
  for (const [index, name] of ['Photos & videos', 'File', 'Poll', 'Contact'].entries())
    await expect(page.getByRole('menuitem').nth(index)).toHaveAccessibleName(name);
  await page.getByRole('menuitem', { name: 'Poll', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Question' }).fill('Which move?');
  await dialog.getByRole('textbox', { name: 'Option 1', exact: true }).fill('Cannon');
  await dialog.getByRole('textbox', { name: 'Option 2', exact: true }).fill('Horse');
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.msg-poll')).toContainText('Which move?');
  await expect(draft).toHaveValue('saved draft');
  await page.locator('.attachment-plus').click();
  await page.getByRole('menuitem', { name: 'Contact', exact: true }).click();
  await dialog.getByRole('radio', { name: 'Bob' }).check();
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.msg-shared-contact')).toContainText('Bob');
  await expect
    .poll(() => requests.some(r => r.fields.text === '@Bob' && JSON.parse(r.fields.card).contact === 'Bob'))
    .toBe(true);
  expect(errors).toEqual([]);
});

test('composer previews can be dismissed or sent as snapshots', async ({ page }) => {
  const url = 'https://signal.org/blog/';
  await page.route('**/attachment/msg/*/link-preview', route =>
    route.fulfill({
      json: {
        url,
        title: 'Signal blog',
        description: 'News from Signal',
        image: { mime: 'image/webp', data: pixel.toString('base64') },
      },
    }),
  );
  const id = attachmentId(1);
  await page.route('**/attachment/msg/*/policy', route =>
    route.fulfill({ json: { enabled: true, maxCount: 8, maxBytes: 4194304 } }),
  );
  await page.route('**/attachment/msg/*/upload', route => route.fulfill({ json: { id, state: 'ready' } }));
  await page.route('**/attachment/msg/item/**', route =>
    new URL(route.request().url()).searchParams.has('meta')
      ? route.fulfill({ json: { name: 'preview.webp', size: pixel.length, mime: 'image/webp' } })
      : route.fulfill({ body: pixel, contentType: 'image/webp' }),
  );
  const { requests, errors } = await inbox(page, 1440);
  await page.locator('.msg-app__convo__head summary').click();
  await expect(page.getByText('Generate link previews')).toHaveCount(0);
  await page.locator('.msg-app__convo__head summary').click();
  const draft = page.getByTestId('msg-textarea');
  await draft.fill(url);
  await expect(page.locator('.msg-staged-preview')).toContainText('News from Signal');
  await page.getByRole('button', { name: 'Remove link preview' }).click();
  await expect(page.locator('.msg-staged-preview')).toHaveCount(0);
  await draft.fill('');
  await draft.fill(url);
  await expect(page.locator('.msg-staged-preview')).toBeVisible();
  await page.getByTestId('msg-send-button').click();
  await expect(page.locator('.msg-link-card')).toHaveAttribute('href', url);
  const card = page.locator('.msg-link-card');
  const image = card.locator('img');
  await expect(image).toHaveCSS('width', '72px');
  await expect(image).toHaveCSS('height', '72px');
  await expect(card).toHaveCSS('text-decoration-line', 'none');
  const metadata = card.locator('.msg-link-card__text');
  const thumbBounds = (await image.boundingBox())!;
  const metadataBounds = (await metadata.boundingBox())!;
  expect(metadataBounds.x).toBeGreaterThanOrEqual(thumbBounds.x + thumbBounds.width + 7);
  await expect(page.locator('.msg-body t').last()).toContainText(url);
  expect(
    requests.some(
      r =>
        r.fields.attachments === id &&
        r.fields.card &&
        JSON.parse(r.fields.card).preview.title === 'Signal blog',
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test('composer grows only to three lines and inserts emoji at the selection', async ({ page }) => {
  const { errors } = await inbox(page, 768);
  const draft = page.getByTestId('msg-textarea');
  const shell = page.locator('.msg-app__convo__post__input');
  const emoji = page.getByRole('button', { name: 'Add emoji' });
  await expect(shell).toHaveCSS('height', '34px');
  await draft.fill('one');
  await expect(shell).toHaveCSS('height', '34px');
  await expect(draft).toHaveCSS('overflow-y', 'hidden');
  await draft.press('Shift+Enter');
  await draft.press('o');
  await expect(shell).toHaveCSS('height', '54px');
  await expect(draft).toHaveCSS('overflow-y', 'hidden');
  await draft.press('Shift+Enter');
  await draft.press('o');
  await expect(shell).toHaveCSS('height', '72px');
  await expect(draft).toHaveCSS('overflow-y', 'auto');
  await draft.press('Shift+Enter');
  await draft.press('o');
  await expect(shell).toHaveCSS('height', '72px');

  await draft.fill('A replace B');
  await draft.evaluate(el => el.setSelectionRange(2, 9));
  await emoji.click();
  await page.getByRole('searchbox', { name: 'Search emoji' }).fill('😀');
  await page.getByRole('button', { name: 'grinning face', exact: true }).click();
  await expect(draft).toHaveValue('A 😀 B');
  await expect(draft).toBeFocused();
  await expect(shell).toHaveCSS('height', '34px');
  expect(errors).toEqual([]);
});

test('a qualifying landscape link image uses the Signal banner layout', async ({ page }) => {
  const landscape = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 240;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#2267f5';
    context.fillRect(0, 0, 400, 240);
    return canvas.toDataURL('image/webp').split(',')[1];
  });
  const url = 'https://signal.org/blog/';
  const id = attachmentId(1);
  await page.route('**/attachment/msg/*/link-preview', route =>
    route.fulfill({
      json: { url, title: 'Signal', description: '', image: { mime: 'image/webp', data: landscape } },
    }),
  );
  await page.route('**/attachment/msg/*/policy', route =>
    route.fulfill({ json: { enabled: true, maxCount: 8, maxBytes: 4194304 } }),
  );
  await page.route('**/attachment/msg/*/upload', route => route.fulfill({ json: { id, state: 'ready' } }));
  const image = Buffer.from(landscape, 'base64');
  await page.route('**/attachment/msg/item/**', route =>
    new URL(route.request().url()).searchParams.has('meta')
      ? route.fulfill({ json: { name: 'preview.webp', size: image.length, mime: 'image/webp' } })
      : route.fulfill({ body: image, contentType: 'image/webp' }),
  );
  await inbox(page, 1440);
  await page.getByTestId('msg-textarea').fill(url);
  await expect(page.locator('.msg-staged-preview')).toBeVisible();
  await page.getByTestId('msg-send-button').click();
  const banner = page.locator('.msg-link-card__banner');
  await expect(banner).toBeVisible();
  const bounds = (await banner.boundingBox())!;
  const metadata = (await page.locator('.msg-link-card__text').boundingBox())!;
  expect(bounds.width).toBe(300);
  expect(bounds.width).toBeCloseTo(metadata.width);
  expect(bounds.y + bounds.height).toBeCloseTo(metadata.y);
});

test('failed poll offers a single retry and can be discarded locally', async ({ page }) => {
  await inbox(page, 768);
  const nonces: string[] = [];
  await page.route('**/inbox/alice', async route => {
    const payload = route.request().postDataBuffer();
    if (!payload) return route.fallback();
    const form = await new Response(new Uint8Array(payload), {
      headers: { 'content-type': route.request().headers()['content-type'] },
    }).formData();
    nonces.push(String(form.get('nonce')));
    await route.fulfill({ status: 503, body: '' });
  });
  await page.locator('.attachment-plus').click();
  await page.getByRole('menuitem', { name: 'Poll', exact: true }).click();
  const editor = page.getByRole('dialog');
  await editor.getByRole('textbox', { name: 'Question' }).fill('Which move?');
  await editor.getByRole('textbox', { name: 'Option 1', exact: true }).fill('Cannon');
  await editor.getByRole('textbox', { name: 'Option 2', exact: true }).fill('Horse');
  await editor.getByRole('button', { name: 'Add emoji · Option 2' }).click();
  await page.getByRole('searchbox', { name: 'Search emoji' }).fill('😀');
  await page.getByRole('button', { name: 'grinning face', exact: true }).click();
  await expect(editor.getByRole('textbox', { name: 'Option 2', exact: true })).toHaveValue('Horse😀');
  await editor.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(editor).toBeHidden();
  const retry = page.getByRole('button', { name: 'Not sent. Tap to retry.' });
  await retry.click();
  await expect(retry).toBeVisible();
  expect(nonces).toHaveLength(2);
  expect(nonces[0]).toBe(nonces[1]);
  await expect(page.locator('.msg-error')).toHaveCount(0);
  await page.locator('.msg-poll').click({ button: 'right' });
  await page.getByRole('button', { name: 'Delete for me' }).click();
  await expect(page.locator('.msg-poll')).toHaveCount(0);
  expect(nonces).toHaveLength(2);
});
