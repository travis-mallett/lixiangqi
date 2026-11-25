import type { Api } from 'chessgroundx/api';
import { Chessground } from 'chessgroundx/chessground';
import type { Config } from 'chessgroundx/config';
import { Notation, type Color, type Key, type Piece, type Role } from 'chessgroundx/types';

import { BoardFeedback } from '../feedback';
import { boardLayout } from '../layout';
import { positionToFen } from '../position';
import type {
  BoardDefinition,
  RectangularGeometry,
  BoardInteraction,
  BoardMark,
  BoardOptions,
  BoardPosition,
  BoardPresentation,
  BoardTransition,
  Location,
  Participant,
  VisiblePiece,
} from '../types';
import { annotationBrushes, renderAnnotation } from './annotations';
import { boardLocation, rendererKey } from './coordinates';
import { rectangularMotion } from './rectangularMotion';

/** The only owner of the rectangular renderer. Controllers never receive its mutable state. */
export class RectangularBoardView {
  private renderer: Api;
  private readonly feedback: BoardFeedback;
  private readonly definition: BoardDefinition & { geometry: RectangularGeometry };
  private presentation: BoardPresentation;
  private interaction: BoardInteraction;
  private readonly concealed = new WeakMap<Piece, VisiblePiece>();
  private destroyed = false;
  private displayedPosition?: string;
  private readonly cleanups: Array<() => void> = [];
  private readonly controls = new Set<HTMLElement>();
  private readonly markListeners = new Set<(marks: readonly BoardMark[]) => void>();

