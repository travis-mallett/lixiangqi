// no side effects allowed due to re-export by index.ts

import type { Api } from 'chessgroundx/api';
import { Chessground as makeChessground } from 'chessgroundx/chessground';
import type { Config } from 'chessgroundx/config';
import { Notation } from 'chessgroundx/types';
import { COLORS } from 'chessops';
import { h, type VNode } from 'snabbdom';

import * as domData from '@/data';
import { fenColor } from '@/game/chess';
import { formatMs, lichessClockIsRunning, setClockWidget } from '@/game/clock/clockWidget';
import {
  isRecordedClockTimeline,
  RecordedClockPlayback,
  type RecordedClockFrame,
  type RecordedClockTimeline,
} from '@/game/replay/recordedClockPlayback';
import { XIANGQI_DIMENSIONS, xiangqiUciMoveToCg } from '@/game/xiangqi';
import { pubsub } from '@/pubsub';
import { wsSend } from '@/socket';
import { playXiangqiBoardAnimation } from '@/xiangqiBoardAnimation';

interface MiniGameReplay {
  animationMillis: number;
  checks: Set<number>;
  initialFen: FEN;
  mate: boolean;
  moves: Uci[];
  recordedClock: RecordedClockTimeline;
}

const readMiniGameReplay = (node: Element): MiniGameReplay | undefined => {
  const initialFen = node.getAttribute('data-replay-initial-fen'),
    moves = node.getAttribute('data-replay-moves')?.split(' ').filter(Boolean);
  if (!initialFen || !moves?.length) return;

  const rawRecordedClock = node.getAttribute('data-recorded-clock');
  if (!rawRecordedClock) return;
  let recordedClock: unknown;
  try {
    recordedClock = JSON.parse(rawRecordedClock);
  } catch {
    return;
  }
  if (!isRecordedClockTimeline(recordedClock) || recordedClock.delays.length !== moves.length) return;
  return {
    animationMillis: Number.parseInt(
      node.getAttribute('data-replay-animation') ||
        node.closest('[data-mini-game-animation]')?.getAttribute('data-mini-game-animation') ||
        '250',
      10,
    ),
    checks: new Set(
      (node.getAttribute('data-replay-checks') || '')
        .split(',')
        .filter(Boolean)
        .map(value => Number.parseInt(value, 10)),
    ),
    initialFen,
    mate: node.getAttribute('data-replay-mate') === 'true',
    moves,
    recordedClock,
  };
};

const startMiniGameReplay = (node: Element, cg: Api, replay: MiniGameReplay): void => {
  const board = node.querySelector<HTMLElement>('.cg-wrap') || undefined;
  const playback: { controller?: RecordedClockPlayback } = {};
  const resetBoard = () => {
    cg.set({ animation: { enabled: false } });
    cg.set({ fen: replay.initialFen, lastMove: undefined });
    cg.set({ animation: { enabled: replay.animationMillis > 0, duration: replay.animationMillis } });
  };
  const renderClock = (frame: RecordedClockFrame) => {
    if (!node.isConnected) {
      playback.controller?.destroy();
      return;
    }
    (['white', 'black'] as Color[]).forEach(color => {
      const element = node.querySelector<HTMLElement>(`.mini-game__clock--${color}`);
      if (!element) return;
      element.textContent = formatMs(frame[color]);
      element.classList.toggle('clock--run', frame.activeColor === color);
    });
  };

  const controller = new RecordedClockPlayback(replay.recordedClock, {
    currentPosition: () => 0,
    goToPosition: position => {
      if (position === 0) {
        resetBoard();
        return;
      }
      const moveIndex = position - 1;
      const [orig, dest] = xiangqiUciMoveToCg(replay.moves[moveIndex]),
        capture = !!cg.state.boardState.pieces.get(dest);
      cg.move(orig, dest);
      cg.set({ lastMove: [orig, dest] });
      if (replay.mate && moveIndex === replay.moves.length - 1) playXiangqiBoardAnimation('checkmate', board);
      else if (replay.checks.has(moveIndex)) playXiangqiBoardAnimation('check', board);
      else if (capture) playXiangqiBoardAnimation('capture', board);
    },
    renderClock,
    ended: () => {
      window.setTimeout(() => {
        if (node.isConnected) controller.start();
        else controller.destroy();
      }, 5000);
    },
  });
  playback.controller = controller;
  controller.start();
};

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
    replay = readMiniGameReplay(node),
    config: Config = {
      coordinates: false,
      viewOnly: true,
      fen: replay?.initialFen || fen,
      orientation: color as Color,
      lastMove: replay ? undefined : lm ? xiangqiUciMoveToCg(lm) : undefined,
      dimensions: XIANGQI_DIMENSIONS,
      notation: Notation.XIANGQI_HANNUM,
      kingRoles: ['k-piece'],
      autoCastle: false,
      animation: replay
        ? {
            enabled: replay.animationMillis > 0,
            duration: replay.animationMillis,
          }
        : undefined,
      drawable: {
        enabled: false,
        visible: false,
      },
    },
    $el = $(node).removeClass('mini-game--init'),
    $cg = $el.find('.cg-wrap').addClass('xiangqi9x10'),
    turnColor = fenColor(fen);

  const cg = makeChessground($cg[0] as HTMLElement, config);
  domData.set($cg[0] as Element, 'chessground', cg);
  if (replay) startMiniGameReplay(node, cg, replay);

  if (!replay)
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
