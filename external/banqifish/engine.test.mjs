import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { search } from '../../public/banqi-engine/banqifish-worker-v1.js';

const bytes = await readFile(
  process.env.BANQIFISH_WASM || new URL('../../public/banqi-engine/banqifish-v1.wasm', import.meta.url),
);
const module = await WebAssembly.compile(bytes);
const fresh = async () => (await WebAssembly.instantiate(module)).exports;
const engine = await fresh(),
  stock = 'KAABBRRNNCCPPPPPkaabbrrnnccppppp';
const opening = Array(8).fill('****').join('/') + ' w banqi - 0 1 ' + stock;
const fen = (cells, seat = 'w', quiet = 0, bag = '-', first = 'r') => {
  const rows = Array.from({ length: 8 }, () => Array(4).fill('.'));
  for (const [s, v] of Object.entries(cells)) rows[8 - Number(s[1])][s.charCodeAt(0) - 97] = v;
  return (
    rows.map(row => row.join('').replace(/\.+/g, dots => dots.length)).join('/') +
    ' ' +
    seat +
    ' banqi ' +
    first +
    ' ' +
    quiet +
    ' 16 ' +
    bag
  );
};
const moves = f => search(engine, [f], 1).lines.map(l => l.move);

test('all levels obey their node ceilings and reproduce decisions in a fresh worker', async () => {
  const other = await fresh();
  const mixed = fen(
    { a1: 'C', c1: 'p', d1: 'k', a3: '*', a5: 'a', c3: '*', d6: 'P', b4: '*' },
    'b',
    0,
    'PCp',
  );
  const ceilings = [600, 800, 1200, 1800, 2800, 4500, 7000, 11000, 17000, 27000];
  for (const [i, ceiling] of ceilings.entries()) {
    const level = i + 1;
    for (const pos of [opening, mixed]) {
      const result = search(engine, [pos], level, 42);
      assert.deepEqual(result, search(other, [pos], level, 42));
      assert(result.nodes > 0 && result.nodes <= ceiling);
      assert(result.lines.every(l => l.depth >= 1));
      assert(result.lines.some(l => l.move === result.move));
    }
  }
  const candidates = search(engine, [opening], 10, 987, 5).lines;
  assert.equal(candidates.length, 32);
  for (const l of candidates) {
    assert.equal(l.move.slice(0, 2), l.move.slice(2));
    const mirrored = String.fromCharCode(100 - (l.move.charCodeAt(0) - 97)) + (9 - Number(l.move[1]));
    assert.equal(candidates.find(m => m.move === mirrored + mirrored).score, l.score);
  }
  assert.deepEqual(WebAssembly.Module.imports(module), []);
  assert.throws(() => engine.memory.grow(1), RangeError);
});

test('rank captures, cannon screens and colour assignment match the public contract', () => {
  const roles = 'KABRNCP';
  for (let a = 0; a < 7; ++a)
    for (let v = 0; v < 7; ++v) {
      const allowed = a !== 5 && (a === 6 ? v === 6 || v === 0 : a <= v && !(a === 0 && v === 6));
      for (const [seat, first, red] of [
        ['w', 'r', true],
        ['b', 'r', false],
        ['w', 'b', false],
        ['b', 'b', true],
      ]) {
        const army = (p, ours) => (red === ours ? p : p.toLowerCase());
        const f = fen({ a1: army(roles[a], true), b1: army(roles[v], false) }, seat, 0, '-', first);
        assert.equal(moves(f).includes('a1b1'), allowed, f);
      }
    }
  assert(moves(fen({ a1: 'C', a3: '*', a5: 'k' }, 'w', 0, 'p')).includes('a1a5'));
  assert(!moves(fen({ a1: 'C', a2: 'R', a3: '*', a5: 'k' }, 'w', 0, 'p')).includes('a1a5'));
  assert(!moves(fen({ a1: 'C', a3: 'p', a5: '*' }, 'w', 0, 'k')).includes('a1a5'));
  assert(!moves(fen({ a1: 'K', a3: '*' }, 'w', 0, 'P')).length);
  assert.deepEqual(moves(fen({ a1: 'K', a3: '*' }, 'b', 0, 'p')), ['a3a3']);
});

