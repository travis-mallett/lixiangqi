import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parsePuzzleVariant, puzzleVariants } from '../src/variant.ts';

test('puzzle variant boundary accepts Xiangqi and rejects unknown variants', () => {
  assert.deepEqual(puzzleVariants, ['xiangqi']);
  assert.equal(parsePuzzleVariant('xiangqi'), 'xiangqi');
  assert.throws(() => parsePuzzleVariant('standard'), /Unsupported puzzle variant/);
});
