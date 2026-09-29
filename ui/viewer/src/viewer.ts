import {
  createBoard,
  boardPresentation,
  standardXiangqi,
  boardAssets,
  type BoardView,
  type BoardServices,
} from '@lixiangqi/board';

import { applyViewerAppearance } from './appearance';
import { lastNode, type ViewerNode } from './model';

export interface ViewerLabels {
  first: string;
  previous: string;
  next: string;
  last: string;
  flip: string;
  board: string;
  pieces: string;
  sound: string;
  moves: string;
  start: string;
  analysis: string;
}

export interface ViewerOptions {
  root: ViewerNode;
  services: BoardServices;
  labels: ViewerLabels;
  initialPly?: number | 'last';
  orientation?: 'white' | 'black' | 'red';
  boardTheme?: string;
  pieceSet?: string;
  showMoves?: boolean;
  showControls?: boolean;
  onPosition?: (node: ViewerNode) => void;
}

const makeElement = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const result = document.createElement(tag);
  if (text) result.textContent = text;
  return result;
};

/** Replay UI owns navigation; the board owns geometry, input, motion, and feedback. */
export class GameViewer {
  readonly board: BoardView;
  private current: ViewerNode;
  private readonly moves = makeElement('div');
  private readonly comments = makeElement('div');
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private readonly abort = new AbortController();

  constructor(
    readonly element: HTMLElement,
    private readonly options: ViewerOptions,
  ) {
    this.current = options.root;
    element.replaceChildren();
    element.classList.add('xiangqi-viewer');
    element.tabIndex = 0;
    const wrap = document.createElement('div');
    wrap.className = 'xiangqi-viewer__board';
    const surface = document.createElement('div');
    wrap.append(surface);
    this.moves.className = 'xiangqi-viewer__moves';
    this.moves.setAttribute('aria-label', options.labels.moves);
    this.comments.className = 'xiangqi-viewer__comments';
    this.comments.setAttribute('aria-live', 'polite');
    element.append(wrap, this.comments);
    if (options.showMoves !== false) element.append(this.moves);
    const presentation = boardPresentation('replay', options.orientation === 'black' ? 'black' : 'red');
    this.board = createBoard(surface, {
      definition: standardXiangqi,
      position: this.current.position,
      presentation: { ...presentation, feedback: { ...presentation.feedback, audio: false } },
      interaction: { mode: 'display' },
      services: options.services,
    });
    if (options.showControls !== false) this.controls();
    this.renderMoves(options.root);
    element.addEventListener(
      'keydown',
      event => {
        if ((event.target as HTMLElement).matches('select,input,textarea,button')) return;
        const action = (
          { ArrowLeft: 'previous', ArrowRight: 'next', Home: 'first', End: 'last' } as Record<string, string>
        )[event.key];
        if (action) {
          event.preventDefault();
          this.navigate(action);
        }
      },
      { signal: this.abort.signal },
    );
    const target =
      options.initialPly === 'last'
        ? lastNode(options.root)
        : this.nodeAtPly(options.initialPly ?? options.root.ply);
    this.go(target);
    void this.appearance().catch(error => {
      if (!this.abort.signal.aborted) this.comments.textContent = String(error);
    });
  }

  private nodeAtPly(ply: number): ViewerNode {
    let node = this.options.root;
    while (node.children[0] && node.ply < ply) node = node.children[0];
    return node;
  }

  navigate(action: string): void {
    const target =
      action === 'first'
        ? this.options.root
        : action === 'previous'
          ? this.current.parent
          : action === 'next'
            ? this.current.children[0]
            : action === 'last'
              ? lastNode(this.current)
              : undefined;
    if (target) this.go(target);
  }

  position(): ViewerNode {
    return this.current;
  }

