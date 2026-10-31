import {
  contactShadowFor,
  contactShadow,
  prewarmDepthColors,
  depthColor,
  computedBackgroundImage,
  span,
  syncXiangqiShadows,
} from './appearance';
export { syncXiangqiShadows, syncXiangqiShadowPosition } from './appearance';
import {
  syncIndicators,
  destinationMarker,
  syncLastMovePresentation,
  clearLastMovePresentation,
} from './indicators';
// Extracted from LiXiangQi's maintained ChessgroundX motion patch.
// Geometry, input and DOM reconciliation belong to the renderer adapters.
import type { MotionHost, MotionPlan, Point } from './types';

const LIFT_MS = 33;
const CARRY_MS = 150;
const LAND_MS = 150;
// Measured from the 30 fps reference: three travel frames, one landing frame,
// two settled frames, then four turnover frames (10 frames / 333 1/3 ms total).
const JIEQI_FRAME_MS = 1000 / 30;
const JIEQI_CARRY_MS = 3 * JIEQI_FRAME_MS;
const JIEQI_LAND_MS = JIEQI_FRAME_MS;
const JIEQI_HOLD_MS = 2 * JIEQI_FRAME_MS;
const JIEQI_TURN_MS = 4 * JIEQI_FRAME_MS;
const SLIDE_BASE_MS = 83.333;
const SLIDE_PER_CELL_MS = 16.667;
const SLIDE_MAX_MS = 180;
const CAMERA_DISTANCE_PIECES = 3;

const runtimes = new WeakMap<MotionHost, MotionRuntime>();
interface MotionLayers {
  contactShadow: HTMLElement;
  airborneShadow: HTMLElement;
  stack: HTMLElement;
  rim: HTMLElement;
}

interface ActivePiece {
  root: HTMLElement;
  key: string;
  cameraDistance: number;
  layers: MotionLayers;
  animations: Set<Animation>;
  generation: number;
  reveal?: boolean;
  concealed: boolean;
  phaseStart?: number;
  revealAt?: number;
  revealReadyAt?: number;
}

interface PlannedMove {
  active: ActivePiece;
  dest: string;
  from: Point;
  to: Point;
  fromRest: boolean;
}

interface MotionRuntime {
  active: Set<ActivePiece>;
  animations: Set<Animation>;
  epoch: number;
  moving: boolean;
  selected?: ActivePiece;
  awaitingReveal?: { key: string; at: number };
}

export function prepareXiangqiMutation(state: MotionHost): void {
  const runtime = runtimes.get(state);
  if (!runtime || (!runtime.moving && (!runtime.active.size || (runtime.selected && state.selected)))) return;
  resetXiangqiMotion(state);
  state.redraw(true);
}

export function animateXiangqi(state: MotionHost, plan: MotionPlan): void {
  const runtime = runtimeFor(state);
  const moves: PlannedMove[] = [];
  const retainedSelection = runtime.selected;

  runtime.epoch += 1;
  runtime.moving = true;

  for (const [dest, orig] of plan.moves) {
    const selected = retainedSelection?.key === orig ? retainedSelection : undefined;
    const source = selected?.root ?? pieceElementByKey(state, orig);
    if (!source) continue;

    const active = selected ?? activatePiece(state, source, orig);
    const from = state.point(orig);
    const to = state.point(dest);
    active.key = dest;
    if (orig === dest)
      active.revealAt = runtime.awaitingReveal?.key === dest ? runtime.awaitingReveal.at : motionTime(state);
    if (plan.reveals?.has(dest)) prepareReveal(state, active, dest);
    moves.push({ active, dest, from, to, fromRest: !selected });
  }

  // A selection may be landing when another piece starts moving. Retire every
  // inactive layer now; its asynchronous landing no longer owns this move.
  for (const active of runtime.active)
    if (!moves.some(move => move.active === active)) cleanupActive(runtime, active);
  runtime.selected = undefined;
  runtime.awaitingReveal = undefined;

  state.start(plan);
  state.redraw(true);

  if (!moves.length) {
    finishMove(state, runtime, runtime.epoch, moves);
    return;
  }

  const epoch = runtime.epoch;
  void runMove(state, runtime, epoch, moves, plan);
}

