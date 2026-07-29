import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..', '..', 'public', 'pikafish-web');
const createPikafish = await import(pathToFileURL(resolve(root, 'pikafish.js')).href);
const engine = await createPikafish.default();
const output = [];
let resolveBestMove;
const bestMove = new Promise(resolve => (resolveBestMove = resolve));

engine.listen = line => {
  output.push(line);
  if (line.startsWith('bestmove ')) resolveBestMove(line);
};
engine.onError = message => {
  throw new Error(message);
};
engine.setNnueBuffer(await readFile(resolve(root, engine.getRecommendedNnue())));
engine.uci('uci');
engine.uci('setoption name Threads value 2');
engine.uci('setoption name MultiPV value 2');
// Red is missing the left rook. A correctly loaded NNUE must score this as a
// substantial disadvantage; a zero-filled evaluator returns only 0/1 cp.
engine.uci('position fen rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/1NBAKABNR w');
engine.uci('go depth 5');

let timeoutId;
const timeout = new Promise((_, reject) => {
  timeoutId = setTimeout(() => reject(new Error('Pikafish smoke test timed out')), 30000);
});
await Promise.race([bestMove, timeout]);
clearTimeout(timeoutId);
if (!output.some(line => line.startsWith('info ') && line.includes('depth 5') && line.includes('multipv 2')))
  throw new Error(`Pikafish did not stream a complete MultiPV depth:\n${output.join('\n')}`);
if (!output.includes('id name Pikafish 2026-01-02'))
  throw new Error(`Unexpected browser engine version:\n${output.join('\n')}`);
const primary = output.findLast(line => line.startsWith('info depth 5 ') && line.includes(' multipv 1 '));
const centipawns = Number.parseInt(primary?.match(/ score cp (-?\d+)/)?.[1] ?? '', 10);
if (!Number.isFinite(centipawns) || centipawns > -100)
  throw new Error(`Browser Pikafish NNUE did not evaluate the missing rook:\n${output.join('\n')}`);
console.log(
  output
    .filter(line => line.startsWith('info ') || line.startsWith('bestmove '))
    .slice(-5)
    .join('\n'),
);
engine.uci('quit');
