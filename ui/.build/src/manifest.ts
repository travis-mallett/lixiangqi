import cps from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { join } from 'node:path';

import { shallowSort, isContained } from './algo.ts';
import { jsLogger } from './console.ts';
import { env, c } from './env.ts';

const manifest = {
  i18n: {} as Manifest,
  js: {} as Manifest,
  css: {} as Manifest,
  hashed: {} as Manifest,
  dirty: false,
};
let writeTimer: NodeJS.Timeout;

type SplitAsset = { hash?: string; path?: string; imports?: string[]; inline?: string; omit?: boolean };

export type Manifest = Record<string, SplitAsset>;
export type ManifestUpdate = Partial<Omit<typeof manifest, 'dirty'>>;

// CSS must use the same URLs as HTML preloads. The manifest owns this mapping;
// filesystem links are only a storage optimization and may be copies on Windows.
export async function assetHashes(): Promise<Record<string, string>> {
  let previous: Record<string, string | SplitAsset> = {};
  try {
    previous = JSON.parse(await fs.promises.readFile(join(env.jsOutDir, 'manifest.json'), 'utf8')).hashed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return Object.fromEntries(
    Object.entries({ ...previous, ...manifest.hashed }).flatMap(([path, entry]) => {
      const hash = typeof entry === 'string' ? entry : entry.hash;
      return hash ? [[path, hash]] : [];
    }),
  );
}

export function stopManifest(clear = false): void {
  clearTimeout(writeTimer);
  if (clear) {
    manifest.i18n = {};
    manifest.js = {};
    manifest.css = {};
    manifest.hashed = {};
    manifest.dirty = false;
  }
}

export function updateManifest(update: ManifestUpdate = {}): void {
  for (const [key, partial] of Object.entries(update) as [keyof ManifestUpdate, Manifest][]) {
    const full = manifest[key];
    if (isContained(full, partial)) continue;
    for (const [name, entry] of Object.entries(partial)) {
      full[name] = shallowSort({ ...full[name], ...entry });
    }
    manifest[key] = shallowSort(full);
    manifest.dirty = true;
  }
  if (manifest.dirty) {
    clearTimeout(writeTimer);
    writeTimer = setTimeout(writeManifest, env.watch && !env.startTime ? 750 : 0);
  }
}

async function writeManifest() {
  if (!env.buildOk()) return;
  const commitMessage = cps
    .execSync('git log -1 --pretty=%s', { encoding: 'utf-8' })
    .trim()
    .replaceAll("'", '&#39;')
    .replaceAll('"', '&quot;');

  const clientJs: string[] = [
    'if (!window.site) window.site={};',
    'const s=window.site;',
    's.info={};',
    `s.info.commit='${cps.execSync('git rev-parse -q HEAD', { encoding: 'utf-8' }).trim()}';`,
    `s.info.message='${commitMessage}';`,
    `s.debug=${env.debug};`,
    's.asset={loadEsm:(m,o)=>import(`/assets/compiled/${m}${s.manifest.js[m]?"."+s.manifest.js[m]:""}.js`)' +
      '.then(x=>(x.initModule||x.default)(o.init))};',
    // a light version of loadEsm for embeds. on pages this will be overwritten by site.js
  ];
  if (env.remoteLog) clientJs.push(await jsLogger());

  const pairLine = ([name, info]: [string, SplitAsset]) => `'${name.replaceAll("'", "\\'")}':'${info.hash}'`;
  const jsLines = Object.entries(manifest.js)
    .filter(([name, _]) => !/lib\.[A-Z0-9]{8}/.test(name))
    .map(pairLine)
    .join(',');
  const cssLines = Object.entries(manifest.css).map(pairLine).join(',');
  const hashedLines = Object.entries(manifest.hashed)
    .filter(([, { omit }]) => !omit)
    .map(([name, { hash }]) => pairLine([name, { hash }]))
    .join(',');
  clientJs.push(`s.manifest={\ncss:{${cssLines}},\njs:{${jsLines}},\nhashed:{${hashedLines}}\n};`);

  const clientManifest =
    clientJs.join('\n') + `\ns.info.date='${new Date().toISOString().split('.')[0] + '+00:00'}';\n`;
  const hash = crypto.createHash('sha256').update(clientManifest).digest('hex').slice(0, 8);
  const serverManifest = JSON.stringify(
    {
      js: compactManifest({ manifest: { hash }, ...manifest.js, ...manifest.i18n }),
      css: compactManifest(manifest.css),
      hashed: compactManifest(manifest.hashed),
    },
    null,
    env.prod ? undefined : 2,
  );
  await Promise.all([
    fs.promises.writeFile(join(env.jsOutDir, `manifest.${hash}.js`), clientManifest),
    fs.promises.writeFile(join(env.jsOutDir, `manifest.json`), serverManifest),
  ]);
  manifest.dirty = false;
  const serverHash = crypto.createHash('sha256').update(serverManifest).digest('hex').slice(0, 8);
  env.log(
    `'${c.cyan(`public/compiled/manifest.${hash}.js`)}', '${c.cyan(`public/compiled/manifest.json`)}' ${c.grey(serverHash)}`,
    'manifest',
  );
}

function compactManifest(manifest: Manifest): Record<string, SplitAsset | string> {
  const compacted: Record<string, SplitAsset | string> = {};
  for (const [key, info] of Object.entries(manifest)) {
    const infoKeys = Object.keys(info);
    if (infoKeys.length === 1 && infoKeys[0] === 'hash') compacted[key] = info.hash!;
    else compacted[key] = info;
  }
  return compacted;
}
