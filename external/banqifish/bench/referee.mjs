import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { random } from './engine.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const stock = 'KAABBRRNNCCPPPPPkaabbrrnnccppppp';
export function deal(seed) {
  const next = random(seed),
    cards = [...stock];
  for (let i = cards.length - 1; i; --i) {
    const j = Math.floor((next() / 2 ** 32) * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards.join('');
}

export function referee() {
  const child = spawn(
    process.env.JAVA || 'java',
    [
      '-Xmx384m',
      '-XX:ActiveProcessorCount=2',
      '--class-path',
      'target/universal/stage/lib/*',
      'external/banqifish/bench/Referee.java',
    ],
    { cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'inherit'] },
  );
  const queue = [];
  let failure;
  const fail = error => {
    failure = error;
    for (const [, reject] of queue.splice(0)) reject(error);
  };
  createInterface({ input: child.stdout }).on('line', line => queue.shift()[0](line.split('\t')));
  child.on('error', fail);
  child.stdin.on('error', fail);
  child.on('exit', code => fail(Error('Scala referee exited ' + code)));
  return {
    request: line =>
      new Promise((res, rej) => {
        if (failure) throw failure;
        queue.push([res, rej]);
        child.stdin.write(line + '\n');
      }),
    close: () => child.stdin.end(),
  };
}
