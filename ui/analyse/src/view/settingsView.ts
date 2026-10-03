import type { BoardView } from '@lixiangqi/board';

import { frag } from 'lib';
import { createXiangqiBoard, xiangqiPosition, websiteBoardPresentation } from 'lib/board';
import { isTouchDevice } from 'lib/device';
import { XIANGQI_START_FEN } from 'lib/game/xiangqi';
import { licon } from 'lib/licon';
import { domDialog, type Dialog } from 'lib/view';

import type AnalyseCtrl from '@/ctrl';
import type { SettingsCtrl, SettingKey } from '@/settingsCtrl';

type Listener = (e: Event, ctrl: SettingsCtrl, key: SettingKey) => void;

type Setting = {
  label: string;
  group: string;
  shortcutHtml?: string;
  helpHtml?: string;
  renderHtml?: (ctrl: SettingsCtrl) => string; // otherwise defaultToggleHtml
  listener?: Listener | { events: string[]; action: Listener }; // otherwise defaultToggleListener
};

let settingValues: Record<SettingKey, Setting> | undefined;
const getSettings = (): Record<SettingKey, Setting> =>
  (settingValues ??= {
    showStaticAnalysis: {
      label: i18n.preferences.showServerAnalysis,
      shortcutHtml: '<kbd>z</kbd>',
      group: i18n.preferences.generalSettings,
      helpHtml: nativeHelp('showStaticAnalysis'),
    },
    showGauge: {
      label: i18n.preferences.showGauge,
      group: i18n.preferences.generalSettings,
      helpHtml: nativeHelp('showGauge'),
    },
    inline: {
      label: i18n.preferences.inlineNotation,
      shortcutHtml: '<kbd>shift</kbd> +<kbd>i</kbd>',
      group: i18n.preferences.moveListSettings,
      helpHtml: nativeHelp('inline'),
    },
    disclosureMode: {
      label: i18n.preferences.disclosureMode,
      group: i18n.preferences.moveListSettings,
      helpHtml: nativeHelp('disclosureMode'),
    },
    showLiveAnnotations: {
      label: i18n.preferences.showLiveGlyphs,
      group: i18n.preferences.moveListSettings,
      helpHtml: nativeHelp('showLiveAnnotations'),
    },
    showBestMoveArrows: {
      label: i18n.preferences.showBestMoveArrows,
      shortcutHtml: '<kbd>a</kbd>',
      group: i18n.preferences.boardSettings,
      helpHtml: nativeHelp('showBestMoveArrows'),
    },
    showVariationArrows: {
      label: i18n.preferences.showVariationArrows,
      shortcutHtml: '<kbd>v</kbd>',
      group: i18n.preferences.boardSettings,
      helpHtml: $html`
      ${nativeHelp('showVariationArrows')}
      <span>${i18n.site.keyCycleSelectedVariation} <kbd>shift</kbd></span>`,
    },
    showMoveAnnotationsOnBoard: {
      label: i18n.preferences.showMoveAnnotationsOnBoard,
      group: i18n.preferences.boardSettings,
      helpHtml: nativeHelp('showMoveAnnotationsOnBoard'),
    },
    showUndefendedPieces: {
      label: i18n.preferences.showUndefendedPieces,
      group: i18n.preferences.boardSettings,
      helpHtml: nativeHelp('showUndefendedPieces'),
    },
    showPinnedPieces: {
      label: i18n.preferences.showPinnedPieces,
      group: i18n.preferences.boardSettings,
      helpHtml: nativeHelp('showPinnedPieces'),
    },
    showCheckableGeneral: {
      label: i18n.preferences.showCheckableGeneral,
      group: i18n.preferences.boardSettings,
      helpHtml: nativeHelp('showCheckableGeneral'),
    },
  });

