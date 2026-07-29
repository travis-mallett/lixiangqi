import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('keeps Xiangqi file coordinates player-relative in both board orientations', () => {
  const theme = readFileSync(new URL('../../lib/css/theme/board/_xiangqi.scss', import.meta.url), 'utf8');

  assert.match(
    theme,
    /&\.orientation-white\s*\{[\s\S]*?coords\.top\s*\{\s*background-position:\s*center bottom;[\s\S]*?coords\.bottom\s*\{\s*background-position:\s*center 33\.3333%;/,
    'Red view must show Black 1..9 at the top and Red 9..1 at the bottom',
  );
  assert.match(
    theme,
    /&\.orientation-black\s*\{[\s\S]*?coords\.top\s*\{\s*background-position:\s*center 66\.6667%;[\s\S]*?coords\.bottom\s*\{\s*background-position:\s*center top;/,
    'Black view must show Red 1..9 at the top and Black 9..1 at the bottom',
  );
});
