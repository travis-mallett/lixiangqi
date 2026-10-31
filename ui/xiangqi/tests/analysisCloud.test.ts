import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AnalysisCloud } from '../src/analysisCloud.ts';

const position = { initialFen: 'root', moves: ['a4a5'], ruleset: 'unrestricted-v1' as const };
const signal = () => new AbortController().signal;

test('cloud hits retain history, provide immediate arrow lines, and reuse cached positions', async t => {
  const requests: object[] = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    requests.push(JSON.parse(init!.body as string));
    return Response.json({
      sourceUrl: 'CDB',
      moves: [{ move: 'a7a6', notation: 'P9+1', score: 25, note: '' }],
    });
  });
  const cloud = new AnalysisCloud();
  const result = await cloud.get(position, signal());
  assert.equal(result?.available, true);
  assert.deepEqual(result?.moves[0].pvMoves, ['a7a6']);
  assert.equal(await cloud.get(position, signal()), result);
  assert.deepEqual(requests, [{ ...position, metric: 'dtm', endgame: false }]);
  await cloud.get({ ...position, moves: [] }, signal());
  await cloud.get({ ...position, ruleset: 'tiantian-v1' }, signal());
  assert.equal(requests.length, 3);
});

test('cache misses allow local analysis without repeating the cloud request', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ sourceUrl: 'CDB', moves: [] }),
  );
  const cloud = new AnalysisCloud();
  assert.equal((await cloud.get(position, signal()))?.available, false);
  assert.equal((await cloud.get(position, signal()))?.available, false);
  assert.equal(fetch.mock.callCount(), 1);
});

test('failed and cancelled lookups do not poison the cache', async t => {
  let fail = true;
  t.mock.method(globalThis, 'fetch', async () => {
    if (fail) throw new Error('offline');
    return Response.json({ sourceUrl: 'CDB', moves: [] });
  });
  const cloud = new AnalysisCloud();
  assert.equal(await cloud.get(position, signal()), undefined);
  fail = false;
  const controller = new AbortController();
  controller.abort();
  assert.equal(await cloud.get(position, controller.signal), undefined);
  assert.equal((await cloud.get(position, signal()))?.available, false);
});