export async function showSettingsDialog(ctrl: AnalyseCtrl): Promise<Dialog> {
  let scrollableDiv: HTMLElement | null = null;
  const flexTamer = () => {
    scrollableDiv ??= document.querySelector<HTMLElement>('.analysis-settings-dialog');
    if (!scrollableDiv || isTouchDevice()) return;

    // we reflow, then freeze height as sized by initial content so hover targets can't be moved by shrinkage
    scrollableDiv.style.width = scrollableDiv.style.height = '';
    const { width, height } = scrollableDiv.getBoundingClientRect();
    scrollableDiv.style.width = `${width}px`;
    scrollableDiv.style.height = `${height}px`;
  };
  if (!isTouchDevice()) window.addEventListener('resize', flexTamer);
  return domDialog({
    class: 'analysis-settings-dialog',
    htmlText: `<h2>${i18n.preferences.analysisSettings}</h2>`,
    append: [{ node: settingsView(ctrl.settings) }],
    modal: !isTouchDevice(),
    easyClose: 'clickOutside',
    show: true,
    actions: [
      { selector: '.show-all', result: 'showKeyboardShortcuts' },
      { selector: '.ok', result: 'ok' },
    ],
    onShow: flexTamer,
    onClose: dlg => {
      window.removeEventListener('resize', flexTamer);
      destroyExamples(dlg.view);
      if (dlg.returnValue !== 'showKeyboardShortcuts') return;
      ctrl.keyboardHelp = true;
      ctrl.redraw();
    },
  });
}

export function settingsView(ctrl: SettingsCtrl): HTMLElement {
  const settings = getSettings();
  const groupedHtml = (group: keyof typeof i18n.preferences) => {
    return $html`
      <fieldset>
        <legend>${i18n.preferences[group]}</legend>
        ${Object.keys(settings)
          .filter((key: SettingKey): key is SettingKey => settings[key].group === i18n.preferences[group])
          .map(key => (settings[key].renderHtml ?? defaultToggleHtml)(ctrl, key))
          .join('')}
      </fieldset>`;
  };
  const view = frag<HTMLElement>($html`
    <div class="analysis-settings-view">
      <div class="column">
        ${helpHtml()}
        ${groupedHtml('generalSettings')}
      </div>
      <div class="column">
        ${groupedHtml('moveListSettings')}
        ${groupedHtml('boardSettings')}
      </div>
    </div>`);

  if (isTouchDevice()) setupTouchHelp(view);
  else setupHoverHelp(view);

  view.querySelectorAll<HTMLInputElement>('.setting input').forEach(input => {
    const key = input.dataset.key as SettingKey;
    if (!settings[key]) return;
    const listener = settings[key].listener ?? defaultToggleListener;
    if ('events' in listener) {
      listener.events.forEach(event => input.addEventListener(event, e => listener.action(e, ctrl, key)));
    } else {
      input.addEventListener('change', e => listener(e, ctrl, key));
    }
  });
  return view;
}

function setupTouchHelp(view: HTMLElement) {
  const settings = getSettings();
  view.querySelectorAll<HTMLElement>('.help-button').forEach(el => {
    const key = el.dataset.key as SettingKey;
    if (!settings[key]) return;
    const htmlText = settings[key].helpHtml;

    el.addEventListener('click', () =>
      domDialog({
        htmlText,
        class: 'setting-popup',
        noCloseButton: true,
        show: true,
        easyClose: 'anyClick',
        onShow: dialog => mountExamples(dialog.view),
        onClose: dialog => destroyExamples(dialog.view),
      }),
    );
  });
}

function setupHoverHelp(view: HTMLElement) {
  const settings = getSettings();
  const helpEl = () => view.querySelector<HTMLElement>('.help-container')!.firstElementChild!;
  const helpPanes = { keyboardHelp: helpEl() } as Record<string, Element>;

  let hoverTimeout: number;
  view.querySelectorAll<HTMLElement>('.hover-help').forEach(el => {
    const key = el.dataset.key as SettingKey;
    const setting = settings[key];
    if (!setting?.helpHtml) return;

    el.addEventListener('mouseenter', () => {
      clearTimeout(hoverTimeout);
      hoverTimeout = setTimeout(
        () => {
          const helpPaneEl =
            helpPanes[key] ??
            frag<HTMLElement>($html`
              <fieldset class="help-pane" data-key="${key}">
                <legend>${setting.label}</legend>
                ${setting.helpHtml}
              </fieldset>`);
          helpEl().replaceWith(helpPaneEl);
          mountExamples(helpPaneEl);
          helpPanes[key] = helpPaneEl;
        },
        helpEl() === helpPanes.keyboardHelp ? 400 : 0,
      );
    });
    el.addEventListener('mouseleave', () => {
      clearTimeout(hoverTimeout);
      hoverTimeout = setTimeout(() => helpEl().replaceWith(helpPanes.keyboardHelp), 700);
    });
  });
  if (document.querySelector('main.analyse')) return; // keyboard help is triggered by analyse snabbdom
  helpPanes.keyboardHelp.querySelector('button')!.addEventListener('click', () =>
    domDialog({
      class: 'help.keyboard-help',
      htmlUrl: '/analysis/help',
      easyClose: 'clickOutside',
      modal: true,
      show: true,
    }),
  );
}