export function animateXiangqiSlide(state: MotionHost, plan: MotionPlan): void {
  const runtime = runtimeFor(state);
  const slides: Array<{ root: HTMLElement; from: Point; to: Point; duration: number }> = [];

  runtime.epoch += 1;
  runtime.moving = true;

  for (const [dest, orig] of plan.moves) {
    const root = pieceElementByKey(state, orig);
    if (!root) continue;
    state.adopt(root, dest);
    const from = state.point(orig),
      to = state.point(dest);
    const size = state.size();
    const distance = Math.hypot((to[0] - from[0]) / size[0], (to[1] - from[1]) / size[1]);
    slides.push({
      root,
      from,
      to,
      duration: phaseDuration(state, Math.min(SLIDE_MAX_MS, SLIDE_BASE_MS + SLIDE_PER_CELL_MS * distance)),
    });
  }

  state.start(plan);
  state.redraw(true);

  const epoch = runtime.epoch;
  if (!slides.length) {
    finishSlide(state, runtime, epoch);
    return;
  }

  void Promise.all(
    slides.map(({ root, from, to, duration }) => {
      return animateTravel(state, runtime, undefined, root, from, to, slideSteps, duration);
    }),
  ).then(() => finishSlide(state, runtime, epoch));
}

/** An authoritative reveal joins the optimistic move without replacing its owner. */
export function animateJieqiReveal(state: MotionHost, plan: MotionPlan): void {
  const runtime = runtimeFor(state);
  const reveals = [...(plan.reveals ?? [])];
  const active =
    reveals.length === 1 &&
    [...runtime.active].find(
      piece => runtime.moving && piece.key === reveals[0][0] && reveals[0][0] === reveals[0][1],
    );
  if (active && runtime.moving) {
    prepareReveal(state, active, active.key);
    // Preserve the original travel vector and captured-piece fade until landing.
    state.redraw(true);
    return;
  }
  // A different move supersedes the old animation, including any selection.
  // Keep the current DOM nodes for the new plan's source lookup.
  if (runtime.moving) resetXiangqiMotion(state);
  animateXiangqi(state, plan);
}

function prepareReveal(state: MotionHost, active: ActivePiece, dest: string): void {
  if (active.reveal) return;
  const root = active.root;
  state.adopt(root, dest);
  active.reveal = true;
  active.revealReadyAt = motionTime(state);
  // Keep the concealed face throughout the ordinary lift, travel and landing.
  const front = span('xiangqi-motion-face jieqi-reveal-front');
  front.style.backgroundImage = computedBackgroundImage(root);
  front.style.visibility = 'hidden';
  active.layers.stack.append(front);
}

async function revealPiece(state: MotionHost, runtime: MotionRuntime, active: ActivePiece): Promise<void> {
  const { stack, rim } = active.layers;
  const hold = phaseDuration(state, JIEQI_HOLD_MS);
  // Use the original move deadline. A late server response consumes the hold,
  // but never skips turnover frames or restarts travel/landing.
  const readyAt = active.revealReadyAt ?? motionTime(state);
  active.phaseStart = Math.max(active.revealAt ?? readyAt, readyAt) - hold;
  const duration = phaseDuration(state, JIEQI_HOLD_MS + JIEQI_TURN_MS);
  const held = JIEQI_HOLD_MS / (JIEQI_HOLD_MS + JIEQI_TURN_MS);
  const frame = JIEQI_FRAME_MS / (JIEQI_HOLD_MS + JIEQI_TURN_MS);
  const front = stack.querySelector<HTMLElement>('.jieqi-reveal-front')!;
  stack.classList.add('jieqi-reveal-stack');
  stack.querySelector<HTMLElement>('.xiangqi-motion-face')!.classList.add('jieqi-reveal-back');
  front.style.visibility = '';
  rim.style.opacity = '0';
  const body = span('xiangqi-motion-rim jieqi-reveal-body');
  stack.before(body);
  void animate(
    runtime,
    active,
    body,
    [
      { opacity: 0, offset: 0 },
      { opacity: 0, offset: held },
      { opacity: 0.8, offset: held + frame },
      { opacity: 1, offset: held + 2 * frame },
      { opacity: 0.8, offset: held + 3 * frame },
      { opacity: 0, offset: 1 },
    ],
    duration,
  );
  await animate(
    runtime,
    active,
    stack,
    [
      { transform: 'translateY(0) rotateX(0deg)', offset: 0 },
      { transform: 'translateY(0) rotateX(0deg)', offset: held },
      { transform: 'translateY(0) rotateX(-30deg)', offset: held + frame },
      { transform: 'translateY(-3%) rotateX(-95deg)', offset: held + 2 * frame },
      { transform: 'translateY(4%) rotateX(-145deg)', offset: held + 3 * frame },
      { transform: 'translateY(0) rotateX(-180deg)', offset: 1 },
    ],
    duration,
  );
}

