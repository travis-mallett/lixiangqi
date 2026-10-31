import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const opening = 'xxxxkxxxx/9/1x5x1/x1x1x1x1x/9/9/X1X1X1X1X/1X5X1/9/XXXXKXXXX w R2A2C2P5N2B2r2a2c2p5n2b2 0 1';

function freshSearch() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./uci.mjs', import.meta.url))]);
    const lines = [];
    let buffer = '';
    let diagnostics = '';
    let bestMove;
    let timedOut = false;
    const send = command => child.stdin.write(command + '\n');
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, 120_000);
    child.on('error', error => {
      clearTimeout(timeout);
      reject(error);
    });
    child.stdin.on('error', error => {
      child.kill();
      reject(error);
    });
    child.stderr.on('data', data => (diagnostics += data));
    child.stdout.on('data', data => {
      buffer += data;
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end).trim();
        buffer = buffer.slice(end + 1);
        if (line === 'uciok') {
          send('setoption name Threads value 1');
          send('setoption name Hash value 64');
          send('setoption name MultiPV value 1');
          send('ucinewgame');
          send('isready');
        } else if (line === 'readyok') {
          send(`position fen ${opening}`);
          send('go depth 20');
        } else if (line.startsWith('info depth ') && !/\b(?:lowerbound|upperbound)\b/.test(line)) {
          // Bound reports are time-gated; completed iterations must be identical.
          lines.push(line.replace(/ nps \d+| time \d+/g, ''));
        } else if (line.startsWith('bestmove ')) {
          bestMove = line;
          send('quit');
        }
      }
    });
    child.on('close', code => {
      clearTimeout(timeout);
      if (timedOut || code !== 0 || !bestMove)
        reject(new Error(`Engine search failed (timeout=${timedOut}, exit=${code}): ${diagnostics}`));
      else resolve({ lines, bestMove });
    });
    send('uci');
  });
}

test('shipped Jieqi WASM repeats the opening search in fresh processes', async () => {
  const baseline = await freshSearch();
  assert.match(baseline.lines.at(-1), /^info depth 20 /);
  assert.match(baseline.bestMove, /^bestmove [a-i][0-9][a-i][0-9]/);
  for (let run = 0; run < 2; run++) assert.deepEqual(await freshSearch(), baseline);
});
