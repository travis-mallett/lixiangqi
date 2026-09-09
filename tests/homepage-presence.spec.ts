import { test, expect } from '@playwright/test';

const baseUrl = process.env.LIXIANGQI_BASE_URL ?? 'http://127.0.0.1:9663';
const base = new URL(baseUrl);
if (!['localhost', '127.0.0.1', '::1'].includes(base.hostname) && !base.hostname.endsWith('.localhost'))
  throw new Error(`Refusing browser presence test against non-local URL: ${base.hostname}`);

test.use({ channel: 'chrome', baseURL: baseUrl });
test.describe.configure({ mode: 'serial' });
const localExpect = expect.configure({ timeout: 10_000 });

async function puzzle(context: import('@playwright/test').BrowserContext) {
  return context.newPage().then(async page => {
    const response = await page.goto('/training', { waitUntil: 'domcontentloaded' });
    expect(response?.ok()).toBeTruthy();
    await localExpect(page.locator('main.puzzle')).toBeVisible();
    return page;
  });
}

async function onlineCount(page: import('@playwright/test').Page) {
  return Number((await page.locator('.lobby__site-counter--online strong').textContent()) ?? 0);
}

async function activityCount(page: import('@playwright/test').Page, activity: string) {
  const link =
    activity === 'puzzle'
      ? page.locator('a.lobby__action--puzzle .lobby__action__activity')
      : page.locator('.lobby__quick-room .lobby__occupancy').first();
  return Number((await link.textContent()) ?? 0);
}

test('shared puzzle presence stays accurate across tabs and contexts', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: baseUrl });
  try {
    const home = await context.newPage();
    const payloads: unknown[] = [];
    home.on('websocket', socket =>
      socket.on('framereceived', raw => {
        try {
          const message = JSON.parse(String(raw.payload));
          if (message.t === 'counters') payloads.push(message.d);
        } catch {}
      }),
    );
    await home.goto('/', { waitUntil: 'domcontentloaded' });
    await localExpect.poll(() => onlineCount(home)).toBe(1);
    await localExpect.poll(() => activityCount(home, 'puzzle')).toBe(0);
    const first = await puzzle(context);
    await localExpect.poll(() => onlineCount(home)).toBe(1);
    await localExpect.poll(() => activityCount(home, 'puzzle')).toBe(1);
    const second = await puzzle(context);
    await localExpect.poll(() => onlineCount(home)).toBe(1);
    await localExpect.poll(() => activityCount(home, 'puzzle')).toBe(1);
    await first.close();
    await localExpect.poll(() => activityCount(home, 'puzzle')).toBe(1);
    await second.close();
    await localExpect.poll(() => onlineCount(home)).toBe(1);
    await localExpect.poll(() => activityCount(home, 'puzzle')).toBe(0);

    const other = await browser.newContext({ baseURL: baseUrl });
    const independent = await puzzle(other);
    await localExpect.poll(() => onlineCount(home)).toBe(2);
    await localExpect.poll(() => activityCount(home, 'puzzle')).toBe(1);
    await independent.close();
    await localExpect.poll(() => onlineCount(home)).toBe(1);
    await localExpect.poll(() => activityCount(home, 'puzzle')).toBe(0);
    expect(payloads.length).toBeGreaterThan(0);
    for (const payload of payloads) {
      const counters = payload as { members: number; poolCounts: Record<string, number> };
      for (const count of Object.values(counters.poolCounts))
        expect(count).toBeLessThanOrEqual(counters.members);
    }
    await other.close();
  } finally {
    await context.close();
  }
});

test('other time controls use the union occupancy', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: baseUrl });
  try {
    const home = await context.newPage();
    await home.goto('/', { waitUntil: 'domcontentloaded' });
    const quick5 = await context.newPage();
    await quick5.goto('/play/room/5%2B0-m60-30x3', { waitUntil: 'domcontentloaded' });
    const quick10 = await context.newPage();
    await quick10.goto('/play/room/10%2B0-m60-30x3', { waitUntil: 'domcontentloaded' });
    const summary = async () =>
      Number((await home.locator('.lobby__time-controls__summary .lobby__occupancy').textContent()) ?? 0);
    await localExpect.poll(() => summary()).toBe(1);
    await quick5.close();
    await localExpect.poll(() => summary()).toBe(1);
    await quick10.close();
    await localExpect.poll(() => summary()).toBe(0);
  } finally {
    await context.close();
  }
});

test('quick matchmaking room announces its other-time-controls activity', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: baseUrl });
  try {
    const home = await context.newPage();
    await home.goto('/', { waitUntil: 'domcontentloaded' });
    const room = await context.newPage();
    const response = await room.goto('/play/room/5%2B0-m60-30x3', { waitUntil: 'domcontentloaded' });
    expect(response?.ok()).toBeTruthy();
    await localExpect.poll(() => onlineCount(home)).toBe(1);
    await localExpect.poll(() => activityCount(home, 'pool')).toBe(1);
    await room.close();
    await localExpect.poll(() => onlineCount(home)).toBe(1);
    await localExpect.poll(() => activityCount(home, 'pool')).toBe(0);
  } finally {
    await context.close();
  }
});
