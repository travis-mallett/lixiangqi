import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluationLabel, evaluationValue } from '../src/evaluation.ts';

test('missing scores leave gaps while exact zero is drawn at equality', () => {
  assert.equal(evaluationValue({ ply: 1 }, 'xiangqi'), null);
  assert.equal(evaluationValue({ ply: 1, eval: {} }, 'xiangqi'), null);
  assert.equal(evaluationValue({ ply: 1, eval: { cp: 0 } }, 'xiangqi'), 0);
  assert.equal(evaluationLabel({ ply: 1, eval: { cp: 0 } }), '0');
});

test('terminal mate zero uses side to move, including custom starting plies', () => {
  assert.equal(evaluationValue({ ply: 67, eval: { mate: 0 } }, 'xiangqi'), 1);
  assert.equal(evaluationValue({ ply: 68, eval: { mate: 0 } }, 'xiangqi'), -1);
  assert.equal(evaluationValue({ ply: 67, eval: { mate: -3 } }, 'xiangqi'), -1);
  assert.equal(evaluationValue({ ply: 68, eval: { mate: 3 } }, 'xiangqi'), 1);
  assert.equal(evaluationLabel({ ply: 68, eval: { mate: 0 } }), '#0');
});

test('scores retain Red perspective regardless of who just moved', () => {
  const red = evaluationValue({ ply: 5, eval: { cp: 100 } }, 'xiangqi')!;
  assert.ok(red > 0);
  assert.equal(evaluationValue({ ply: 6, eval: { cp: 100 } }, 'xiangqi'), red);
  assert.ok(evaluationValue({ ply: 5, eval: { cp: -100 } }, 'xiangqi')! < 0);
  assert.equal(evaluationLabel({ ply: 5, eval: { cp: 125 } }), '+1.3');
});

test('chess mate notation fallback remains variant specific', () => {
  assert.equal(evaluationValue({ ply: 1, san: 'Qh7#' }, 'standard'), 1);
  assert.equal(evaluationValue({ ply: 1, san: 'Qh7#' }, 'antichess'), -1);
  assert.equal(evaluationValue({ ply: 1, san: 'R5+1#' }, 'xiangqi'), null);
});
