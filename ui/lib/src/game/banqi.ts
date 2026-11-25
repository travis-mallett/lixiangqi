import { standardXiangqi } from '@lixiangqi/board';

import type { EngineAnalysis } from '../ceval/engines/pikafishProtocol';
import { banqiEngineName } from './aiLevel';
import type { JieqiCapture, RevealChoice } from './jieqi';

export type Army = 'red' | 'black';

export function banqiActionLabel(action: string): string {
  const from = action.slice(0, 2),
    to = action.slice(2);
  return from === to ? i18n.site.banqiFlip(from) : from + '-' + to;
}
export const banqiInventory = 'KAABBRRNNCCPPPPPkaabbrrnnccppppp';
export const BANQI_START_FEN: string = Array(8).fill('****').join('/') + ' w banqi - 0 1 ' + banqiInventory;

export const armyOfSeat = (fen: string, seat: Army): Army =>
  fen.split(' ')[3] === 'b' ? (seat === 'red' ? 'black' : 'red') : seat;

export function banqiRevealChoices(fen: string, move: string): RevealChoice[] {
  if (move.slice(0, 2) !== move.slice(2)) return [];
  const bag = fen.split(' ')[6];
  return [...new Set(bag)]
    .filter(c => c !== '-')
    .map(identity => {
      const count = [...bag].filter(c => c === identity).length;
      return {
        role: identity,
        pieceRole: Object.keys(standardXiangqi.roles).find(
          r => standardXiangqi.roles[r] === identity.toLowerCase(),
        ),
        army: identity === identity.toUpperCase() ? 'red' : 'black',
        count,
        probability: count / bag.length,
        total: bag.length,
      };
    });
}

export function banqiCapturedPiece(
  captures: readonly JieqiCapture[] | undefined,
  ply: number,
): { square: string; symbol: string } | undefined {
  const capture = captures?.[captures.length - 1];
  if (!capture || capture.ply !== ply || !capture.role) return;
  const role = standardXiangqi.roles[capture.role];
  return role
    ? { square: capture.square, symbol: capture.side === 'red' ? role.toUpperCase() : role }
    : undefined;
}

export interface BanqiLine {
  move: string;
  score: number;
  depth: number;
}
interface SearchResult {
  nodes: number;
  move?: string;
  lines: BanqiLine[];
}

let idleWorker: Worker | undefined;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

export function searchBanqi(
  history: string[],
  level: number,
  signal: AbortSignal,
  seed = 0,
  multiPv = 1,
): Promise<SearchResult> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const quiet = Number(history[history.length - 1].split(' ')[4]);
    clearTimeout(idleTimer);
    const worker =
      idleWorker ??
      new Worker(site.asset.url('banqi-engine/banqifish-worker-v1.js', { documentOrigin: true }), {
        type: 'module',
      });
    idleWorker = undefined;
    const release = (reuse: boolean) => {
      signal.removeEventListener('abort', abort);
      worker.onmessage = worker.onerror = worker.onmessageerror = null;
      if (reuse && !idleWorker) {
        idleWorker = worker;
        idleTimer = setTimeout(() => {
          worker.terminate();
          idleWorker = undefined;
        }, 30_000);
      } else worker.terminate();
    };
    const abort = () => {
      release(false);
      reject(new DOMException('Cancelled', 'AbortError'));
    };
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = ({ data }) => {
      release(!data.error);
      if (data.error) reject(new Error(data.error));
      else resolve(data);
    };
    worker.onerror = event => {
      release(false);
      reject(new Error(event.message));
    };
    worker.onmessageerror = () => {
      release(false);
      reject(new Error('Invalid BanqiFish worker response'));
    };
    worker.postMessage({
      history: history.slice(-Math.min(31, quiet + 1)),
      level,
      seed,
      multiPv,
      wasm: site.asset.url('banqi-engine/banqifish-v1.wasm', { documentOrigin: true }),
    });
  });
}

export async function analyseBanqiPosition(
  history: string[],
  legalMoves: readonly string[],
  multiPv: number,
  signal: AbortSignal,
): Promise<EngineAnalysis> {
  const started = performance.now();
  const result = await searchBanqi(history, 10, signal, 0, multiPv);
  const lines = result.lines
    .filter(line => legalMoves.includes(line.move))
    .slice(0, multiPv)
    .map((line, i) => {
      return {
        multipv: i + 1,
        depth: line.depth,
        seldepth: line.depth,
        pvMoves: [line.move],
        wxfMoves: [banqiActionLabel(line.move)],
        score: {
          cp: line.score,
          redCp: history[history.length - 1].split(' ')[1] === 'w' ? line.score : -line.score,
        },
      };
    });
  if (!lines.length) throw Error(banqiEngineName + ' returned no legal action');
  return {
    engine: banqiEngineName,
    bestMove: lines[0].pvMoves[0],
    depth: lines[0].depth,
    nodes: result.nodes,
    nps: (result.nodes * 1000) / Math.max(1, performance.now() - started),
    timeMs: performance.now() - started,
    score: lines[0].score,
    lines,
  };
}
