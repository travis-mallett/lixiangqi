import { h, type VNode } from 'snabbdom';

import { type Prop, propWithEffect } from 'lib';
import type { SanToUci } from 'lib/game';
import type { MoveRootCtrl, MoveUpdate } from 'lib/game/moveRootCtrl';
import { onInsert, snabDialog } from 'lib/view';

import KeyboardChecker from './keyboardChecker';

export interface Opts {
  input: HTMLInputElement;
  ctrl: KeyboardMove;
}

export type KeyboardMoveHandler = (
  fen: FEN,
  dests?: ReadonlyMap<string, readonly string[]>,
  yourMove?: boolean,
) => void;

export interface KeyboardMove {
  update(up: MoveUpdate): void;
  registerHandler(h: KeyboardMoveHandler): void;
  isFocused: Prop<boolean>;
  san(orig: string, dest: string): void;
  select(key: string): void;
  hasSelected(): string | undefined;
  confirmMove(): void;
  usedSan: boolean;
  legalSans: SanToUci | null;
  arrowNavigate(arrowKey: ArrowKey): void;
  justSelected(): boolean;
  draw(): void;
  next(): void;
  vote(v: boolean): void;
  resign(v: boolean, immediately?: boolean): void;
  helpModalOpen: Prop<boolean>;
  checker?: KeyboardChecker;
  opponent?: string;
  speakClock?: () => void;
  goBerserk?: () => void;
}

export interface RootData {
  game: { variant: { key: VariantKey } };
  player: { color: Color | 'both' };
  opponent?: { color: Color; user?: { username: string } };
}

export type ArrowKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';

export interface KeyboardMoveRootCtrl extends MoveRootCtrl {
  userJumpPlyDelta?: (plyDelta: Ply) => void;
  handleArrowKey?: (arrowKey: ArrowKey) => void;
  submitMove?: (v: boolean) => void;
  data: RootData;
}

export function loadKeyboardMove(opts: Opts): Promise<KeyboardMoveHandler> {
  return site.asset.loadEsm('keyboardMove', { init: opts });
}

export function render(ctrl: KeyboardMove): VNode {
  return h('div.keyboard-move', [
    h('input', {
      attrs: { spellcheck: 'false', autocomplete: 'off' },
      hook: onInsert((input: HTMLInputElement) =>
        site.asset
          .loadEsm<KeyboardMoveHandler>('keyboardMove', { init: { input, ctrl } })
          .then(m => ctrl.registerHandler(m)),
      ),
    }),
    ctrl.isFocused()
      ? h('em', ['a1a2 / a10a9 ', h('kbd', 'Enter')])
      : h('strong', ['Press ', h('kbd', 'm'), ' to focus']),
    ctrl.helpModalOpen()
      ? snabDialog({
          class: 'help.keyboard-move-help',
          htmlUrl: '/help/keyboard-move',
          onClose: () => ctrl.helpModalOpen(false),
          modal: true,
          easyClose: 'clickOutside',
        })
      : null,
  ]);
}

export function ctrl(root: KeyboardMoveRootCtrl): KeyboardMove {
  const isFocused = propWithEffect(false, root.redraw);
  const helpModalOpen = propWithEffect(false, root.redraw);
  let handler: KeyboardMoveHandler | undefined;
  let lastSelect = performance.now();
  let lastFen: FEN | undefined;
  let board: MoveUpdate['board'];
  const select = (key: string): void => {
    if (!board) return;
    if (board.selectedLocation() === key) board.cancelInput();
    else board.select(key);
    lastSelect = performance.now();
  };
  let usedSan = false;
  return {
    update(up: MoveUpdate) {
      if (up.board) board = up.board;
      if (handler) handler(up.fen, board?.destinations(), up.canMove);
      lastFen = up.fen;
    },
    registerHandler(h: KeyboardMoveHandler) {
      handler = h;
      if (lastFen) handler(lastFen, board?.destinations());
    },
    san(orig, dest) {
      usedSan = true;
      board?.cancelInput();
      select(orig);
      select(dest);
      board?.cancelInput();
    },
    select,
    hasSelected: () => board?.selectedLocation(),
    confirmMove: () => (root.submitMove ? root.submitMove(true) : null),
    usedSan,
    legalSans: null,
    arrowNavigate(arrowKey: ArrowKey) {
      if (root.handleArrowKey) {
        root.handleArrowKey?.(arrowKey);
        return;
      }

      const arrowKeyToPlyDelta = {
        ArrowUp: -999,
        ArrowDown: 999,
        ArrowLeft: -1,
        ArrowRight: 1,
      };
      root.userJumpPlyDelta?.(arrowKeyToPlyDelta[arrowKey]);
    },
    justSelected: () => performance.now() - lastSelect < 500,
    draw: () => (root.offerDraw ? root.offerDraw(true, true) : null),
    resign: (v, immediately) => (root.resign ? root.resign(v, immediately) : null),
    next: () => root.nextPuzzle?.(),
    vote: (v: boolean) => root.vote?.(v),
    helpModalOpen,
    isFocused,
    checker: root.speakClock ? new KeyboardChecker() : undefined,
    opponent: root.data.opponent?.user?.username,
    speakClock: root.speakClock,
    goBerserk: root.goBerserk,
  };
}
