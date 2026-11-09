import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';

test.skip(process.env.BLOG_EDITIONS_TEST !== '1', 'Requires published multilingual editions');
const source = JSON.parse(fs.readFileSync('blog/translations/4wtrgg9Y/source.json', 'utf8'));
const path = new URL(source.sourceUrl, 'https://lixiangqi.com').pathname;
const cases = [
  ['zh-CN', 'zh-Hans'],
  ['en-US', 'en'],
  ['vi-VN', 'vi'],
  ['fr-FR', 'en'],
  ['de-DE', 'en'],
] as const;

async function selectInMenu(page: Page, code: string) {
  await page.locator('.dasher > button.toggle').click();
  await page.locator('#dasher_app .subs > button').first().click();
  await page.locator(`form[action="/translation/select"] button[value="${code}"]`).click();
}

test('site language selector keeps the article and replaces a stale blog preference', async ({
  page,
  context,
  baseURL,
}) => {
  await context.addCookies([{ name: 'blogLanguage', value: 'zh-Hans', url: baseURL! }]);
  await page.goto(path + '/zh-Hans');
  for (const [code, edition] of cases) {
    await selectInMenu(page, code);
    await expect(page).toHaveURL(new RegExp(`/4wtrgg9Y${edition === 'en' ? '' : '/' + edition}$`));
    await expect(page.locator('html')).toHaveAttribute('lang', edition);
    await expect(page.locator('body')).toHaveAttribute('lang', code);
    if (code === 'fr-FR' || code === 'de-DE')
      await expect(page.locator('.ublog-post__language-fallback')).toBeVisible();
  }
});

test('home language changes update cards and links, including unavailable-language fallback', async ({
  page,
  context,
  baseURL,
}) => {
  await context.addCookies([{ name: 'blogLanguage', value: 'zh-Hans', url: baseURL! }]);
  for (const [code, edition] of cases) {
    await page.goto('/');
    await selectInMenu(page, code);
    await expect(page).toHaveURL(baseURL! + '/');
    const cards = page.locator('a.ublog-post-card--link[data-post-id]');
    await expect(cards.first()).toBeVisible();
    for (const card of await cards.all()) {
      await expect(card).toHaveAttribute('lang', edition);
      const href = await card.getAttribute('href');
      expect(href).toMatch(edition === 'en' ? /\/\w{8}$/ : new RegExp('/' + edition + '$'));
    }
    await cards.first().click();
    await expect(page.locator('html')).toHaveAttribute('lang', edition);
  }
});

test('no-JavaScript selection preserves query strings and ordinary article reads preserve preferences', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ baseURL, javaScriptEnabled: false, locale: 'en-US' });
  const page = await context.newPage();
  await context.addCookies([{ name: 'blogLanguage', value: 'zh-Hans', url: baseURL! }]);
  await page.goto(path + '/vi');
  expect((await context.cookies()).find(c => c.name === 'blogLanguage')?.value).toBe('zh-Hans');
  await page.locator('.ublog-post__languages a[hreflang="en"]').click();
  await expect(page).toHaveURL(new RegExp('/4wtrgg9Y$'));
  expect((await context.cookies()).find(c => c.name === 'blogLanguage')?.value).toBe('en');
  const response = await page.request.post('/translation/select', {
    headers: { Origin: baseURL!, Referer: baseURL + '/blog/search?text=LiXiangQi&sort=likes' },
    form: { lang: 'vi-VN' },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(303);
  expect(response.headers().location).toBe('/blog/search?text=LiXiangQi&sort=likes');
  expect((await context.cookies()).find(c => c.name === 'blogLanguage')?.value).toBe('vi');
  for (const referer of [baseURL + '//other.example/path', 'https://other.example/path']) {
    const safeReturn = await page.request.post('/translation/select', {
      headers: { Origin: baseURL!, Referer: referer },
      form: { lang: 'en-US' },
      maxRedirects: 0,
    });
    expect(safeReturn.status()).toBe(303);
    expect(safeReturn.headers().location).toBe('/');
  }
  await context.close();
});

test('signed-in site selection updates the article and list preference', async ({
  page,
  context,
  baseURL,
}) => {
  test.skip(process.env.BLOG_PREVIEW !== '1', 'Uses only the disposable preview account');
  await page.goto('/login?method=password');
  await page.locator('input[name="username"]').fill('testing123');
  await page.locator('input[name="password"]').fill('testing123');
  await page.locator('form[action="/login"] button[type="submit"]').click();
  await expect(page.locator('#user_tag')).toBeVisible();
  await context.addCookies([{ name: 'blogLanguage', value: 'zh-Hans', url: baseURL! }]);
  await page.goto(path + '/zh-Hans');
  for (const code of ['en-US', 'vi-VN']) {
    await selectInMenu(page, code);
    const language = code.slice(0, 2);
    await expect(page.locator('html')).toHaveAttribute('lang', language);
    expect((await context.cookies()).find(c => c.name === 'blogLanguage')?.value).toBe(language);
    const settings = await page.request.get('/dasher', { headers: { Accept: 'application/json' } });
    expect((await settings.json()).lang.current).toBe(code);
  }
});