export function syncXiangqiMotion(state: MotionHost): void {
  prewarmDepthColors(state);
  syncIndicators(state);
  syncLastMovePresentation(state);
  syncXiangqiShadows(state);

  const runtime = runtimeFor(state);
  if (!motionEnabled(state)) {
    resetXiangqiMotion(state);
    return;
  }
  if (runtime.moving) return;
  // The input renderer owns the piece while a pointer drag is in progress. This also
  // lets click-or-drag distinguish a released click (lift it) from a drag
  // (use the renderer's pointer position).
  if (state.dragging) {
    resetXiangqiMotion(state);
    return;
  }

  const selected = state.selected;
  const selectedKey = typeof selected === 'string' && selected.length > 0 ? selected : undefined;
  if (!selectedKey) {
    if (runtime.selected) {
      const active = runtime.selected;
      runtime.selected = undefined;
      void landSelected(state, runtime, active);
    }
    return;
  }

  const root = pieceElementByKey(state, selectedKey);
  if (!root) return;
  if (runtime.selected?.root === root) return;

  if (runtime.selected) {
    const previous = runtime.selected;
    runtime.selected = undefined;
    void landSelected(state, runtime, previous);
  }

  const active = activatePiece(state, root, selectedKey);
  runtime.selected = active;
  lift(state, active);
}

export function resetXiangqiMotion(state: MotionHost): void {
  const runtime = runtimes.get(state);
  if (!runtime) return;

  runtime.epoch += 1;
  cancelAnimations(runtime.animations);
  for (const active of runtime.active) cleanupActive(runtime, active);
  runtime.selected = undefined;
  runtime.moving = false;
  state.stop();
  runtimes.delete(state);
}

async function runMove(
  state: MotionHost,
  runtime: MotionRuntime,
  epoch: number,
  moves: PlannedMove[],
  plan: MotionPlan,
): Promise<void> {
  const duration = phaseDuration(
    state,
    moves.some(move => move.active.concealed) ? JIEQI_CARRY_MS : CARRY_MS,
  );
  const startedAt = motionTime(state);
  const carryAnimations: Promise<void>[] = [];

  for (const move of moves) {
    const { active, from, to, fromRest } = move;
    if (from[0] === to[0] && from[1] === to[1]) continue;
    if (active.concealed) {
      active.phaseStart = startedAt;
      active.revealAt = startedAt + phaseDuration(state, JIEQI_CARRY_MS + JIEQI_LAND_MS + JIEQI_HOLD_MS);
    }
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const { stack, contactShadow, airborneShadow, rim } = active.layers;

    carryAnimations.push(
      animateTravel(state, runtime, active, active.root, from, to, carrySteps, duration),
      animate(
        runtime,
        active,
        stack,
        fromRest
          ? [
              { transform: idleTransform(active), offset: 0 },
              { transform: heldTransform(active), offset: 0.2 },
              { transform: peakTransform(active), offset: 1 },
            ]
          : [
              { transform: heldTransform(active), offset: 0 },
              { transform: heldTransform(active), offset: 0.2 },
              { transform: peakTransform(active), offset: 1 },
            ],
        duration,
      ),
      animate(
        runtime,
        active,
        contactShadow,
        fromRest
          ? [
              { opacity: 1, offset: 0 },
              { opacity: 0, offset: 0.2 },
              { opacity: 0, offset: 1 },
            ]
          : [{ opacity: 0 }, { opacity: 0 }],
        duration,
      ),
      animate(
        runtime,
        active,
        airborneShadow,
        fromRest
          ? [
              { transform: 'translate3d(0,0,0)', opacity: 0, offset: 0 },
              { transform: 'translate3d(0,0,0)', opacity: 1, offset: 0.2 },
              { transform: 'translate3d(2.4%,3.4%,0) scale(1.07)', opacity: 0.8, offset: 1 },
            ]
          : [
              { transform: 'translate3d(0,0,0)', opacity: 1, offset: 0 },
              { transform: 'translate3d(2.4%,3.4%,0) scale(1.07)', opacity: 0.8, offset: 1 },
            ],
        duration,
      ),
      animate(
        runtime,
        active,
        rim,
        fromRest
          ? [
              { opacity: 0, offset: 0 },
              { opacity: 0.96, offset: 0.2 },
              { opacity: 0.96, offset: 1 },
            ]
          : [{ opacity: 0.96 }, { opacity: 0.96 }],
        duration,
      ),
    );

    const destination = destinationMarker(state, move.dest);
    if (destination) {
      destination.classList.add('xiangqi-motion-underlay');
      carryAnimations.push(
        animate(runtime, undefined, destination, rootCarryKeyframes(from, dx, dy), duration),
      );
    }
  }

  for (const key of plan.captured) {
    const captured = fadingPieceElementByKey(state, key);
    if (!captured) continue;
    const position = state.point(key);
    carryAnimations.push(
      animate(
        runtime,
        undefined,
        captured,
        [
          { opacity: 1, transform: `${translated(position, 0, 0, 0)} scale(1)` },
          { opacity: 0.72, transform: `${translated(position, 0, 0, 0)} scale(.96)`, offset: 0.62 },
          { opacity: 0, transform: `${translated(position, 0, 0, 0)} scale(.86)`, offset: 1 },
        ],
        duration,
        'ease-in',
      ),
    );
  }

  await Promise.all(carryAnimations);
  if (runtime.epoch !== epoch || !runtime.moving) return;

  await Promise.all(
    moves
      .filter(move => move.from[0] !== move.to[0] || move.from[1] !== move.to[1])
      .map(move => land(state, runtime, move.active, true)),
  );
  if (runtime.epoch !== epoch || !runtime.moving) return;
  await Promise.all(
    moves.filter(move => move.active.reveal).map(move => revealPiece(state, runtime, move.active)),
  );
  if (runtime.epoch !== epoch || !runtime.moving) return;
  finishMove(state, runtime, epoch, moves);
}

