import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpus } from 'node:os';

import { loadEngine, random } from './engine.mjs';
import { deal, referee } from './referee.mjs';

// Both engines see the same legal histories. A third, seeded, capture-first
// policy generates the corpus without consulting either engine.
const positions = [],
  arbiter = referee();
try {
  for (let game = 0; game < 8; ++game) {
    const seed = 647100 + game,
      rng = random(seed),
      collected = new Set();
    let history = [],
      state = await arbiter.request([game, 'deal', deal(seed)].join('\t'));
    while (state[1] === '*') {
      const [fen, , , actions] = state;
      if (fen.split(' ')[4] === '0') history = [];
      history.push(fen);
      const placement = fen.split(' ')[0],
        covers = placement.split('*').length - 1;
      const faces = [...placement].filter(s => /[a-z]/i.test(s)).length;
      const phase =
        covers === 32 && !game
          ? 'opening'
          : covers === 26
            ? 'early'
            : covers === 13
              ? 'mixed'
              : covers === 3
                ? 'three covers'
                : !covers && faces > 5
                  ? 'open'
                  : !covers && faces <= 5
                    ? 'ending'
                    : undefined;
      if (phase && !collected.has(phase)) {
        positions.push({ phase, history: [...history] });
        collected.add(phase);
      }
      const cells = [...placement.replaceAll('/', '').replace(/[1-4]/g, n => '.'.repeat(Number(n)))];
      const legal = actions.split(' ');
      const flips = legal.filter(m => m.slice(0, 2) === m.slice(2));
      const captures = legal.filter(
        m => !flips.includes(m) && cells[(8 - Number(m[3])) * 4 + m.charCodeAt(2) - 97] !== '.',
      );
      const pool =
        captures.length && rng() / 2 ** 32 < 0.8
          ? captures
          : flips.length && rng() / 2 ** 32 < 0.8
            ? flips
            : legal;
      state = await arbiter.request(game + '\t' + pool[Math.floor((rng() / 2 ** 32) * pool.length)]);
    }
  }
} finally {
  arbiter.close();
}

const reps = Number(process.argv[2] || 8);
assert(Number.isInteger(reps) && reps > 0);
const models = {};
for (const id of ['baseline', 'fish']) {
  const engine = await loadEngine(id);
  for (const p of positions) engine.search(p.history, 10, 0);
  models[id] = { engine, times: [], cpu: 0, phases: {} };
}
for (let rep = 0; rep < reps; ++rep) {
  for (const id of rep % 2 ? ['fish', 'baseline'] : ['baseline', 'fish']) {
    const model = models[id];
    const cpu = process.cpuUsage();
    for (const p of positions) {
      const start = performance.now();
      const result = model.engine.search(p.history, 10, rep);
      const ms = performance.now() - start;
      assert(result.move);
      model.times.push(ms);
      (model.phases[p.phase] ??= []).push(ms);
    }
    const delta = process.cpuUsage(cpu);
    model.cpu += delta.user + delta.system;
  }
}
const percentile = (nums, p) => nums.toSorted((a, b) => a - b)[Math.ceil(nums.length * p) - 1];
console.log(
  JSON.stringify(
    {
      cpu: cpus()[0].model,
      node: process.version,
      platform: process.platform + '-' + process.arch,
      positions: positions.length,
      corpusSha256: createHash('sha256').update(JSON.stringify(positions)).digest('hex'),
      repetitions: reps,
      level: 10,
      engines: Object.fromEntries(
        Object.entries(models).map(([id, m]) => [
          id,
          {
            decisions: m.times.length,
            medianMs: percentile(m.times, 0.5),
            p95Ms: percentile(m.times, 0.95),
            cpuMsPerMove: m.cpu / 1000 / m.times.length,
            wasmBytes: m.engine.bytes,
            linearMemoryBytes: m.engine.memory.buffer.byteLength,
            phaseMedianMs: Object.fromEntries(
              Object.entries(m.phases).map(([k, v]) => [k, percentile(v, 0.5)]),
            ),
          },
        ]),
      ),
    },
    null,
    2,
  ),
);