function defaultToggleHtml(ctrl: SettingsCtrl, key: SettingKey) {
  const settings = getSettings();
  const setting = settings[key];
  const label = setting.helpHtml
    ? isTouchDevice()
      ? `<button class="help-button" data-key="${key}" data-icon="${licon.InfoCircle}">${setting.label}</button>`
      : `<span class="hover-help" data-key="${key}">${setting.label}</span>`
    : setting.label;
  return $html`
    <span class="setting">
      ${label}
      <span class="form-check__input">
        <input data-key="${key}" id="${key}" type="checkbox" ${ctrl[key] ? 'checked' : ''}>
        <label class="form-check__label" for="${key}"></label>
      </span>
    </span>`;
}

function defaultToggleListener(e: Event, ctrl: SettingsCtrl, key: SettingKey) {
  ctrl.set(key, (e.target as HTMLInputElement).checked);
}

function helpHtml() {
  const settings = getSettings();
  const settingShortcutsHtml = Object.values(settings)
    .filter(opt => opt.shortcutHtml)
    .map(opt => `<div class="setting inert">${opt.label}<span>${opt.shortcutHtml}</span></div>`)
    .join('');
  return $html`
    <div class="help-container">
      <fieldset class="help-pane" data-key="keyboardShortcuts">
        <legend>${i18n.site.keyboardShortcuts}</legend>
        <div class="setting inert">${i18n.site.flipBoard}<kbd>f</kbd></div>
        <div class="setting inert">${i18n.site.toggleLocalAnalysis}<kbd>l</kbd></div>
        ${settingShortcutsHtml}
        <button class="button button-empty button-dim show-all">${i18n.site.showAll}</button>
      </fieldset>
    </div>
    <div class="hover-hint">${i18n.preferences.hoverOverSettingLabelsForHelp}</div>`;
}

const examples = new Map<HTMLElement, BoardView>();

function nativeHelp(key: SettingKey): string {
  return $html`<div class="native-setting-example" data-example="${key}"></div><p>${i18n.preferences[`${key}Help` as keyof typeof i18n.preferences]}</p>`;
}

function mountExamples(root: Element): void {
  root.querySelectorAll<HTMLElement>('.native-setting-example').forEach(element => {
    if (examples.has(element)) return;
    const key = element.dataset.example;
    const fen =
      key === 'showPinnedPieces'
        ? '4k4/4r4/9/9/9/9/9/9/4R4/3K5 w - - 0 1'
        : key === 'showCheckableGeneral'
          ? '4k4/9/9/4R4/9/9/9/9/9/3K5 w - - 0 1'
          : XIANGQI_START_FEN;
    const board = createXiangqiBoard(element, xiangqiPosition(fen), websiteBoardPresentation({}, 'preview'));
    const marks =
      key === 'showPinnedPieces'
        ? [
            { from: 'e2', to: 'e10', brush: 'paleRed' },
            { from: 'e9', brush: 'red' },
          ]
        : key === 'showCheckableGeneral'
          ? [
              { from: 'e7', to: 'e9', brush: 'green' },
              { from: 'e10', brush: 'red' },
            ]
          : key === 'showUndefendedPieces'
            ? [{ from: 'b3', brush: 'yellow' }]
            : [
                { from: 'h1', to: 'g3', brush: 'green' },
                ...(key === 'showVariationArrows' ? [{ from: 'b1', to: 'c3', brush: 'blue' }] : []),
              ];
    board.setMarks(marks);
    examples.set(element, board);
  });
}

function destroyExamples(root: Element): void {
  for (const [element, board] of examples) {
    if (!element.isConnected || root.contains(element)) {
      board.destroy();
      examples.delete(element);
    }
  }
}
