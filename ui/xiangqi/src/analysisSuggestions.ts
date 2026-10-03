import { boardPresentation, type BoardView } from '@lixiangqi/board';

import { createXiangqiBoard, xiangqiPosition } from 'lib/board';
import type { EngineAnalysis } from 'lib/ceval';
import { isTouchDevice } from 'lib/device';
import {
  replayXiangqiVariation,
  rulesPositionKey,
  type RulesPosition,
  type VariationMove,
} from 'lib/game/xiangqiNotation';
import { licon } from 'lib/licon';
import type { EngineScore } from 'lib/tree/native';
import stepwiseScroll from 'lib/view/stepwiseScroll';

import { displayedEvaluation, evaluationShare, formatEvaluation, NEUTRAL_EVALUATION } from './evaluation';

export interface ExplorerMove {
  move: string;
  notation: string;
  score?: number;
  rank?: number;
  winrate?: number;
  note: string;
  pvMoves: string[];
  wxfMoves: string[];
}

export interface ExplorerResult {
  available: boolean;
  source: string;
  moves: ExplorerMove[];
  error?: string;
}

export interface AnalysisSuggestionElements {
  eval: HTMLElement;
  evalFill: HTMLElement;
  evalScore: HTMLElement;
  engineLines: HTMLElement;
  engineScore: HTMLElement;
  engineStatus: HTMLElement;
  cloudBadge: HTMLElement;
  moreLines: HTMLButtonElement;
}

export const MAX_PV_MOVES = 16;

export class AnalysisSuggestions {
  engineResult: EngineAnalysis | undefined;
  explorerResult: ExplorerResult | undefined;

  private play: ((moves: string[]) => void) | undefined;
  private fen: string;
  private position: RulesPosition;
  private readonly variations = new Map<string, VariationMove[]>();
  private readonly pending = new Map<string, string[]>();
  private readonly requests = new Set<string>();
  private timer?: ReturnType<typeof setTimeout>;
  private previewGround: BoardView | undefined;
  private previewEnabled = true;
  private expanded = false;
  private lastEvaluation = NEUTRAL_EVALUATION;
  private updateArrows = (): void => undefined;
  private readonly lifetime = new window.AbortController();

  constructor(
    initialFen: string,
    private readonly orientation: () => 'red' | 'black',
    private readonly configuredMultiPv: () => number,
    private readonly elements: AnalysisSuggestionElements,
  ) {
    this.fen = initialFen;
    this.position = { initialFen, moves: [], ruleset: 'unrestricted-v1' };
    this.elements.engineLines.addEventListener('mouseleave', () => this.hidePreview(), {
      signal: this.lifetime.signal,
    });
    window.matchMedia('(max-width: 799px)').addEventListener(
      'change',
      event => {
        if (event.matches) this.hidePreview();
        this.render();
      },
      { signal: this.lifetime.signal },
    );
  }

  destroy(): void {
    this.lifetime.abort();
    clearTimeout(this.timer);
    this.hidePreview();
  }

  setArrowRenderer(update: () => void): void {
    this.updateArrows = update;
  }

  setPosition(fen: string, position: RulesPosition, play: (moves: string[]) => void): void {
    this.engineResult = undefined;
    this.explorerResult = undefined;
    this.fen = fen;
    this.position = position;
    this.pending.clear();
    clearTimeout(this.timer);
    this.play = play;
    this.expanded = false;
    this.render();
  }

  clearResults(): void {
    this.engineResult = undefined;
    this.explorerResult = undefined;
  }

  resetEvaluation(): void {
    this.lastEvaluation = NEUTRAL_EVALUATION;
  }

  setEvaluation(score?: EngineScore): void {
    this.elements.eval.classList.toggle('flipped', this.orientation() === 'black');
    this.lastEvaluation = displayedEvaluation(score, this.lastEvaluation);
    const redShare = evaluationShare(this.lastEvaluation);
    this.elements.evalFill.style.setProperty('--xiangqi-eval-share', `${redShare}%`);
    this.elements.eval.setAttribute('aria-valuenow', redShare.toFixed(1));
    this.elements.engineScore.textContent = formatEvaluation(this.lastEvaluation);
    this.elements.evalScore.textContent = formatEvaluation(this.lastEvaluation);
  }

  renderEngine(result: EngineAnalysis, play: (moves: string[]) => void): void {
    this.elements.engineStatus.classList.remove('error');
    this.elements.engineStatus.textContent = `Depth ${result.depth} · ${formatNodes(result.nodes)} nodes`;
    this.setEvaluation(result.score);
    this.engineResult = result;
    this.play = play;
    this.render();
  }

  renderExplorer(result: ExplorerResult, play: (moves: string[]) => void): void {
    this.explorerResult = result;
    this.play = play;
    this.render();
  }

