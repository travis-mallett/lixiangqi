import { test, expect } from '@playwright/test';
import fs from 'node:fs';

// Run against the disposable preview with the reviewed release (or rendering
// fixtures) installed. These checks only read public content, including on live.
const enabled = process.env.BLOG_EDITIONS_TEST === '1';
const metadata = JSON.parse(fs.readFileSync('blog/translations/editions.json', 'utf8')) as {
  id: string;
  language: string;
  title: string;
  intro: string;
  imageAlt: string;
}[];
const originals = [...new Set(metadata.map(e => e.id))].map(id => ({
  id,
  ...JSON.parse(fs.readFileSync(`blog/translations/${id}/source.json`, 'utf8')),
}));
const sourcePath = (id: string) =>
  new URL(originals.find(p => p.id === id).sourceUrl, 'https://lixiangqi.com').pathname;

test.describe('published blog editions', () => {
  test.skip(!enabled, 'Requires multilingual official blog preview fixtures');
  test.use({ javaScriptEnabled: false, locale: 'vi-VN' });
  for (const original of originals) {
    for (const language of ['en', 'zh-Hans', 'vi']) {
      test(`${original.id} serves ${language} in anonymous initial HTML`, async ({
        page,
        context,
        baseURL,
      }) => {
        const edition =
          language === 'en' ? original : metadata.find(e => e.id === original.id && e.language === language)!;
        const route = sourcePath(original.id) + (language === 'en' ? '' : `/${language}`);
        await context.addCookies([
          { name: 'blogLanguage', value: language === 'vi' ? 'zh-Hans' : 'vi', url: baseURL! },
        ]);
        const response = await page.goto(route);
        expect(response?.status()).toBe(200);
        expect(response?.headers()['content-language']).toBe(language);
        expect(response?.headers()['x-robots-tag']).toBeUndefined();
        await expect(page.locator('html')).toHaveAttribute('lang', language);
        await expect(page.locator('h1')).toHaveText(edition.title);
        await expect(page.locator('.ublog-post__intro')).toHaveText(edition.intro);
        await expect(page.locator('.ublog-post__translation-meta')).toHaveCount(0);
        expect(await response!.text()).not.toContain('Codex (AI');
        const sourceImages = [...original.markdown.matchAll(/!\[[^\]]*\]\(/g)].length;
        await expect(page.locator('.ublog-post__markup img')).toHaveCount(sourceImages);
        await expect(page.locator('.ublog-post__image')).toHaveAttribute(
          'alt',
          edition.imageAlt ?? edition.image.alt,
        );
        const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
        expect(new URL(canonical!).pathname.toLowerCase()).toBe(route.toLowerCase());
        expect(await page.locator('meta[property="og:title"]').getAttribute('content')).toBe(edition.title);
        expect(await page.locator('meta[property="og:description"]').getAttribute('content')).toBe(
          edition.intro,
        );
        const alternatives = page.locator('head link[rel="alternate"][hreflang]');
        expect(
          await alternatives.evaluateAll(links => links.map(l => l.getAttribute('hreflang')).sort()),
        ).toEqual(['en', 'vi', 'zh-Hans']);
        for (const lang of ['en', 'zh-Hans', 'vi']) {
          const expected = sourcePath(original.id) + (lang === 'en' ? '' : `/${lang}`);
          const link = page.locator(`.ublog-post__languages a[hreflang="${lang}"]`);
          // The current edition can be a non-link label; all others must navigate.
          if (lang !== language)
            expect(new URL((await link.getAttribute('href'))!, baseURL).pathname.toLowerCase()).toBe(
              expected.toLowerCase(),
            );
        }
        const body = await page.locator('.ublog-post__markup').innerText();
        expect(body.length).toBeGreaterThan(250);
        expect(await response!.text()).toContain(edition.title);
        const robots = await page
          .locator('meta[name="robots"]')
          .getAttribute('content')
          .catch(() => null);
        if (process.env.BLOG_PREVIEW === '1') expect(robots).toContain('noindex');
        else expect(robots ?? '').not.toContain('noindex');
        const markdown = await page.request.get(route, {
          headers: { Accept: 'text/markdown', 'Accept-Language': 'en', 'X-Blog-Language': 'en' },
        });
        expect(markdown.status()).toBe(200);
        expect(markdown.headers()['content-language']).toBe(language);
        expect(await markdown.text()).toContain(edition.title);
        expect(await markdown.text()).toContain(edition.intro);
      });
    }
  }

  test('unavailable editions offer the original and are not indexable', async ({ page }) => {
    const response = await page.goto(sourcePath(originals[0].id) + '/fr');
    expect(response?.status()).toBe(404);
    await expect(page.locator('.ublog-missing-edition')).toBeVisible();
    await expect(page.locator('.ublog-missing-edition a[hreflang="en"]')).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    expect(await page.locator('.ublog-post__markup').count()).toBe(0);
  });

  test('lists, author pages, search, API and Atom retain one identity', async ({ page, request }) => {
    for (const route of ['/blog/official', '/@/ChineseChessOutLoud/blog', '/blog/search?text=LiXiangQi']) {
      await page.setExtraHTTPHeaders({ 'X-Blog-Language': 'zh-Hans' });
      expect((await page.goto(route))?.status()).toBe(200);
      const cards = page.locator('a.ublog-post-card--link');
      const ids = await cards.evaluateAll(nodes => nodes.map(n => n.getAttribute('data-post-id')));
      expect(ids.length).toBeGreaterThan(0);
      expect(new Set(ids).size).toBe(ids.length);
      for (const item of metadata.filter(e => e.language === 'zh-Hans' && ids.includes(e.id))) {
        await expect(page.locator(`[data-post-id="${item.id}"] .ublog-post-card__title`)).toHaveText(
          item.title,
        );
      }
    }
    for (const language of ['en', 'zh-Hans', 'vi']) {
      const feed = await request.get('/blog/official.atom', { headers: { 'X-Blog-Language': language } });
      expect(feed.status()).toBe(200);
      const xml = await feed.text();
      const ids = [...xml.matchAll(/<entry>[\s\S]*?<id>(.*?)<\/id>/g)].map(m => m[1]);
      expect(ids.length).toBeGreaterThan(0);
      expect(new Set(ids).size).toBe(ids.length);
      if (language !== 'en')
        expect(xml).toContain(metadata.find(e => e.id === originals[0].id && e.language === language)!.title);
      const carousel = await request.get('/api/blog/carousel', { headers: { 'X-Blog-Language': language } });
      const entries = await carousel.json();
      expect(new Set(entries.map((e: { id: string }) => e.id)).size).toBe(entries.length);
      for (const entry of entries.filter((e: { id: string }) => originals.some(p => p.id === e.id))) {
        expect(entry.language).toBe(language);
        expect(entry.editions).toHaveLength(3);
      }
    }
  });
});

test('edition links update the URL and preference while browser history remains usable', async ({
  page,
  context,
}) => {
  test.skip(!enabled, 'Requires published multilingual editions');
  const source = sourcePath('4wtrgg9Y');
  await page.goto(source);
  await page.locator('.ublog-post__languages a[hreflang="zh-Hans"]').click();
  await expect(page).toHaveURL(new RegExp('/4wtrgg9Y/zh-Hans$'));
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-Hans');
  expect((await context.cookies()).find(cookie => cookie.name === 'blogLanguage')?.value).toBe('zh-Hans');
  await page.locator('.ublog-post__languages a[hreflang="vi"]').click();
  await expect(page).toHaveURL(new RegExp('/4wtrgg9Y/vi$'));
  await expect(page.locator('html')).toHaveAttribute('lang', 'vi');
  await page.goBack();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-Hans');
  await page.goForward();
  await expect(page.locator('html')).toHaveAttribute('lang', 'vi');
});
