import { fitEmbed } from 'lib/fitEmbed';
import { initMiniBoard } from 'lib/view';

// https://lixiangqi.org/training/frame
window.onload = () => {
  const el = document.querySelector<HTMLElement>('#daily-puzzle');
  const board = el?.querySelector<HTMLAnchorElement>('.mini-board');

  if (!el || !board) return;

  initMiniBoard(board);

  const resize = () => fitEmbed(el);
  resize();
  window.addEventListener('resize', resize);
};
