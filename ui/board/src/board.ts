import type { Api } from 'chessgroundx/api';
import { Chessground } from 'chessgroundx/chessground';
import type { Config } from 'chessgroundx/config';
import { Notation, type Color, type Key, type Piece, type Role } from 'chessgroundx/types';

import { BoardFeedback } from './feedback';
import { positionToFen } from './position';
import { boardLocation, rendererKey } from './renderer/coordinates';
import type {
  BoardDefinition,
  BoardInteraction,
  BoardMark,
  BoardOptions,
  BoardPosition,
  BoardPresentation,
  BoardTransition,
  Location,
  Participant,
  VisiblePiece,
} from './types';

/** The only owner of the rectangular renderer. Controllers never receive its mutable state. */
export class BoardView {
  private renderer: Api;
  private readonly feedback: BoardFeedback;
  private readonly definition: BoardDefinition;
  private presentation: BoardPresentation;
  private interaction: BoardInteraction;
  private readonly concealed = new WeakMap<Piece, VisiblePiece>();
  private destroyed = false;
  private readonly cleanups: Array<() => void> = [];
  private readonly controls = new Set<HTMLElement>();
  private readonly markListeners = new Set<(marks: readonly BoardMark[]) => void>();

  constructor(
    readonly element: HTMLElement,
    private readonly options: BoardOptions,
  ) {
    this.definition = Object.freeze({
      ...options.definition,
      geometry: Object.freeze({ ...options.definition.geometry }),
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
    element.classList.add('cg-wrap', 'lixiangqi-board');
    element.classList.toggle('xiangqi9x10', this.definition.id === 'xiangqi');
    element.dataset.boardDefinition = this.definition.id;
    element.dataset.boardPlacement = this.definition.geometry.placement;
    element.dataset.boardCoordinates = this.definition.coordinates;
    element.style.setProperty('--board-columns', String(columns));
    element.style.setProperty('--board-rows', String(rows));
    this.renderer = this.createRenderer(options.position);
    this.setInteraction(this.interaction);
    this.display(options.position, { kind: 'initial' });
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
    return positionToFen(position, this.definition).split(' ')[0];
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
        brushes: { variation: { key: 'variation', color: 'white', opacity: 0.5, lineWidth: 12 } },
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
    const turnColor = this.color(position.active);
    const animated =
      transition.kind === 'forward' || transition.kind === 'backward' || transition.kind === 'confirmation';
    const duration =
      this.options.services.reducedMotion?.() || !animated ? 0 : this.presentation.motion.duration;
    this.renderer.set(
      {
        animation: { enabled: duration > 0, duration },
        fen,
        turnColor,
        lastMove: position.lastMove?.map(location => rendererKey(location, this.definition.geometry)),
        check: position.checked?.map(location => rendererKey(location, this.definition.geometry)) ?? false,
      },
      transition.kind === 'backward' ? { animation: 'slide' } : undefined,
    );
    for (const [location, piece] of position.pieces) {
      if (piece.face === 'down') {
        const rendered = this.renderer.state.boardState.pieces.get(
          rendererKey(location, this.definition.geometry),
        );
        if (rendered) this.concealed.set(rendered, { ...piece });
      }
    }
    this.renderer.set(this.presentationConfig());
    this.feedback.present(transition, this.presentation);
  }

  setPresentation(presentation: BoardPresentation): void {
    if (this.destroyed) return;
    if (JSON.stringify(presentation) === JSON.stringify(this.presentation)) return;
    const coordinatesChanged = presentation.coordinates !== this.presentation.coordinates;
    this.presentation = presentation;
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
      brush: mark.brush,
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
      piece?.face === 'up' &&
      piece.participant === position.active &&
      piece.participant === this.interaction.participant &&
      !!this.interaction.destinations.get(from)?.includes(to)
    );
  }

  /** Mount a host control whose lifecycle survives perspective and coordinate changes. */
  mountControl(element: HTMLElement): void {
    if (this.destroyed) return;
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

export function createBoard(element: HTMLElement, options: BoardOptions): BoardView {
  return new BoardView(element, options);
}
