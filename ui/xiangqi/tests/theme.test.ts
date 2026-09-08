import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const theme = readFileSync(new URL('../../lib/css/theme/board/_xiangqi.scss', import.meta.url), 'utf8');
const chessgroundTheme = readFileSync(
  new URL('../../lib/css/theme/board/_chessground.scss', import.meta.url),
  'utf8',
);
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test('uses reusable shadow textures without live blur filters', () => {
  assert.match(
    chessgroundTheme,
    /cg-board piece\s*\{\s*--cg-piece-brightness:\s*brightness\([\s\S]*?\);\s*\}/,
  );
  assert.match(
    theme,
    /--xiangqi-rest-shadow-image:\s*url\('\.\.\/piece\/effects\/xiangqi-rest-shadow\.png'\);/,
  );
  assert.match(
    theme,
    /--xiangqi-airborne-shadow-image:\s*url\('\.\.\/piece\/effects\/xiangqi-airborne-shadow\.png'\);/,
  );
  assert.doesNotMatch(theme, /drop-shadow\(|filter:\s*blur\(/);

  for (const asset of ['xiangqi-rest-shadow.png', 'xiangqi-airborne-shadow.png']) {
    const image = readFileSync(new URL(`../../../public/piece/effects/${asset}`, import.meta.url));
    assert.deepEqual(image.subarray(0, pngSignature.length), pngSignature);
  }
});
