import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('localized bundles refresh source fallbacks even when the source bundle is already current', async t => {
  const root = await mkdtemp(join(tmpdir(), 'lixiangqi-i18n-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = {
    i18nSrcDir: join(root, 'source'),
    i18nDestDir: join(root, 'dest'),
    i18nJsDir: join(root, 'js'),
    jsOutDir: join(root, 'compiled'),
    typesDir: join(root, 'types'),
    begin: () => true,
    log() {},
  };
  for (const folder of ['source', 'dest/site', 'dest/puzzle', 'js', 'types/lichess'])
    await mkdir(join(root, folder), { recursive: true });
  const old = new Date(Date.now() - 20000);
  const updated = new Date(old.getTime() + 10000);
  const fixture = async (path: string, content: string, time = old) => {
    await writeFile(join(root, path), content);
    await utimes(join(root, path), time, time);
  };
  const xml = (entries: Record<string, string>) =>
    '<resources>' +
    Object.entries(entries)
      .map(([key, text]) => `<string name="${key}">${text}</string>`)
      .join('') +
    '</resources>';
  await fixture('source/site.xml', xml({ yourTurn: 'Your turn' }));
  await fixture('dest/site/en-US.xml', xml({ yourTurn: 'Your turn' }));
  await fixture('source/puzzle.xml', xml({ restart: 'Restart', analyze: 'Analyze' }), updated);
  await fixture('dest/puzzle/en-US.xml', xml({ puzzles: 'Puzzles' }));
  await fixture('js/puzzle.en-US.js', 'old bundle missing the new source keys');
  await fixture('js/puzzle.en-GB.js', 'source bundle already rebuilt', updated);
  await fixture('types/lichess/i18n.d.ts', '// existing types', updated);
  t.mock.module(new URL('../src/env.ts', import.meta.url).href, { namedExports: { env } });
  t.mock.module(new URL('../src/task.ts', import.meta.url).href, {
    namedExports: { makeTask: async (task: { execute: () => Promise<void> }) => task.execute() },
  });
  t.mock.module(new URL('../src/manifest.ts', import.meta.url).href, {
    namedExports: { updateManifest() {} },
  });
  const { i18n } = await import('../src/i18n.ts');
  await i18n();
  const output = join(root, 'js/puzzle.en-US.js');
  const built = await readFile(output, 'utf8');
  assert.match(built, /Restart/);
  assert.match(built, /Analyze/);
  assert.match(built, /Puzzles/);
  assert.ok(Math.abs((await stat(output)).mtimeMs - updated.getTime()) < 2);
  await i18n();
  assert.equal(await readFile(output, 'utf8'), built);
  // Removing the last localized string must discard the old generated bundle,
  // allowing the locale manifest to select the current source catalog.
  await fixture('dest/puzzle/en-US.xml', xml({}), new Date(updated.getTime() + 5000));
  await i18n();
  await assert.rejects(stat(output), { code: 'ENOENT' });
  await fixture('js/puzzle.en-US.js', 'removed catalog', updated);
  await rm(join(root, 'dest/puzzle/en-US.xml'));
  await i18n();
  await assert.rejects(stat(output), { code: 'ENOENT' });
});
