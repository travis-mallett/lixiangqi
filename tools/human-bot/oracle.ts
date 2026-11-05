import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import type { XiangqiSnapshot } from '../../ui/humanBot/src/xiangqi/rules.ts';

export interface OracleAnalysis {
  engine: string;
  bestMove: string;
  nodes: number;
  depth: number;
  timeMs: number;
  lines: { pvMoves: string[]; score: { cp?: number; mate?: number; redCp?: number; redMate?: number } }[];
}
/** Separate diagnostic scorer. Its higher-budget labels never feed back into live choices. */
export interface OfflineOracle<S> {
  analyze(snapshot: S, legalMoves: readonly string[], nodes: number): Promise<OracleAnalysis>;
  close(): Promise<void>;
}
export class PikafishOracle implements OfflineOracle<XiangqiSnapshot> {
  private readonly process: ChildProcessWithoutNullStreams;
  private pending?: {
    resolve: (value: OracleAnalysis) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  };
  private failure?: Error;
  private readonly exited: Promise<void>;
  constructor() {
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const local = resolve(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    const python = process.env.PYTHON ?? (existsSync(local) ? local : 'python3');
    this.process = spawn(python, ['-u', resolve(root, 'tools/human-bot/oracle.py')], {
      cwd: root,
      windowsHide: true,
    });
    this.exited = new Promise(resolve => this.process.once('close', () => resolve()));
    const fail = (error: Error) => {
      this.failure = error;
      if (this.pending) {
        clearTimeout(this.pending.timer);
        this.pending.reject(error);
        this.pending = undefined;
      }
    };
    this.process.on('error', fail);
    this.process.stdin.on('error', fail);
    this.process.on('exit', code => fail(new Error(`Offline oracle exited (${code})`)));
    let errors = '';
    this.process.stderr.on('data', chunk => {
      errors = (errors + String(chunk)).slice(-3000);
    });
    createInterface({ input: this.process.stdout }).on('line', line => {
      const pending = this.pending;
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending = undefined;
      try {
        const response = JSON.parse(line);
        if (!response.ok) pending.reject(new Error(`${response.error}\n${errors}`));
        else pending.resolve(response.analysis);
      } catch (error) {
        pending.reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
  analyze(snapshot: XiangqiSnapshot, legalMoves: readonly string[], nodes = 10000): Promise<OracleAnalysis> {
    if (this.failure) return Promise.reject(this.failure);
    if (this.pending) return Promise.reject(new Error('Offline oracle searches must be sequential'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = undefined;
        this.failure = new Error('Offline Pikafish timeout');
        reject(this.failure);
        this.process.stdin.end();
      }, 30000);
      this.pending = { resolve, reject, timer };
      this.process.stdin.write(JSON.stringify({ ...snapshot, legalMoves, nodes }) + '\n', error => {
        if (error && this.pending) {
          clearTimeout(timer);
          this.pending = undefined;
          reject(error);
        }
      });
    });
  }
  async close(): Promise<void> {
    this.process.stdin.end();
    await this.exited;
  }
}
