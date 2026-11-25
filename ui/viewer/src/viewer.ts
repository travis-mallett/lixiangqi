import {
  createBoard,
  boardPresentation,
  boardDefinition,
  type BoardView,
  type BoardServices,
  type BoardMark,
  type BoardPresentation,
} from '@lixiangqi/board';
import { attributesModule, classModule, init, type VNode } from 'snabbdom';

import { banqiRail } from 'lib/game/view/banqiRail';
import { capturedPieces, type CaptureLabels } from 'lib/game/view/captures';
import { licon } from 'lib/licon';
import { renderColumnTree, renderIndex, type ColumnTreeNode } from 'lib/tree/columnView';
import { hl, renderReplayControls } from 'lib/view';

import { lastNode, type ViewerNode } from './model';

export interface ViewerLabels {
  captures: CaptureLabels;
  first: string;
  previous: string;
  next: string;
  last: string;
  moves: string;
  moveAnnotations: string;
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
  presentation?: BoardPresentation;
  drawnMarks?: (node: ViewerNode) => readonly BoardMark[];
  onDraw?: (node: ViewerNode, marks: readonly BoardMark[]) => void;
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
  private captureNodes?: [HTMLElement | VNode, HTMLElement | VNode];

  constructor(
    readonly element: HTMLElement,
    private readonly options: ViewerOptions,
  ) {
    this.current =
      options.initialPly === 'last'
        ? lastNode(options.root)
        : this.nodeAtPly(options.initialPly ?? options.root.ply);
    element.replaceChildren();
    element.classList.add('xiangqi-viewer');

    const layout = makeElement('div');
    layout.className = 'xiangqi-viewer__layout';
    const board = makeElement('div');
    board.className = 'xiangqi-viewer__board';
    const definition = boardDefinition(this.current.position.board ?? 'xiangqi');
    const geometry = definition.geometry;
    element.style.setProperty(
      '--board-aspect-ratio',
      String(geometry.kind === 'graph' ? geometry.width / geometry.height : geometry.columns / geometry.rows),
    );
    const surface = makeElement('div');
    board.append(surface);
    const boardColumn = makeElement('div');
    boardColumn.className = 'xiangqi-viewer__board-column';
    if (definition.id === 'banqi') boardColumn.classList.add('banqi-frame');
    if (definition.id === 'banqi' || this.current.node?.state.variant === 'jieqi') {
      const top = makeElement('div');
      const bottom = makeElement('div');
      this.captureNodes = [top, bottom];
      boardColumn.append(top, board, bottom);
    } else boardColumn.append(board);
    const playback = makeElement('div');
    playback.className = 'xiangqi-viewer__playback';
    this.panel.className = 'xiangqi-viewer__panel';
    playback.append(this.panel);
    layout.append(boardColumn, playback);
    element.append(layout);

    /* A position without recorded moves is a diagram: it has nothing to replay. */
    const navigable = !!options.root.children.length;
    this.showMoves = navigable && options.showMoves !== false;
    this.showControls = navigable && options.showControls !== false;
    const annotated = hasComments(options.root);
    element.classList.toggle('xiangqi-viewer--solo', !this.showMoves && !this.showControls && !annotated);
    element.classList.toggle('xiangqi-viewer--annotated', annotated);
    if (this.showMoves || this.showControls) element.tabIndex = 0;
    this.moves.className = 'xiangqi-viewer__moves';
    this.moves.setAttribute('role', 'group');
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
      definition,
      position: this.current.position,
      presentation: options.presentation ?? {
        ...presentation,
        feedback: { ...presentation.feedback, audio: false },
      },
      interaction: { mode: 'display' },
      services: options.services,
    });
    if (options.onDraw)
      this.board.onDestroy(this.board.onMarksChange(marks => options.onDraw?.(this.current, marks)));
    element.addEventListener(
      'keydown',
      event => {
        if (
          (!this.showMoves && !this.showControls) ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey ||
          (event.target as HTMLElement).closest('select,input,textarea,button,a,[contenteditable]')
        )
          return;
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
    this.renderPosition(this.current);
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
    if (this.abort.signal.aborted || node === this.current) return;
    const previous = this.current;
    const direction = node.parent === previous ? 'forward' : previous.parent === node ? 'backward' : 'jump';
    this.current = node;
    this.board.display(node.position, {
      kind: direction,
      id: node.id,
      effects: direction === 'forward' ? node.effects : direction === 'backward' ? [] : undefined,
    });
    this.renderPosition(node);
  }

  private renderPosition(node: ViewerNode): void {
    this.board.setMarks(node.marks, 'annotation');
    if (this.options.drawnMarks) this.board.setMarks(this.options.drawnMarks(node));
    if (this.captureNodes) {
      const bottom = this.board.getPresentation().perspective === 'red' ? 'red' : 'black';
      const captures = node.node?.state.captures ?? [];
      this.captureNodes =
        node.position.board === 'banqi'
          ? [
              patch(this.captureNodes[0], banqiRail(node.fen, bottom, true, this.options.services.assetUrl)),
              patch(this.captureNodes[1], banqiRail(node.fen, bottom, false, this.options.services.assetUrl)),
            ]
          : [
              patch(
                this.captureNodes[0],
                capturedPieces(captures, bottom, node.ply, this.options.labels.captures),
              ),
              patch(
                this.captureNodes[1],
                capturedPieces(
                  captures,
                  bottom === 'red' ? 'black' : 'red',
                  node.ply,
                  this.options.labels.captures,
                ),
              ),
            ];
    }
    const comments = node.comments.join('\n\n');
    if (this.comments.textContent !== comments) this.comments.textContent = comments;
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
          const label = node.label || node.move || '';
          const annotation = this.options.labels.moveAnnotations;
          return hl(
            'move',
            {
              attrs: {
                role: 'button',
                tabindex: '0',
                'data-node': node.id,
                'aria-label': node.hasAnnotation ? `${label}, ${annotation}` : label,
                ...(node.id === current.id ? { 'aria-current': 'step' } : {}),
              },
              class: { active: node.id === current.id },
            },
            [
              context.withIndex && renderIndex(node.ply, true),
              hl('span.xiangqi-viewer__move-label', label),
              node.hasAnnotation &&
                hl('span.xiangqi-viewer__note', {
                  attrs: { 'data-icon': licon.BubbleSpeech, 'aria-hidden': 'true', title: annotation },
                }),
            ],
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
        labels: {
          first: this.options.labels.first,
          prev: this.options.labels.previous,
          next: this.options.labels.next,
          last: this.options.labels.last,
        },
        previousIcon: licon.JumpPrev,
        nextIcon: licon.JumpNext,
        onClick: action => this.navigate(action === 'prev' ? 'previous' : (action as ViewerAction)),
      }),
    );
  }

  destroy(): void {
    this.abort.abort();
    this.board.destroy();
    this.element.replaceChildren();
  }
}
