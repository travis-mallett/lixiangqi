// Fit a board and its surrounding captions into a fixed-size iframe. Measure the
// actual board geometry: Xiangqi and other supported boards are not square.
export function fitEmbed(element: HTMLElement): void {
  element.style.maxWidth = '';
  const board = element.querySelector<HTMLElement>('.cg-wrap');
  if (!board?.offsetHeight || element.offsetHeight <= window.innerHeight) return;
  const chromeHeight = element.offsetHeight - board.offsetHeight;
  const chromeWidth = element.offsetWidth - board.offsetWidth;
  element.style.maxWidth =
    chromeWidth +
    Math.max(0, window.innerHeight - chromeHeight) * (board.offsetWidth / board.offsetHeight) +
    'px';
}