function lift(state: MotionHost, active: ActivePiece): void {
  const generation = ++active.generation;
  const duration = phaseDuration(state, LIFT_MS);
  const { stack, contactShadow, airborneShadow, rim } = active.layers;

  void Promise.all([
    animate(
      runtimeFor(state),
      active,
      stack,
      [{ transform: idleTransform(active) }, { transform: heldTransform(active) }],
      duration,
    ),
    animate(runtimeFor(state), active, contactShadow, [{ opacity: 1 }, { opacity: 0 }], duration),
    animate(runtimeFor(state), active, airborneShadow, [{ opacity: 0 }, { opacity: 1 }], duration),
    animate(runtimeFor(state), active, rim, [{ opacity: 0 }, { opacity: 0.96 }], duration),
  ]).then(() => {
    if (active.generation === generation) active.root.classList.add('xiangqi-motion-held');
  });
}

async function landSelected(state: MotionHost, runtime: MotionRuntime, active: ActivePiece): Promise<void> {
  const generation = ++active.generation;
  await land(state, runtime, active, false);
  if (active.generation === generation && runtime.selected !== active && !runtime.moving) {
    cleanupActive(runtime, active);
  }
}

function land(
  state: MotionHost,
  runtime: MotionRuntime,
  active: ActivePiece,
  fromPeak: boolean,
): Promise<void> {
  const referenceLanding = fromPeak && active.concealed && active.revealAt !== undefined;
  const duration = phaseDuration(state, referenceLanding ? JIEQI_LAND_MS : LAND_MS);
  active.phaseStart = referenceLanding
    ? active.revealAt! - phaseDuration(state, JIEQI_LAND_MS + JIEQI_HOLD_MS)
    : undefined;
  const airborneStartOpacity = fromPeak ? 0.8 : 1;
  const { stack, contactShadow, airborneShadow, rim } = active.layers;

  return Promise.all([
    animate(
      runtime,
      active,
      stack,
      [
        { transform: fromPeak ? peakTransform(active) : heldTransform(active), offset: 0 },
        { transform: projectedPose(active, -7.5, 23, 1.25), offset: 0.2 },
        { transform: projectedPose(active, -5, 17, 1.18), offset: 0.4 },
        { transform: projectedPose(active, -2.8, 10, 1.11), offset: 0.6 },
        { transform: projectedPose(active, -0.8, 3, 1.04), offset: 0.8 },
        { transform: idleTransform(active), offset: 1 },
      ],
      duration,
    ),
    animate(
      runtime,
      active,
      airborneShadow,
      [
        {
          transform: fromPeak ? 'translate3d(2.4%,3.4%,0) scale(1.07)' : 'translate3d(0,0,0)',
          opacity: airborneStartOpacity,
        },
        { transform: 'translate3d(0,0,0)', opacity: 0 },
      ],
      duration,
    ),
    animate(runtime, active, contactShadow, [{ opacity: 0 }, { opacity: 1 }], duration),
    animate(
      runtime,
      active,
      rim,
      [
        { opacity: 0.96, offset: 0 },
        { opacity: 0.82, offset: 0.2 },
        { opacity: 0.58, offset: 0.4 },
        { opacity: 0.32, offset: 0.6 },
        { opacity: 0.1, offset: 0.8 },
        { opacity: 0, offset: 1 },
      ],
      duration,
    ),
  ]).then(() => undefined);
}

