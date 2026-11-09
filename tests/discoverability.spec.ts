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
