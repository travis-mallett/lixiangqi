/** Renderer-neutral screen geometry. Points are piece-box top-lefts in CSS pixels. */
export type Point = readonly [number, number];

export interface MotionPlan {
  readonly moves: ReadonlyMap<string, string>; // destination -> origin
  readonly captured: ReadonlySet<string>;
  readonly reveals?: ReadonlyMap<string, string>;
}

/** Adapters own DOM reconciliation; the shared presentation owns every animation. */
export interface MotionHost {
  readonly surface: HTMLElement;
  readonly enabled: boolean;
  readonly duration: number;
  readonly selected: string | undefined;
  readonly dragging: boolean;
  readonly highlight: boolean;
  readonly lastMove: readonly string[] | undefined;
  readonly animating: boolean;
  size(): Point;
  point(location: string): Point;
  key(piece: HTMLElement): string;
  concealed(piece: HTMLElement): boolean;
  findPiece(location: string, fading?: boolean): HTMLElement | undefined;
  adopt(piece: HTMLElement, location: string): void;
  start(plan: MotionPlan): void;
  stop(): void;
  redraw(skip?: boolean): void;
}
