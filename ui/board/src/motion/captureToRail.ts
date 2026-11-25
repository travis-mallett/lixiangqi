import type { BoardTransition, Participant } from '../types';

/** The rail count comes from the accepted position. This disc represents the one moving victim. */
export function captureToRail(
  root: HTMLElement,
  capture: NonNullable<BoardTransition['captureToRail']>,
  perspective: Participant,
): (() => void) | undefined {
  const board = root.querySelector('cg-board')?.getBoundingClientRect();
  if (!board?.width || !/^[a-d][1-8]$/.test(capture.square) || !/^[KABRNCP]$/i.test(capture.symbol)) return;
  const target = root
    .closest('.banqi-frame')
    ?.querySelector<HTMLElement>('[data-victim="' + capture.symbol + '"]');
  if (!target) return;
  const end = target.getBoundingClientRect();
  const cell = board.width / 4;
  const file = capture.square.charCodeAt(0) - 97;
  const rank = Number(capture.square[1]) - 1;
  const left = board.left + (perspective === 'red' ? file : 3 - file) * cell;
  const top = board.top + ((perspective === 'red' ? 7 - rank : rank) * board.height) / 8;
  const disc = root.ownerDocument.createElement('piece');
  disc.className =
    'banqi-capture-flight ' +
    capture.symbol.toLowerCase() +
    '-piece ' +
    (capture.symbol === capture.symbol.toUpperCase() ? 'white' : 'black');
  Object.assign(disc.style, { left: left + 'px', top: top + 'px', width: cell + 'px', height: cell + 'px' });
  disc.setAttribute('aria-hidden', 'true');
  root.ownerDocument.body.append(disc);
  const dx = end.left + (end.width - cell) / 2 - left;
  const dy = end.top + (end.height - cell) / 2 - top;
  const transform = 'translate(' + dx + 'px,' + dy + 'px) scale(' + end.width / cell + ')';
  const animation = disc.animate(
    [
      { transform: 'none', offset: 0 },
      { transform: 'none', offset: 0.56 },
      { transform, offset: 1 },
    ],
    { duration: 445, easing: 'ease-in-out' },
  );
  const remove = () => disc.remove();
  animation.onfinish = remove;
  return () => {
    animation.cancel();
    remove();
  };
}
