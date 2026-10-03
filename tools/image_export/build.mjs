import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { build } from '../../ui/.build/node_modules/esbuild/lib/main.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const outdir = fileURLToPath(new URL('./dist', import.meta.url));
await build({
  absWorkingDir: root,
  entryPoints: ['tools/image_export/server.ts', 'tools/image_export/renderer.ts'],
  outdir,
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  external: ['@resvg/resvg-js'],
});
await mkdir(outdir, { recursive: true });
await writeFile(
  `${outdir}/package.json`,
  JSON.stringify({ private: true, type: 'module', dependencies: { '@resvg/resvg-js': '2.6.2' } }, null, 2) +
    '\n',
);
