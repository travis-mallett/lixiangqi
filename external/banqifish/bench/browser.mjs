import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Only these four local files can be served. Start timing after Chromium has
// cached them, so the first measurement captures worker creation and search.
assert(process.env.BANQI_BASELINE, 'Set BANQI_BASELINE to the archived public engine directory');
const shipped = fileURLToPath(new URL('../../../public/banqi-engine/', import.meta.url));
const setups = [
  ['baseline', process.env.BANQI_BASELINE, 'worker-v1.js', 'misty-banqi-v1.wasm'],
  ['fish', shipped, 'banqifish-worker-v1.js', 'banqifish-v1.wasm'],
];
const files = new Map();
for (const [id, dir, js, wasm] of setups)
  for (const name of [js, wasm]) files.set('/' + id + '/' + name, await readFile(resolve(dir, name)));
const server = createServer((req, res) => {
  if (req.url === '/')
    return res.writeHead(200, { 'Content-Type': 'text/html' }).end('<title>Banqi benchmark</title>');
  const body = files.get(req.url);
  if (!body) return res.writeHead(404).end();
  res
    .writeHead(200, {
      'Content-Type': req.url.endsWith('.wasm') ? 'application/wasm' : 'text/javascript',
      'Cache-Control': 'public, max-age=3600',
    })
    .end(body);
});
await new Promise((res, rej) => server.once('error', rej).listen(0, '127.0.0.1', res));
let browser;
try {
  browser = await chromium.launch({ channel: process.env.CHROMIUM_CHANNEL || undefined });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:' + server.address().port);
  const samples = { baseline: { first: [], warm: [] }, fish: { first: [], warm: [] } };
  const fen = '4/2r1/1*1k/4/2R1/1P*1/1C2/2pK w banqi r 0 16 Np';
  for (let pass = 0; pass <= 16; ++pass) {
    for (const [id, , js, wasm] of pass % 2 ? setups : [...setups].reverse()) {
      const times = await page.evaluate(
        async ({ id, js, wasm, fen }) => {
          const start = performance.now();
          const worker = new Worker('/' + id + '/' + js, { type: 'module' });
          const times = [];
          try {
            for (let i = 0; i < 6; ++i) {
              const began = i ? performance.now() : start;
              const result = await new Promise((res, rej) => {
                worker.onmessage = ({ data }) => res(data);
                worker.onerror = event => rej(Error(event.message || 'Worker failed'));
                worker.postMessage({
                  history: [fen],
                  level: 10,
                  seed: 0,
                  multiPv: 1,
                  wasm: '/' + id + '/' + wasm,
                });
              });
              if (result.error || !result.move) throw Error(result.error || 'Missing browser move');
              times.push(performance.now() - began);
            }
          } finally {
            worker.terminate();
          }
          return times;
        },
        { id, js, wasm, fen },
      );
      if (pass) {
        samples[id].first.push(times[0]);
        samples[id].warm.push(...times.slice(1));
      }
    }
  }
  const report = series => {
    const sorted = series.toSorted((a, b) => a - b);
    return {
      samples: sorted.length,
      medianMs: sorted[Math.ceil(sorted.length * 0.5) - 1],
      p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
    };
  };
  console.log(
    JSON.stringify(
      {
        browser: browser.version(),
        fen,
        engines: Object.fromEntries(
          Object.entries(samples).map(([id, s]) => [id, { first: report(s.first), warm: report(s.warm) }]),
        ),
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  server.close();
}
