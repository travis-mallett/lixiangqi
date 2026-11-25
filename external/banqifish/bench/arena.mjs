import assert from 'node:assert/strict';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';

import { loadEngine, random } from './engine.mjs';
import { deal, referee } from './referee.mjs';

function describe(deals, games) {
  const scores = deals.map(pair => (pair[0] + pair[1]) / 2);
  const average = nums => nums.reduce((a, b) => a + b, 0) / nums.length;
  const next = random(0x51a7),
    estimates = [];
  for (let i = 0; i < 10000; ++i)
    estimates.push(average(scores.map(() => scores[Math.floor((next() / 2 ** 32) * scores.length)])));
  estimates.sort((a, b) => a - b);
  const outcomes = deals.flat();
  return {
    wins: outcomes.filter(s => s === 1).length,
    draws: outcomes.filter(s => s === 0.5).length,
    losses: outcomes.filter(s => s === 0).length,
    score: average(scores),
    pairedBootstrap95: [estimates[250], estimates[9749]],
    pairBins: [0, 0.25, 0.5, 0.75, 1].map(n => scores.filter(s => s === n).length),
    plies: games.reduce((a, b) => a + b.plies, 0),
    terminations: Object.fromEntries(
      [...new Set(games.map(g => g.reason))].map(reason => [
        reason,
        games.filter(g => g.reason === reason).length,
      ]),
    ),
  };
}

async function run() {
  const [a = 'fish:10', b = 'baseline:10', n = '32', first = '735000', jobs = '4'] = process.argv.slice(2);
  const count = Number(n),
    start = Number(first),
    threads = Number(jobs);
  assert(Number.isSafeInteger(count) && count > 0 && Number.isSafeInteger(start));
  assert(Number.isInteger(threads) && threads > 0 && threads <= 64);
  const specs = [a, b].map(spec => {
    const [id, level] = spec.split(':');
    assert(['fish', 'baseline'].includes(id) && Number(level) >= 1 && Number(level) <= 10);
    return [id, Number(level)];
  });
  const arbiter = referee();
  const pairs = Array.from({ length: count }, () => []),
    games = [];
  let task = 0;
  const workers = [];
  try {
    await Promise.all(
      Array.from({ length: Math.min(threads, 2 * count) }, async () => {
        const worker = new Worker(new URL(import.meta.url), { workerData: specs });
        workers.push(worker);
        let pending;
        let failure;
        worker.on('message', message => pending.resolve(message));
        worker.on('error', err => {
          failure = err;
          pending?.reject(err);
        });
        worker.on('exit', code => {
          if (code) {
            failure ??= Error('Search process exited ' + code);
            pending?.reject(failure);
          }
        });
        for (let index; (index = task++) < 2 * count;) {
          const pair = Math.floor(index / 2),
            reversed = index % 2,
            seed = start + pair;
          let state = await arbiter.request([index, 'deal', deal(seed)].join('\t'));
          let ply = 0,
            history = [];
          const next = random(seed ^ 0x51de8af1);
          while (state[1] === '*') {
            const [fen, , , legal] = state;
            const side = (ply % 2) ^ reversed;
            if (fen.split(' ')[4] === '0') history = [];
            history.push(fen);
            const chosen = await new Promise((resolve, reject) => {
              if (failure) throw failure;
              pending = { resolve, reject };
              worker.postMessage({ history, side, seed: next() });
            });
            if (specs[side][0] === 'baseline' && !chosen.move && !chosen.legal.length) {
              // The retired binary can exhaust its retry without producing any
              // move. Keep the deal and report the forfeit separately.
              state = [fen, ply % 2 === 0 ? '0-1' : '1-0', 'baseline-no-action'];
              break;
            }
            // Differential check of the complete legal root on every single turn.
            assert.deepEqual(chosen.legal.sort(), legal.split(' ').sort(), fen);
            assert(chosen.legal.includes(chosen.move), fen);
            state = await arbiter.request(index + '\t' + chosen.move);
            ++ply;
          }
          const [, result, reason] = state;
          pairs[pair][reversed] = result === '1/2-1/2' ? 0.5 : Number((result === '1-0') === !reversed);
          games.push({ plies: ply, reason });
        }
      }),
    );
    console.log(JSON.stringify({ a, b, deals: count, firstSeed: start, ...describe(pairs, games) }, null, 2));
  } finally {
    arbiter.close();
    await Promise.all(workers.map(w => w.terminate()));
  }
}
if (isMainThread) await run();
else {
  const engines = new Map();
  for (const [id] of workerData) if (!engines.has(id)) engines.set(id, await loadEngine(id));
  parentPort.on('message', ({ history, side, seed }) => {
    const [id, level] = workerData[side],
      result = engines.get(id).search(history, level, seed);
    parentPort.postMessage({ move: result.move, legal: result.lines.map(l => l.move) });
  });
}
