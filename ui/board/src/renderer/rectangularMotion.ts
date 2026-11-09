import type { AnimPlan } from 'chessgroundx/anim';
import type { State } from 'chessgroundx/state';
import type { Key, PieceNode } from 'chessgroundx/types';
import { key2pos, pos2key, posToTranslate, pieceClasses } from 'chessgroundx/util';
import type { PieceMotion } from 'chessgroundx/xiangqiMotion';

import {
  animateXiangqi,
  animateXiangqiSlide,
  animateJieqiReveal,
  prepareXiangqiMutation,
  resetXiangqiMotion,
  syncXiangqiMotion,
  syncXiangqiShadowPosition,
  syncXiangqiShadows,
} from '../motion';
import type { MotionHost, MotionPlan } from '../motion/types';

const hosts = new WeakMap<State, MotionHost>();
const plans = new WeakMap<MotionPlan, AnimPlan>();

/** Only this adapter knows Chessground keys, state, piece classes and animation plans. */
function host(state: State): MotionHost {
  let result = hosts.get(state);
  if (result) return result;
  result = {
    get surface() {
      return state.dom.elements.board;
    },
    get enabled() {
      return state.animation.enabled;
    },
    get duration() {
      return state.animation.duration;
    },
    get selected() {
      const key = state.selectable.selected;
      return typeof key === 'string' && key !== 'a0' ? key : undefined;
    },
    get dragging() {
      return !!state.draggable.current;
    },
    get highlight() {
      return state.highlight.lastMove;
    },
    get lastMove() {
      return state.lastMove?.filter((key): key is Key => typeof key === 'string' && key !== 'a0');
    },
    get checked() {
      return state.highlight.check ? state.check : undefined;
    },
    get animating() {
      return !!state.animation.current;
    },
    size: () => [
      state.dom.bounds().width / state.dimensions.width,
      state.dom.bounds().height / state.dimensions.height,
    ],
    point: key =>
      posToTranslate(state.dom.bounds(), state.dimensions)(
        key2pos(key as Key),
        state.orientation === 'white',
      ),
    key: root => (root as PieceNode).cgKey,
    concealed: root => (root as PieceNode).cgPiece.includes('_-piece'),
    findPiece: (key, fading = false) =>
      Array.from(state.dom.elements.board.children).find(element => {
        const node = element as PieceNode;
        return node.tagName === 'PIECE' && node.cgKey === key && !!node.cgFading === fading;
      }) as HTMLElement | undefined,
    adopt: (element, location) => {
      const root = element as PieceNode;
      const name = pieceClasses(state.boardState.pieces.get(location as Key)!, state.orientation);
      root.classList.remove(...root.cgPiece.split(' ').filter(Boolean));
      root.classList.add(...name.split(' ').filter(Boolean));
      root.cgPiece = name;
      root.cgKey = location as Key;
      root.cgAnimating = true;
    },
    start: plan => {
      state.animation.current = { start: performance.now(), frequency: 1, plan: plans.get(plan)! };
    },
    stop: () => {
      state.animation.current = undefined;
    },
    redraw: skip => state.dom.redrawNow(skip),
  };
  hosts.set(state, result);
  return result;
}

function motionPlan(plan: AnimPlan): MotionPlan {
  const result: MotionPlan = {
    moves: new Map(
      [...plan.anims].map(([to, vector]) => {
        const point = key2pos(to);
        return [to, pos2key([point[0] + vector[0], point[1] + vector[1]])];
      }),
    ),
    captured: new Set(plan.fadings.keys()),
    reveals: plan.reveals,
  };
  plans.set(result, plan);
  return result;
}

export const rectangularMotion: PieceMotion = {
  sync: state => syncXiangqiMotion(host(state)),
  shadows: state => syncXiangqiShadows(host(state)),
  shadow: syncXiangqiShadowPosition,
  reset: state => resetXiangqiMotion(host(state)),
  prepare: state => prepareXiangqiMutation(host(state)),
  animate: (state, plan, mode) => {
    const animate =
      mode === 'slide' ? animateXiangqiSlide : mode === 'reveal' ? animateJieqiReveal : animateXiangqi;
    animate(host(state), motionPlan(plan));
  },
};