  configuredRowCount(): number {
    return this.configuredMultiPv();
  }

  showPlaceholders(): void {
    this.hidePreview();
    const rowCount = this.configuredRowCount();
    this.elements.engineLines.replaceChildren(
      ...Array.from({ length: rowCount }, () => this.placeholderRow()),
    );
  }

  setPreviewEnabled(enabled: boolean): void {
    this.previewEnabled = enabled;
    if (!enabled) this.hidePreview();
  }

  toggleExpanded(): void {
    this.expanded = !this.expanded;
    this.render();
  }

  private render(): void {
    if (this.lifetime.signal.aborted) return;
    this.hidePreview();
    const cloudMoves = this.explorerResult?.available ? this.explorerResult.moves : [];
    const useCloud = cloudMoves.length > 0;
    this.elements.cloudBadge.hidden = !useCloud;
    const configuredRowCount = this.configuredRowCount();
    const limit = this.expanded && !isMobileAnalysisLayout() ? 12 : configuredRowCount;
    const rows: HTMLElement[] = useCloud
      ? cloudMoves.slice(0, limit).map(entry =>
          this.suggestionRow({
            moves: entry.pvMoves?.length ? entry.pvMoves : [entry.move],
            notations: entry.wxfMoves?.length ? entry.wxfMoves : [entry.notation],
            value: formatExplorerScore(entry.score),
          }),
        )
      : (this.engineResult?.lines ?? [])
          .filter(line => line.pvMoves[0])
          .slice(0, configuredRowCount)
          .map(line =>
            this.suggestionRow({
              moves: line.pvMoves,
              notations: line.wxfMoves.length ? line.wxfMoves : line.pvMoves,
              value: formatEvaluation(line.score),
            }),
          );
    while (rows.length < configuredRowCount) rows.push(this.placeholderRow());
    this.elements.engineLines.replaceChildren(...rows);
    this.elements.moreLines.hidden =
      isMobileAnalysisLayout() || !useCloud || cloudMoves.length <= configuredRowCount;
    this.elements.moreLines.setAttribute('aria-expanded', String(this.expanded));
    const moreLabel = this.expanded ? 'Show fewer cloud moves' : 'Show more cloud moves';
    this.elements.moreLines.dataset.icon = this.expanded ? licon.UpTriangle : licon.DownTriangle;
    this.elements.moreLines.title = moreLabel;
    this.elements.moreLines.setAttribute('aria-label', moreLabel);
    this.updateArrows();
  }

