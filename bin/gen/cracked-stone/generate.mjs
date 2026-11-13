import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { standard, mini, banqi } from './rectangular.mjs';
import { threePlayer } from './three-player.mjs';

const output = new URL('../../../public/images/board/svg/', import.meta.url);
const review = new URL('../../../doc/design/cracked-stone/', import.meta.url);
mkdirSync(review, { recursive: true });
const assets = new Map([
  ['', standard()],
  ['-minixiangqi', mini()],
  ['-three-player', threePlayer()],
  ['-banqi', banqi()],
]);
function write(target, data) {
  if (process.argv.includes('--check')) {
    if (!readFileSync(target).equals(data)) throw new Error(target.pathname + ' is stale; regenerate it.');
  } else writeFileSync(target, data);
}
for (const [suffix, svg] of assets) {
  write(new URL('xiangqi-cracked-stone' + suffix + '.svg', output), Buffer.from(svg));
}
write(
  new URL('preview.png', review),
  new Resvg(assets.get(''), { font: { loadSystemFonts: false } }).render().asPng(),
);
console.log(
  (process.argv.includes('--check') ? 'Verified' : 'Wrote') +
    ' four Cracked Stone SVGs and the standard preview.',
);
