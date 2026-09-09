/**
 * Center an active item in an overflowable horizontal move list.
 *
 * Round replay (including LiXiangQiTV) and the analysis board use this same
 * mobile interaction. Keeping the calculation here prevents their scroll
 * behavior from drifting apart.
 */
export function horizontalMoveListScrollPosition(container: HTMLElement, active: HTMLElement): number {
  return Math.max(0, active.offsetLeft - container.clientWidth / 2 + active.offsetWidth / 2);
}
