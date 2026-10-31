import type { BoardView } from '@lixiangqi/board';

import { dispatchChessgroundResize } from 'lib/boardResize';
import { domDialog, type Dialog } from 'lib/view';

import {
  applyInterfaceSettingsClasses,
  INTERFACE_SETTINGS_KEY,
  setupGaugeDocking,
  type InterfaceSettings,
} from './analysisSettings';
import type { AnalysisTreeView } from './analysisTreeView';
import { isGaugeDock, type GaugeDock } from './gaugeDock';

interface Options {
  page: HTMLElement;
  eval: HTMLElement;
  ground: BoardView;
  treeView: Pick<AnalysisTreeView, 'render'>;
  perspectives?: readonly string[];
  share?: () => void;
  edit?: () => void;
  fenInput: HTMLTextAreaElement;
  saveStatus: HTMLElement;
  settings: () => InterfaceSettings;
  fixedSettings?: Partial<InterfaceSettings>;
  updateSettings: (settings: InterfaceSettings) => void;
  currentFen: () => string;
  loadFen: (fen: string) => void;
  renderBoardOverlays: () => void;
}

export function bindAnalysisInterfaceControls(options: Options): void {
  const panel = requiredElement('#xiangqi-interface-settings');
  const panelButton = requiredElement<HTMLButtonElement>('#xiangqi-interface-settings-button');
  const dockStatus = requiredElement('#xiangqi-dock-status');

  const persist = (): void => {
    localStorage.setItem(INTERFACE_SETTINGS_KEY, JSON.stringify(options.settings()));
  };
  const apply = (): void => {
    applyInterfaceSettingsClasses(
      { ...options.settings(), ...options.fixedSettings },
      options.page,
      options.eval,
    );
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

  setupGaugeDocking(
    options.eval,
    dockStatus,
    () => ({ ...options.settings(), ...options.fixedSettings }),
    setGaugeDock,
    settleDockLayout,
  );

  const panelHome = panel.parentElement!;
  let dialog: Dialog | undefined;
  let opening = false;
  const close = (): void => dialog?.close();
  const open = (): void => {
    if (dialog || opening) return;
    opening = true;
    void domDialog({
      class: 'xiangqi-interface-settings-modal',
      append: [{ node: panel }],
      modal: true,
      show: true,
      noCloseButton: true,
      easyClose: 'clickOutside',
      attrs: { dialog: { 'aria-labelledby': 'xiangqi-interface-settings-title' } },
      onShow: opened => {
        dialog = opened;
        opening = false;
        panel.hidden = false;
        panelButton.setAttribute('aria-expanded', 'true');
        requiredElement<HTMLButtonElement>('#xiangqi-interface-settings-close').focus();
      },
      onClose: () => {
        panel.hidden = true;
        panelHome.append(panel);
        panelButton.setAttribute('aria-expanded', 'false');
        dialog = undefined;
      },
    });
  };
  panelButton.addEventListener('click', open);
  requiredElement('#xiangqi-interface-settings-close').addEventListener('click', close);

  requiredElement('#xiangqi-flip').addEventListener('click', () => {
    const perspectives = options.perspectives ?? ['red', 'black'];
    const index = perspectives.indexOf(options.ground.getPresentation().perspective);
    options.ground.setPresentation({
      ...options.ground.getPresentation(),
      perspective: perspectives[(index + 1) % perspectives.length],
    });
    options.renderBoardOverlays();
  });
  requiredElement('#xiangqi-edit-position').addEventListener('click', () => {
    close();
    if (options.edit) return options.edit();
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
    if (options.share) {
      options.share();
      close();
      return;
    }
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
    if (options.fixedSettings?.[key] !== undefined) {
      input.closest<HTMLElement>('label')!.hidden = true;
      return;
    }
    input.checked = options.settings()[key];
    input.addEventListener('change', () => {
      options.updateSettings({ ...options.settings(), [key]: input.checked });
      persist();
      apply();
      if (key === 'gauge') settleDockLayout();
      options.ground.setPresentation({
        ...options.ground.getPresentation(),
        coordinates: options.settings().coordinates,
      });
      options.renderBoardOverlays();
    });
  });

  syncGaugeDockInputs();
  if (options.fixedSettings?.gauge === false || options.fixedSettings?.gaugeDock)
    requiredElement('.xiangqi-gauge-dock-settings').hidden = true;
  panel.querySelectorAll<HTMLInputElement>('input[name="xiangqi-gauge-dock"]').forEach(input => {
    input.addEventListener('change', () => {
      if (input.checked && isGaugeDock(input.value)) setGaugeDock(input.value);
    });
  });
  panel.querySelectorAll<HTMLInputElement>('input[name="xiangqi-notation-layout"]').forEach(input => {
    if (options.fixedSettings?.notationLayout) {
      input.closest<HTMLElement>('.xiangqi-setting-radios')!.hidden = true;
      return;
    }
    input.checked = input.value === options.settings().notationLayout;
    input.addEventListener('change', () => {
      if (!input.checked || (input.value !== 'two-column' && input.value !== 'compact')) return;
      options.updateSettings({ ...options.settings(), notationLayout: input.value });
      persist();
      apply();
      options.treeView.render();
    });
  });
  apply();
}

function requiredElement<T extends HTMLElement = HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing Xiangqi analysis element: ${selector}`);
  return element;
}