  private placeholderRow(): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'pv pv--nowrap placeholder';
    row.setAttribute('aria-hidden', 'true');
    return row;
  }

  private suggestionRow(entry: { moves: string[]; notations: string[]; value: string }): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'pv pv--nowrap';
    if (entry.moves[0]) row.dataset.uci = entry.moves[0];

    const wrapToggle = document.createElement('span');
    wrapToggle.className = 'pv-wrap-toggle';
    wrapToggle.setAttribute('aria-label', 'Toggle line wrapping');
    for (const eventName of ['touchstart', 'mousedown'] as const)
      wrapToggle.addEventListener(eventName, event => {
        event.stopPropagation();
        event.preventDefault();
        row.classList.toggle('pv--nowrap');
      });

    const value = document.createElement('strong');
    value.className = 'xiangqi-engine__score';
    value.textContent = entry.value;
    row.append(wrapToggle, value, ...this.renderPvMoves(entry.moves, entry.notations));

    let pvIndex: number | null = null;
    const showIndex = (index: number): void => {
      if (!this.previewEnabled) return;
      const move = row.querySelector<HTMLElement>(`.pv-san[data-move-index="${index}"]`);
      if (!move?.dataset.fen || !move.dataset.uci) return;
      pvIndex = index;
      this.showPreview(move.dataset.fen, move.dataset.uci);
    };
    row.addEventListener('mouseover', event => {
      const move = (event.target as HTMLElement).closest<HTMLElement>('.pv-san');
      if (move?.dataset.moveIndex !== undefined) showIndex(Number(move.dataset.moveIndex));
    });
    const scrollPreview = stepwiseScroll(
      event => {
        if (pvIndex === null) return;
        if (event.deltaY < 0 && pvIndex > 0) pvIndex -= 1;
        else if (
          event.deltaY > 0 &&
          pvIndex < Math.min(entry.moves.length, entry.notations.length, MAX_PV_MOVES) - 1
        )
          pvIndex += 1;
        showIndex(pvIndex);
      },
      () => pvIndex === null,
      true,
    );
    row.addEventListener('wheel', event => {
      if (this.previewEnabled) scrollPreview(event);
    });
    row.addEventListener('pointerdown', event => {
      if ((event.target as HTMLElement).closest('.pv-wrap-toggle')) return;
      if (isTouchDevice()) {
        const moveIndex = (event.target as HTMLElement).dataset.moveIndex;
        pvIndex = moveIndex === undefined ? null : Number(moveIndex);
      }
      const lastIndex = pvIndex ?? 0;
      if (entry.moves.length > lastIndex) {
        this.play?.(entry.moves.slice(0, lastIndex + 1));
        this.hidePreview();
        event.preventDefault();
      }
    });
    return row;
  }

  private renderPvMoves(moves: string[], notations: string[]): HTMLElement[] {
    const elements: HTMLElement[] = [];
    const clipped = moves.slice(0, MAX_PV_MOVES);
    const key = JSON.stringify([this.position, clipped]);
    const positions = this.variations.get(key);
    if (!positions && !this.requests.has(key)) {
      this.pending.set(key, clipped);
      clearTimeout(this.timer);
      const positionKey = rulesPositionKey(this.position);
      const context = this.position;
      this.timer = setTimeout(() => {
        const wanted = [...this.pending];
        this.pending.clear();
        for (const [requestKey, variation] of wanted.slice(-12)) {
          this.requests.add(requestKey);
          void replayXiangqiVariation(context.initialFen, context.moves, context.ruleset, variation)
            .then(result => {
              if (this.lifetime.signal.aborted) return;
              this.variations.set(requestKey, result.moves);
              while (this.variations.size > 64) this.variations.delete(this.variations.keys().next().value!);
              if (rulesPositionKey(this.position) === positionKey) this.render();
            })
            .catch(error => {
              if (this.lifetime.signal.aborted) return;
              if (rulesPositionKey(this.position) === positionKey) {
                this.elements.engineStatus.textContent = error.message;
                this.elements.engineStatus.classList.add('error');
              }
            })
            .finally(() => this.requests.delete(requestKey));
        }
      }, 180);
    }
    let beforeFen = this.fen;
    const resolvedNotations = positions?.map(move => move.notation) ?? notations;
    const length = Math.min(moves.length, resolvedNotations.length, MAX_PV_MOVES);
    for (let index = 0; index < length; index += 1) {
      const prefix = pvMovePrefix(beforeFen, index);
      if (prefix) {
        const moveNumber = document.createElement('span');
        moveNumber.textContent = prefix;
        elements.push(moveNumber);
      }
      const move = document.createElement('span');
      move.className = 'pv-san';
      move.dataset.moveIndex = String(index);
      if (positions?.[index]) move.dataset.fen = positions[index].state.fen;
      move.dataset.uci = moves[index];
      move.textContent = resolvedNotations[index];
      elements.push(move);
      if (positions?.[index]) beforeFen = positions[index].state.fen;
    }
    return elements;
  }

  private showPreview(fen: string, move: string): void {
    if (!this.previewEnabled || isMobileAnalysisLayout()) return;
    this.hidePreview();
    const board = document.createElement('div');
    board.className = 'pv-board';
    const boardFrame = document.createElement('div');
    boardFrame.className = 'pv-board-square';
    const groundElement = document.createElement('div');
    groundElement.className = 'cg-wrap is2d xiangqi9x10';
    boardFrame.append(groundElement);
    board.append(boardFrame);
    this.elements.engineLines.append(board);
    this.previewGround = createXiangqiBoard(
      groundElement,
      xiangqiPosition(fen, move),
      boardPresentation('preview', this.orientation() === 'red' ? 'red' : 'black'),
    );
  }

  private hidePreview(): void {
    this.previewGround?.destroy();
    this.previewGround = undefined;
    this.elements.engineLines.querySelector(':scope > .pv-board')?.remove();
  }
}

function isMobileAnalysisLayout(): boolean {
  return window.matchMedia('(max-width: 799px)').matches;
}

function pvMovePrefix(fen: string, index: number): string | undefined {
  const fields = fen.trim().split(/\s+/);
  const fullmove = Math.max(1, Number.parseInt(fields[5] || '1', 10) || 1);
  if (fields[1] === 'w') return `${fullmove}.`;
  return index === 0 ? `${fullmove}...` : undefined;
}

function formatExplorerScore(score?: number): string {
  if (score === undefined) return '—';
  const pawns = score / 100;
  return `${pawns >= 0 ? '+' : '−'}${Math.abs(pawns).toFixed(2)}`;
}

function formatNodes(nodes: number): string {
  return nodes >= 1_000_000
    ? `${(nodes / 1_000_000).toFixed(1)}M`
    : nodes >= 1_000
      ? `${Math.round(nodes / 1_000)}k`
      : String(nodes);
}
