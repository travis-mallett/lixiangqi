import { span } from './appearance';
import type { MotionHost } from './types';

const namespace = 'http://www.w3.org/2000/svg';

/** One origin, destination and connector implementation for every board topology. */
export function syncIndicators(host: MotionHost): void {
  const surface = host.surface;
  const move = host.highlight ? host.lastMove : undefined;
  const origin = move?.[0],
    destination = move?.[move.length - 1];
  const size = host.size();
  for (const [kind, location] of [
    ['origin', origin],
    ['destination', destination],
  ] as const) {
    let marker = surface.querySelector<HTMLElement>(`.board-marker.last-move-${kind}`);
    if (!location) {
      marker?.remove();
      continue;
    }
    if (!marker) {
      marker = document.createElement('span');
      marker.className = `board-marker last-move-${kind}`;
      marker.setAttribute('aria-hidden', 'true');
      surface.prepend(marker);
    }
    marker.dataset.location = location;
    const point = host.point(location);
    marker.style.transform = `translate3d(${point[0]}px,${point[1]}px,0)`;
    marker.style.width = `${size[0]}px`;
    marker.style.height = `${size[1]}px`;
    if (!host.animating) marker.classList.remove('xiangqi-motion-underlay');
  }
  let connector = surface.querySelector<SVGSVGElement>('.xiangqi-last-move-connector');
  if (!origin || !destination || origin === destination || size[0] <= 0 || size[1] <= 0) {
    connector?.remove();
    return;
  }
  if (!connector) {
    connector = document.createElementNS(namespace, 'svg');
    connector.classList.add('xiangqi-last-move-connector');
    connector.setAttribute('aria-hidden', 'true');
    connector.append(document.createElementNS(namespace, 'line'));
    surface.prepend(connector);
  }
  // Cell-normalized units preserve the existing theme's dash and stroke sizes.
  const bounds = surface.getBoundingClientRect();
  connector.setAttribute('viewBox', `0 0 ${bounds.width / size[0] || 1} ${bounds.height / size[1] || 1}`);
  const from = host.point(origin),
    to = host.point(destination);
  const x1 = from[0] / size[0] + 0.5,
    y1 = from[1] / size[1] + 0.5;
  const x2 = to[0] / size[0] + 0.5,
    y2 = to[1] / size[1] + 0.5;
  const distance = Math.hypot(x2 - x1, y2 - y1);
  const dx = (x2 - x1) / distance,
    dy = (y2 - y1) / distance;
  const line = connector.firstElementChild!;
  for (const [name, value] of Object.entries({
    x1: x1 + dx * 0.4,
    y1: y1 + dy * 0.4,
    x2: x2 - dx * 0.5,
    y2: y2 - dy * 0.5,
  }))
    line.setAttribute(name, String(value));
}

export function destinationMarker(host: MotionHost, location: string): HTMLElement | undefined {
  const marker = host.surface.querySelector<HTMLElement>('.board-marker.last-move-destination');
  return marker?.dataset.location === location ? marker : undefined;
}

export function syncLastMovePresentation(state: MotionHost): void {
  const destination =
    state.highlight && state.lastMove ? state.lastMove[state.lastMove.length - 1] : undefined;
  let element = state.surface.firstElementChild;
  while (element) {
    if (element.tagName === 'PIECE') {
      const root = element as HTMLElement;
      root.classList.toggle('xiangqi-last-move-destination', state.key(root) === destination);
      if (state.key(root) === destination && !root.classList.contains('xiangqi-motion-piece')) {
        ensureLastMovePresentation(root);
      } else clearLastMovePresentation(root);
    }
    element = element.nextElementSibling;
  }
}

function ensureLastMovePresentation(root: HTMLElement): void {
  if (root.classList.contains('xiangqi-last-move-piece')) return;
  const highlight = span('xiangqi-last-move-highlight');
  root.append(highlight);
  root.classList.add('xiangqi-last-move-piece');
}

export function clearLastMovePresentation(root: HTMLElement): void {
  if (!root.classList.contains('xiangqi-last-move-piece')) return;
  root.classList.remove('xiangqi-last-move-piece');
  root.querySelector('.xiangqi-last-move-highlight')?.remove();
}
