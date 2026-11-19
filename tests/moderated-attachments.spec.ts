import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const requireBuild = createRequire(resolve('ui/.build/package.json'));
const { buildSync } = requireBuild('esbuild');
const source = buildSync({
  entryPoints: [resolve('ui/lib/src/attachments.ts')],
  format: 'iife',
  globalName: 'ugc',
  bundle: true,
  write: false,
}).outputFiles[0].text;

{
  const surface = 'forum';
  test(`published photos load inline and files wait for a download in ${surface}`, async ({ page }) => {
    const photo = 'a'.repeat(32);
    const file = 'b'.repeat(32);
    let fileReads = 0;
    await page.route('https://fixture.test/**', route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/')
        return route.fulfill({
          contentType: 'text/html',
          body: '<main><div id="photo"></div><div id="file"></div></main>',
        });
      const image = url.pathname === `/attachment/${surface}/item/${photo}`;
      if (!image && url.pathname !== `/attachment/${surface}/item/${file}`) return route.abort();
      if (url.searchParams.has('meta'))
        return route.fulfill({
          json: {
            name: image ? 'board.webp' : 'moves.txt',
            mime: image ? 'image/webp' : 'text/plain',
            size: 42,
          },
        });
      if (image)
        return route.fulfill({
          contentType: 'image/webp',
          body: Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64'),
        });
      fileReads++;
      return route.fulfill({ contentType: 'text/plain', body: 'moves' });
    });
    await page.goto('https://fixture.test/');
    await page.addScriptTag({ content: source });
    await page.evaluate(
      ({ photo, file }) => {
        const w = window as any;
        w.i18n = { site: { mediaOpen: 'Expand photo', mediaDownload: 'Download' } };
        w.ugc.showForumMedia(document.querySelector('#photo'), photo);
        w.ugc.showForumMedia(document.querySelector('#file'), file);
      },
      { photo, file },
    );
    const img = page.getByRole('img', { name: 'board.webp' });
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate(el => (el as HTMLImageElement).naturalWidth)).toBe(1);
    await img.click();
    await expect(page.locator('#photo button')).toHaveAttribute('aria-expanded', 'true');
    const download = page.getByRole('link', { name: /moves.txt/ });
    await expect(download).toHaveAttribute('download', 'moves.txt');
    expect(fileReads).toBe(0);
    const event = page.waitForEvent('download');
    await download.click();
    const requested = await event;
    expect(requested.suggestedFilename()).toBe('moves.txt');
    expect(new URL(requested.url()).pathname).toBe(`/attachment/${surface}/item/${file}`);
  });
}

for (const narrow of [false, true]) {
  test(`staged items preserve caption, focus and per-file decisions on ${narrow ? 'mobile' : 'desktop'}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: narrow ? 360 : 1280, height: 800 });
    await page.emulateMedia({ colorScheme: narrow ? 'dark' : 'light' });
    await page.route('https://fixture.test/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/')
        return route.fulfill({
          contentType: 'text/html',
          body: '<main><form><div id="picker"></div><textarea aria-label="Caption"></textarea><button type="submit">Send</button></form></main>',
        });
      if (url.pathname.endsWith('/policy'))
        return route.fulfill({ json: { enabled: true, maxCount: 4, maxBytes: 4194304 } });
      if (url.pathname.endsWith('/upload'))
        return route.fulfill({
          status: 201,
          json: {
            id:
              route.request().headers()['x-attachment-name'] === 'bad.txt' ? 'b'.repeat(32) : 'a'.repeat(32),
            state: 'checking',
          },
        });
      if (url.pathname.includes('/draft/'))
        return route.fulfill({
          json: { state: url.pathname.endsWith('b'.repeat(32)) ? 'blocked' : 'ready' },
        });
      return route.fulfill({ status: 404 });
    });
    await page.goto('https://fixture.test/');
    await page.addScriptTag({ content: source });
    await page.evaluate(async () => {
      const w = window as any;
      w.i18n = { site: new Proxy({}, { get: (_, key) => String(key) }) };
      const draft = new w.ugc.AttachmentDraft('msg', 'bob');
      await draft.mount(document.querySelector('#picker'), document.querySelector('textarea'), () => {
        document.querySelector<HTMLButtonElement>('[type=submit]')!.disabled = !draft.ready;
      });
    });
    const caption = page.getByRole('textbox', { name: 'Caption' });
    await caption.fill('好棋 · Ván cờ hay');
    const plus = page.getByRole('button', { name: 'attachMedia' });
    await plus.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'mediaPhotos' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(plus).toBeFocused();
    await plus.click();
    const picker = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'mediaFiles' }).click();
    await (
      await picker
    ).setFiles(
      ['good.txt', 'bad.txt'].map(name => ({ name, mimeType: 'text/plain', buffer: Buffer.from('notes') })),
    );
    await expect(page.getByText('mediaReady', { exact: true })).toBeVisible();
    await expect(page.getByText('mediaBlocked', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send' })).toBeDisabled();
    await page
      .locator('.attachment-item')
      .filter({ hasText: 'bad.txt' })
      .getByRole('button', { name: 'mediaRemove' })
      .click();
    await expect(caption).toHaveValue('好棋 · Ván cờ hay');
    await expect(plus).toBeFocused();
    await expect(page.locator('[aria-live=polite]')).toContainText('good.txt');
    await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled();
  });
}
