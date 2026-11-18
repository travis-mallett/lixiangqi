import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

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
          m[1] === 'plurals' ? (/<item quantity="other">([\s\S]*?)<\/item>/.exec(m[3])?.[1] ?? m[2]) : m[3],
        ]),
      ),
    ];
  }),
);

test.beforeAll(async () => {
  const manifest = JSON.parse(readFileSync('public/compiled/manifest.json', 'utf8'));
  const css = ['lib.theme.all', 'site', 'msg', 'bits.dialog']
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
    initModule({ data: window.fixture });
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
      ${css}</style>
      <body class="dark" data-theme="dark"><div id="main-wrap"><main class="msg-app"></main></div></body></html>`);
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Inbox fixture unavailable');
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  await server?.[Symbol.asyncDispose]();
});

async function inbox(page: Page, width: number, legacyPreview = false) {
  await page.setViewportSize({ width, height: 850 });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.stack ?? error.message));
  const now = Date.now();
  let messages: any[] = [
    {
      id: 'mine',
      text: 'That cannon move was excellent.',
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
  const data = () => ({
    me: { id: 'me', name: 'Me', bot: false },
    names: {},
    contacts: [
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
      if (path.endsWith('/receipt')) {
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
      } else if (path.endsWith('/search')) result = { contacts: [], friends: [], users: [{ name: 'Bob' }] };
      else if (request.method() === 'POST') {
        const reply = messages.find(m => m.id === fields.replyTo);
        const msg = {
          id: `me_${fields.nonce}`,
          user: 'me',
          date: Date.now(),
          text: fields.text,
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
  await page.addScriptTag({ content: script });
  await expect(page.locator('.msg-row')).toHaveCount(2);
  return { errors, requests };
}

for (const width of [320, 768, 1440]) {
  test(`responsive conversation, typing, reply and message menu at ${width}px`, async ({ page }, info) => {
    const { errors, requests } = await inbox(page, width);
    await expect(page.locator('.msg-receipt')).toHaveAttribute('aria-label', 'Read');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.evaluate(() => (window as any).inboxEvent('msgTyping', { user: 'alice', active: true }));
    await expect(page.locator('.msg-typing i')).toHaveCount(3);
    const incoming = page.locator('[data-message-id="theirs"]');
    await incoming.hover();
    await expect(incoming.locator('.msg-toolbar')).toHaveCSS('opacity', '1');
    await page.screenshot({ path: info.outputPath(`inbox-initial-${width}.png`) });
    await incoming.getByRole('button', { name: 'Reply', exact: true }).click();
    await expect(page.locator('.msg-compose-context')).toContainText('Shall we play');
    await page.getByTestId('msg-textarea').fill('Yes, let’s play!');
    await page.getByTestId('msg-send-button').click();
    await expect(page.locator('.msg-row')).toHaveCount(3);
    expect(requests.some(r => r.fields.replyTo === 'theirs')).toBe(true);
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
  await expect(mine.locator('.msg-reactions')).toContainText('❤️');
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
