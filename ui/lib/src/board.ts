import {
  createBoard,
  boardPresentation,
  positionFromFen,
  coordinateMove,
  boardDefinition,
  boardDefinitionForFen,
  moveDestinations,
  type BoardView,
  type BoardPosition,
  type BoardPresentation,
  type BoardInteraction,
  type BoardPurpose,
} from '@lixiangqi/board';

import resizeHandle from './boardResize';
import { MoveEvent, ShowResizeHandle } from './prefs';

export function makeBoardResizable(
  board: BoardView,
  preference: ShowResizeHandle = ShowResizeHandle.Always,
  ply = 0,
  visible?: (ply: number) => boolean,
): void {
  document.body.style.setProperty(
    '--board-aspect-ratio',
    board.element.style.getPropertyValue('--board-aspect-ratio'),
  );
  publishBoardDimensions(board, document.body);
  if (preference === ShowResizeHandle.Never) return;
  const container = document.createElement('span');
  board.mountControl(container);
  board.onDestroy(resizeHandle({ container }, preference, ply, visible));
}

/** Page layout owns the measurement scope; previews never overwrite the main board's sizing. */
export function publishBoardDimensions(board: BoardView, target: HTMLElement): void {
  const update = () => {
    const { width, height } = board.element.getBoundingClientRect();
    target.style.setProperty('--cg-width', `${width}px`);
    target.style.setProperty('--cg-height', `${height}px`);
  };
  update();
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(update);
    observer.observe(board.element);
    board.onDestroy(() => observer.disconnect());
  } else {
    window.addEventListener('resize', update);
    board.onDestroy(() => window.removeEventListener('resize', update));
  }
}

export interface BoardPreferences {
  animationDuration?: number;
  moveEvent?: MoveEvent;
  highlight?: boolean;
}

export function boardInput(preferences: BoardPreferences = {}): 'drag' | 'click' | 'both' {
  return preferences.moveEvent === MoveEvent.Drag
    ? 'drag'
    : preferences.moveEvent === MoveEvent.ClickOrDrag
      ? 'both'
      : 'click';
}

/** Resolve website preferences once at the boundary; standalone embeds choose their own settings. */
export function websiteBoardPresentation(
  preferences: BoardPreferences = {},
  purpose: BoardPurpose = 'interactive',
  perspective = 'red',
): BoardPresentation {
  const preset = boardPresentation(purpose, perspective);
  const configured = Number.parseInt(document.body.dataset.boardAnimations ?? '', 10);
  const mask = Number.isInteger(configured) ? configured : 15;
  const bits = { capture: 2, check: 4, checkmate: 8, defeat: 8 };
  return {
    ...preset,
    highlight: preferences.highlight ?? preset.highlight,
    motion: {
      duration: purpose === 'preview' ? 0 : (preferences.animationDuration ?? preset.motion.duration),
    },
    feedback: {
      ...preset.feedback,
      effects: preset.feedback.effects.filter(effect => !!(mask & bits[effect])),
    },
  };
}

export function xiangqiPlay(
  board: BoardView,
  participant: string,
  moves: readonly string[],
  onMove: (move: string) => void,
  preferences: BoardPreferences = {},
  enabled = true,
): BoardInteraction {
  if (!enabled) return { mode: 'display' };
  return {
    mode: 'play',
    participant,
    destinations: moveDestinations(moves),
    input: boardInput(preferences),
    showDestinations: true,
    onMove: ({ from, to }) => {
      board.setInteraction({ mode: 'display' });
      onMove(`${from}${to}`);
    },
  };
}

/** The website boundary supplies assets and settings; the board package has no site globals. */
export function createXiangqiBoard(
  element: HTMLElement,
  position: BoardPosition,
  presentation: BoardPresentation = boardPresentation('interactive', 'red'),
  interaction: BoardInteraction = { mode: 'display' },
): BoardView {
  const board = createBoard(element, {
    definition: boardDefinition(position.board ?? 'xiangqi'),
    position,
    presentation,
    interaction,
    services: {
      assetUrl: path => site.asset.url(path),
      inactivePieceLabel: i18n.threeKingdoms?.fallenGeneral,
      reducedMotion: () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
      sound: cue => {
        if (cue.move)
          site.sound.move({
            capture: cue.effects.includes('capture'),
            check: cue.effects.includes('check'),
            mate: cue.effects.includes('checkmate'),
          });
        else {
          const effect = (['checkmate', 'check', 'capture'] as const).find(name =>
            cue.effects.includes(name),
          );
          if (effect) void site.sound.play(effect);
        }
      },
    },
  });
  // The website's outer frame reserves space for its absolutely positioned renderer.
  // Keep this local: a history page can contain several different board geometries.
  const frame = element.parentElement;
  if (frame?.classList.contains('main-board'))
    frame.style.setProperty('--board-aspect-ratio', element.style.getPropertyValue('--board-aspect-ratio'));
  return board;
}

export function xiangqiPosition(fen: string, lastMove?: string, check = false): BoardPosition {
  const position = positionFromFen(fen, boardDefinitionForFen(fen));
  return {
    ...position,
    lastMove: lastMove ? coordinateMove(lastMove) : undefined,
    checked: check
      ? [...position.pieces]
          .filter(
            ([, piece]) =>
              piece.face === 'up' && piece.role === 'general' && piece.participant === position.active,
          )
          .map(([location]) => location)
      : [],
  };
}
