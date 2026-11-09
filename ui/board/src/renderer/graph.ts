import type { BoardView } from '../board';
import { BoardFeedback } from '../feedback';
import type {
  BoardDefinition,
  BoardInteraction,
  BoardMark,
  BoardOptions,
  BoardPosition,
  BoardPresentation,
  BoardTransition,
  GraphGeometry,
  Location,
  VisiblePiece,
} from '../types';
import { annotationBrushes, renderAnnotation } from './annotations';
import { renderGraphCoordinates } from './graphCoordinates';
import { graphPoint, validateGraphGeometry } from './graphGeometry';
import { GraphPieces } from './graphPieces';

const svgNamespace = 'http://www.w3.org/2000/svg';

/** Explicit-location renderer. The controller owns move legality and all game state. */
export class GraphBoardView implements BoardView {
  private readonly geometry: GraphGeometry;
  private readonly feedback: BoardFeedback;
  private readonly pieces: GraphPieces;
  private displayedPosition?: string;
  private readonly surface = document.createElement('div');
  private readonly artwork = document.createElement('div');
  private readonly marks = document.createElementNS(svgNamespace, 'svg');
  private readonly coordinates = document.createElementNS(svgNamespace, 'svg');
  private coordinatePerspective?: string;
  private readonly locations = new Map<Location, HTMLButtonElement>();
  private readonly cleanups: Array<() => void> = [];
  private readonly markListeners = new Set<(marks: readonly BoardMark[]) => void>();
  private readonly markLayers = new Map<string, readonly BoardMark[]>();
  private current: BoardPosition;
  private presentation: BoardPresentation;
  private interaction: BoardInteraction;
  private selected?: Location;
  private premove?: readonly [Location, Location];
  private pointer?: { id: number; from: Location; x: number; y: number; drawing: boolean; moved: boolean };
  private destroyed = false;

