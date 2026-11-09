import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('CSS asset mappings work without symlinks and prefer the current build', async t => {
  const root = await mkdtemp(join(tmpdir(), 'lixiangqi-assets-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  t.mock.module(new URL('../src/env.ts', import.meta.url).href, {
    namedExports: { env: { jsOutDir: root, buildOk: () => false }, c: {}, errorMark: '', warnMark: '' },
  });
  const { assetHashes, updateManifest, stopManifest } = await import('../src/manifest.ts');
  t.after(() => stopManifest(true));
  assert.deepEqual(await assetHashes(), {});
  const saved = join(root, 'manifest.json');
  await writeFile(
    saved,
    JSON.stringify({ hashed: { 'font/noto.woff2': '12345678', 'images/board.svg': { hash: 'abcdef12' } } }),
  );
  assert.deepEqual(await assetHashes(), { 'font/noto.woff2': '12345678', 'images/board.svg': 'abcdef12' });
  updateManifest({ hashed: { 'font/noto.woff2': { hash: '87654321' } } });
  assert.deepEqual(await assetHashes(), { 'font/noto.woff2': '87654321', 'images/board.svg': 'abcdef12' });
  await writeFile(saved, 'invalid manifest');
  await assert.rejects(assetHashes(), SyntaxError);
});