test('win precedence, third repetition, and distinct quiet histories in a reused instance', () => {
  const cycle = [
    fen({ a1: 'K', d1: 'k' }),
    fen({ a2: 'K', d1: 'k' }, 'b', 1),
    fen({ a2: 'K', d2: 'k' }, 'w', 2),
    fen({ a1: 'K', d2: 'k' }, 'b', 3),
    fen({ a1: 'K', d1: 'k' }, 'w', 4),
  ];
  const repeated = [
    ...cycle,
    ...cycle.slice(1).map(f => f.replace(/ r (\d+) /, (_, q) => ' r ' + (Number(q) + 4) + ' ')),
  ];
  assert(search(engine, cycle, 10).move);
  assert.equal(search(engine, repeated.slice(0, -1), 10, 0, 5).lines.find(m => m.move === 'd2d1').score, 0);
  assert.deepEqual(search(engine, repeated, 10).lines, []);
  assert(search(engine, [repeated.at(-1)], 10).move);
  assert(!moves(fen({ a1: 'K', d1: 'k' }, 'w', 30)).length);
  const result = search(engine, [fen({ a1: 'p', b1: 'R', b2: 'R' }, 'w', 29)], 10, 0, 5);
  assert(result.lines.find(l => l.move === 'b2a2').score > 11000);
  assert(result.lines.some(l => l.score === 0));
});

test('two-piece results agree with independent finite-horizon minimax on every ordered square pair', () => {
  const coord = s => String.fromCharCode(97 + (s % 4)) + (1 + Math.floor(s / 4));
  const adj = Array.from({ length: 32 }, (_, s) =>
    [...Array(32).keys()].filter(t => Math.abs((s % 4) - (t % 4)) + Math.abs((s >> 2) - (t >> 2)) === 1),
  );
  const cache = new Map();
  function oracle(a, b, rights, remaining) {
    if (!remaining) return 0;
    if (rights & 1 && adj[a].includes(b)) return 11999;
    const key = ((remaining * 4 + rights) * 32 + a) * 32 + b;
    if (cache.has(key)) return cache.get(key);
    let best = -12000;
    for (const dest of adj[a])
      if (dest !== b) {
        const v = -oracle(b, dest, ((rights & 1) << 1) | (rights >> 1), remaining - 1);
        best = Math.max(best, v - Math.sign(v));
      }
    cache.set(key, best);
    return best;
  }
  for (const [rights, pieces] of ['Cc', 'Ap', 'Pa', 'Rr'].entries())
    for (let a = 0; a < 32; ++a)
      for (let b = 0; b < 32; ++b)
        if (a !== b) {
          const quiet = (a + b) % 3 === 0 ? 26 : 0;
          const f = fen({ [coord(a)]: pieces[0], [coord(b)]: pieces[1] }, 'w', quiet);
          assert.equal(search(engine, [f], 10).lines[0].score, oracle(a, b, rights, 30 - quiet), f);
        }
});

test('rejects malformed public inventories, positions and levels', () => {
  for (const invalid of [
    opening + ' secret',
    opening.replace('KAAB', 'XAAB'),
    opening.replace('KAAB', 'KKAB'),
    opening.replace('****', '4'),
    opening.replace(' w ', ' b '),
  ])
    assert.throws(() => search(engine, [invalid], 10));
  assert.throws(() => search(engine, [opening], 11));
});

test('flip scores weight the public identities by multiplicity', () => {
  const shared = { a4: '*', b4: '*', d2: 'k', a2: 'P', d4: 'p' };
  const score = (cells, bag, move) =>
    search(engine, [fen(cells, 'w', 0, bag)], 1).lines.find(line => line.move === move).score;
  // The quiet chariot step produces the same visible child as the specified
  // reveal, with identical surviving material. The clock is far from a draw.
  const pawn = score({ ...shared, a1: 'P', c2: 'R' }, 'Pc', 'c2c1');
  const cannon = score({ ...shared, a1: 'c', c2: 'R' }, 'PP', 'c2c1');
  assert.notEqual(pawn, cannon);
  assert.equal(score({ ...shared, a1: '*', c1: 'R' }, 'PPc', 'a1a1'), Math.trunc((2 * pawn + cannon) / 3));
});

test('the beginner returns a legal action on the mixed position where the retired worker exhausted its retry', () => {
  const f = 'PNAb/*b*a/**BP/Cc*A/p*na/1*pp/*rRP/*p*K b banqi b 0 12 BRNCPPkrcp';
  const result = search(engine, [f], 1, 123);
  assert.equal(result.lines.length, 15);
  assert(result.lines.some(line => line.move === result.move));
  assert(result.nodes <= 600);
});
