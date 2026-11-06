import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';

import createEngine from '../../public/fairy-stockfish-engine/stockfish.js';

const variant = process.argv[2];
if (!['minixiangqi', 'manchu'].includes(variant))
  throw new Error('Expected a supported Fairy-Stockfish variant');

// Identical rules/search binary to browser analysis. Preload WASM so Node's
// fetch implementation never tries to fetch a filesystem path as a URL.
const engine = await createEngine({
  wasmBinary: await readFile(new URL('../../public/fairy-stockfish-engine/stockfish.wasm', import.meta.url)),
});
engine.addMessageListener(line => {
  // UCI negotiation initializes the engine's variant options. Configure only
  // after it completes, before the worker can send position/search commands.
  if (line === 'uciok') {
    engine.postMessage(`setoption name UCI_Variant value ${variant}`);
    engine.postMessage('setoption name Use NNUE value false');
  }
  process.stdout.write(line + '\n');
});
const close = () => {
  engine.terminate();
  process.exit(0);
};
createInterface({ input: process.stdin })
  .on('line', line => (line === 'quit' ? close() : engine.postMessage(line)))
  .on('close', close);
