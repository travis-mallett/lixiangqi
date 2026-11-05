import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..', '..', 'public', 'pikafish-web');
const release = JSON.parse(await readFile(resolve(import.meta.dirname, '..', 'pikafish', 'release.json')));
const network = await readFile(resolve(root, 'pikafish.nnue'));
if (createHash('sha256').update(network).digest('hex') !== release.files['pikafish.nnue'].sha256)
  throw new Error('Browser NNUE does not match the pinned official release');
for (const notice of [
  'AUTHORS',
  'COPYING.txt',
  'NNUE-License.md',
  'NOTICE.html',
  'SOURCE.txt',
  'pikafish-source.tar.gz',
])
  if (!(await readFile(resolve(root, notice))).length)
    throw new Error(`Missing redistribution file: ${notice}`);
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
engine.setNnueBuffer(network);
engine.uci('uci');
engine.uci('setoption name Threads value 2');
engine.uci('setoption name MultiPV value 2');
// Red is missing the left rook. A correctly loaded NNUE must score this as a
// substantial disadvantage; a zero-filled evaluator returns only 0/1 cp.
engine.uci('position fen rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/1NBAKABNR w - - 0 1');
engine.uci('go depth 5');

let timeoutId;
const timeout = new Promise((_, reject) => {
  timeoutId = setTimeout(() => reject(new Error('Pikafish smoke test timed out')), 30000);
});
await Promise.race([bestMove, timeout]);
clearTimeout(timeoutId);
if (!output.some(line => line.startsWith('info ') && line.includes('depth 5') && line.includes('multipv 2')))
  throw new Error(`Pikafish did not stream a complete MultiPV depth:\n${output.join('\n')}`);
if (!output.includes(`id name Pikafish ${release.tag.slice('Pikafish-'.length)} LiXiangQi Web`))
  throw new Error(`Unexpected browser engine version:\n${output.join('\n')}`);
const primary = output.findLast(line => line.startsWith('info depth 5 ') && line.includes(' multipv 1 '));
const centipawns = Number.parseInt(primary?.match(/ score cp (-?\d+)/)?.[1] ?? '', 10);
if (!Number.isFinite(centipawns) || centipawns > -100)
  throw new Error(`Browser Pikafish NNUE did not evaluate the missing rook:\n${output.join('\n')}`);
const heapMiB = engine.HEAPU8.buffer.byteLength / 1048576;
if (heapMiB >= 384)
  throw new Error(`Network loading exceeded the browser memory regression ceiling: ${heapMiB} MiB`);
console.log(
  output
    .filter(line => line.startsWith('info ') || line.startsWith('bestmove '))
    .slice(-5)
    .join('\n'),
);
engine.uci('quit');
console.log(`WASM heap after NNUE load and two-thread search: ${heapMiB.toFixed(2)} MiB`);

// Exercise the native streaming decoder, independently of the adapter's SHA-256
// check. A prefix that parses correctly but lacks the end of its frame must fail.
for (const broken of [network.subarray(0, 100), network.subarray(0, network.length - 1)]) {
  const rejected = await createPikafish.default();
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      rejected.uci('quit');
      reject(new Error('Truncated network was not rejected'));
    }, 10000);
    rejected.listen = () => {};
    rejected.onError = message => {
      clearTimeout(timer);
      if (message === 'Pikafish could not initialize the NNUE network') resolve();
      else reject(new Error(message));
    };
    rejected.setNnueBuffer(broken);
    rejected.uci('isready');
  });
}
console.log('Native decoder rejects both early and late truncated NNUE frames');
