import { gaugeDockAtPoint, isGaugeDock, type GaugeDock } from './gaugeDock';

export const ENGINE_SETTINGS_KEY = 'lixiangqi.analysis.engine.v1';
export const INTERFACE_SETTINGS_KEY = 'lixiangqi.analysis.interface.v1';

export interface EngineSettings {
  useCloud: boolean;
  showLinesPreview: boolean;
  depth: number;
  multiPv: number;
  threads: number;
  hashSize: number;
}

export interface InterfaceSettings {
  notationLayout: 'two-column' | 'compact';
  inline: boolean;
  annotations: boolean;
  gauge: boolean;
  gaugeDock: GaugeDock;
  lockPanels: boolean;
  bestArrow: boolean;
  variationArrows: boolean;
  coordinates: boolean;
}

export function loadEngineSettings(): EngineSettings {
  const defaults: EngineSettings = {
    useCloud: true,
    showLinesPreview: true,
    depth: 20,
    multiPv: 3,
    threads: 2,
    hashSize: 64,
  };
  const stored = readStoredSettings<Partial<EngineSettings>>(ENGINE_SETTINGS_KEY, {});
  return {
    useCloud: stored.useCloud !== false,
    showLinesPreview: stored.showLinesPreview !== false,
    depth: clampNumber(stored.depth, 10, 30, defaults.depth),
    multiPv: clampNumber(stored.multiPv, 1, 5, defaults.multiPv),
    threads: clampNumber(stored.threads, 1, 8, defaults.threads),
    hashSize: clampNumber(stored.hashSize, 16, 256, defaults.hashSize, 16),
  };
}

export function loadInterfaceSettings(): InterfaceSettings {
  const stored = readStoredSettings<Partial<InterfaceSettings>>(INTERFACE_SETTINGS_KEY, {});
  return {
    inline: false,
    annotations: true,
    gauge: true,
    lockPanels: false,
    bestArrow: true,
    variationArrows: false,
    coordinates: true,
    ...stored,
    gaugeDock: isGaugeDock(stored.gaugeDock) ? stored.gaugeDock : 'left',
    notationLayout: stored.notationLayout === 'compact' ? 'compact' : 'two-column',
  };
}

export function applyInterfaceSettingsClasses(
  settings: InterfaceSettings,
  page: HTMLElement,
  evaluation: HTMLElement,
): void {
  page.classList.toggle('two-column-notation', settings.notationLayout === 'two-column');
  page.classList.toggle('inline-notation', settings.inline);
  page.classList.toggle('annotations-hidden', !settings.annotations);
  page.classList.toggle('gauge-hidden', !settings.gauge);
  page.classList.toggle('panels-locked', settings.lockPanels);
  applyGaugeDockClass(page, settings.gaugeDock);
  evaluation.title = settings.lockPanels
    ? 'Evaluation bar position is locked'
    : 'Drag to dock the evaluation bar';
}

export function setupGaugeDocking(
  evaluation: HTMLElement,
  status: HTMLElement,
  settings: () => InterfaceSettings,
  dock: (location: GaugeDock) => void,
  layoutChanged: () => void,
): void {
  const page = requiredElement('.xiangqi-analysis-page');
  const board = requiredElement('.xiangqi-analysis-board > .main-board');
  const overlay = requiredElement('.xiangqi-dock-overlay');
  const targets = new Map<GaugeDock, HTMLElement>();
  overlay.querySelectorAll<HTMLElement>('[data-dock]').forEach(target => {
    if (isGaugeDock(target.dataset.dock)) targets.set(target.dataset.dock, target);
  });

  let drag:
    | {
        pointerId: number;
        startX: number;
        startY: number;
        origin: GaugeDock;
        boardRect: DOMRect;
        active?: GaugeDock;
        started: boolean;
        ghost?: HTMLElement;
      }
    | undefined;

  const positionGhost = (ghost: HTMLElement, event: PointerEvent): void => {
    ghost.style.translate = `${event.clientX + 14}px ${event.clientY + 14}px`;
  };

  const preview = (location: GaugeDock | undefined): void => {
    if (!drag || drag.active === location) return;
    drag.active = location;
    applyGaugeDockClass(page, location ?? drag.origin);
    targets.forEach((target, targetDock) => target.classList.toggle('active', targetDock === location));
    status.textContent = location
      ? `Dock preview: ${location}. Release to place the evaluation bar.`
      : 'No dock target. Release to cancel.';
    layoutChanged();
  };

  const begin = (event: PointerEvent): void => {
    if (!drag || drag.started) return;
    drag.started = true;
    page.classList.add('gauge-dragging');
    document.body.classList.add('dragging-xiangqi-gauge');
    const ghost = evaluation.cloneNode(true) as HTMLElement;
    ghost.removeAttribute('id');
    ghost.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'));
    ghost.removeAttribute('role');
    ghost.removeAttribute('aria-label');
    ghost.classList.add('xiangqi-eval-drag-ghost');
    ghost.setAttribute('aria-hidden', 'true');
    document.body.append(ghost);
    drag.ghost = ghost;
    positionGhost(ghost, event);
  };

  const finish = (commit: boolean): void => {
    if (!drag) return;
    const completed = drag;
    drag = undefined;
    completed.ghost?.remove();
    page.classList.remove('gauge-dragging');
    document.body.classList.remove('dragging-xiangqi-gauge');
    targets.forEach(target => target.classList.remove('active'));
    applyGaugeDockClass(page, completed.origin);
    if (commit && completed.active) dock(completed.active);
    else {
      layoutChanged();
      if (completed.started) status.textContent = 'Evaluation bar move cancelled.';
    }
  };

  evaluation.addEventListener('pointerdown', event => {
    const current = settings();
    if (current.lockPanels || !current.gauge || event.button !== 0 || !event.isPrimary) return;
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: current.gaugeDock,
      boardRect: board.getBoundingClientRect(),
      started: false,
    };
    evaluation.setPointerCapture(event.pointerId);
    event.preventDefault();
  });

  evaluation.addEventListener('pointermove', event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    const threshold = event.pointerType === 'touch' ? 10 : 6;
    if (!drag.started && distance < threshold) return;
    begin(event);
    if (!drag) return;
    if (drag.ghost) positionGhost(drag.ghost, event);
    preview(gaugeDockAtPoint(event.clientX, event.clientY, drag.boardRect));
  });

  evaluation.addEventListener('pointerup', event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const commit = drag.started;
    finish(commit);
    if (evaluation.hasPointerCapture(event.pointerId)) evaluation.releasePointerCapture(event.pointerId);
  });
  evaluation.addEventListener('pointercancel', () => finish(false));
  evaluation.addEventListener('lostpointercapture', () => finish(false));
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !drag?.started) return;
    event.preventDefault();
    finish(false);
  });
}

function applyGaugeDockClass(page: HTMLElement, dock: GaugeDock): void {
  page.classList.remove('gauge-dock-top', 'gauge-dock-right', 'gauge-dock-bottom', 'gauge-dock-left');
  page.classList.add(`gauge-dock-${dock}`);
}

function readStoredSettings<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function clampNumber(value: unknown, min: number, max: number, fallback: number, step = 1): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, Math.round(numeric / step) * step));
}

function requiredElement<T extends HTMLElement = HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing Xiangqi analysis element: ${selector}`);
  return element;
}
