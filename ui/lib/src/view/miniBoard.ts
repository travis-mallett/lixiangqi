// no side effects allowed due to re-export by index.ts

import type { Api } from 'chessgroundx/api';
import { Chessground as makeChessground } from 'chessgroundx/chessground';
import type { Config } from 'chessgroundx/config';
import { Notation } from 'chessgroundx/types';
import { COLORS } from 'chessops';
import { h, type VNode } from 'snabbdom';

import * as domData from '@/data';
import { fenColor } from '@/game/chess';
import { lichessClockIsRunning, setClockWidget } from '@/game/clock/clockWidget';
import { XIANGQI_DIMENSIONS, xiangqiUciMoveToCg } from '@/game/xiangqi';
import { pubsub } from '@/pubsub';
import { wsSend } from '@/socket';

export const initMiniBoard = (node: HTMLElement): void => {
  const [fen, orientation, lm] = node.getAttribute('data-state')!.split(',');
  initMiniBoardWith(node, {
    fen,
    orientation: orientation as Color,
    lastMove: lm ? xiangqiUciMoveToCg(lm) : undefined,
  });
};

export const initMiniBoardWith = (node: HTMLElement, config: Config): void => {
  node.classList.add('xiangqi9x10');
  const cgConfig: Config = {
    coordinates: false,
    viewOnly: !node.getAttribute('data-playable'),
    drawable: { enabled: false, visible: false },
    dimensions: XIANGQI_DIMENSIONS,
    notation: Notation.XIANGQI_HANNUM,
    kingRoles: ['k-piece'],
    autoCastle: false,
    ...config,
  };
  domData.set(node, 'chessground', makeChessground(node, cgConfig));
};

export const initMiniBoards = (parent?: HTMLElement): void =>
  Array.from((parent || document).getElementsByClassName('mini-board--init')).forEach((el: HTMLElement) => {
    el.classList.remove('mini-board--init');
    initMiniBoard(el);
  });

export const renderClock = (color: Color, time: number): VNode =>
  h(`span.mini-game__clock.mini-game__clock--${color}`, {
    attrs: { 'data-time': time, 'data-managed': 1 },
  });

export const initMiniGame = (node: Element): string | null => {
  const [fen, color, lm] = node.getAttribute('data-state')!.split(','),
    config: Config = {
      coordinates: false,
      viewOnly: true,
      fen,
      orientation: color as Color,
      lastMove: lm ? xiangqiUciMoveToCg(lm) : undefined,
      dimensions: XIANGQI_DIMENSIONS,
      notation: Notation.XIANGQI_HANNUM,
      kingRoles: ['k-piece'],
      autoCastle: false,
      drawable: {
        enabled: false,
        visible: false,
      },
    },
    $el = $(node).removeClass('mini-game--init'),
    $cg = $el.find('.cg-wrap').addClass('xiangqi9x10'),
    turnColor = fenColor(fen);

  domData.set($cg[0] as Element, 'chessground', makeChessground($cg[0] as HTMLElement, config));

  COLORS.forEach(color =>
    $el.find('.mini-game__clock--' + color).each(function (this: HTMLElement) {
      setClockWidget(this, {
        time: parseInt(this.getAttribute('data-time')!),
        pause: color !== turnColor || !lichessClockIsRunning(fen, color),
      });
    }),
  );
  return node.getAttribute('data-live');
};

export const getChessground = (node: HTMLElement): Api => domData.get(node, 'chessground');

export const initMiniGames = (parent?: HTMLElement): void => {
  const nodes = Array.from((parent || document).getElementsByClassName('mini-game--init')),
    ids = nodes.map(x => initMiniGame(x)).filter(id => id);
  if (ids.length) pubsub.after('socket.hasConnected').then(() => wsSend('startWatching', ids.join(' ')));
};

export const updateMiniGame = (node: HTMLElement, data: MiniGameUpdateData): void => {
  const lm = data.lm,
    cg = getChessground(node.querySelector('.cg-wrap')!);
  if (cg)
    cg.set({
      fen: data.fen,
      lastMove: lm ? xiangqiUciMoveToCg(lm) : undefined,
    });
  const turnColor = fenColor(data.fen);
  const updateClock = (time: number | undefined, color: Color) => {
    const clockEl = node?.querySelector('.mini-game__clock--' + color) as HTMLElement;
    if (clockEl && !isNaN(time!))
      setClockWidget(clockEl, {
        time: time!,
        pause: color !== turnColor || !lichessClockIsRunning(data.fen, color),
      });
  };
  updateClock(data.wc, 'white');
  updateClock(data.bc, 'black');
};

export const finishMiniGame = (node: HTMLElement, win?: 'b' | 'w'): void =>
  COLORS.forEach(color => {
    const clock: HTMLElement | null = node.querySelector('.mini-game__clock--' + color);
    // don't interfere with snabbdom clocks
    if (clock && !clock.dataset['managed'])
      $(clock).replaceWith(
        `<span class="mini-game__result">${win ? (win === color[0] ? 1 : 0) : '½'}</span>`,
      );
  });

interface MiniGameUpdateData {
  fen: FEN;
  lm: Uci;
  wc?: number;
  bc?: number;
}
