import type { Api } from 'chessgroundx/api';

import type { EngineAnalysis } from 'lib/ceval';
import { isTouchDevice } from 'lib/device';
import { licon } from 'lib/licon';
import { ShowResizeHandle } from 'lib/prefs';
import stepwiseScroll from 'lib/view/stepwiseScroll';

import { displayedEvaluation, evaluationShare, formatEvaluation, NEUTRAL_EVALUATION } from './evaluation';
import { makeXiangqiGround } from './index';
import { createMoveTreeFromUciMainline, type EngineScore, type XiangqiTreeNode } from './tree';

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

interface Elements {
  eval: HTMLElement;
  evalFill: HTMLElement;
  evalScore: HTMLElement;
  engineLines: HTMLElement;
  engineScore: HTMLElement;
  engineStatus: HTMLElement;
  cloudBadge: HTMLElement;
  moreLines: HTMLButtonElement;
  multiPv: HTMLInputElement;
}

export const MAX_PV_MOVES = 16;

export class AnalysisSuggestions {
  engineResult: EngineAnalysis | undefined;
  explorerResult: ExplorerResult | undefined;

  private play: ((moves: string[]) => void) | undefined;
  private fen: string;
  private previewGround: Api | undefined;
  private previewEnabled = true;
  private expanded = false;
  private lastEvaluation = NEUTRAL_EVALUATION;
  private updateArrows = (): void => undefined;
  private readonly elements: Elements;

  constructor(
    initialFen: string,
    private readonly orientation: () => 'white' | 'black',
  ) {
    this.fen = initialFen;
    this.elements = {
      eval: requiredElement('#xiangqi-eval'),
      evalFill: requiredElement('#xiangqi-eval-fill'),
      evalScore: requiredElement('#xiangqi-eval-score'),
      engineLines: requiredElement('#xiangqi-engine-lines'),
      engineScore: requiredElement('#xiangqi-engine-score'),
      engineStatus: requiredElement('#xiangqi-engine-status'),
      cloudBadge: requiredElement('#xiangqi-cloud-badge'),
      moreLines: requiredElement<HTMLButtonElement>('#xiangqi-more-lines'),
      multiPv: requiredElement<HTMLInputElement>('#xiangqi-engine-multipv'),
    };
    this.elements.engineLines.addEventListener('mouseleave', () => this.hidePreview());
    window.matchMedia('(max-width: 799px)').addEventListener('change', event => {
      if (event.matches) this.hidePreview();
    });
  }

  setArrowRenderer(update: () => void): void {
    this.updateArrows = update;
  }

  setPosition(fen: string, play: (moves: string[]) => void): void {
    this.engineResult = undefined;
    this.explorerResult = undefined;
    this.fen = fen;
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
    const count = Number(this.elements.multiPv.value);
    return Number.isFinite(count) ? Math.max(1, count) : 3;
  }

  showPlaceholders(count: number): void {
    this.hidePreview();
    this.elements.engineLines.replaceChildren(...Array.from({ length: count }, () => this.placeholderRow()));
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
    this.hidePreview();
    const previousRowCount = this.elements.engineLines.childElementCount;
    const cloudMoves = this.explorerResult?.available ? this.explorerResult.moves : [];
    const useCloud = cloudMoves.length > 0;
    this.elements.cloudBadge.hidden = !useCloud;
    const limit = this.expanded ? 12 : 3;
    const rows: HTMLElement[] = useCloud
      ? cloudMoves.slice(0, limit).map(entry =>
          this.suggestionRow({
            moves: entry.pvMoves?.length ? entry.pvMoves : [entry.move],
            notations: entry.wxfMoves?.length ? entry.wxfMoves : [entry.notation],
            value: formatExplorerScore(entry.score),
          }),
        )
      : (this.engineResult?.lines ?? [])
          .filter(line => line.wxfMoves[0])
          .map(line =>
            this.suggestionRow({
              moves: line.pvMoves,
              notations: line.wxfMoves,
              value: formatEvaluation(line.score),
            }),
          );
    const minimumRowCount =
      this.engineResult || this.explorerResult
        ? this.configuredRowCount()
        : Math.max(previousRowCount, this.configuredRowCount());
    while (rows.length < minimumRowCount) rows.push(this.placeholderRow());
    this.elements.engineLines.replaceChildren(...rows);
    this.elements.moreLines.hidden = !useCloud || cloudMoves.length <= 3;
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
    let node: XiangqiTreeNode | undefined;
    try {
      node = createMoveTreeFromUciMainline(this.fen, moves).root.children[0];
    } catch {
      return elements;
    }
    let beforeFen = this.fen;
    const length = Math.min(moves.length, notations.length, MAX_PV_MOVES);
    for (let index = 0; index < length && node; index += 1) {
      const prefix = pvMovePrefix(beforeFen, index);
      if (prefix) {
        const moveNumber = document.createElement('span');
        moveNumber.textContent = prefix;
        elements.push(moveNumber);
      }
      const move = document.createElement('span');
      move.className = 'pv-san';
      move.dataset.moveIndex = String(index);
      move.dataset.fen = node.state.fen;
      move.dataset.uci = moves[index];
      move.textContent = notations[index];
      elements.push(move);
      beforeFen = node.state.fen;
      node = node.children[0];
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
    this.previewGround = makeXiangqiGround(groundElement, {
      fen,
      lastMove: move,
      orientation: this.orientation(),
      coordinates: false,
      viewOnly: true,
      resizeHandle: ShowResizeHandle.Never,
      addDimensionsCssVarsTo: groundElement,
    });
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

function requiredElement<T extends HTMLElement = HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing Xiangqi analysis element: ${selector}`);
  return element;
}
