import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Prevent a deployment from silently shipping older rules than the server. */
export function checkThreeKingdomsEngine(root: string): void {
  const fail = () => {
    throw new Error(
      'Three Kingdoms engine is stale. Run sbt threeKingdomsJs/threeKingdomsBrowser before building assets.',
    );
  };
  const hash = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
  const manifest = JSON.parse(readFileSync(join(root, 'public/three-kingdoms-engine/manifest.json'), 'utf8'));
  const paths = ['threeKingdomsCore', 'threeKingdomsJs']
    .flatMap(module => {
      const base = `modules/${module}/src/main`;
      return readdirSync(join(root, base), { recursive: true })
        .filter(p => p.toString().endsWith('.scala'))
        .map(p => `${base}/${p.toString().replaceAll('\\', '/')}`);
    })
    .sort();
  if (
    manifest.version !== 1 ||
    JSON.stringify(paths) !== JSON.stringify(Object.keys(manifest.sources).sort())
  )
    fail();
  for (const path of paths)
    if (hash(readFileSync(join(root, path), 'utf8').replaceAll('\r\n', '\n')) !== manifest.sources[path])
      fail();
  if (hash(readFileSync(join(root, 'public/three-kingdoms-engine/main.js'))) !== manifest.javascript) fail();
}