  constructor(
    readonly element: HTMLElement,
    private readonly options: BoardOptions,
  ) {
    if (options.definition.geometry.kind !== 'graph') throw new Error('Expected graph geometry');
    this.geometry = options.definition.geometry;
    validateGraphGeometry(this.geometry, options.definition.participants);
    this.current = options.position;
    this.presentation = options.presentation;
    this.interaction = options.interaction;
    this.feedback = new BoardFeedback(this.surface, options.services);
    this.feedback.prepare(options.presentation);
    element.classList.add('lixiangqi-board', 'graph-board');
    element.dataset.boardDefinition = options.definition.id;
    element.style.setProperty('--board-aspect-ratio', String(this.geometry.width / this.geometry.height));
    element.style.setProperty('--board-image', `var(---board-image-${this.geometry.id})`);
    element.style.setProperty(
      '--graph-piece-width',
      `${(100 * this.geometry.pieceSize) / this.geometry.width}%`,
    );
    element.style.setProperty(
      '--graph-piece-height',
      `${(100 * this.geometry.pieceSize) / this.geometry.height}%`,
    );
    this.surface.className = 'graph-board__surface board-surface';
    element.classList.toggle('manipulable', this.interaction.mode !== 'display');
    element.style.setProperty(
      '--board-cell-size',
      `calc(100cqw * ${this.geometry.pieceSize / this.geometry.width})`,
    );
    this.artwork.className = 'graph-board__artwork';
    this.artwork.setAttribute('aria-hidden', 'true');
    const artworkFrame = document.createElement('div');
    artworkFrame.className = 'graph-board__artwork-frame';
    artworkFrame.append(this.artwork);
    this.marks.classList.add('graph-board__marks');
    this.marks.setAttribute('viewBox', `0 0 ${this.geometry.width} ${this.geometry.height}`);
    this.marks.setAttribute('aria-hidden', 'true');
    this.coordinates.classList.add('graph-board__coordinates');
    this.coordinates.setAttribute('viewBox', `0 0 ${this.geometry.width} ${this.geometry.height}`);
    this.coordinates.setAttribute('aria-hidden', 'true');
    for (const location of Object.keys(this.geometry.locations)) {
      const node = document.createElement('button');
      node.type = 'button';
      node.className = 'graph-board__location';
      node.dataset.location = location;
      node.tabIndex = -1;
      this.locations.set(location, node);
      this.surface.append(node);
    }
    this.surface.prepend(artworkFrame);
    this.surface.append(this.marks);
    element.append(this.surface, this.coordinates);
    this.pieces = new GraphPieces(this.surface, options.definition as BoardDefinition<GraphGeometry>, {
      position: () => this.current,
      presentation: () => this.presentation,
      selected: () => this.selected,
      dragging: () => !!this.pointer?.moved && !this.pointer.drawing,
      reducedMotion: () => !!this.options.services.reducedMotion?.(),
      inactivePieceLabel: this.options.services.inactivePieceLabel,
    });
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => {
        this.pieces.reset();
        this.redraw();
      });
      observer.observe(this.surface);
      this.cleanups.push(() => observer.disconnect());
    }
    element.classList.toggle('cg-static-preview', this.presentation.motion.duration === 0);
    const events = new (element.ownerDocument.defaultView?.AbortController ?? AbortController)();
    const signal = events.signal;
    this.surface.addEventListener('pointerdown', e => this.pointerDown(e), { signal });
    this.surface.addEventListener('pointermove', e => this.pointerMove(e), { signal });
    this.surface.addEventListener('pointerup', e => this.pointerUp(e), { signal });
    this.surface.addEventListener('pointercancel', () => this.cancelInput(), { signal });
    this.surface.addEventListener('contextmenu', e => e.preventDefault(), { signal });
    this.surface.addEventListener('keydown', e => this.keyDown(e), { signal });
    this.cleanups.push(() => events.abort());
    this.display(options.position, { kind: 'initial' });
  }

  private validate(position: BoardPosition): void {
    const definition = this.options.definition;
    if (
      (position.board && position.board !== definition.id) ||
      !definition.participants.includes(position.active)
    )
      throw new Error('Invalid graph board position');
    for (const [location, piece] of position.pieces) {
      if (!this.locations.has(location)) throw new Error(`Unknown board location: ${location}`);
      if (piece.participant && !definition.participants.includes(piece.participant))
        throw new Error('Unknown board participant');
      if (piece.face === 'up' && !definition.roles[piece.role]) throw new Error('Unknown board role');
    }
    for (const location of [...(position.lastMove ?? []), ...(position.checked ?? [])])
      if (!this.locations.has(location)) throw new Error(`Unknown board location: ${location}`);
  }

  display(position: BoardPosition, transition: BoardTransition = { kind: 'jump' }): void {
    if (this.destroyed) return;
    this.validate(position);
    const key = JSON.stringify([position.active, [...position.pieces], position.lastMove, position.checked]);
    if (key === this.displayedPosition && ['jump', 'confirmation', 'forward'].includes(transition.kind)) {
      if (transition.kind !== 'jump' || transition.effects !== undefined) this.presentTransition(transition);
      return;
    }
    const previous = this.current;
    if (['forward', 'backward'].includes(transition.kind)) this.pieces.prepare();
    else this.pieces.reset();
    this.current = { ...position, pieces: new Map(position.pieces) };
    this.displayedPosition = key;
    this.pieces.display(previous, transition);
    this.redraw();
    this.presentTransition(transition);
  }

  setPresentation(presentation: BoardPresentation): void {
    if (this.destroyed) return;
    if (!Number.isFinite(presentation.motion.duration) || presentation.motion.duration < 0)
      throw new Error('Invalid board motion duration');
    graphPoint(this.geometry, this.locations.keys().next().value!, presentation.perspective);
    this.pieces.reset();
    this.presentation = presentation;
    this.feedback.prepare(presentation);
    this.element.classList.toggle('cg-static-preview', presentation.motion.duration === 0);
    this.cancelInput();
    this.feedback.clear();
    this.redraw();
  }

  setInteraction(interaction: BoardInteraction): void {
    if (this.destroyed) return;
    this.interaction = interaction;
    this.element.classList.toggle('manipulable', interaction.mode !== 'display');
    if (interaction.mode !== 'play') this.cancelPremove();
    this.cancelInput();
  }

  position(): BoardPosition {
    return { ...this.current, pieces: new Map(this.current.pieces) };
  }

  redraw(): void {
    if (this.destroyed) return;
    this.element.classList.toggle('cg-static-preview', !this.pieces.enabled);
    this.artwork.style.transform = `rotate(${this.geometry.rotations[this.presentation.perspective]}deg)`;
    this.coordinates.style.display = this.presentation.coordinates ? '' : 'none';
    this.element.classList.toggle('graph-board--coordinates', this.presentation.coordinates);
    if (this.presentation.coordinates && this.coordinatePerspective !== this.presentation.perspective) {
      this.coordinatePerspective = this.presentation.perspective;
      this.coordinates.replaceChildren(
        ...renderGraphCoordinates(this.geometry, this.presentation.perspective),
      );
    }
    const candidates = this.selected ? this.inputDestinations(this.selected) : [];
    for (const [location, node] of this.locations) {
      const [x, y] = graphPoint(this.geometry, location, this.presentation.perspective);
      node.style.left = `${(100 * x) / this.geometry.width}%`;
      node.style.top = `${(100 * y) / this.geometry.height}%`;
      const piece = this.current.pieces.get(location);
      node.classList.toggle('occupied', !!piece);
      const controlled =
        piece?.face === 'up' && piece.controller !== undefined && piece.controller !== piece.participant;
      node.classList.toggle('controlled', controlled);
      if (controlled) node.dataset.controller = piece.controller ?? 'neutral';
      else delete node.dataset.controller;
      node.classList.toggle('xiangqi-lift-origin', this.presentation.highlight && this.selected === location);
      node.classList.toggle('oc', !!piece);
      node.classList.toggle(
        'check',
        this.presentation.highlight && !!this.current.checked?.includes(location),
      );
      node.classList.toggle(
        'xiangqi-move-dest',
        this.interaction.mode === 'play' &&
          this.interaction.showDestinations &&
          candidates.includes(location),
      );
      node.classList.toggle('current-premove', !!this.premove?.includes(location));
      node.setAttribute(
        'aria-label',
        `${location}${piece ? ` ${piece.participant ?? ''} ${piece.face === 'up' ? piece.role : 'concealed'}` : ''}${controlled ? ` (${piece.controller ?? 'neutral'})` : ''}`,
      );
      node.setAttribute('aria-pressed', String(this.selected === location));
      node.tabIndex =
        this.interaction.mode === 'display'
          ? -1
          : location === (this.selected ?? this.locations.keys().next().value)
            ? 0
            : -1;
    }
    this.pieces.redraw();
    this.drawMarks();
  }

  private inputDestinations(from: Location): readonly Location[] {
    const input = this.interaction;
    if (input.mode !== 'play') return [];
    return this.current.active === input.participant
      ? (input.destinations.get(from) ?? [])
      : (input.premove?.destinations(this.current, from) ?? []);
  }

  allowsMove(from: Location, to: Location): boolean {
    const input = this.interaction;
    return (
      input.mode === 'play' &&
      input.participant === this.current.active &&
      this.controller(from) === input.participant &&
      !!input.destinations.get(from)?.includes(to)
    );
  }

  private controller(at: Location): string | null | undefined {
    const piece = this.current.pieces.get(at);
    return piece?.face === 'up' && piece.controller !== undefined ? piece.controller : piece?.participant;
  }

  private move(from: Location, to: Location, controlKey: boolean): void {
    if (from === to) return;
    const input = this.interaction;
    if (input.mode === 'edit') {
      const pieces = new Map(this.current.pieces);
      const piece = pieces.get(from);
      if (!piece) return;
      pieces.delete(from);
      pieces.set(to, piece);
      this.current = { ...this.current, pieces };
      input.onChange(new Map(pieces));
    } else if (input.mode === 'play') {
      if (this.allowsMove(from, to)) {
        this.cancelPremove();
        input.onMove({ from, to, premove: false, controlKey });
      } else if (
        input.participant !== this.current.active &&
        input.premove &&
        this.controller(from) === input.participant &&
        this.inputDestinations(from).includes(to)
      ) {
        this.premove = [from, to];
        input.premove.onChange?.(this.premove);
      }
    }
    this.selected = undefined;
    this.redraw();
  }

  select(location?: Location): void {
    if (this.destroyed) return;
    if (location && !this.locations.has(location)) throw new Error(`Unknown board location: ${location}`);
    if (location) this.click(location);
    else {
      this.selected = undefined;
      this.redraw();
    }
  }

  locationAt([clientX, clientY]: readonly [number, number]): Location | undefined {
    const rect = this.surface.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = ((clientX - rect.left) * this.geometry.width) / rect.width;
    const y = ((clientY - rect.top) * this.geometry.height) / rect.height;
    let distance = this.geometry.pieceSize / 2;
    let result: Location | undefined;
    for (const location of this.locations.keys()) {
      const point = graphPoint(this.geometry, location, this.presentation.perspective);
      const delta = Math.hypot(point[0] - x, point[1] - y);
      if (delta < distance) {
        result = location;
        distance = delta;
      }
    }
    return result;
  }

  private pointerDown(e: PointerEvent): void {
    const from = this.locationAt([e.clientX, e.clientY]);
    if (!from || (e.button !== 0 && e.button !== 2)) return;
    const drawing = e.button === 2;
    if (drawing ? !this.presentation.drawing : this.interaction.mode === 'display') return;
    e.preventDefault();
    this.pointer = { id: e.pointerId, from, x: e.clientX, y: e.clientY, drawing, moved: false };
    this.surface.setPointerCapture?.(e.pointerId);
  }

  private pointerMove(e: PointerEvent): void {
    const pointer = this.pointer;
    if (!pointer || pointer.id !== e.pointerId) return;
    if (Math.hypot(e.clientX - pointer.x, e.clientY - pointer.y) > 4) pointer.moved = true;
    const input = this.interaction;
    if (
      !pointer.drawing &&
      pointer.moved &&
      (input.mode === 'edit' ||
        (input.mode === 'play' &&
          input.input !== 'click' &&
          this.controller(pointer.from) === input.participant))
    ) {
      this.pieces.reset();
      this.pieces.drag(pointer.from, e.clientX - pointer.x, e.clientY - pointer.y);
    }
  }

  private pointerUp(e: PointerEvent): void {
    const pointer = this.pointer;
    if (!pointer || pointer.id !== e.pointerId) return;
    this.pointer = undefined;
    this.releaseDrag(pointer.from);
    if (this.surface.hasPointerCapture?.(e.pointerId)) this.surface.releasePointerCapture(e.pointerId);
    const to = this.locationAt([e.clientX, e.clientY]);
    if (!to) return;
    if (pointer.drawing) {
      const mark: BoardMark = {
        from: pointer.from,
        to: pointer.from === to ? undefined : to,
        brush: e.shiftKey ? 'red' : 'green',
      };
      const marks = [...(this.markLayers.get('user') ?? [])];
      const index = marks.findIndex(m => m.from === mark.from && m.to === mark.to && m.brush === mark.brush);
      if (index < 0) marks.push(mark);
      else marks.splice(index, 1);
      this.setMarks(marks);
      this.markListeners.forEach(listener => listener(marks));
      return;
    }
    const input = this.interaction;
    if (pointer.moved) {
      if (input.mode === 'edit' || (input.mode === 'play' && input.input !== 'click'))
        this.move(pointer.from, to, e.ctrlKey);
    } else if (input.mode === 'edit' || (input.mode === 'play' && input.input !== 'drag'))
      this.click(to, e.ctrlKey);
  }

  private click(location: Location, controlKey = false): void {
    if (this.selected && this.selected !== location) this.move(this.selected, location, controlKey);
    else {
      this.selected = this.selected === location ? undefined : location;
      this.redraw();
    }
  }

  private keyDown(e: KeyboardEvent): void {
    if (this.interaction.mode === 'display') return;
    const from = (e.target as HTMLElement).dataset.location;
    if (!from) return;
    if (e.key === 'Escape') {
      this.cancelInput();
      this.cancelPremove();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      this.click(from, e.ctrlKey);
    } else if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      const point = graphPoint(this.geometry, from, this.presentation.perspective);
      const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[
        e.key
      ];
      if (!direction) return;
      let best: Location | undefined;
      let score = Infinity;
      for (const location of this.locations.keys()) {
        const p = graphPoint(this.geometry, location, this.presentation.perspective);
        const dx = p[0] - point[0],
          dy = p[1] - point[1];
        const forward = dx * direction[0] + dy * direction[1];
        const across = Math.abs(dx * direction[1] - dy * direction[0]);
        const candidate = Math.hypot(dx, dy) + across * 3;
        if (forward > 1 && candidate < score) {
          best = location;
          score = candidate;
        }
      }
      if (best) this.locations.get(best)?.focus();
    }
  }

  setMarks(marks: readonly BoardMark[], layer: 'user' | 'annotation' = 'user'): void {
    for (const mark of marks)
      if (!this.locations.has(mark.from) || (mark.to && !this.locations.has(mark.to)))
        throw new Error('Unknown annotation location');
    this.markLayers.set(
      layer,
      marks.map(mark => ({ ...mark })),
    );
    this.drawMarks();
  }

  private drawMarks(): void {
    this.marks.replaceChildren();
    const shapes = document.createElementNS(svgNamespace, 'g');
    shapes.classList.add('cg-shapes');
    this.marks.append(shapes);
    const allMarks = [...this.markLayers.values()].flat();
    const destinations = new Map<Location, number>();
    for (const mark of allMarks) if (mark.to) destinations.set(mark.to, (destinations.get(mark.to) ?? 0) + 1);
    for (const mark of allMarks) {
      const [x, y] = graphPoint(this.geometry, mark.from, this.presentation.perspective);
      if (mark.svg) {
        const artwork = document.createElementNS(svgNamespace, 'g');
        const size = this.geometry.pieceSize;
        artwork.setAttribute('transform', `translate(${x - size / 2} ${y - size / 2}) scale(${size / 100})`);
        // BoardMark.svg is application-generated artwork, as in the rectangular renderer.
        artwork.innerHTML = mark.svg;
        this.marks.append(artwork);
        continue;
      }
      const size = this.geometry.pieceSize;
      const base = annotationBrushes[mark.brush ?? 'green'] ?? annotationBrushes.green;
      const destination = mark.to
        ? graphPoint(this.geometry, mark.to, this.presentation.perspective)
        : undefined;
      const shape = renderAnnotation(
        base,
        [x / size, y / size],
        destination ? [destination[0] / size, destination[1] / size] : undefined,
        false,
        !!mark.to && (destinations.get(mark.to) ?? 0) > 1,
        0.5,
        mark.lineWidth,
      );
      const frame = document.createElementNS(svgNamespace, 'g');
      frame.setAttribute('transform', `scale(${size})`);
      frame.append(shape);
      shapes.append(frame);
    }
  }

  place(location: Location, piece?: VisiblePiece): void {
    if (this.interaction.mode !== 'edit') throw new Error('Piece placement requires edit mode');
    const pieces = new Map(this.current.pieces);
    if (piece) pieces.set(location, piece);
    else pieces.delete(location);
    this.display({ ...this.current, pieces }, { kind: 'edit' });
    this.interaction.onChange(new Map(pieces));
  }

  dragPiece(piece: VisiblePiece, event: MouseEvent | TouchEvent): void {
    if (this.interaction.mode !== 'edit') throw new Error('Piece placement requires edit mode');
    event.preventDefault();
    const finish = (e: MouseEvent | TouchEvent) => {
      const point = 'changedTouches' in e ? e.changedTouches[0] : e;
      const location = point && this.locationAt([point.clientX, point.clientY]);
      cleanup();
      if (location && !this.destroyed && this.interaction.mode === 'edit') this.place(location, piece);
    };
    const cleanup = () => {
      document.removeEventListener('mouseup', finish);
      document.removeEventListener('touchend', finish);
      document.removeEventListener('touchcancel', cleanup);
    };
    document.addEventListener('mouseup', finish);
    document.addEventListener('touchend', finish);
    document.addEventListener('touchcancel', cleanup);
    this.onDestroy(cleanup);
  }

  cancelInput(): void {
    if (this.pointer && this.surface.hasPointerCapture?.(this.pointer.id))
      this.surface.releasePointerCapture(this.pointer.id);
    if (this.pointer) this.releaseDrag(this.pointer.from);
    this.pointer = undefined;
    this.selected = undefined;
    this.redraw();
  }
  private releaseDrag(location: Location): void {
    this.pieces.release(location);
  }
  cancelPremove(): void {
    if (!this.premove) return;
    this.premove = undefined;
    if (this.interaction.mode === 'play') this.interaction.premove?.onChange?.();
    this.redraw();
  }
  playPremove(): boolean {
    const move = this.premove;
    this.cancelPremove();
    if (!move || !this.allowsMove(move[0], move[1]) || this.interaction.mode !== 'play') return false;
    this.interaction.onMove({ from: move[0], to: move[1], premove: true, controlKey: false });
    return true;
  }
  selectedLocation(): Location | undefined {
    return this.selected;
  }
  destinations(): ReadonlyMap<Location, readonly Location[]> {
    return this.interaction.mode === 'play' ? new Map(this.interaction.destinations) : new Map();
  }
  getDefinition(): BoardDefinition {
    return this.options.definition;
  }
  getPresentation(): BoardPresentation {
    return this.presentation;
  }
  presentTransition(transition: BoardTransition): void {
    this.feedback.present(transition, this.presentation, this.geometry);
  }
  mountControl(element: HTMLElement): void {
    this.element.append(element);
    this.onDestroy(() => element.remove());
  }
  onDestroy(cleanup: () => void): void {
    if (this.destroyed) cleanup();
    else this.cleanups.push(cleanup);
  }
  onMarksChange(listener: (marks: readonly BoardMark[]) => void): () => void {
    this.markListeners.add(listener);
    const cleanup = () => {
      this.markListeners.delete(listener);
    };
    this.onDestroy(cleanup);
    return cleanup;
  }
  destroy(): void {
    if (this.destroyed) return;
    this.cancelInput();
    this.destroyed = true;
    this.feedback.destroy();
    this.pieces.destroy();
    this.cleanups.splice(0).forEach(cleanup => cleanup());
    this.surface.remove();
    this.coordinates.remove();
  }
}