function finishMove(state: MotionHost, runtime: MotionRuntime, epoch: number, moves: PlannedMove[]): void {
  if (runtime.epoch !== epoch) return;
  runtime.moving = false;
  state.stop();
  cancelAnimations(runtime.animations);
  const concealed = moves.find(move => move.active.concealed && !move.active.reveal);
  runtime.awaitingReveal =
    concealed?.active.revealAt === undefined
      ? undefined
      : { key: concealed.dest, at: concealed.active.revealAt };
  for (const active of runtime.active) cleanupActive(runtime, active);
  state.redraw();
}

function finishSlide(state: MotionHost, runtime: MotionRuntime, epoch: number): void {
  if (runtime.epoch !== epoch) return;
  runtime.moving = false;
  state.stop();
  cancelAnimations(runtime.animations);
  state.redraw();
}

function activatePiece(state: MotionHost, root: HTMLElement, key: string): ActivePiece {
  const runtime = runtimeFor(state);
  const existing = [...runtime.active].find(active => active.root === root);
  if (existing) return existing;

  const backgroundImage = computedBackgroundImage(root);
  clearLastMovePresentation(root);
  const contactShadow = contactShadowFor(root).firstElementChild as HTMLElement;
  const airborneShadow = span('xiangqi-motion-shadow-airborne');
  const camera = span('xiangqi-motion-camera');
  const stack = span('xiangqi-motion-stack');
  const rim = span('xiangqi-motion-rim');
  const face = span('xiangqi-motion-face');
  const cameraDistance = state.size()[0] * CAMERA_DISTANCE_PIECES;

  face.style.backgroundImage = backgroundImage;
  stack.append(rim, face);
  camera.append(stack);
  root.append(airborneShadow, camera);
  root.style.setProperty('--xiangqi-piece-perspective', `${cameraDistance}px`);
  root.classList.add('xiangqi-motion-piece');

  const active: ActivePiece = {
    root,
    key,
    cameraDistance,
    layers: { contactShadow, airborneShadow, stack, rim },
    animations: new Set(),
    generation: 0,
    concealed: state.concealed(root),
  };
  runtime.active.add(active);

  void depthColor(backgroundImage, root).then(color => {
    if (root.isConnected && runtime.active.has(active)) {
      root.style.setProperty('--xiangqi-piece-depth-color', color);
    }
  });
  return active;
}

function cleanupActive(runtime: MotionRuntime, active: ActivePiece): void {
  if (!runtime.active.delete(active)) return;
  active.generation += 1;
  for (const animation of active.animations) runtime.animations.delete(animation);
  cancelAnimations(active.animations);
  active.root.classList.remove('xiangqi-motion-piece', 'xiangqi-motion-held');
  active.root.style.removeProperty('--xiangqi-piece-perspective');
  active.root.style.removeProperty('--xiangqi-piece-depth-color');
  active.layers.airborneShadow.remove();
  active.layers.stack.parentElement?.remove();
}

function runtimeFor(state: MotionHost): MotionRuntime {
  let runtime = runtimes.get(state);
  if (!runtime) {
    runtime = { active: new Set(), animations: new Set(), epoch: 0, moving: false };
    runtimes.set(state, runtime);
  }
  return runtime;
}

