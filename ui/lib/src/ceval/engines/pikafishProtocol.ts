export interface EngineScore {
  cp?: number;
  mate?: number;
  redCp?: number;
  redMate?: number;
  bound?: 'lower' | 'upper';
}

export interface EngineLine {
  multipv: number;
  depth: number;
  seldepth: number;
  score: EngineScore;
  pvMoves: string[];
  wxfMoves: string[];
}

export interface EngineAnalysis {
  engine: string;
  bestMove?: string;
  depth: number;
  nodes: number;
  nps: number;
  timeMs: number;
  score: EngineScore;
  lines: EngineLine[];
}

export interface PikafishWork {
  fen: string;
  depth: number;
  multiPv: number;
  threads: number;
  hashSize: number;
  stopRequested: boolean;
  emit: (analysis: EngineAnalysis, final: boolean) => void;
}

interface ParsedInfo extends EngineLine {
  nodes: number;
  nps: number;
  timeMs: number;
}

export class PikafishProtocol {
  engineName = 'Pikafish';

  private work?: PikafishWork;
  private nextWork?: PikafishWork;
  private send?: (command: string) => void;
  private currentDepth = 0;
  private readonly lines = new Map<number, ParsedInfo>();
  private lastCompleteLines = new Map<number, ParsedInfo>();
  private options = new Map<string, string>();
  private computing = false;

  constructor(private readonly onComputingChange: (computing: boolean) => void = () => undefined) {}

  connected(send: (command: string) => void): void {
    this.send = send;
    this.options = new Map([
      ['Threads', '1'],
      ['Hash', '16'],
      ['MultiPV', '1'],
    ]);
    send('uci');
  }

  received(command: string): void {
    const parts = command.trim().split(/\s+/);
    if (parts[0] === 'uciok') {
      this.send?.('ucinewgame');
      this.send?.('isready');
    } else if (parts[0] === 'readyok') this.swapWork();
    else if (parts[0] === 'id' && parts[1] === 'name') this.engineName = parts.slice(2).join(' ');
    else if (parts[0] === 'bestmove') this.finish(parts[1]);
    else if (parts[0] === 'info' && this.work && !this.work.stopRequested) this.receiveInfo(command);
  }

  compute(nextWork?: PikafishWork): void {
    this.nextWork = nextWork;
    this.stop();
    this.swapWork();
  }

  isComputing(): boolean {
    return this.computing;
  }

  private receiveInfo(command: string): void {
    const work = this.work;
    if (!work) return;
    const line = parsePikafishInfo(command, work.fen);
    if (!line || (line.score.bound && line.multipv === 1)) return;

    if (line.multipv === 1) {
      if (line.depth < this.currentDepth) return;
      if (line.depth > this.currentDepth) {
        this.currentDepth = line.depth;
        this.lines.clear();
      }
    }
    if (line.depth !== this.currentDepth || line.multipv > work.multiPv) return;
    this.lines.set(line.multipv, line);

    if (this.lines.size === work.multiPv && this.lines.has(work.multiPv)) {
      this.lastCompleteLines = new Map(this.lines);
      work.emit(this.snapshot(), false);
    }
  }

  private snapshot(bestMove?: string): EngineAnalysis {
    const source =
      this.lines.size === this.work?.multiPv
        ? this.lines
        : this.lastCompleteLines.size
          ? this.lastCompleteLines
          : this.lines;
    const ordered = [...source.values()].sort((a, b) => a.multipv - b.multipv);
    const primary = ordered[0];
    if (!primary) throw new Error('Pikafish produced no principal variation');
    return {
      engine: this.engineName,
      bestMove,
      depth: primary.depth,
      nodes: primary.nodes,
      nps: primary.nps,
      timeMs: primary.timeMs,
      score: primary.score,
      lines: ordered,
    };
  }

  private finish(bestMove: string | undefined): void {
    const work = this.work;
    this.work = undefined;
    this.setComputing(false);
    if (work && !work.stopRequested && this.lines.size) {
      const move = bestMove && !['(none)', '0000'].includes(bestMove) ? engineMoveToUi(bestMove) : undefined;
      work.emit(this.snapshot(move), true);
    }
    this.swapWork();
  }

  private stop(): void {
    if (this.work && !this.work.stopRequested) {
      this.work.stopRequested = true;
      this.setComputing(false);
      this.send?.('stop');
    }
  }

