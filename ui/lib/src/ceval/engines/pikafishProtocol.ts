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

export interface PikafishHistory {
  ruleset?: string;
  initialFen: string;
  moves: readonly string[];
}

export interface PikafishOptions {
  threads: number;
  hashSize: number;
}

export interface PikafishWork {
  fen: string;
  history?: PikafishHistory;
  legalMoves?: readonly string[];
  search:
    | { depth: number }
    | { nodes: number }
    | {
        movetime: number;
        extension?: {
          // Additional search time after the initial budget. Only check
          // completion after the minimum; the maximum always stops the search.
          minMovetime: number;
          maxMovetime: number;
          needed: (analysis: EngineAnalysis) => boolean;
          complete: (analysis: EngineAnalysis) => boolean;
        };
      };
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
  private searchTimer?: ReturnType<typeof setTimeout>;
  private budgetStarted = false;
  private awaitingConfirmation = false;
  private finishRequested = false;
  private ready = false;
  private awaitingReady = false;
  private readonly startupOptions: PikafishOptions | undefined;

  constructor(
    private readonly onComputingChange: (computing: boolean) => void = () => undefined,
    private readonly onReady: () => void = () => undefined,
    startupOptions?: PikafishOptions,
  ) {
    this.startupOptions = startupOptions;
  }

  connected(send: (command: string) => void): void {
    this.send = send;
    this.ready = false;
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
      const options = this.startupOptions ?? this.nextWork;
      if (options) {
        this.setOption('Threads', options.threads);
        this.setOption('Hash', options.hashSize);
      }
      this.send?.('ucinewgame');
      this.awaitingReady = true;
      this.send?.('isready');
    } else if (parts[0] === 'readyok' && this.awaitingReady) {
      this.awaitingReady = false;
      this.ready = true;
      this.onReady();
      this.swapWork();
    } else if (parts[0] === 'id' && parts[1] === 'name') this.engineName = parts.slice(2).join(' ');
    else if (parts[0] === 'bestmove') this.finish(parts[1]);
    else if (parts[0] === 'info' && this.work && !this.work.stopRequested) this.receiveInfo(command);
  }

  compute(nextWork?: PikafishWork): void {
    // Reject malformed history before stopping or replacing an active search.
    nextWork?.history?.moves.forEach(uiMoveToEngine);
    nextWork?.legalMoves?.forEach(uiMoveToEngine);
    this.nextWork = nextWork;
    this.stop();
    this.swapWork();
  }

  isComputing(): boolean {
    return this.computing;
  }

  disconnected(): void {
    this.clearSearchTimer();
    this.send = undefined;
    this.work = this.nextWork = undefined;
    this.ready = this.awaitingReady = false;
    this.setComputing(false);
  }

  private receiveInfo(command: string): void {
    const work = this.work;
    if (!work) return;
    const search = work.search;
    // Start from native search time, not module loading, option changes, or
    // commands waiting in the UCI queue. An adaptive budget uses ONE continuous
    // search: never restart iterative deepening at the confirmation boundary.
    const elapsed = /\btime (\d+)/.exec(command);
    if ('movetime' in search && search.extension && !this.budgetStarted && elapsed) {
      this.budgetStarted = true;
      this.searchTimer = setTimeout(
        () => {
          if (this.work !== work || work.stopRequested) return;
          const extension = search.extension!;
          if (extension.needed(this.snapshot()))
            this.searchTimer = setTimeout(() => {
              if (this.work !== work || work.stopRequested) return;
              const remaining = extension.maxMovetime - extension.minMovetime;
              if (remaining > 0 && !extension.complete(this.snapshot())) {
                this.awaitingConfirmation = true;
                this.searchTimer = setTimeout(() => this.finishSearch(), remaining);
              } else this.finishSearch();
            }, extension.minMovetime);
          else this.finishSearch();
        },
        Math.max(0, search.movetime - Number(elapsed[1])),
      );
    }
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
      if (
        this.work === work &&
        !work.stopRequested &&
        this.awaitingConfirmation &&
        'movetime' in search &&
        search.extension?.complete(this.snapshot())
      )
        this.finishSearch();
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
    return {
      engine: this.engineName,
      bestMove,
      depth: primary?.depth ?? 0,
      nodes: primary?.nodes ?? 0,
      nps: primary?.nps ?? 0,
      timeMs: primary?.timeMs ?? 0,
      score: primary?.score ?? {},
      lines: ordered,
    };
  }

  private finish(bestMove: string | undefined): void {
    this.clearSearchTimer();
    const work = this.work;
    this.work = undefined;
    this.setComputing(false);
    if (work && !work.stopRequested) {
      const move = bestMove && !['(none)', '0000'].includes(bestMove) ? engineMoveToUi(bestMove) : undefined;
      // Completion without a usable PV is still completion. Consumers decide
      // whether the result qualifies; it must not masquerade as a timeout.
      work.emit(this.snapshot(move), true);
    }
    this.swapWork();
  }

  private stop(): void {
    this.clearSearchTimer();
    if (this.work && !this.work.stopRequested) {
      this.work.stopRequested = true;
      this.setComputing(false);
      if (!this.finishRequested) this.send?.('stop');
    }
  }

  private swapWork(): void {
    if (!this.send || !this.ready || this.work) return;
    this.work = this.nextWork;
    this.nextWork = undefined;
    if (!this.work) return;

    this.setComputing(true);

    this.currentDepth = 0;
    this.budgetStarted = false;
    this.awaitingConfirmation = false;
    this.finishRequested = false;
    this.lines.clear();
    this.lastCompleteLines.clear();
    this.setOption('Threads', this.work.threads);
    this.setOption('Hash', this.work.hashSize);
    this.setOption('MultiPV', Math.max(1, this.work.multiPv));
    const history = this.work.history;
    const moves = history?.moves.map(uiMoveToEngine);
    this.send(
      `position fen ${history?.initialFen ?? this.work.fen}${moves?.length ? ` moves ${moves.join(' ')}` : ''}`,
    );
    const { search } = this.work;
    const budget =
      'depth' in search
        ? `depth ${search.depth}`
        : 'nodes' in search
          ? `nodes ${search.nodes}`
          : search.extension
            ? 'infinite'
            : `movetime ${search.movetime}`;
    const allowed = this.work.legalMoves;
    if (allowed && !allowed.length) {
      const completed = this.work;
      this.work = undefined;
      this.setComputing(false);
      completed.emit(this.snapshot(), true);
      this.swapWork();
      return;
    }
    this.send(`go ${budget}${allowed ? ` searchmoves ${allowed.map(uiMoveToEngine).join(' ')}` : ''}`);
  }

  private clearSearchTimer(): void {
    if (this.searchTimer !== undefined) clearTimeout(this.searchTimer);
    this.searchTimer = undefined;
  }

  private finishSearch(): void {
    this.clearSearchTimer();
    this.awaitingConfirmation = false;
    if (this.work && !this.work.stopRequested && !this.finishRequested) {
      this.finishRequested = true;
      this.send?.('stop');
    }
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

function uiMoveToEngine(move: string): string {
  const match = /^([a-i])(10|[1-9])([a-i])(10|[1-9])$/.exec(move);
  if (!match) throw new Error(`Invalid Xiangqi history move: ${move}`);
  return `${match[1]}${Number(match[2]) - 1}${match[3]}${Number(match[4]) - 1}`;
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
