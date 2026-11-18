import { test, expect } from '@playwright/test';
import { JSDOM } from 'jsdom';

// Read-only checks against a running preview or deployed release.
test.skip(process.env.DISCOVERABILITY_TEST !== '1', 'Set DISCOVERABILITY_TEST=1');

for (const language of ['en', 'zh', 'vi']) {
  test(`${language} URLs retain their language with conflicting browser preferences`, async ({ request }) => {
    const response = await request.get(`/${language}`, {
      headers: { 'Accept-Language': language === 'en' ? 'vi' : 'en-US' },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(200);
    const document = new JSDOM(await response.text()).window.document;
    expect(document.querySelector('meta[name="robots"]')?.getAttribute('content') ?? '').not.toContain(
      'noindex',
    );
    expect(document.documentElement.lang.split('-')[0]).toBe(language);
    const canonicals = document.querySelectorAll('link[rel="canonical"]');
    expect(canonicals.length).toBe(1);
    expect(new URL(canonicals[0].getAttribute('href')).pathname).toBe(`/${language}`);
    for (const [tag, path] of [
      ['en', '/en'],
      ['zh-Hans', '/zh'],
      ['vi', '/vi'],
      ['x-default', '/'],
    ]) {
      const link = document.querySelector(`link[hreflang="${tag}"]`);
      expect(link).not.toBeNull();
      expect(new URL(link!.getAttribute('href')).pathname).toBe(path);
    }
    const description = document.querySelector('meta[name="description"]')!.getAttribute('content')!;
    if (language === 'vi') {
      expect(document.title).toContain('cờ tướng');
      expect(description).toContain('cờ tướng');
      expect(description).not.toContain('cờ vua');
    }
    if (language === 'zh') {
      expect(description).toContain('象棋');
      expect(description).not.toContain('国际象棋');
    }
  });
}

test('nested language pages have self-canonicals', async ({ request }) => {
  for (const path of ['/learn', '/en/learn', '/zh/learn', '/vi/learn', '/analysis', '/variant/jieqi']) {
    const response = await request.get(path, { headers: { 'Accept-Language': 'en-US' }, maxRedirects: 0 });
    expect(response.status()).toBe(200);
    const document = new JSDOM(await response.text()).window.document;
    const links = document.querySelectorAll('link[rel="canonical"]');
    expect(links.length).toBe(1);
    expect(new URL(links[0].getAttribute('href')).pathname).toBe(path);
  }
});

test('the retired standalone wiki article no longer exists', async ({ request }) => {
  const response = await request.get('/wiki/elbow-horse', { maxRedirects: 0 });
  expect(response.status()).toBe(404);
});

test('account settings still require authentication', async ({ request }) => {
  const response = await request.get('/account/preferences/display', { maxRedirects: 0 });
  expect([302, 303, 401, 403]).toContain(response.status());
});

test('privacy route and its CMS alias reach the existing policy', async ({ request }) => {
  const response = await request.get('/privacy', { maxRedirects: 0 });
  expect(response.status()).toBe(200);
  const document = new JSDOM(await response.text()).window.document;
  expect(document.querySelector('h1')?.textContent).toContain('Privacy');
  expect(document.body.textContent).toContain('personal');
  expect(new URL(document.querySelector('link[rel="canonical"]')!.getAttribute('href')).pathname).toBe(
    '/privacy',
  );
  const alias = await request.get('/page/privacy', { maxRedirects: 0 });
  expect([301, 302, 303, 308]).toContain(alias.status());
  expect(alias.headers().location).toBe('/privacy');
  expect((await request.get('/privacy/traffic')).status()).toBe(200);
});

test('blog alternate links are escaped, reciprocal and have exactly one language prefix', async ({
  request,
}) => {
  for (const language of ['de', 'zh', 'vi']) {
    const path = `/${language}/blog/community?filter=best&page=2`;
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    const html = await response.text();
    const document = new JSDOM(html).window.document;
    expect(new URL(document.querySelector('link[rel="canonical"]')!.getAttribute('href')).pathname).toBe(
      `/${language}/blog/community`,
    );
    const links = [...document.querySelectorAll('link[hreflang]')];
    expect(links.length).toBeGreaterThan(3);
    for (const link of links) {
      const url = new URL(link.getAttribute('href'));
      expect(url.pathname).toMatch(/^\/(?:[a-z]{2,3}\/)?blog\/community$/);
      expect(url.searchParams.get('filter')).toBe('best');
      expect(url.searchParams.get('page')).toBe('2');
    }
    expect(html).toContain('filter=best&amp;page=2');
    expect(document.querySelector('#topnav a[href="/variant"]')).not.toBeNull();
    expect(
      [...document.querySelectorAll('#topnav a[href$="/variant"]')].map(link => link.getAttribute('href')),
    ).toEqual(['/variant']);
  }
});

test('manifest identifies LiXiangQi and does not advertise another app', async ({ request }) => {
  const response = await request.get('/manifest.json');
  expect(response.status()).toBe(200);
  const manifest = await response.json();
  expect(manifest.name).toBe('LiXiangQi');
  expect(manifest.short_name).toBe('LiXiangQi');
  expect(manifest.description).toContain('Xiangqi');
  expect(manifest.related_applications).toBeUndefined();
  for (const icon of manifest.icons) {
    expect((await request.get(new URL(icon.src, response.url()).href)).status()).toBe(200);
  }
});

test('main tools expose localized, distinct metadata and useful HTML before JavaScript', async ({
  request,
}) => {
  for (const language of ['en', 'zh', 'vi']) {
    const titles = new Set<string>();
    for (const path of ['/analysis', '/editor', '/games/database', '/training/notation']) {
      const response = await request.get(path, { headers: { 'Accept-Language': language } });
      expect(response.status()).toBe(200);
      const document = new JSDOM(await response.text()).window.document;
      const description = document.querySelector('meta[name="description"]')!.getAttribute('content')!;
      expect(description.length).toBeGreaterThan(language === 'zh' ? 30 : 80);
      expect(document.body.textContent).toContain(description);
      expect(document.querySelector('h1')?.textContent?.length).toBeGreaterThan(language === 'zh' ? 3 : 8);
      expect(document.querySelectorAll('h1').length).toBe(1);
      titles.add(document.title);
      if (language === 'zh') expect(description).toContain('象棋');
      if (language === 'vi') expect(description).toContain('cờ tướng');
    }
    expect(titles.size).toBe(4);
  }
});

test('sitemap lists successful canonical pages and keeps intentional exclusions out', async ({ request }) => {
  test.setTimeout(120_000);
  const response = await request.get('/sitemap.xml');
  expect(response.status()).toBe(200);
  const xml = new JSDOM(await response.text(), { contentType: 'application/xml' }).window.document;
  const urls = [...xml.querySelectorAll('url > loc')].map(node => new URL(node.textContent));
  expect(new Set(urls.map(url => url.href)).size).toBe(urls.length);
  const paths = urls.map(url => url.pathname);
  for (const path of [
    '/analysis',
    '/editor',
    '/games/database',
    '/privacy',
    '/learn/special-rules',
    '/zh/training/themes',
  ])
    expect(paths).toContain(path);
  for (const path of ['/learn', '/login', '/signup', '/streak', '/storm', '/racer', '/swiss', '/simul'])
    expect(paths).not.toContain(path);
  for (const url of urls) {
    const page = await request.get(url.href, { maxRedirects: 0 });
    expect(page.status(), url.href).toBe(200);
    const document = new JSDOM(await page.text()).window.document;
    const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute('href');
    expect(canonical, url.href).toBe(url.href);
    expect(document.querySelector('meta[name="robots"]')?.getAttribute('content') ?? '').not.toContain(
      'noindex',
    );
  }
});

test('different published puzzle themes remain distinct in rendered search content', async ({ request }) => {
  const results: { title: string; description: string }[] = [];
  for (const theme of ['smallThroatCuttingMate', 'doubleGhostsKnocking']) {
    const path = `/de/training/${theme}`;
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    const document = new JSDOM(await response.text()).window.document;
    expect(new URL(document.querySelector('link[rel="canonical"]')!.getAttribute('href')).pathname).toBe(
      path,
    );
    const description = document.querySelector('meta[name="description"]')!.getAttribute('content')!;
    expect(document.body.textContent).toContain(description);
    expect(document.querySelector(`.tool-intro a[href$="#${theme}"]`)).not.toBeNull();
    results.push({ title: document.title, description });
  }
  expect(results[0].title).not.toBe(results[1].title);
  expect(results[0].description).not.toBe(results[1].description);
});

test('ignored directory parameters do not become canonical URLs', async ({ request }) => {
  for (const [query, expected] of [
    ['community=1', ''],
    ['community=1&order=name', 'order=name'],
    ['community=1&q=Hu&order=name', 'q=Hu&order=name'],
  ]) {
    const response = await request.get(`/players?${query}`);
    expect(response.status()).toBe(200);
    const document = new JSDOM(await response.text()).window.document;
    const canonical = new URL(document.querySelector('link[rel="canonical"]')!.getAttribute('href'));
    expect(canonical.pathname).toBe('/players');
    expect(canonical.searchParams.toString()).toBe(expected);
  }
});
