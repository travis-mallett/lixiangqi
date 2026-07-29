import type { Api } from 'chessgroundx/api';

import { dispatchChessgroundResize } from 'lib/chessgroundResize';

import {
  applyInterfaceSettingsClasses,
  INTERFACE_SETTINGS_KEY,
  setupGaugeDocking,
  type InterfaceSettings,
} from './analysisSettings';
import type { AnalysisTreeView } from './analysisTreeView';
import { isGaugeDock, type GaugeDock } from './gaugeDock';
import { setXiangqiCoordinates } from './index';

interface Options {
  page: HTMLElement;
  eval: HTMLElement;
  ground: Api;
  treeView: AnalysisTreeView;
  fenInput: HTMLTextAreaElement;
  saveStatus: HTMLElement;
  settings: () => InterfaceSettings;
  updateSettings: (settings: InterfaceSettings) => void;
  currentFen: () => string;
  loadFen: (fen: string) => void;
  renderArrows: () => void;
}

export function bindAnalysisInterfaceControls(options: Options): void {
  const panel = requiredElement('#xiangqi-interface-settings');
  const panelButton = requiredElement<HTMLButtonElement>('#xiangqi-interface-settings-button');
  const dockStatus = requiredElement('#xiangqi-dock-status');

  const persist = (): void => {
    localStorage.setItem(INTERFACE_SETTINGS_KEY, JSON.stringify(options.settings()));
  };
  const apply = (): void => {
    applyInterfaceSettingsClasses(options.settings(), options.page, options.eval);
  };
  const settleDockLayout = (): void => {
    requestAnimationFrame(() => dispatchChessgroundResize());
    window.setTimeout(() => dispatchChessgroundResize(), 220);
  };
  const syncGaugeDockInputs = (): void => {
    panel
      .querySelectorAll<HTMLInputElement>('input[name="xiangqi-gauge-dock"]')
      .forEach(input => (input.checked = input.value === options.settings().gaugeDock));
  };
  const setGaugeDock = (dock: GaugeDock, announce = true): void => {
    if (dock !== options.settings().gaugeDock) {
      options.updateSettings({ ...options.settings(), gaugeDock: dock });
      persist();
      apply();
      syncGaugeDockInputs();
      settleDockLayout();
    }
    if (announce) dockStatus.textContent = `Evaluation bar docked ${dock}.`;
  };

  setupGaugeDocking(options.eval, dockStatus, options.settings, setGaugeDock, settleDockLayout);

  const close = (): void => {
    panel.hidden = true;
    panelButton.setAttribute('aria-expanded', 'false');
  };
  const open = (): void => {
    panel.hidden = false;
    panelButton.setAttribute('aria-expanded', 'true');
    requiredElement<HTMLButtonElement>('#xiangqi-interface-settings-close').focus();
  };
  panelButton.addEventListener('click', open);
  requiredElement('#xiangqi-interface-settings-close').addEventListener('click', close);
  panel.querySelector('.xiangqi-interface-settings__scrim')?.addEventListener('click', close);
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || panel.hidden) return;
    event.preventDefault();
    close();
    panelButton.focus();
  });

  requiredElement('#xiangqi-flip').addEventListener('click', () => {
    options.ground.toggleOrientation();
    options.renderArrows();
  });
  requiredElement('#xiangqi-edit-position').addEventListener('click', () => {
    close();
    options.fenInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    options.fenInput.focus({ preventScroll: true });
    options.fenInput.select();
  });
  requiredElement('#xiangqi-continue-here').addEventListener('click', () => {
    const fen = options.currentFen();
    close();
    options.loadFen(fen);
  });
  requiredElement('#xiangqi-share-position').addEventListener('click', () => {
    const url = new URL(location.href);
    url.searchParams.set('fen', options.currentFen());
    void navigator.clipboard.writeText(url.toString());
    options.saveStatus.textContent = 'Position link copied';
    close();
  });

  type InterfaceToggle = Exclude<keyof InterfaceSettings, 'notationLayout' | 'gaugeDock'>;
  const controls: Array<[string, InterfaceToggle]> = [
    ['#xiangqi-setting-inline', 'inline'],
    ['#xiangqi-setting-annotations', 'annotations'],
    ['#xiangqi-setting-gauge', 'gauge'],
    ['#xiangqi-setting-lock-panels', 'lockPanels'],
    ['#xiangqi-setting-best-arrow', 'bestArrow'],
    ['#xiangqi-setting-variation-arrows', 'variationArrows'],
    ['#xiangqi-setting-coordinates', 'coordinates'],
  ];
  controls.forEach(([selector, key]) => {
    const input = requiredElement<HTMLInputElement>(selector);
    input.checked = options.settings()[key];
    input.addEventListener('change', () => {
      options.updateSettings({ ...options.settings(), [key]: input.checked });
      persist();
      apply();
      if (key === 'gauge') settleDockLayout();
      setXiangqiCoordinates(options.ground, options.settings().coordinates);
      options.renderArrows();
    });
  });

  syncGaugeDockInputs();
  panel.querySelectorAll<HTMLInputElement>('input[name="xiangqi-gauge-dock"]').forEach(input => {
    input.addEventListener('change', () => {
      if (input.checked && isGaugeDock(input.value)) setGaugeDock(input.value);
    });
  });
  panel.querySelectorAll<HTMLInputElement>('input[name="xiangqi-notation-layout"]').forEach(input => {
    input.checked = input.value === options.settings().notationLayout;
    input.addEventListener('change', () => {
      if (!input.checked || (input.value !== 'two-column' && input.value !== 'compact')) return;
      options.updateSettings({ ...options.settings(), notationLayout: input.value });
      persist();
      apply();
      options.treeView.render();
    });
  });
}

function requiredElement<T extends HTMLElement = HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing Xiangqi analysis element: ${selector}`);
  return element;
}
