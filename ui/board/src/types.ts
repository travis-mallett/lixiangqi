/** Board locations and participants belong to the game, never to the rendering library. */
export type Location = string;
export type Participant = string;
export type PieceRole = string;

export type VisiblePiece =
  | { face: 'up'; participant: Participant; role: PieceRole }
  | { face: 'down'; back: string; participant?: Participant };

export interface BoardGeometry {
  readonly id: string;
  readonly columns: number;
  readonly rows: number;
  readonly placement: 'intersections' | 'cells';
}

export interface BoardDefinition {
  readonly id: string;
  readonly geometry: BoardGeometry;
  readonly participants: readonly Participant[];
  readonly roles: Readonly<Record<PieceRole, string>>;
  readonly royalRoles: readonly PieceRole[];
  readonly coordinates: 'xiangqi' | 'algebraic';
}

export interface BoardPosition {
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

export type BoardEffect = 'capture' | 'check' | 'checkmate';
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
}

export interface BoardOptions {
  readonly definition: BoardDefinition;
  readonly position: BoardPosition;
  readonly interaction: BoardInteraction;
  readonly presentation: BoardPresentation;
  readonly services: BoardServices;
}
