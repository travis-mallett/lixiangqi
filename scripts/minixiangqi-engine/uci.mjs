import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';

import createEngine from '../../public/minixiangqi-engine/stockfish.js';

// Identical rules/search binary to browser analysis. Preload WASM so Node's
// fetch implementation never tries to fetch a filesystem path as a URL.
const engine = await createEngine({
  wasmBinary: await readFile(new URL('../../public/minixiangqi-engine/stockfish.wasm', import.meta.url)),
});
engine.addMessageListener(line => {
  // UCI negotiation initializes the engine's variant options. Configure only
  // after it completes, before the worker can send position/search commands.
  if (line === 'uciok') {
    engine.postMessage('setoption name UCI_Variant value minixiangqi');
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
