import { initMiniBoard } from 'lib/view';

// https://lixiangqi.org/training/frame
window.onload = () => {
  const el = document.querySelector<HTMLElement>('#daily-puzzle');
  const board = el?.querySelector<HTMLAnchorElement>('.mini-board');

  if (!el || !board) return;

  initMiniBoard(board);

  const resize = () => {
    const windowHeight = window.innerHeight;
    if (el.offsetHeight > windowHeight) {
      const textHeightOffset = el.querySelector<HTMLElement>('span.text')?.offsetHeight ?? 0;
      el.style.maxWidth = windowHeight - textHeightOffset + 'px';
    }
  };
  resize();
  window.addEventListener('resize', resize);
};
