import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const inline = ts.transpileModule(readFileSync(new URL('../src/site.inline.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

const roles = ['soldier', 'elephant', 'horse', 'chariot', 'advisor', 'cannon', 'general'];
const assets = (key: string): Record<string, string> =>
  Object.fromEntries(
    ['red', 'black'].flatMap(color =>
      roles.map(role => [`---${color}-${role}`, `url("/${key}/${color}-${role}.svg")`]),
    ),
  );

function fixture() {
  const root = new Map([
    ...Object.entries(assets('initial')),
    ['--xiangqi-rest-shadow-image', 'url("/rest.png")'],
    ['--xiangqi-airborne-shadow-image', 'url("/airborne.png")'],
  ]);
  const values = new Map<string, string>();
  const body = {
    dataset: { pieceSet: 'initial' },
    classList: new Set<string>(),
    style: {
      getPropertyValue: (key: string) => values.get(key) ?? '',
      setProperty: (key: string, value: string) => values.set(key, value),
      removeProperty: (key: string) => values.delete(key),
    },
  };
  const pending = new Map<string, { resolve: () => void; reject: (reason: Error) => void }>();
  class Image {
    src = '';
    decode() {
      return new Promise<void>((resolve, reject) => pending.set(this.src, { resolve, reject }));
    }
  }
  const documentElement = { style: { getPropertyValue: (key: string) => root.get(key) ?? '' } };
  const document = { body, documentElement, addEventListener() {} };
  const getComputedStyle = (element: unknown) => ({
    getPropertyValue: (key: string) =>
      (element === body ? values.get(key) : undefined) ?? root.get(key) ?? '',
  });
  const window = { site: {} as Site, getComputedStyle };
  runInNewContext(inline, { window, document, getComputedStyle, Image, console, Promise });
  const resolve = (predicate: (url: string) => boolean = () => true) => {
    for (const [url, request] of pending)
      if (predicate(url)) {
        pending.delete(url);
        request.resolve();
      }
  };
  return { api: window.site.pieceImages, body, values, pending, resolve };
}

test('initial pieces remain hidden until all faces and both shadow images decode', async () => {
  const f = fixture();
  assert.equal(f.pending.size, 16);
  f.resolve(url => url.endsWith('.svg'));
  await setImmediate();
  assert.equal(f.body.classList.has('piece-images-ready'), false);
  f.resolve(url => url === '/rest.png');
  await setImmediate();
  assert.equal(f.body.classList.has('piece-images-ready'), false);
  f.resolve();
  await f.api.ready;
  assert.equal(f.body.classList.has('piece-images-ready'), true);
});

test('loaded shadows cannot reveal a piece set while a face still needs decoding', async () => {
  const f = fixture();
  f.resolve(url => url !== '/initial/black-general.svg');
  await setImmediate();
  assert.equal(f.body.classList.has('piece-images-ready'), false);
  f.resolve();
  await f.api.ready;
  assert.equal(f.body.classList.has('piece-images-ready'), true);
});

test('piece switching keeps the previous set visible and commits only the latest completed selection', async () => {
  const f = fixture();
  f.resolve();
  await f.api.ready;
  const first = f.api.set(assets('first'), 'first');
  const second = f.api.set(assets('second'), 'second');
  assert.equal(f.body.dataset.pieceSet, 'initial');
  assert.equal(f.body.classList.has('piece-images-ready'), true);
  f.resolve(url => url.startsWith('/second/'));
  await second;
  assert.equal(f.body.dataset.pieceSet, 'second');
  for (const [key, value] of Object.entries(assets('second'))) assert.equal(f.values.get(key), value);
  f.resolve();
  await first;
  assert.equal(f.body.dataset.pieceSet, 'second');
  for (const [key, value] of Object.entries(assets('second'))) assert.equal(f.values.get(key), value);
});

test('failed replacement leaves the complete previous set intact', async () => {
  const f = fixture();
  f.resolve();
  await f.api.ready;
  const replacement = f.api.set(assets('broken'), 'broken');
  const rejected = assert.rejects(replacement, /image unavailable/);
  f.pending.get('/broken/red-general.svg')!.reject(new Error('image unavailable'));
  f.resolve();
  await rejected;
  assert.equal(f.body.dataset.pieceSet, 'initial');
  assert.equal(f.body.classList.has('piece-images-ready'), true);
  for (const key of Object.keys(assets('broken'))) assert.notEqual(f.values.get(key), assets('broken')[key]);
});

test('a superseded initial load cannot reveal an incomplete replacement', async () => {
  const f = fixture();
  const replacement = f.api.set(assets('replacement'), 'replacement');
  f.resolve(url => !url.startsWith('/replacement/'));
  await f.api.ready;
  assert.equal(f.body.classList.has('piece-images-ready'), false);
  assert.equal(f.body.dataset.pieceSet, 'initial');
  f.resolve();
  await replacement;
  assert.equal(f.body.classList.has('piece-images-ready'), true);
  assert.equal(f.body.dataset.pieceSet, 'replacement');
});