function motionEnabled(state: MotionHost): boolean {
  return (
    state.enabled &&
    !state.surface.ownerDocument.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
}

function motionTime(state: MotionHost): number {
  return Number(state.surface.ownerDocument.timeline?.currentTime ?? performance.now());
}

function phaseDuration(state: MotionHost, duration: number): number {
  if (!motionEnabled(state)) return 1;
  const preferenceScale = state.duration <= 120 ? 0.5 : state.duration >= 500 ? 1.5 : 1;
  return duration * preferenceScale;
}

function animate(
  runtime: MotionRuntime,
  active: ActivePiece | undefined,
  element: HTMLElement | SVGSVGElement,
  keyframes: Keyframe[],
  duration: number,
  easing = 'linear',
): Promise<void> {
  const shadow = element.tagName === 'PIECE' ? contactShadow(element as HTMLElement) : undefined;
  if (shadow) {
    // Mirror board-space travel/fading, while contact opacity remains an
    // independent animation on its child. Both cancel with the same owner.
    void animate(runtime, active, shadow, keyframes, duration, easing);
  }
  const animation = element.animate(keyframes, { duration, easing, fill: 'forwards' });
  if (active?.phaseStart !== undefined) animation.startTime = active.phaseStart;
  runtime.animations.add(animation);
  active?.animations.add(animation);
  return animation.finished.then(() => undefined).catch(() => undefined);
}

function cancelAnimations(animations: Set<Animation>): void {
  for (const animation of animations) animation.cancel();
  animations.clear();
}

function projectedPose(
  active: ActivePiece,
  translateY: number,
  pitch: number,
  apparentScale: number,
): string {
  const depth = active.cameraDistance * (1 - 1 / apparentScale);
  return `translate3d(0, ${translateY}%, ${depth.toFixed(3)}px) rotateX(${pitch}deg)`;
}

function idleTransform(active: ActivePiece): string {
  return projectedPose(active, 0, 0, 1);
}

function heldTransform(active: ActivePiece): string {
  return projectedPose(active, -7, 27, 1.18);
}

function peakTransform(active: ActivePiece): string {
  return projectedPose(active, -10, 27, 1.3);
}

function translated(origin: Point, dx: number, dy: number, progress: number): string {
  return `translate3d(${origin[0] + dx * progress}px,${origin[1] + dy * progress}px,0)`;
}

function rootCarryKeyframes(origin: Point, dx: number, dy: number): Keyframe[] {
  return carrySteps.map(({ progress, offset }) => ({
    transform: translated(origin, dx, dy, progress),
    offset,
  }));
}

function pieceElementByKey(state: MotionHost, key: string): HTMLElement | undefined {
  return state.findPiece(key);
}

function fadingPieceElementByKey(state: MotionHost, key: string): HTMLElement | undefined {
  return state.findPiece(key, true);
}

type TravelStep = { progress: number; offset: number };
const carrySteps: TravelStep[] = [
  { progress: 0, offset: 0 },
  { progress: 0, offset: 0.2 },
  { progress: 0.32, offset: 0.4 },
  { progress: 0.63, offset: 0.6 },
  { progress: 0.93, offset: 0.8 },
  { progress: 1, offset: 1 },
];
const slideSteps: TravelStep[] = [
  { progress: 0, offset: 0 },
  { progress: 0.35, offset: 0.23 },
  { progress: 0.67, offset: 0.47 },
  { progress: 0.94, offset: 0.75 },
  { progress: 1, offset: 1 },
];

function animateTravel(
  state: MotionHost,
  runtime: MotionRuntime,
  active: ActivePiece | undefined,
  root: HTMLElement,
  from: Point,
  to: Point,
  steps: TravelStep[],
  duration: number,
): Promise<void> {
  const dx = to[0] - from[0],
    dy = to[1] - from[1];
  const travel = animate(
    runtime,
    active,
    root,
    steps.map(({ progress, offset }) => ({
      transform: translated(from, dx, dy, progress),
      offset,
    })),
    duration,
  );
  const connector = state.surface.querySelector<SVGSVGElement>('.xiangqi-last-move-connector');
  if (connector && state.key(root) === state.lastMove?.[1]) {
    const size = state.size();
    const x = from[0] + size[0] / 2;
    const y = from[1] + size[1] / 2;
    const distance = Math.hypot(dx, dy);
    // Reveal the existing dashes up to the travelling piece's center. The
    // piece and reveal share every progress stop, duration and cancellation.
    void animate(
      runtime,
      active,
      connector,
      steps.map(({ progress, offset }) => ({
        clipPath: `circle(${distance * progress}px at ${x}px ${y}px)`,
        offset,
      })),
      duration,
    );
  }
  return travel;
}