  private swapWork(): void {
    if (!this.send || this.work) return;
    this.work = this.nextWork;
    this.nextWork = undefined;
    if (!this.work) return;

    this.setComputing(true);

    this.currentDepth = 0;
    this.lines.clear();
    this.lastCompleteLines.clear();
    this.setOption('Threads', this.work.threads);
    this.setOption('Hash', this.work.hashSize);
    this.setOption('MultiPV', Math.max(1, this.work.multiPv));
    this.send(`position fen ${this.work.fen}`);
    this.send(`go depth ${this.work.depth}`);
  }

  private setComputing(computing: boolean): void {
    if (this.computing === computing) return;
    this.computing = computing;
    this.onComputingChange(computing);
  }

  private setOption(name: string, value: string | number): void {
    const stringValue = String(value);
    if (this.send && this.options.get(name) !== stringValue) {
      this.send(`setoption name ${name} value ${stringValue}`);
      this.options.set(name, stringValue);
    }
  }
}

export function parsePikafishInfo(command: string, fen: string): ParsedInfo | undefined {
  const tokens = command.trim().split(/\s+/);
  if (tokens[0] !== 'info' || !tokens.includes('pv') || !tokens.includes('score')) return;

  const numberAfter = (name: string): number | undefined => {
    const index = tokens.indexOf(name);
    if (index < 0) return;
    const value = Number.parseInt(tokens[index + 1] ?? '', 10);
    return Number.isFinite(value) ? value : undefined;
  };
  const scoreIndex = tokens.indexOf('score');
  const scoreKind = tokens[scoreIndex + 1];
  const scoreValue = Number.parseInt(tokens[scoreIndex + 2] ?? '', 10);
  if (
    !['cp', 'mate'].includes(scoreKind) ||
    !Number.isFinite(scoreValue) ||
    (scoreKind === 'mate' && !scoreValue)
  )
    return;

  const redValue = fen.trim().split(/\s+/)[1] === 'b' ? -scoreValue : scoreValue;
  const score: EngineScore =
    scoreKind === 'mate' ? { mate: scoreValue, redMate: redValue } : { cp: scoreValue, redCp: redValue };
  if (tokens.includes('lowerbound')) score.bound = 'lower';
  else if (tokens.includes('upperbound')) score.bound = 'upper';

  const pvIndex = tokens.indexOf('pv');
  const pvMoves: string[] = [];
  for (const token of tokens.slice(pvIndex + 1)) {
    const move = engineMoveToUi(token);
    if (!move) break;
    pvMoves.push(move);
  }
  const depth = numberAfter('depth');
  const nodes = numberAfter('nodes');
  const timeMs = numberAfter('time');
  if (depth === undefined || nodes === undefined || timeMs === undefined || !pvMoves.length) return;
  return {
    multipv: numberAfter('multipv') ?? 1,
    depth,
    seldepth: numberAfter('seldepth') ?? depth,
    nodes,
    nps: numberAfter('nps') ?? 0,
    timeMs,
    score,
    pvMoves,
    // WXF is added asynchronously by the lightweight rules endpoint. Keep the
    // line hidden until then so transient UCI coordinates never flash in the UI.
    wxfMoves: [],
  };
}

export function engineMoveToUi(move: string): string | undefined {
  const match = /^([a-i])([0-9])([a-i])([0-9])$/i.exec(move);
  if (!match) return;
  return `${match[1].toLowerCase()}${Number(match[2]) + 1}${match[3].toLowerCase()}${Number(match[4]) + 1}`;
}

export function toLocalEval(analysis: EngineAnalysis, fen: string): LocalEval {
  return {
    bestmove: analysis.bestMove,
    fen,
    depth: analysis.depth,
    nodes: analysis.nodes,
    millis: analysis.timeMs,
    ...redEvaluation(analysis.score),
    pvs: analysis.lines.map(line => ({
      moves: line.pvMoves,
      depth: line.depth,
      ...redEvaluation(line.score),
    })),
  };
}

function redEvaluation(score: EngineScore): { cp?: number; mate?: number } {
  return {
    cp: score.redCp ?? score.cp,
    mate: score.redMate ?? score.mate,
  };
}
import type { LocalEval } from '../../tree/types';
