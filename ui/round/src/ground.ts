import type { Api } from 'chessgroundx/api';
import { Chessground } from 'chessgroundx/chessground';
import type { Config } from 'chessgroundx/config';
import { premove } from 'chessgroundx/premove';
import { Notation, type Color, type Dests } from 'chessgroundx/types';
import { h, type VNode } from 'snabbdom';

import resizeHandle from 'lib/chessgroundResize';
import { XIANGQI_DIMENSIONS, plyColor, xiangqiUciMoveToCg } from 'lib/game';
import { ShowResizeHandle, Coords, MoveEvent } from 'lib/prefs';
import { storage } from 'lib/storage';
import { onInsert } from 'lib/view';

import type RoundController from './ctrl';
import type { RoundData, Step } from './interfaces';
import * as util from './util';
import { plyStep } from './util';

export function makeConfig(ctrl: RoundController): Config {
  const data = ctrl.data,
    hooks = ctrl.makeCgHooks(),
    step = plyStep(data, ctrl.ply),
    playing = ctrl.isPlaying();
  return {
    fen: step.fen,
    dimensions: XIANGQI_DIMENSIONS,
    notation: Notation.XIANGQI_HANNUM,
    kingRoles: ['k-piece'],
    autoCastle: false,
    orientation: boardOrientation(data, ctrl.flip),
    turnColor: plyColor(step.ply),
    lastMove: step.uci ? xiangqiUciMoveToCg(step.uci) : undefined,
    check: !!step.check,
    coordinates: data.pref.coords !== Coords.Hidden,
    addDimensionsCssVarsTo: document.body,
    highlight: {
      lastMove: data.pref.highlight,
      check: data.pref.highlight,
    },
    events: {
      move: hooks.onMove,
      insert(elements) {
        const firstPly = util.firstPly(ctrl.data);
        const isSecond = plyColor(firstPly) !== data.player.color;
        const showUntil = firstPly + 2 + Number(isSecond);
        resizeHandle(
          elements,
          playing ? ctrl.data.pref.resizeHandle : ShowResizeHandle.Always,
          ctrl.ply,
          p => p <= showUntil,
        );
      },
    },
    movable: {
      free: false,
      ...movableState(data, playing),
      showDests: data.pref.destination && !ctrl.blindfold(),
      rookCastle: false,
      events: {
        after: hooks.onUserMove,
      },
    },
    animation: {
      enabled: true,
      duration: data.pref.animationDuration,
    },
    premovable: {
      enabled: data.pref.enablePremove,
      castle: false,
      premoveFunc: premove('xiangqi', false, XIANGQI_DIMENSIONS),
      events: {
        set: hooks.onPremove,
        unset: hooks.onCancelPremove,
      },
    },
    draggable: {
      enabled: data.pref.moveEvent !== MoveEvent.Click,
      showGhost: data.pref.highlight,
    },
    selectable: {
      enabled: data.pref.moveEvent !== MoveEvent.Drag,
    },
    drawable: {
      enabled: true,
      defaultSnapToValidMove: storage.boolean('arrow.snap').getOrDefault(true),
    },
    disableContextMenu: true,
  };
}

const movableState = (data: RoundData, playing: boolean): { color?: Color; dests: Dests } => ({
  color: playing ? data.player.color : undefined,
  dests: playing ? util.parsePossibleMoves(data.possibleMoves) : new Map(),
});

export const reload = (ctrl: RoundController): void => ctrl.chessground.set(makeConfig(ctrl));

export const sync = (ctrl: RoundController, step: Step, playing: boolean): void =>
  ctrl.chessground.set({
    fen: step.fen,
    lastMove: step.uci ? xiangqiUciMoveToCg(step.uci) : undefined,
    check: !!step.check,
    turnColor: plyColor(step.ply),
    movable: movableState(ctrl.data, playing),
  });

export const boardOrientation = (data: RoundData, flip: boolean): Color =>
  flip ? data.opponent.color : data.player.color;

export const render = (ctrl: RoundController): VNode =>
  h('div.cg-wrap.xiangqi9x10', {
    hook: onInsert(el => ctrl.setChessground(Chessground(el, makeConfig(ctrl)))),
  });

export type RoundGround = Api;
