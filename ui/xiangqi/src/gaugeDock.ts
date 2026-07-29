export const GAUGE_DOCKS = ['top', 'right', 'bottom', 'left'] as const;

export type GaugeDock = (typeof GAUGE_DOCKS)[number];

export interface DockRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export function isGaugeDock(value: unknown): value is GaugeDock {
  return typeof value === 'string' && GAUGE_DOCKS.includes(value as GaugeDock);
}

export function gaugeDockAtPoint(
  x: number,
  y: number,
  rect: DockRect,
  activationPadding = 72,
): GaugeDock | undefined {
  if (
    x < rect.left - activationPadding ||
    x > rect.right + activationPadding ||
    y < rect.top - activationPadding ||
    y > rect.bottom + activationPadding
  )
    return undefined;

  const horizontal = (x - (rect.left + rect.width / 2)) / Math.max(rect.width, 1);
  const vertical = (y - (rect.top + rect.height / 2)) / Math.max(rect.height, 1);
  if (Math.abs(horizontal) > Math.abs(vertical)) return horizontal < 0 ? 'left' : 'right';
  return vertical < 0 ? 'top' : 'bottom';
}
