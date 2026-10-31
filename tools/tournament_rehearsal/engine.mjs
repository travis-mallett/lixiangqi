import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export const strengths = [100, 200, 400, 800, 1600, 3200, 6400, 12000, 22000, 40000];

/** Local UCI only. This process has no connection to the website. */
export class Engine {
  constructor(executable, cwd, level) {
    this.level = level;
    this.pending = undefined;
    this.failure = undefined;
    this.process = spawn(executable, [], { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    createInterface({ input: this.process.stdout }).on('line', line => this.pending?.line(line));
    this.process.stderr.on('data', () => {});
    this.process.on('error', error => this.fail(error));
    this.process.on('exit', code => this.fail(new Error(`Pikafish exited (${code})`)));
  }

  fail(error) {
    this.failure = error;
    this.pending?.reject(error);
  }

  command(commands, done, timeout = 10000) {
    if (this.failure) return Promise.reject(this.failure);
    if (this.pending) return Promise.reject(new Error('Overlapping UCI commands'));
    return new Promise((resolve, reject) => {
      const lines = [];
      const finish = (error, value) => {
        clearTimeout(timer);
        this.pending = undefined;
        if (error) reject(error);
        else resolve(value);
      };
      const timer = setTimeout(() => {
        this.process.kill();
        finish(new Error(`Pikafish timed out: ${commands.at(-1)}`));
      }, timeout);
      this.pending = {
        reject: error => finish(error),
        line: line => {
          lines.push(line);
          if (done(line)) finish(undefined, lines);
        },
      };
      this.process.stdin.write(commands.join('\n') + '\n');
    });
  }

  async start() {
    const lines = await this.command(['uci'], line => line === 'uciok');
    if (!lines.some(line => /^id name .*Pikafish/i.test(line)))
      throw new Error('Expected a Pikafish UCI engine');
    await this.command(
      ['setoption name Threads value 1', 'setoption name Hash value 32', 'isready'],
      line => line === 'readyok',
    );
  }

  async move(moves) {
    const lines = await this.command(
      [
        `position startpos${moves.length ? ' moves ' + moves.join(' ') : ''}`,
        `go nodes ${strengths[this.level - 1]}`,
      ],
      line => line.startsWith('bestmove '),
    );
    const move = lines.at(-1).split(' ')[1];
    if (!/^[a-i][0-9][a-i][0-9]$/.test(move)) throw new Error(`No playable engine move: ${move}`);
    return move;
  }

  async close() {
    if (this.process.exitCode !== null) return;
    this.process.stdin.end('quit\n');
    await Promise.race([
      new Promise(resolve => this.process.once('exit', resolve)),
      new Promise(resolve =>
        setTimeout(() => {
          this.process.kill();
          resolve();
        }, 1500),
      ),
    ]);
  }
}