  go(node: ViewerNode): void {
    if (this.abort.signal.aborted) return;
    if (
      node.parent &&
      ![...this.moves.querySelectorAll<HTMLButtonElement>('button')].some(
        button => button.dataset.node === node.id,
      )
    ) {
      this.moves.replaceChildren();
      this.renderMoves(this.options.root);
    }
    const previous = this.current;
    const direction = node.parent === previous ? 'forward' : previous.parent === node ? 'backward' : 'jump';
    this.current = node;
    this.board.display(node.position, {
      kind: direction,
      id: node.id,
      effects: direction === 'forward' ? node.effects : direction === 'backward' ? [] : undefined,
    });
    this.board.setMarks(node.marks, 'annotation');
    this.comments.textContent = node.comments.join('\n\n');
    for (const button of this.moves.querySelectorAll<HTMLButtonElement>('button')) {
      const active = button.dataset.node === node.id;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    }
    for (const [action, button] of this.buttons)
      button.disabled = action === 'first' || action === 'previous' ? !node.parent : !node.children.length;
    this.options.onPosition?.(node);
  }

  private renderMoves(root: ViewerNode): void {
    const walk = (parent: ViewerNode, container: HTMLElement) => {
      for (const [index, node] of parent.children.entries()) {
        const line = index ? makeElement('span') : container;
        if (index) {
          line.className = 'xiangqi-viewer__variation';
          container.append(line);
        }
        const button = makeElement(
          'button',
          `${Math.ceil(node.ply / 2)}${node.ply % 2 ? '.' : '…'} ${node.label || node.move}`,
        );
        button.type = 'button';
        button.dataset.node = node.id;
        button.addEventListener('click', () => this.go(node), { signal: this.abort.signal });
        line.append(button);
        walk(node, line);
      }
    };
    walk(root, this.moves);
  }

  private controls(): void {
    const controls = makeElement('div');
    controls.className = 'xiangqi-viewer__controls';
    for (const [action, symbol] of [
      ['first', '⏮'],
      ['previous', '◀'],
      ['next', '▶'],
      ['last', '⏭'],
    ] as const) {
      const button = makeElement('button', symbol);
      button.type = 'button';
      button.title = this.options.labels[action];
      button.setAttribute('aria-label', button.title);
      button.addEventListener('click', () => this.navigate(action), { signal: this.abort.signal });
      this.buttons.set(action, button);
      controls.append(button);
    }
    const flip = makeElement('button', this.options.labels.flip);
    flip.type = 'button';
    flip.addEventListener(
      'click',
      () =>
        this.board.setPresentation({
          ...this.board.getPresentation(),
          perspective: this.board.getPresentation().perspective === 'red' ? 'black' : 'red',
        }),
      { signal: this.abort.signal },
    );
    controls.append(flip);
    if (this.options.services.sound) {
      const sound = makeElement('button', this.options.labels.sound);
      sound.type = 'button';
      sound.setAttribute('aria-pressed', 'false');
      sound.addEventListener(
        'click',
        () => {
          const settings = this.board.getPresentation();
          this.board.setPresentation({
            ...settings,
            feedback: { ...settings.feedback, audio: !settings.feedback.audio },
          });
          sound.setAttribute('aria-pressed', String(!settings.feedback.audio));
        },
        { signal: this.abort.signal },
      );
      controls.append(sound);
    }
    const themes = makeElement('details'),
      summary = makeElement('summary', this.options.labels.board);
    themes.append(summary);
    for (const [label, items, key] of [
      [this.options.labels.board, boardAssets.boards, 'boardTheme'],
      [this.options.labels.pieces, boardAssets.pieceSets, 'pieceSet'],
    ] as const) {
      const select = makeElement('select');
      select.setAttribute('aria-label', label);
      for (const item of items) {
        const option = makeElement('option', item.name);
        option.value = item.key;
        select.append(option);
      }
      select.value =
        this.options[key] || (key === 'boardTheme' ? boardAssets.defaultBoard : boardAssets.defaultPieces);
      select.addEventListener(
        'change',
        () => {
          this.options[key] = select.value;
          void this.appearance().catch(error => {
            if (!this.abort.signal.aborted) this.comments.textContent = String(error);
          });
        },
        { signal: this.abort.signal },
      );
      themes.append(select);
    }
    controls.append(themes);
    this.element.append(controls);
  }

  private appearance(): Promise<void> {
    return applyViewerAppearance(
      this.element,
      this.options.services.assetUrl,
      this.options.boardTheme,
      this.options.pieceSet,
      this.abort.signal,
    );
  }

  destroy(): void {
    this.abort.abort();
    this.board.destroy();
    this.element.replaceChildren();
  }
}
