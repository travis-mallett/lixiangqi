import {
  createBoard,
  boardPresentation,
  standardXiangqi,
  type BoardView,
  type BoardServices,
} from '@lixiangqi/board';
import { attributesModule, classModule, init, type VNode } from 'snabbdom';

import { licon } from 'lib/licon';
import { renderColumnTree, renderIndex, type ColumnTreeNode } from 'lib/tree/columnView';
import { hl, renderReplayControls } from 'lib/view';

import { applyViewerAppearance } from './appearance';
import { lastNode, type ViewerNode } from './model';

export interface ViewerLabels {
  first: string;
  previous: string;
  next: string;
  last: string;
  moves: string;
  start: string;
  analysis: string;
}

export interface ViewerOptions {
  root: ViewerNode;
  services: BoardServices;
  labels: ViewerLabels;
  initialPly?: number | 'last';
  orientation?: 'red' | 'black';
  boardTheme?: string;
  pieceSet?: string;
  showMoves?: boolean;
  showControls?: boolean;
  onPosition?: (node: ViewerNode) => void;
}

type ViewerAction = 'first' | 'previous' | 'next' | 'last';

/* The column tree identifies a move by its own coordinate move; a viewer node keeps its
   full native path, so clicks find the exact node even when a move repeats in a branch. */
interface MoveNode extends ColumnTreeNode<MoveNode> {
  viewer: ViewerNode;
}

const hasComments = (node: ViewerNode): boolean => !!node.comments.length || node.children.some(hasComments);

const patch = init([attributesModule, classModule]);

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
  private readonly panel = makeElement('div');
  private readonly nodes = new Map<string, ViewerNode>();
  private readonly abort = new AbortController();
  private readonly showMoves: boolean;
  private readonly showControls: boolean;
  private movesVNode?: VNode;
  private controlsVNode?: VNode;

  constructor(
    readonly element: HTMLElement,
    private readonly options: ViewerOptions,
  ) {
    this.current = options.root;
    element.replaceChildren();
    element.classList.add('xiangqi-viewer');
    element.tabIndex = 0;

    const layout = makeElement('div');
    layout.className = 'xiangqi-viewer__layout';
    const board = makeElement('div');
    board.className = 'xiangqi-viewer__board';
    const surface = makeElement('div');
    board.append(surface);
    const playback = makeElement('div');
    playback.className = 'xiangqi-viewer__playback';
    this.panel.className = 'xiangqi-viewer__panel';
    playback.append(this.panel);
    layout.append(board, playback);
    element.append(layout);

    /* A position without recorded moves is a diagram: it has nothing to replay. */
    const navigable = !!options.root.children.length;
    this.showMoves = navigable && options.showMoves !== false;
    this.showControls = navigable && options.showControls !== false;
    if (!this.showMoves && !this.showControls && !hasComments(options.root))
      element.classList.add('xiangqi-viewer--solo');
    /* An annotated example keeps one stable place for its notes while navigating. */
    if (hasComments(options.root)) element.classList.add('xiangqi-viewer--annotated');
    this.moves.className = 'xiangqi-viewer__moves';
    this.moves.setAttribute('aria-label', options.labels.moves);
    if (this.showMoves) {
      this.panel.append(this.moves);
      this.moves.addEventListener(
        'click',
        event => {
          const node = this.moveFromEvent(event);
          if (node) this.go(node);
        },
        { signal: this.abort.signal },
      );
      this.moves.addEventListener(
        'keydown',
        event => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          const node = this.moveFromEvent(event);
          if (!node) return;
          event.preventDefault();
          this.go(node);
        },
        { signal: this.abort.signal },
      );
    }
    const feedback = makeElement('div');
    feedback.className = 'xiangqi-viewer__feedback';
    this.comments.className = 'xiangqi-viewer__comments';
    this.comments.setAttribute('aria-live', 'polite');
    feedback.append(this.comments);
    this.panel.append(feedback);

    const presentation = boardPresentation('replay', options.orientation === 'black' ? 'black' : 'red');
    this.board = createBoard(surface, {
      definition: standardXiangqi,
      position: this.current.position,
      presentation: { ...presentation, feedback: { ...presentation.feedback, audio: false } },
      interaction: { mode: 'display' },
      services: options.services,
    });
    element.addEventListener(
      'keydown',
      event => {
        if ((event.target as HTMLElement).matches('select,input,textarea,button')) return;
        const action = (
          {
            ArrowLeft: 'previous',
            ArrowRight: 'next',
            Home: 'first',
            End: 'last',
          } as Record<string, ViewerAction>
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

  navigate(action: ViewerAction): void {
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
    if (this.showMoves) this.renderMoves();
    this.renderControls();
    this.options.onPosition?.(node);
  }

  private moveFromEvent(event: Event): ViewerNode | undefined {
    const target =
      event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[data-node]') : null;
    return target?.dataset.node === undefined ? undefined : this.nodes.get(target.dataset.node);
  }

  /** The move list is the canonical replay tree view, shared with analysis and the wiki. */
  private renderMoves(): void {
    const current = this.current;
    this.nodes.clear();
    const build = (node: ViewerNode): MoveNode => {
      this.nodes.set(node.id, node);
      return {
        id: node.move ?? '',
        ply: node.ply,
        viewer: node,
        children: node.children.map(build),
      };
    };
    this.movesVNode = patch(
      this.movesVNode ?? this.moves.appendChild(document.createElement('div')),
      renderColumnTree({
        root: build(this.options.root),
        renderMove: (move, context) => {
          const node = move.viewer;
          return hl(
            'move',
            {
              attrs: {
                role: 'button',
                tabindex: '0',
                'data-node': node.id,
                'aria-label': node.label || node.move || '',
                ...(node.id === current.id ? { 'aria-current': 'step' } : {}),
              },
              class: { active: node.id === current.id },
            },
            [context.withIndex && renderIndex(node.ply, true), node.label || node.move || ''],
          );
        },
      }),
    );
    this.scrollToActive();
  }

  /** A bounded move list follows the current move without scrolling the hosting page. */
  private scrollToActive(): void {
    const active = this.moves.querySelector<HTMLElement>('move.active');
    if (!active || !this.moves.clientHeight) return;
    const top =
      active.getBoundingClientRect().top - this.moves.getBoundingClientRect().top + this.moves.scrollTop;
    const bottom = top + active.offsetHeight;
    if (top < this.moves.scrollTop) this.moves.scrollTop = top;
    else if (bottom > this.moves.scrollTop + this.moves.clientHeight)
      this.moves.scrollTop = bottom - this.moves.clientHeight;
  }

  private renderControls(): void {
    if (!this.showControls) return;
    const node = this.current;
    this.controlsVNode = patch(
      this.controlsVNode ?? this.panel.appendChild(document.createElement('div')),
      renderReplayControls({
        selector: 'div.xiangqi-viewer__controls',
        enabled: {
          first: !!node.parent,
          prev: !!node.parent,
          next: !!node.children.length,
          last: !!node.children.length,
        },
        previousIcon: licon.JumpPrev,
        nextIcon: licon.JumpNext,
        onClick: action => this.navigate(action === 'prev' ? 'previous' : (action as ViewerAction)),
      }),
    );
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
