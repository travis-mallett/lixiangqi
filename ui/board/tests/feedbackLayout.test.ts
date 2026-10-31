import assert from 'node:assert/strict';
import { test } from 'node:test';

import { threeKingdoms } from '../src/definitions';
import { feedbackLayout } from '../src/feedbackLayout';

test('capture and check share a river without sharing an anchor in every perspective', () => {
  for (const perspective of threeKingdoms.participants) {
    const result = feedbackLayout(
      {
        kind: 'forward',
        effects: ['check', 'capture', 'checkmate'],
        effectRoutes: { capture: [['black', 'green']], check: [['black', 'green']] },
        effectTargets: { checkmate: ['green'] },
        winners: ['black'],
      },
      threeKingdoms.geometry,
      perspective,
    );
    assert.equal(result.length, 4);
    const capture = result.find(x => x.effect === 'capture')!;
    const check = result.find(x => x.effect === 'check')!;
    assert.notDeepEqual(capture.point, check.point);
    assert.ok(
      Math.hypot(capture.point[0] - 50, capture.point[1] - 50) <
        Math.hypot(check.point[0] - 50, check.point[1] - 50),
    );
    const defeat = result.find(x => x.effect === 'checkmate')!;
    assert.notDeepEqual(defeat.point, capture.point);
    assert.notDeepEqual(defeat.point, result.find(x => x.effect === 'victory')!.point);
    for (const { point } of result) assert.ok(point.every(v => v > 0 && v < 100));
  }
});

test('different-army simultaneous events retain separate rivers', () => {
  const result = feedbackLayout(
    {
      kind: 'forward',
      effects: ['capture', 'check'],
      effectRoutes: { capture: [['green', 'black']], check: [['green', 'red']] },
    },
    threeKingdoms.geometry,
    'red',
  );
  assert.equal(result.length, 2);
  assert.notDeepEqual(result[0].point, result[1].point);
});

test('peak effect bounds stay separate at mobile, intermediate and desktop widths', () => {
  for (const width of [320, 640, 1000])
    for (const perspective of threeKingdoms.participants) {
      const result = feedbackLayout(
        {
          kind: 'forward',
          effects: ['capture', 'check', 'checkmate'],
          effectRoutes: {
            capture: [['black', 'green']],
            check: [
              ['black', 'green'],
              ['green', 'red'],
            ],
          },
          effectTargets: { checkmate: ['black'] },
          winners: ['red'],
        },
        threeKingdoms.geometry,
        perspective,
      );
      const height = (width * threeKingdoms.geometry.height) / threeKingdoms.geometry.width;
      for (const [i, a] of result.entries())
        for (const b of result.slice(i + 1)) {
          const separation = ((a.width + b.width) * width) / 200;
          assert.ok(
            (Math.abs(a.point[0] - b.point[0]) * width) / 100 > separation ||
              (Math.abs(a.point[1] - b.point[1]) * height) / 100 > separation,
          );
          assert.ok(a.width > 8, 'Effects remain readable while avoiding collisions');
        }
    }
});
