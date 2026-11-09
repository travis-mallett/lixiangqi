import { test, expect, type Page } from '@playwright/test';

// Destructive only to the named disposable preview fixture, never official posts.
test.skip(process.env.BLOG_PREVIEW !== '1', 'Requires disposable BlogTest fixtures');
const route = '/@/testing123/blog/edition-review-fixture/BlogTest';
async function formValues(page: Page, action: string) {
  return page
    .locator(`form[action="${action}"]`)
    .evaluate(
      form => Object.fromEntries(new FormData(form as HTMLFormElement).entries()) as Record<string, string>,
    );
}

test('draft, private, unlisted and spam access retains article protections', async ({ request }) => {
  for (const path of [
    route + '/vi',
    route + '/vi?draft=true',
    '/@/testing123/blog/edition-review-fixture/BlogDraf/zh-Hans',
    '/@/bloghidden/blog/edition-review-fixture/BlogHide/zh-Hans',
  ]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(404);
    expect(await response.text()).not.toContain('draftsecretword');
  }
  for (const path of [
    '/@/blogunlisted/blog/edition-review-fixture/BlogUnli/zh-Hans',
    '/@/testing123/blog/edition-review-fixture/BlogSpam/zh-Hans',
  ]) {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    expect(response.headers()['x-robots-tag']).toContain('noindex');
  }
});

test('an editor can revise imported editions without changing shared engagement', async ({
  page,
  browser,
  baseURL,
}) => {
  await page.goto('/login?method=password');
  await page.locator('input[name="username"]').fill('testing123');
  await page.locator('input[name="password"]').fill('testing123');
  await page.locator('form[action="/login"] button[type="submit"]').click();
  await expect(page.locator('#user_tag')).toBeVisible();
  const action = '/ublog/BlogTest/translation/zh-Hans';
  const headers = { Origin: baseURL!, Referer: baseURL + route };
  await page.goto(action);
  await expect(page.locator('.toastui-editor-defaultUI')).toBeVisible();
  const initial = await formValues(page, action);
  const submitted = { ...initial, title: '经审核的测试文章', reviewed: 'true', action: 'publish' };
  const response = await page.request.post(action, { headers, form: submitted, maxRedirects: 0 });
  expect(response.status(), await response.text()).toBe(303);
  await page.goto(route + '/zh-Hans');
  await expect(page.locator('h1')).toHaveText(submitted.title);
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-Hans');
  const commentLink = await page.locator('.ublog-post__discuss').getAttribute('href');
  const likes = await page.locator('.ublog-post__like__nb').first().textContent();
  await page.goto(route);
  expect(await page.locator('.ublog-post__discuss').getAttribute('href')).toBe(commentLink);
  expect(await page.locator('.ublog-post__like__nb').first().textContent()).toBe(likes);

  await page.goto(action);
  const published = await formValues(page, action);
  const draft = await page.request.post(action, {
    headers,
    form: { ...published, title: '尚未发布的草稿标题', action: 'draft' },
    maxRedirects: 0,
  });
  expect(draft.status()).toBe(303);
  await page.goto(route + '/zh-Hans');
  await expect(page.locator('h1')).toHaveText(submitted.title);
  await page.goto(route + '/zh-Hans?draft=true');
  await expect(page.locator('h1')).toHaveText('尚未发布的草稿标题');
  const anonymous = await browser.newContext({ baseURL, locale: 'vi-VN' });
  const publicPage = await anonymous.newPage();
  await publicPage.goto(route + '/zh-Hans?draft=true');
  await expect(publicPage.locator('h1')).toHaveText(submitted.title);
  await anonymous.close();
  const stale = await page.request.post(action, { headers, form: published, maxRedirects: 0 });
  expect([400, 409]).toContain(stale.status());

  await page.goto('/ublog/BlogTest/edit');
  const source = await formValues(page, '/ublog/BlogTest/edit');
  const edit = await page.request.post('/ublog/BlogTest/edit', {
    headers,
    form: { ...source, markdown: source.markdown + '\n\nA source revision for review tracking.' },
    maxRedirects: 0,
  });
  expect(edit.status(), await edit.text()).toBe(303);
  await page.goto(action);
  await expect(
    page.getByText('The original has changed. This translation is awaiting review.'),
  ).toBeVisible();
  const current = await formValues(page, action);
  const unpublish = await page.request.post(action, {
    headers,
    form: { ...current, action: 'unpublish' },
    maxRedirects: 0,
  });
  expect(unpublish.status()).toBe(303);
  const unavailable = await page.request.get(route + '/zh-Hans');
  expect(unavailable.status()).toBe(404);
  await page.goto(route + '/zh-Hans?draft=true');
  await expect(page.locator('h1')).toHaveText('尚未发布的草稿标题');
});
