import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Opts } from '../src/exports';
import { makeSubmit } from '../src/keyboardSubmit';

test('native notation is resolved by the rules owner and stale input is never played', async () => {
  const played: string[] = [];
  const input = document.createElement('input');
  let resolve!: (move: string) => void;
  const ctrl = {
    legalMoves: { i10i9: 'i10i9' },
    move: (from: string, to: string) => played.push(from + to),
    resolveNotation: () =>
      new Promise<string>(done => {
        resolve = done;
      }),
  };
  const submit = makeSubmit({ input, ctrl } as unknown as Opts, () => {
    input.value = '';
  });
  input.value = 'R9+1';
  submit(input.value, { isTrusted: true, force: true });
  input.value = 'R9+2';
  resolve('i10i9');
  await new Promise<void>(done => setImmediate(done));
  assert.deepEqual(played, []);
  submit(input.value, { isTrusted: true, force: true });
  resolve('i10i9');
  await new Promise<void>(done => setImmediate(done));
  assert.deepEqual(played, ['i10i9']);
});

test('rank ten input is unambiguous, legal, and requires a trusted commit', () => {
  const played: string[] = [];
  const input = document.createElement('input');
  const ctrl = {
    legalMoves: { a10a9: 'a10a9', a1a2: 'a1a2' },
    move: (from: string, to: string) => played.push(from + to),
    select: (key: string) => played.push(key),
  };
  const submit = makeSubmit({ input, ctrl } as unknown as Opts, () => {
    input.value = '';
  });
  submit('a10a9', { isTrusted: false, force: true });
  submit('a10a9', { isTrusted: true });
  assert.deepEqual(played, []);
  submit('a10a9', { isTrusted: true, force: true });
  assert.deepEqual(played, ['a10a9']);
  submit('a1', { isTrusted: true });
  assert.deepEqual(played, ['a10a9']);
  submit('a10', { isTrusted: true, force: true });
  assert.deepEqual(played, ['a10a9', 'a10']);
});

test('a queued move waits for legal destinations and plays when the turn arrives', () => {
  const played: string[] = [];
  const ctrl = {
    legalMoves: null as Record<string, string> | null,
    move: (from: string, to: string) => played.push(from + to),
  };
  const input = document.createElement('input');
  input.value = 'i10i9';
  const submit = makeSubmit({ input, ctrl } as unknown as Opts, () => {
    input.value = '';
  });
  submit(input.value, { isTrusted: true, force: true });
  assert.equal(input.value, 'i10i9');
  ctrl.legalMoves = { i10i9: 'i10i9' };
  submit(input.value, { isTrusted: true, yourMove: true });
  assert.deepEqual(played, ['i10i9']);
  assert.equal(input.value, '');
});