  constructor(
    readonly element: HTMLElement,
    private readonly options: BoardOptions,
  ) {
    if (options.definition.geometry.kind === 'graph') throw new Error('Expected rectangular geometry');
    this.definition = Object.freeze({
      ...options.definition,
      geometry: Object.freeze({
        ...options.definition.geometry,
        frame: options.definition.geometry.frame && Object.freeze({ ...options.definition.geometry.frame }),
      }),
      participants: Object.freeze([...options.definition.participants]),
      roles: Object.freeze({ ...options.definition.roles }),
      royalRoles: Object.freeze([...options.definition.royalRoles]),
    });
    const { columns, rows } = this.definition.geometry;
    if (![columns, rows].every(value => Number.isInteger(value) && value > 0 && value <= 16))
      throw new Error('The rectangular renderer supports dimensions from 1 through 16');
    if (this.definition.participants.length !== 2 || new Set(this.definition.participants).size !== 2)
      throw new Error('This renderer requires two distinct participants');
    const roles = Object.values(this.definition.roles);
    if (
      !roles.length ||
      roles.some(letter => !/^[a-z]$/.test(letter)) ||
      new Set(roles).size !== roles.length ||
      this.definition.royalRoles.some(role => !this.definition.roles[role])
    )
      throw new Error('Invalid board piece roles');
    this.presentation = options.presentation;
    this.interaction = options.interaction;
    this.feedback = new BoardFeedback(element, options.services);
    this.feedback.prepare(options.presentation);
    element.classList.add('cg-wrap', 'lixiangqi-board');
    element.classList.toggle('xiangqi9x10', this.definition.id === 'xiangqi');
    element.dataset.boardDefinition = this.definition.id;
    element.dataset.boardPlacement = this.definition.geometry.placement;
    element.dataset.boardCoordinates = this.definition.coordinates;
    element.style.setProperty('--board-image', `var(---board-image-${this.definition.geometry.id})`);
    if (this.definition.coordinateImage)
      element.style.setProperty(
        '--board-coordinate-image',
        `url("${options.services.assetUrl(this.definition.coordinateImage)}")`,
      );
    else element.style.removeProperty('--board-coordinate-image');
    const layout = boardLayout(this.definition.geometry);
    element.style.setProperty('--board-aspect-ratio', String(layout.canvasWidth / layout.canvasHeight));
    element.style.setProperty('--board-columns', String(columns));
    element.style.setProperty('--board-rows', String(rows));
    for (const [key, value] of Object.entries(boardLayout(this.definition.geometry).viewport))
      element.style.setProperty(`--board-layout-${key}`, String(value));
    this.renderer = this.createRenderer(options.position);
    // A neutral covered cell can be flipped by either army, in place.
    // Chessground's normal drag/selection path handles two-cell moves.
    if (this.definition.id === 'banqi') {
      const flip = (event: PointerEvent) => {
        if (event.button !== 0 || this.interaction.mode !== 'play') return;
        const at = this.locationAt([event.clientX, event.clientY]);
        if (!at || !this.allowsMove(at, at)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        this.renderer.cancelMove();
        this.interaction.onMove({ from: at, to: at, premove: false, controlKey: event.ctrlKey });
      };
      this.bindBanqiKeyboard();
      element.addEventListener('pointerdown', flip, true);
      this.onDestroy(() => element.removeEventListener('pointerdown', flip, true));
    }
    this.setInteraction(this.interaction);
    this.display(options.position, { kind: 'initial' });
  }

  private bindBanqiKeyboard(): void {
    const root = this.element;
    const cursor = root.ownerDocument.createElement('span');
    cursor.className = 'banqi-keyboard-cursor';
    cursor.setAttribute('aria-hidden', 'true');
    root.append(cursor);
    let x = 0,
      y = 7;
    let selected: Location | undefined;
    const update = () => {
      const first = this.presentation.perspective === 'red';
      const square = String.fromCharCode(97 + (first ? x : 3 - x)) + (first ? 8 - y : y + 1);
      cursor.style.left = ((48 + x * 100) / 496) * 100 + '%';
      cursor.style.top = ((48 + y * 100) / 896) * 100 + '%';
      root.setAttribute('aria-label', square);
      return square;
    };
    const keys = (event: KeyboardEvent) => {
      if (event.target !== root || this.interaction.mode !== 'play') return;
      switch (event.key) {
        case 'ArrowLeft':
          x = Math.max(0, x - 1);
          break;
        case 'ArrowRight':
          x = Math.min(3, x + 1);
          break;
        case 'ArrowUp':
          y = Math.max(0, y - 1);
          break;
        case 'ArrowDown':
          y = Math.min(7, y + 1);
          break;
        case 'Escape':
          selected = undefined;
          this.cancelInput();
          break;
        case 'Enter':
        case ' ': {
          const at = update();
          const from = selected && this.allowsMove(selected, at) ? selected : at;
          if (this.allowsMove(from, at)) {
            selected = undefined;
            this.cancelInput();
            this.interaction.onMove({ from, to: at, premove: false, controlKey: false });
          } else if (this.interaction.destinations.get(at)?.length) {
            selected = at;
            this.select(at);
          }
          break;
        }
        default:
          return;
      }
      update();
      event.preventDefault();
      event.stopPropagation();
    };
    root.setAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown ArrowLeft ArrowRight Enter Space Escape');
    root.addEventListener('focus', update);
    root.addEventListener('keydown', keys);
    this.onDestroy(() => {
      cursor.remove();
      root.removeEventListener('focus', update);
      root.removeEventListener('keydown', keys);
      for (const attr of ['aria-label', 'aria-keyshortcuts', 'tabindex']) root.removeAttribute(attr);
    });
  }

  private createRenderer(position: BoardPosition): Api {
    const { columns, rows } = this.definition.geometry;
    return Chessground(this.element, {
      fen: this.placement(position),
      dimensions: { width: columns, height: rows },
      notation: this.definition.coordinates === 'xiangqi' ? Notation.XIANGQI_HANNUM : Notation.ALGEBRAIC,
      kingRoles: this.definition.royalRoles.map(role => this.role(role)),
      autoCastle: false,
      addDimensionsCssVarsTo: this.element,
      disableContextMenu: true,
      layeredPieces: true,
      pieceMotion: rectangularMotion,
      events: { insert: elements => elements.container.append(...this.controls) },
      staticPreview:
        this.interaction.mode === 'display' &&
        this.presentation.motion.duration === 0 &&
        !this.presentation.drawing,
      ...this.presentationConfig(),
    });
  }

  private enableRendererCapabilities(): void {
    if (
      !this.renderer.state.staticPreview ||
      (this.interaction.mode === 'display' &&
        this.presentation.motion.duration === 0 &&
        !this.presentation.drawing)
    )
      return;
    const position = this.position();
    this.renderer.destroy();
    this.renderer = this.createRenderer(position);
    this.display(position, { kind: 'initial' });
  }

  private color(participant: Participant): Color {
    const index = this.definition.participants.indexOf(participant);
    if (index < 0) throw new Error(`Unknown participant: ${participant}`);
    return index === 0 ? 'white' : 'black';
  }

  private participant(color: Color): Participant {
    return this.definition.participants[color === 'white' ? 0 : 1];
  }

  private role(role: string): Role {
    const letter = this.definition.roles[role];
    if (!letter || !/^[a-z]$/.test(letter)) throw new Error(`Unknown piece role: ${role}`);
    return `${letter}-piece` as Role;
  }

  private piece(piece: VisiblePiece): Piece {
    if (piece.face === 'down')
      return { role: '_-piece', color: piece.participant ? this.color(piece.participant) : 'white' };
    return { role: this.role(piece.role), color: this.color(piece.participant) };
  }

  private placement(position: BoardPosition): string {
    return positionToFen(position, this.definition).split(' ')[0].replaceAll('*', 'X');
  }

  private presentationConfig(): Config {
    const settings = this.presentation;
    const duration = this.options.services.reducedMotion?.() ? 0 : settings.motion.duration;
    if (!Number.isFinite(duration) || duration < 0) throw new Error('Invalid board motion duration');
    this.element.classList.toggle('cg-static-preview', duration === 0);
    return {
      orientation: this.color(settings.perspective),
      coordinates: settings.coordinates,
      animation: { enabled: duration > 0, duration },
      highlight: { lastMove: settings.highlight, check: settings.highlight },
      drawable: {
        enabled: settings.drawing,
        visible: true,
        defaultSnapToValidMove: false,
        brushes: annotationBrushes,
        renderAnnotation,
        onChange: shapes => {
          const marks = shapes.map(shape => ({
            from: boardLocation(shape.orig),
            to: shape.dest ? boardLocation(shape.dest) : undefined,
            brush: shape.brush,
          }));
          this.markListeners.forEach(listener => listener(marks));
        },
      },
    };
  }

  display(position: BoardPosition, transition: BoardTransition = { kind: 'jump' }): void {
    if (this.destroyed) return;
    const fen = this.placement(position);
    const positionKey = JSON.stringify([fen, position.active, position.lastMove, position.checked ?? []]);
    const silentRefresh =
      transition.kind === 'jump' &&
      transition.effects === undefined &&
      positionKey === this.displayedPosition;
    this.displayedPosition = positionKey;
    const turnColor = this.color(position.active);
    const animated =
      silentRefresh ||
      transition.kind === 'forward' ||
      transition.kind === 'optimistic' ||
      transition.kind === 'backward' ||
      transition.kind === 'confirmation';
    const duration =
      this.options.services.reducedMotion?.() || !animated ? 0 : this.presentation.motion.duration;
    const move = position.lastMove?.map(location => rendererKey(location, this.definition.geometry));
    const revealing =
      transition.kind !== 'backward' &&
      move?.length === 2 &&
      position.pieces.get(position.lastMove![1])?.face === 'up' &&
      move.some(
        key =>
          this.renderer.state.boardState.pieces.get(key)?.role === '_-piece' &&
          (this.definition.id === 'banqi' ||
            this.renderer.state.boardState.pieces.get(key)?.color ===
              this.piece(position.pieces.get(position.lastMove![1])!).color),
      );
    this.renderer.set(
      {
        animation: { enabled: duration > 0, duration },
        fen,
        turnColor,
        lastMove: position.lastMove?.map(location => rendererKey(location, this.definition.geometry)),
        check: position.checked?.map(location => rendererKey(location, this.definition.geometry)) ?? false,
      },
      { animation: transition.kind === 'backward' ? 'slide' : revealing ? 'reveal' : 'default' },
    );
    for (const [location, piece] of position.pieces) {
      if (piece.face === 'down') {
        const rendered = this.renderer.state.boardState.pieces.get(
          rendererKey(location, this.definition.geometry),
        );
        if (rendered) {
          this.concealed.set(rendered, { ...piece });
        }
      }
    }
    this.renderer.set(this.presentationConfig());
    // Synchronizing an unchanged position must not interrupt feedback for its move.
    if (!silentRefresh) this.feedback.present(transition, this.presentation);
  }

  setPresentation(presentation: BoardPresentation): void {
    if (this.destroyed) return;
    if (JSON.stringify(presentation) === JSON.stringify(this.presentation)) return;
    const coordinatesChanged = presentation.coordinates !== this.presentation.coordinates;
    this.presentation = presentation;
    this.feedback.prepare(presentation);
    this.enableRendererCapabilities();
    this.feedback.clear();
    this.renderer.set(this.presentationConfig());
    if (coordinatesChanged) this.renderer.redrawAll();
    this.element.classList.toggle('cg-static-preview', presentation.motion.duration === 0);
    this.setInteraction(this.interaction);
  }

  setInteraction(interaction: BoardInteraction): void {
    if (this.destroyed) return;
    this.interaction = interaction;
    if (this.definition.id === 'banqi') this.element.tabIndex = interaction.mode === 'play' ? 0 : -1;
    this.enableRendererCapabilities();
    const play = interaction.mode === 'play' ? interaction : undefined;
    const editing = interaction.mode === 'edit';
    const dests = new Map<Key, Key[]>();
    for (const [from, destinations] of play?.destinations ?? [])
      dests.set(
        rendererKey(from, this.definition.geometry),
        destinations.map(to => rendererKey(to, this.definition.geometry)),
      );
    this.renderer.set({
      // Keep event bindings available when a display becomes interactive (e.g. CAPTCHA).
      // Interaction is disabled through the independent input capabilities below.
      viewOnly: false,
      movable: {
        free: editing,
        color: editing ? 'both' : play?.participant ? this.color(play.participant) : undefined,
        dests,
        showDests: play?.showDestinations ?? false,
        rookCastle: false,
        events: {
          after: (from, to, metadata) => {
            if (this.interaction.mode !== 'play') return;
            this.interaction.onMove({
              from: boardLocation(from),
              to: boardLocation(to),
              premove: metadata.premove,
              controlKey: !!metadata.ctrlKey,
              holdTime: metadata.holdTime,
            });
          },
        },
      },
      premovable: {
        enabled: !!play?.premove,
        castle: false,
        premoveFunc: (_, from) =>
          (play?.premove?.destinations(this.position(), boardLocation(from)) ?? []).map(to =>
            rendererKey(to, this.definition.geometry),
          ),
        events: {
          set: (from, to) => play?.premove?.onChange?.([boardLocation(from as Key), boardLocation(to)]),
          unset: () => play?.premove?.onChange?.(),
        },
      },
      draggable: {
        enabled: editing || (!!play && play.input !== 'click'),
        showGhost: this.presentation.highlight,
        deleteOnDropOff: editing,
      },
      selectable: { enabled: !!play && play.input !== 'drag' },
      events: {
        change: () => {
          if (this.interaction.mode === 'edit') this.interaction.onChange(this.position().pieces);
        },
      },
    });
  }

  position(): BoardPosition {
    const pieces = new Map<Location, VisiblePiece>();
    for (const [key, piece] of this.renderer.state.boardState.pieces) {
      const role = Object.keys(this.definition.roles).find(role => this.role(role) === piece.role);
      pieces.set(
        boardLocation(key),
        role
          ? { face: 'up', participant: this.participant(piece.color), role }
          : { ...(this.concealed.get(piece) ?? { face: 'down', back: 'default' }) },
      );
    }
    const lastMove = this.renderer.state.lastMove;
    return {
      board: this.definition.id,
      pieces,
      active: this.participant(this.renderer.state.turnColor),
      lastMove:
        lastMove?.length === 2
          ? [boardLocation(lastMove[0] as Key), boardLocation(lastMove[1] as Key)]
          : undefined,
      checked: this.renderer.state.check?.map(boardLocation),
    };
  }

  setMarks(marks: readonly BoardMark[], layer: 'user' | 'annotation' = 'user'): void {
    const shapes = marks.map(mark => ({
      orig: rendererKey(mark.from, this.definition.geometry),
      dest: mark.to ? rendererKey(mark.to, this.definition.geometry) : undefined,
      brush: mark.brush ?? 'green',
      customSvg: mark.svg,
      modifiers: mark.lineWidth === undefined ? undefined : { lineWidth: mark.lineWidth },
    }));
    if (layer === 'annotation') this.renderer.setAutoShapes(shapes);
    else this.renderer.setShapes(shapes);
  }

  select(location?: Location): void {
    this.renderer.selectSquare(location ? rendererKey(location, this.definition.geometry) : null, true);
  }

  locationAt(point: readonly [number, number]): Location | undefined {
    const key = this.renderer.getKeyAtDomPos([point[0], point[1]]);
    return key ? boardLocation(key) : undefined;
  }

  place(location: Location, piece?: VisiblePiece): void {
    if (this.interaction.mode !== 'edit') throw new Error('Piece placement requires edit mode');
    const rendered = piece ? this.piece(piece) : undefined;
    if (rendered && piece?.face === 'down') this.concealed.set(rendered, { ...piece });
    this.renderer.setPieces(new Map([[rendererKey(location, this.definition.geometry), rendered]]));
    this.interaction.onChange(this.position().pieces);
  }

  dragPiece(piece: VisiblePiece, event: MouseEvent | TouchEvent): void {
    if (this.interaction.mode !== 'edit') throw new Error('Piece placement requires edit mode');
    const rendered = this.piece(piece);
    if (piece.face === 'down') this.concealed.set(rendered, { ...piece });
    this.renderer.dragNewPiece(rendered, false, event, true);
  }

  cancelInput(): void {
    this.renderer.cancelMove();
  }
  getDefinition(): BoardDefinition {
    return this.definition;
  }
  getPresentation(): BoardPresentation {
    return this.presentation;
  }
  presentTransition(transition: BoardTransition): void {
    this.feedback.present(transition, this.presentation);
  }
  cancelPremove(): void {
    this.renderer.cancelPremove();
  }
  playPremove(): boolean {
    return this.renderer.playPremove();
  }
  redraw(): void {
    this.renderer.redrawAll();
  }

  onDestroy(cleanup: () => void): void {
    if (this.destroyed) cleanup();
    else this.cleanups.push(cleanup);
  }

  onMarksChange(listener: (marks: readonly BoardMark[]) => void): () => void {
    this.markListeners.add(listener);
    const stop = () => {
      this.markListeners.delete(listener);
    };
    this.onDestroy(stop);
    return stop;
  }

  selectedLocation(): Location | undefined {
    const selected = this.renderer.state.selectable.selected;
    return typeof selected === 'string' ? boardLocation(selected) : undefined;
  }

  destinations(): ReadonlyMap<Location, readonly Location[]> {
    return this.interaction.mode === 'play'
      ? new Map([...this.interaction.destinations].map(([from, to]) => [from, [...to]]))
      : new Map();
  }

  allowsMove(from: Location, to: Location): boolean {
    if (this.interaction.mode !== 'play') return false;
    const position = this.position();
    const piece = position.pieces.get(from);
    return (
      piece !== undefined &&
      (piece.participant === position.active ||
        (from === to && piece.face === 'down' && piece.participant === undefined)) &&
      position.active === this.interaction.participant &&
      !!this.interaction.destinations.get(from)?.includes(to)
    );
  }

  /** Mount a host control whose lifecycle survives perspective and coordinate changes. */
  mountControl(element: HTMLElement): void {
    if (this.destroyed) return;
    element.classList.add('rectangular-board__controls');
    this.controls.add(element);
    this.renderer.state.dom.elements.container.append(element);
    this.onDestroy(() => element.remove());
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.feedback.destroy();
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.renderer.destroy();
  }
}
