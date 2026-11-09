import {
  animateXiangqi,
  animateXiangqiSlide,
  prepareXiangqiMutation,
  resetXiangqiMotion,
  syncXiangqiMotion,
  syncXiangqiShadowPosition,
} from '../motion';
import type { MotionHost, MotionPlan, Point } from '../motion/types';
import type {
  BoardDefinition,
  BoardPosition,
  BoardPresentation,
  BoardTransition,
  GraphGeometry,
} from '../types';
import { graphPoint } from './graphGeometry';

interface GraphState {
  position(): BoardPosition;
  presentation(): BoardPresentation;
  selected(): string | undefined;
  dragging(): boolean;
  reducedMotion(): boolean;
  inactivePieceLabel?: string;
}

/** Graph topology adapter: piece identity and geometry, with no animation choreography. */
export class GraphPieces implements MotionHost {
  private readonly nodes = new Map<string, HTMLElement>();
  private readonly fading = new Map<string, HTMLElement>();
  private plan?: MotionPlan;
  private bounds = { width: 0, height: 0 };

  constructor(
    readonly surface: HTMLElement,
    private readonly definition: BoardDefinition<GraphGeometry>,
    private readonly state: GraphState,
  ) {}

  get enabled(): boolean {
    return this.duration > 0 && !this.state.reducedMotion();
  }
  get duration(): number {
    return this.state.presentation().motion.duration;
  }
  get selected(): string | undefined {
    return this.state.selected();
  }
  get dragging(): boolean {
    return this.state.dragging();
  }
  get highlight(): boolean {
    return this.state.presentation().highlight;
  }
  get lastMove(): readonly string[] | undefined {
    return this.state.position().lastMove;
  }
  get checked(): readonly string[] | undefined {
    return this.highlight ? this.state.position().checked : undefined;
  }
  get animating(): boolean {
    return !!this.plan;
  }
  size(): Point {
    const geometry = this.definition.geometry,
      bounds = this.bounds;
    return [
      (bounds.width * geometry.pieceSize) / geometry.width,
      (bounds.height * geometry.pieceSize) / geometry.height,
    ];
  }
  point(location: string): Point {
    const geometry = this.definition.geometry,
      bounds = this.bounds;
    const [x, y] = graphPoint(geometry, location, this.state.presentation().perspective),
      size = this.size();
    return [
      (x * bounds.width) / geometry.width - size[0] / 2,
      (y * bounds.height) / geometry.height - size[1] / 2,
    ];
  }
  key(root: HTMLElement): string {
    return root.dataset.pieceLocation!;
  }
  concealed(root: HTMLElement): boolean {
    return root.dataset.concealed === 'true';
  }
  findPiece(location: string, fading = false): HTMLElement | undefined {
    return (fading ? this.fading : this.nodes).get(location);
  }
  adopt(root: HTMLElement, location: string): void {
    const captured = this.nodes.get(location);
    if (captured && captured !== root) {
      captured.classList.add('fading');
      this.fading.set(location, captured);
    }
    this.nodes.delete(this.key(root));
    this.nodes.set(location, root);
    root.dataset.pieceLocation = location;
    this.face(root, location);
  }
  start(plan: MotionPlan): void {
    this.plan = plan;
  }
  stop(): void {
    this.plan = undefined;
  }

  /** Called before replacing the position so interrupted travel settles on its current position. */
  prepare(): void {
    prepareXiangqiMutation(this);
  }
  reset(): void {
    resetXiangqiMotion(this);
  }

  display(previous: BoardPosition, transition: BoardTransition): void {
    const current = this.state.position();
    const backward = transition.kind === 'backward';
    const move = backward ? previous.lastMove : current.lastMove;
    const from = move?.[backward ? 1 : 0],
      to = move?.[backward ? 0 : 1];
    if (
      this.enabled &&
      ['forward', 'backward'].includes(transition.kind) &&
      from &&
      to &&
      previous.pieces.has(from) &&
      current.pieces.has(to) &&
      (backward || !current.pieces.has(from))
    ) {
      const plan: MotionPlan = {
        moves: new Map([[to, from]]),
        captured: new Set(!backward && previous.pieces.has(to) ? [to] : []),
      };
      (backward ? animateXiangqiSlide : animateXiangqi)(this, plan);
    } else this.redraw();
  }

  redraw(): void {
    // Measure once before writing piece styles; do not force layout for each piece.
    this.bounds = this.surface.getBoundingClientRect();
    const position = this.state.position();
    for (const [to, from] of this.plan?.moves ?? []) {
      const root = this.nodes.get(from);
      if (root && from !== to) this.adopt(root, to);
    }
    if (!this.plan) {
      for (const root of this.fading.values()) root.remove();
      this.fading.clear();
    }
    for (const [location, root] of this.nodes) {
      if (!position.pieces.has(location)) {
        root.remove();
        this.nodes.delete(location);
      }
    }
    for (const location of position.pieces.keys()) {
      let root = this.nodes.get(location);
      if (!root) {
        root = document.createElement('piece');
        root.dataset.pieceLocation = location;
        root.setAttribute('aria-hidden', 'true');
        const ownership = document.createElement('span');
        ownership.className = 'graph-board__ownership';
        root.append(ownership);
        this.nodes.set(location, root);
        this.surface.append(root);
      }
      this.face(root, location);
      const point = this.point(this.plan?.moves.get(location) ?? location);
      root.style.transform = `translate(${point[0]}px,${point[1]}px)`;
    }
    syncXiangqiMotion(this);
  }

  private face(root: HTMLElement, location: string): void {
    const piece = this.state.position().pieces.get(location)!;
    const family = this.definition.pieceFamily ?? this.definition.id;
    root.style.setProperty(
      '--xiangqi-piece-image',
      piece.face === 'up'
        ? `var(---${family}-${piece.participant}-${piece.role})`
        : `var(--board-piece-back-${piece.participant ?? this.definition.participants[0]})`,
    );
    root.style.setProperty(
      '--board-face-rotation',
      `${this.definition.pieceRotation ? this.definition.pieceRotation(location, piece) + this.definition.geometry.rotations[this.state.presentation().perspective] : 0}deg`,
    );
    root.dataset.concealed = String(piece.face === 'down');
    root.classList.toggle('fallen-general', piece.face === 'up' && !!piece.inactive);
    if (piece.face === 'up' && piece.inactive && this.state.inactivePieceLabel)
      root.title = this.state.inactivePieceLabel;
    else root.removeAttribute('title');
    const controlled =
      piece.face === 'up' && piece.controller !== undefined && piece.controller !== piece.participant;
    root.classList.toggle('controlled', controlled);
    if (controlled) root.dataset.controller = piece.controller ?? 'neutral';
    else delete root.dataset.controller;
  }

  drag(location: string, dx: number, dy: number): void {
    const root = this.nodes.get(location);
    if (!root) return;
    const point = this.point(location);
    root.style.transform = `translate3d(${point[0] + dx}px,${point[1] + dy}px,0)`;
    root.classList.add('dragging');
    syncXiangqiShadowPosition(root);
  }
  release(location: string): void {
    this.nodes.get(location)?.classList.remove('dragging');
    this.redraw();
  }
  destroy(): void {
    this.reset();
    for (const root of [...this.nodes.values(), ...this.fading.values()]) root.remove();
    this.nodes.clear();
    this.fading.clear();
  }
}
