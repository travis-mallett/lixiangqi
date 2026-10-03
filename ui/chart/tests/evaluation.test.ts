import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluationLabel, evaluationValue } from '../src/evaluation.ts';

test('missing scores leave gaps while exact zero is drawn at equality', () => {
  assert.equal(evaluationValue({ ply: 1 }), null);
  assert.equal(evaluationValue({ ply: 1, eval: {} }), null);
  assert.equal(evaluationValue({ ply: 1, eval: { cp: 0 } }), 0);
  assert.equal(evaluationLabel({ ply: 1, eval: { cp: 0 } }), '0');
});

test('terminal mate zero uses side to move, including custom starting plies', () => {
  assert.equal(evaluationValue({ ply: 67, eval: { mate: 0 } }), 1);
  assert.equal(evaluationValue({ ply: 68, eval: { mate: 0 } }), -1);
  assert.equal(evaluationValue({ ply: 67, eval: { mate: -3 } }), -1);
  assert.equal(evaluationValue({ ply: 68, eval: { mate: 3 } }), 1);
  assert.equal(evaluationLabel({ ply: 68, eval: { mate: 0 } }), '#0');
});

test('scores retain Red perspective regardless of who just moved', () => {
  const red = evaluationValue({ ply: 5, eval: { cp: 100 } })!;
  assert.ok(red > 0);
  assert.equal(evaluationValue({ ply: 6, eval: { cp: 100 } }), red);
  assert.ok(evaluationValue({ ply: 5, eval: { cp: -100 } })! < 0);
  assert.equal(evaluationLabel({ ply: 5, eval: { cp: 125 } }), '+1.3');
});

test('display notation cannot substitute for native adjudication or engine evaluation', () => {
  assert.equal(evaluationValue({ ply: 1, notation: 'R5+1#' }), null);
});
