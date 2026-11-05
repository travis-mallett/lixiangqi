import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '../..');
let assets;
/** Desktop and lab use the identical WASM/NNUE/adapter that the browser runs. */
export async function createEngine(rules) {
  const { PikafishEngine } = await import('../../ui/humanBot/dist/xiangqi.js');
  assets ??= (async () => {
    const manifest = JSON.parse(
      await readFile(resolve(root, 'ui/humanBot/dist/engine-manifest.json'), 'utf8'),
    );
    return {
      ...manifest,
      moduleUrl: pathToFileURL(resolve(root, 'public/pikafish-web/pikafish.js')).href,
      network: new Uint8Array(await readFile(resolve(root, 'public/pikafish-web/pikafish.nnue'))),
    };
  })();
  return PikafishEngine.create(rules, await assets);
}
