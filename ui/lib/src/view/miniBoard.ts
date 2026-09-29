// no side effects allowed due to re-export by index.ts

import { boardPresentation, coordinateMove, recordedPosition, type BoardView } from '@lixiangqi/board';
import { COLORS } from 'chessops';
import { h, type VNode } from 'snabbdom';

import { createXiangqiBoard, xiangqiPosition } from '@/board';
import * as domData from '@/data';
import { fenColor } from '@/game/chess';
import { formatMs, lichessClockIsRunning, setClockWidget } from '@/game/clock/clockWidget';
import {
  isRecordedClockTimeline,
  RecordedClockPlayback,
  type RecordedClockFrame,
  type RecordedClockTimeline,
} from '@/game/replay/recordedClockPlayback';
import { pubsub } from '@/pubsub';
import { wsSend } from '@/socket';

interface MiniGameReplay {
  animationMillis: number;
  initialFen: FEN;
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
        '200',
      10,
    ),
    initialFen,
    moves,
    recordedClock,
  };
};

const startMiniGameReplay = (node: Element, board: BoardView, replay: MiniGameReplay): void => {
  let repeatTimer: ReturnType<typeof setTimeout> | undefined;
  const playback: { controller?: RecordedClockPlayback } = {};
  const resetBoard = () => {
    board.display(xiangqiPosition(replay.initialFen), { kind: 'jump' });
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
      const current = board.position();
      const next = recordedPosition(
        current,
        replay.moves[position - 1],
        current.active === 'red' ? 'black' : 'red',
      );
      board.display(next, { kind: 'forward' });
    },
    renderClock,
    ended: () => {
      repeatTimer = setTimeout(() => {
        if (node.isConnected) controller.start();
        else controller.destroy();
      }, 5000);
    },
  });
  playback.controller = controller;
  board.onDestroy(() => {
    controller.destroy();
    if (repeatTimer !== undefined) clearTimeout(repeatTimer);
  });
  controller.start();
};

export const initMiniBoard = (node: HTMLElement): void => {
  const [fen, orientation, lm] = node.getAttribute('data-state')!.split(',');
  initMiniBoardWith(node, {
    fen,
    orientation: orientation as Color,
    lastMove: lm ? coordinateMove(lm) : undefined,
  });
};

export interface MiniBoardOptions {
  fen: string;
  orientation?: Color;
  lastMove?: readonly string[];
  coordinates?: boolean;
  purpose?: 'thumbnail' | 'preview';
}

export const initMiniBoardWith = (node: HTMLElement, options: MiniBoardOptions): void => {
  getBoard(node)?.destroy();
  const position = xiangqiPosition(options.fen, options.lastMove?.join(''));
  const presentation = {
    ...boardPresentation(options.purpose ?? 'thumbnail', options.orientation === 'black' ? 'black' : 'red'),
    coordinates: options.coordinates ?? false,
  };
  domData.set(node, 'board', createXiangqiBoard(node, position, presentation));
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
    $el = $(node).removeClass('mini-game--init'),
    $cg = $el.find('.cg-wrap').addClass('xiangqi9x10'),
    turnColor = fenColor(fen);

  const element = $cg[0] as HTMLElement;
  getBoard(element)?.destroy();
  const position = xiangqiPosition(replay?.initialFen || fen, replay ? undefined : lm || undefined);
  const presentation = {
    ...boardPresentation('thumbnail', color === 'black' ? 'black' : 'red'),
    motion: { duration: replay?.animationMillis ?? 200 },
  };
  const board = createXiangqiBoard(element, position, presentation);
  domData.set(element, 'board', board);
  if (replay) startMiniGameReplay(node, board, replay);

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

export const getBoard = (node: HTMLElement): BoardView | undefined => domData.get(node, 'board');

export const initMiniGames = (parent?: HTMLElement): void => {
  const nodes = Array.from((parent || document).getElementsByClassName('mini-game--init')),
    ids = nodes.map(x => initMiniGame(x)).filter(id => id);
  if (ids.length) pubsub.after('socket.hasConnected').then(() => wsSend('startWatching', ids.join(' ')));
};

export const updateMiniGame = (node: HTMLElement, data: MiniGameUpdateData): void => {
  const lm = data.lm,
    board = getBoard(node.querySelector('.cg-wrap')!);
  if (board) board.display(xiangqiPosition(data.fen, lm || undefined), { kind: 'forward' });
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
