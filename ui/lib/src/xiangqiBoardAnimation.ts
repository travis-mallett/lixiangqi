const ANIMATION_NAMES = ['capture', 'check', 'checkmate'] as const;
const ANIMATION_PATHS: Record<XiangqiBoardAnimationName, string> = {
  capture: 'images/board-animations/lixiangqi-default/capture/animation.webp',
  check: 'images/board-animations/lixiangqi-default/check/animation.webp',
  checkmate: 'images/board-animations/lixiangqi-default/checkmate/animation.webp',
};
const ANIMATION_DURATIONS_MS: Record<XiangqiBoardAnimationName, number> = {
  capture: 1200,
  check: 1200,
  checkmate: 1500,
};
const XIANGQI_BOARD_SELECTOR = '.cg-wrap.xiangqi9x10:not(.mini-board)';
const PRELOAD_ATTRIBUTE = 'data-xiangqi-board-animation';
const ALL_ANIMATIONS_MASK = 15;
const ANIMATION_BITS: Record<XiangqiBoardAnimationName, number> = {
  capture: 2,
  check: 4,
  checkmate: 8,
};

export type XiangqiBoardAnimationName = (typeof ANIMATION_NAMES)[number];

interface ActiveAnimation {
  element: HTMLElement;
  timeout: ReturnType<typeof setTimeout>;
}

const activeAnimations = new WeakMap<HTMLElement, ActiveAnimation>();
let animationSequence = 0;

function configuredAnimationMask(): number {
  const configured = Number.parseInt(document.body.dataset.boardAnimations ?? '', 10);
  return Number.isInteger(configured) ? configured & ALL_ANIMATIONS_MASK : ALL_ANIMATIONS_MASK;
}

export function xiangqiBoardAnimationEnabled(name: XiangqiBoardAnimationName): boolean {
  return (configuredAnimationMask() & ANIMATION_BITS[name]) !== 0;
}

function animationAllowed(name: XiangqiBoardAnimationName): boolean {
  return (
    xiangqiBoardAnimationEnabled(name) && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
}

export function preloadXiangqiBoardAnimations(): void {
  if (!site.asset?.url) return;

  for (const name of ANIMATION_NAMES) {
    if (!xiangqiBoardAnimationEnabled(name)) continue;
    if (document.head.querySelector<HTMLLinkElement>(`link[${PRELOAD_ATTRIBUTE}="${name}"]`)) continue;

    const preload = document.createElement('link');
    preload.rel = 'preload';
    preload.as = 'image';
    preload.type = 'image/webp';
    preload.href = site.asset.url(ANIMATION_PATHS[name]);
    preload.setAttribute(PRELOAD_ATTRIBUTE, name);
    document.head.append(preload);
  }
}

export function findPrimaryXiangqiBoard(root: ParentNode = document): HTMLElement | undefined {
  return [...root.querySelectorAll<HTMLElement>(XIANGQI_BOARD_SELECTOR)]
    .filter(board => !board.closest('.mini-game'))
    .map(board => ({ board, bounds: board.getBoundingClientRect() }))
    .filter(({ bounds }) => bounds.width > 0 && bounds.height > 0)
    .sort((a, b) => b.bounds.width * b.bounds.height - a.bounds.width * a.bounds.height)[0]?.board;
}

export function stopXiangqiBoardAnimation(board: HTMLElement): void {
  const active = activeAnimations.get(board);
  if (!active) return;
  clearTimeout(active.timeout);
  active.element.remove();
  activeAnimations.delete(board);
}

export function playXiangqiBoardAnimation(
  name: XiangqiBoardAnimationName,
  board: HTMLElement | undefined = findPrimaryXiangqiBoard(),
): void {
  if (!board || !animationAllowed(name)) return;

  stopXiangqiBoardAnimation(board);

  const overlay = document.createElement('span');
  overlay.className = `xiangqi-board-animation xiangqi-board-animation--${name}`;
  overlay.setAttribute('aria-hidden', 'true');

  const image = document.createElement('img');
  image.className = 'xiangqi-board-animation__image';
  image.alt = '';
  image.draggable = false;
  image.src = `${site.asset.url(ANIMATION_PATHS[name])}#${++animationSequence}`;
  overlay.append(image);
  board.append(overlay);

  activeAnimations.set(board, {
    element: overlay,
    timeout: setTimeout(() => stopXiangqiBoardAnimation(board), ANIMATION_DURATIONS_MS[name]),
  });
}
