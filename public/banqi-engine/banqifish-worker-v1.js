const symbols = 'KABRNCPkabrncp';
const square = s => String.fromCharCode(97 + s % 4) + (1 + Math.floor(s / 4));

// One entry per public level. Slips choose among all legal actions. Otherwise
// the score window controls which near-best decisions a learner can play.
const levels = [
  // nodes, depth, capture extensions, slip probability, score window
  [600, 1, 0, 0.96, 350],
  [800, 1, 0, 0.78, 260],
  [1200, 2, 1, 0.60, 195],
  [1800, 3, 2, 0.43, 145],
  [2800, 4, 3, 0.29, 100],
  [4500, 5, 4, 0.18, 68],
  [7000, 7, 5, 0.10, 40],
  [11000, 9, 5, 0.05, 22],
  [17000, 12, 6, 0.02, 9],
  [27000, 16, 6, 0, 0],
];

function frame(fen) {
  const [placement, seat, variant, army, quiet, full, bag, extra] = fen.split(' ');
  if (extra !== undefined || !bag || variant !== 'banqi' || !['w', 'b'].includes(seat) ||
      !['-', 'r', 'b'].includes(army) || !/^\d+$/.test(quiet) || Number(quiet) > 30 ||
      !/^[1-9]\d*$/.test(full) || (army === '-' && (seat !== 'w' || quiet !== '0' || full !== '1')))
    throw Error('Invalid public Banqi position');
  const rows = placement.split('/');
  if (rows.length !== 8) throw Error('Invalid board height');
  const data = new Int16Array(48);
  data.fill(14, 0, 32);
  rows.forEach((row, y) => {
    let file = 0;
    for (const c of row) {
      if (c >= '1' && c <= '4') file += Number(c);
      else {
        const code = c === '*' ? 15 : symbols.indexOf(c);
        if (code < 0 || file >= 4) throw Error('Invalid Banqi cell');
        data[(7 - y) * 4 + file++] = code;
      }
    }
    if (file !== 4) throw Error('Invalid board width');
  });
  if (bag !== '-') for (const c of bag) {
    const index = symbols.indexOf(c);
    if (index < 0 || bag.length > 32) throw Error('Invalid Banqi inventory');
    ++data[32 + index];
  }
  data[46] = army === '-' ? 2 : Number((army === 'r') !== (seat === 'w'));
  data[47] = Number(quiet);
  return data;
}

function random(seed) {
  return () => {
    seed = (seed + 0x9e3779b9) >>> 0;
    let n = Math.imul(seed ^ (seed >>> 16), 0x21f0aaad);
    n = Math.imul(n ^ (n >>> 15), 0x735a2d97);
    return ((n ^ (n >>> 15)) >>> 0) / 0x100000000;
  };
}

export function search(engine, history, level, seed = 0, multiPv = 1) {
  if (!history.length || !Number.isInteger(level) || level < 1 || level > levels.length)
    throw Error('Invalid BanqiFish search request');
  const latest = frame(history.at(-1));
  const suffix = history.slice(-Math.min(31, latest[47] + 1));
  const input = new Int16Array(engine.memory.buffer, engine.input(), suffix.length * 48);
  suffix.forEach((fen, i) => input.set(i + 1 === suffix.length ? latest : frame(fen), i * 48));
  const [budget, depth, captures, slip, window] = levels[level - 1];
  const count = engine.analyse(suffix.length, budget, depth, captures, multiPv);
  if (count < 0) throw Error('Invalid public Banqi history');
  const records = new Int32Array(engine.memory.buffer, engine.lines(), count * 4);
  const lines = Array.from({ length: count }, (_, i) => ({
    move: square(records[4 * i]) + square(records[4 * i + 1]),
    score: records[4 * i + 2], depth: records[4 * i + 3],
  }));
  let move = lines[0]?.move;
  if (move && level < 10) {
    const rng = random(seed);
    const pool = rng() < slip ? lines :
      lines.filter(line => line.depth === lines[0].depth && line.score >= lines[0].score - window);
    move = pool[Math.floor(rng() * pool.length)].move;
  }
  return { move, lines, nodes: engine.nodes() };
}

if (typeof self !== 'undefined' && typeof document === 'undefined') {
  let instance;
  self.onmessage = async ({ data }) => {
    try {
      instance ??= fetch(data.wasm).then(async response => {
        if (!response.ok) throw Error('BanqiFish asset request failed: ' + response.status);
        return WebAssembly.instantiate(await response.arrayBuffer());
      });
      self.postMessage(search((await instance).instance.exports, data.history, data.level, data.seed, data.multiPv));
    } catch (error) {
      self.postMessage({ error: String(error) });
    }
  };
}
