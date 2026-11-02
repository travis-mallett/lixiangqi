/** Board locations and participants belong to the game, never to the rendering library. */
export type Location = string;
export type Participant = string;
export type PieceRole = string;

export type VisiblePiece =
  | {
      face: 'up';
      participant: Participant;
      role: PieceRole;
      controller?: Participant | null;
      inactive?: boolean;
    }
  | { face: 'down'; back: string; participant?: Participant };

export interface RectangularGeometry {
  readonly kind?: 'rectangular';
  readonly id: string;
  readonly columns: number;
  readonly rows: number;
  readonly placement: 'intersections' | 'cells';
  /** Artwork units; opposite margins are equal. Omit for full cell-based boards. */
  readonly frame?: { readonly cellSize: number; readonly marginX: number; readonly marginY: number };
}

/** Explicit artwork locations. Neither hit testing nor perspective assumes a rectangular grid. */
export interface GraphGeometry {
  readonly kind: 'graph';
  readonly id: string;
  readonly placement: 'intersections';
  readonly width: number;
  readonly height: number;
  readonly pieceSize: number;
  readonly locations: Readonly<Record<Location, readonly [number, number]>>;
  /** Clockwise artwork rotation in degrees, around the canvas center. */
  readonly rotations: Readonly<Record<Participant, number>>;
  readonly territoryAnchors?: Readonly<Record<Participant, readonly [number, number]>>;
  readonly riverAnchors?: Readonly<Record<string, readonly [number, number]>>;
  readonly coordinates?: readonly GraphCoordinate[];
}

export interface GraphCoordinate {
  readonly point: readonly [number, number];
  readonly text: string;
  readonly location: Location;
  readonly axis: 'file' | 'rank';
}

export type BoardGeometry = RectangularGeometry | GraphGeometry;

export interface BoardDefinition<G extends BoardGeometry = BoardGeometry> {
  readonly id: string;
  readonly geometry: G;
  readonly pieceFamily?: string;
  readonly participants: readonly Participant[];
  readonly roles: Readonly<Record<PieceRole, string>>;
  readonly royalRoles: readonly PieceRole[];
  readonly coordinates: 'xiangqi' | 'algebraic';
  readonly coordinateImage?: string;
  /** Piece-facing angle in artwork coordinates, before applying the viewer's rotation. */
  readonly pieceRotation?: (location: Location, piece: VisiblePiece) => number;
}

export interface BoardPosition {
  readonly board?: string;
  readonly pieces: ReadonlyMap<Location, VisiblePiece>;
  readonly active: Participant;
  readonly lastMove?: readonly [Location, Location];
  readonly checked?: readonly Location[];
}

export interface MoveIntent {
  readonly from: Location;
  readonly to: Location;
  readonly premove: boolean;
  readonly controlKey: boolean;
  readonly holdTime?: number;
}

export type BoardInteraction =
  | { mode: 'display' }
  | {
      mode: 'play';
      participant?: Participant;
      destinations: ReadonlyMap<Location, readonly Location[]>;
      input: 'click' | 'drag' | 'both';
      showDestinations: boolean;
      onMove: (move: MoveIntent) => void;
      premove?: {
        destinations: (position: BoardPosition, from: Location) => readonly Location[];
        onChange?: (move?: readonly [Location, Location]) => void;
      };
    }
  | { mode: 'edit'; onChange: (pieces: ReadonlyMap<Location, VisiblePiece>) => void };

export type BoardEffect = 'capture' | 'check' | 'checkmate' | 'defeat';
export type TransitionKind =
  | 'initial'
  | 'forward'
  | 'backward'
  | 'jump'
  | 'confirmation'
  | 'correction'
  | 'edit';

export interface BoardTransition {
  readonly kind: TransitionKind;
  /** Stable within the feature's session, used to suppress duplicate acknowledgments. */
  readonly id?: string;
  /** Supplying effects opts into feedback; [] announces an ordinary move. Omit for silent position sync. */
  readonly effects?: readonly BoardEffect[];
  /** Original armies affected by each effect; explicit-location boards resolve their anchors. */
  readonly effectTargets?: Partial<Record<BoardEffect, readonly Participant[]>>;
  readonly effectRoutes?: Partial<Record<BoardEffect, readonly (readonly [Participant, Participant])[]>>;
  readonly winners?: readonly Participant[];
}

export interface BoardPresentation {
  readonly perspective: Participant;
  readonly coordinates: boolean;
  readonly highlight: boolean;
  readonly motion: { readonly duration: number };
  readonly feedback: { readonly effects: readonly BoardEffect[]; readonly audio: boolean };
  readonly drawing: boolean;
}

export interface BoardMark {
  readonly from: Location;
  readonly to?: Location;
  readonly brush?: string;
  /** Trusted, application-generated artwork. Never pass untrusted article or user HTML. */
  readonly svg?: string;
  readonly lineWidth?: number;
}

export interface BoardServices {
  readonly assetUrl: (path: string) => string;
  readonly sound?: (cue: { move: boolean; effects: readonly BoardEffect[] }) => void;
  readonly reducedMotion?: () => boolean;
  readonly inactivePieceLabel?: string;
}

export interface BoardOptions {
  readonly definition: BoardDefinition;
  readonly position: BoardPosition;
  readonly interaction: BoardInteraction;
  readonly presentation: BoardPresentation;
  readonly services: BoardServices;
}
