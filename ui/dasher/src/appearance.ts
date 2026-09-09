import { debounce } from 'lib/async';
import { prefersLightThemeQuery } from 'lib/device';
import { licon } from 'lib/licon';
import { pubsub } from 'lib/pubsub';
import { bind, dataIcon, hl, onInsert, type VNode } from 'lib/view';
import { cmnToggleWrap } from 'lib/view/cmn-toggle';
import { form as xhrForm, text as xhrText } from 'lib/xhr';

import type { DasherCtrl } from '@/ctrl';
import type {
  AppearanceState,
  BackgroundData,
  BoardThemeData,
  CatalogItem,
  PieceSetData,
  UiThemeData,
} from '@/interfaces';

import { PaneCtrl } from './interfaces';
import { header } from './util';

type BoardSetting = keyof AppearanceState['board'];
type Range = { min: number; max: number; step: number };

const customBackground = 'custom';
const noBackground = 'none';

export class AppearanceCtrl {
  private sliderKey = Date.now();
  private selectionVersion = 0;
  private backgroundVersion = 0;
  private backgroundPickerOpen: boolean;
  private readonly settingPosts = new Map<string, (value: string, version: number) => void>();
  private saveQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly root: DasherCtrl) {
    this.backgroundPickerOpen = this.current.background !== noBackground;
    this.apply();
  }

  renderUiTheme = (): VNode[] => [
    hl(
      'div.ui-theme-grid',
      this.uiThemes.map(theme =>
        hl(
          'button.ui-theme-card',
          {
            key: theme.key,
            attrs: {
              ...dataIcon(licon.Checkmark),
              type: 'button',
              title: this.catalogName(theme),
            },
            class: { active: this.current.uiTheme === theme.key },
            hook: bind('click', () => this.setComponent('uiTheme', theme.key)),
          },
          [
            hl(`span.ui-theme-preview.${theme.key}`, { attrs: this.uiThemePreviewStyle(theme) }, [
              hl('span.panel-preview'),
              hl('span.panel-preview-low'),
              hl('span.button-preview'),
            ]),
            hl('strong', this.catalogName(theme)),
          ],
        ),
      ),
    ),
    hl('div.background-image-setting', [
      cmnToggleWrap({
        id: 'appearance-backgroundImage',
        name: i18n.site.backgroundImage,
        checked: this.backgroundPickerOpen,
        change: this.toggleBackground,
        redraw: this.root.redraw,
      }),
      this.backgroundPickerOpen ? this.backgroundPicker() : null,
    ]),
  ];

  renderBoardStyle = (): VNode[] => [
    hl('div.board-settings', [
      this.sizeSlider(),
      this.boardSlider('opacity', i18n.site.opacity, { min: 0, max: 100, step: 1 }),
      this.boardSlider('brightness', i18n.site.brightness, { min: 20, max: 140, step: 1 }),
      this.boardSlider('contrast', i18n.site.contrast, { min: 40, max: 200, step: 2 }),
      this.boardSlider('saturation', i18n.site.saturation, { min: 0, max: 200, step: 2 }),
      this.boardSlider('hue', i18n.site.hue, { min: 0, max: 100, step: 1 }, value => `${value * 3.6}°`),
      hl(
        'button.text.board-reset',
        {
          attrs: { ...dataIcon(licon.Back), type: 'button' },
          hook: bind('click', this.resetBoard),
        },
        i18n.site.boardReset,
      ),
    ]),
    hl(
      'div.board-style-list',
      this.data.boards.map(board => this.boardCard(board)),
    ),
  ];

  renderBoardPieces = (): VNode[] => [
    this.pieceSection(
      i18n.site.traditional,
      this.data.pieceSets.filter(pieceSet => pieceSet.category === 'traditional'),
    ),
    this.pieceSection(
      i18n.site.graphicalSymbols,
      this.data.pieceSets.filter(pieceSet => pieceSet.category === 'graphicalSymbols'),
    ),
    this.pieceSection(
      i18n.site.other,
      this.data.pieceSets.filter(pieceSet => pieceSet.category === 'other'),
    ),
  ];

  selectMusicSet = (key: string): void => {
    if (this.data.musicSets.some(track => track.key === key) && key !== this.current.musicSet)
      this.setComponent('musicSet', key);
  };

  selectUiTheme = (key: string): void => {
    if (this.data.uiThemes.some(theme => theme.key === key) && key !== this.current.uiTheme)
      this.setComponent('uiTheme', key);
  };

  private get data() {
    return this.root.data.appearance;
  }

  private get current() {
    return this.data.current;
  }

  private set current(value: AppearanceState) {
    this.data.current = value;
  }

  private get uiThemes() {
    const order = ['system', 'dark', 'light', 'wood', 'wudang'];
    return [...this.data.uiThemes].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  }

  private readonly uiThemePreviewStyle = (theme: UiThemeData): Record<string, string> => ({
    style: [
      `--preview-bg:${theme.previewBackground}`,
      `--preview-panel:${theme.previewPanel}`,
      `--preview-panel-low:${theme.previewPanelLow}`,
      `--preview-accent:${theme.previewAccent}`,
    ].join(';'),
  });

  private readonly backgroundPicker = (): VNode =>
    hl('div.background-picker', [
      hl('div.background-list', [
        this.backgroundCard(this.data.backgrounds.find(background => background.key === noBackground)!),
        ...this.data.backgrounds
          .filter(background => background.key !== noBackground)
          .map(background => this.backgroundCard(background)),
        this.customBackgroundCard(),
      ]),
      this.current.background === customBackground ? this.customBackgroundInput() : null,
    ]);

  private readonly backgroundCard = (background: BackgroundData): VNode =>
    hl(
      'button.background-card',
      {
        key: background.key,
        attrs: { type: 'button', title: background.name },
        class: { active: this.current.background === background.key },
        hook: bind('click', () => this.setBackground(background.key)),
      },
      [
        background.image
          ? hl('img', { attrs: { src: assetPath(background.image), alt: '' } })
          : hl('span.background-placeholder'),
        hl('strong', this.catalogName(background)),
      ],
    );

  private readonly customBackgroundCard = (): VNode =>
    hl(
      'button.background-card.custom',
      {
        key: customBackground,
        attrs: { type: 'button', title: i18n.site.customImageUrl },
        class: { active: this.current.background === customBackground },
        hook: bind('click', () => this.setBackground(customBackground)),
      },
      [
        hl('span.background-placeholder', { attrs: dataIcon(licon.UploadCloud) }),
        hl('strong', i18n.site.custom),
      ],
    );

  private readonly customBackgroundInput = (): VNode =>
    hl('div.custom-background', [
      hl('label', { attrs: { for: 'appearance-background-url' } }, i18n.site.backgroundImageUrl),
      hl('input#appearance-background-url', {
        attrs: {
          type: 'url',
          inputmode: 'url',
          placeholder: 'https://',
          value: this.current.backgroundUrl || '',
        },
        hook: onInsert<HTMLInputElement>(input => {
          const save = debounce((url: string, version: number) => {
            if (version === this.backgroundVersion && isBackgroundUrl(url)) this.setBackgroundUrl(url);
          }, 350);
          input.addEventListener('input', () => save(input.value.trim(), this.backgroundVersion));
        }),
      }),
    ]);

  private readonly toggleBackground = (enabled: boolean): void => {
    this.backgroundPickerOpen = enabled;
    if (!enabled && this.current.background !== noBackground) this.setBackground(noBackground);
  };

  private readonly setBackground = (key: string): void => {
    if (key !== customBackground && !this.data.backgrounds.some(background => background.key === key)) return;
    this.backgroundVersion++;
    this.current = {
      ...this.current,
      background: key,
      backgroundUrl: key === customBackground ? this.current.backgroundUrl : undefined,
    };
    this.apply();
    this.post('background', key);
    this.root.redraw();
  };

  private readonly setBackgroundUrl = (url: string): void => {
    this.current = { ...this.current, background: customBackground, backgroundUrl: url };
    this.apply();
    this.post('backgroundUrl', url);
    this.root.redraw();
  };

  private readonly boardCard = (board: BoardThemeData): VNode =>
    hl(
      'button',
      {
        key: board.key,
        attrs: { type: 'button', title: board.name, 'aria-label': board.name },
        class: { active: this.current.boardTheme === board.key },
        hook: bind('click', () => this.setComponent('boardTheme', board.key)),
      },
      hl('span', { attrs: this.boardPreviewStyle(board.key) }),
    );

  private readonly boardPreviewStyle = (key: string): Record<string, string> => {
    const board = this.data.boards.find(candidate => candidate.key === key)!;
    return { style: `background-image:url(${site.asset.url(`images/board/${board.file}`)})` };
  };

  private readonly pieceSection = (name: string, pieceSets: PieceSetData[]): VNode =>
    hl('section.piece-section', [
      hl('h3', name),
      hl(
        'div.piece-list',
        pieceSets.map(pieceSet => this.pieceCard(pieceSet)),
      ),
    ]);

  private readonly pieceCard = (pieceSet: PieceSetData): VNode =>
    hl(
      'button',
      {
        key: pieceSet.key,
        attrs: { type: 'button', title: pieceSet.name, 'aria-label': pieceSet.name },
        class: { active: this.current.pieceSet === pieceSet.key },
        hook: bind('click', () => this.setComponent('pieceSet', pieceSet.key)),
      },
      hl('span', {
        attrs: {
          style: `background-image:url(${site.asset.url(pieceSet.assets['---red-horse'])})`,
        },
      }),
    );

  private readonly sizeSlider = (): VNode => {
    const value = readCssNumber('zoom', 80);
    return this.rangeControl('zoom', i18n.site.size, value, { min: 0, max: 100, step: 1 }, next => {
      document.body.style.setProperty('---zoom', String(next));
      window.dispatchEvent(new Event('resize'));
      xhrText(`/pref/zoom?v=${next}`, { method: 'post' }).catch(() => this.saveFailed('board size'));
    });
  };

  private readonly boardSlider = (
    setting: BoardSetting,
    label: string,
    range: Range,
    title?: (value: number) => string,
  ): VNode =>
    this.rangeControl(
      setting,
      label,
      this.current.board[setting],
      range,
      value => {
        this.current = {
          ...this.current,
          board: { ...this.current.board, [setting]: value },
        };
        this.applyBoardSettings();
        this.debouncedPost(`board${capitalize(setting)}`, String(value));
      },
      title,
    );

  private readonly rangeControl = (
    key: string,
    label: string,
    value: number,
    range: Range,
    update: (value: number) => void,
    title?: (value: number) => string,
  ): VNode =>
    hl(`div.range-control.${key}`, { attrs: { title: title ? title(value) : `${value}%` } }, [
      hl('label', { attrs: { for: `appearance-${key}` } }, label),
      hl('input.range', {
        key: this.sliderKey + key,
        attrs: { id: `appearance-${key}`, type: 'range', value, ...range },
        hook: onInsert<HTMLInputElement>(input => {
          const set = (next: number) => {
            if (next < range.min || next > range.max) return;
            update(next);
          };
          input.addEventListener('input', () => set(parseInt(input.value)));
          input.addEventListener('change', this.root.redraw);
          input.addEventListener(
            'wheel',
            event => {
              event.preventDefault();
              const next = parseInt(input.value) + (event.deltaY > 0 ? -range.step : range.step);
              input.value = String(Math.max(range.min, Math.min(range.max, next)));
              set(parseInt(input.value));
            },
            { passive: false },
          );
        }),
      }),
    ]);

  private readonly resetBoard = (): void => {
    this.selectionVersion++;
    this.current = {
      ...this.current,
      board: { brightness: 100, contrast: 100, saturation: 100, opacity: 100, hue: 0 },
    };
    this.applyBoardSettings();
    this.sliderKey = Date.now();
    for (const [field, value] of [
      ['boardBrightness', '100'],
      ['boardContrast', '100'],
      ['boardSaturation', '100'],
      ['boardOpacity', '100'],
      ['boardHue', '0'],
    ])
      this.post(field, value);
    this.root.redraw();
  };

  private readonly setComponent = (
    field: 'uiTheme' | 'boardTheme' | 'pieceSet' | 'musicSet',
    value: string,
  ): void => {
    this.selectionVersion++;
    this.current = { ...this.current, [field]: value };
    this.apply();
    this.post(field, value);
    this.root.redraw();
  };

  private apply(): void {
    const state = this.current;
    const uiTheme = this.data.uiThemes.find(theme => theme.key === state.uiTheme)!;
    const colorScheme =
      uiTheme.key === 'system' ? (prefersLightThemeQuery().matches ? 'light' : 'dark') : uiTheme.colorScheme;
    const themeClass = uiTheme.key === 'system' ? colorScheme : uiTheme.key;

    for (const theme of this.data.uiThemes)
      if (theme.key !== 'system') document.documentElement.classList.remove(theme.key);
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(themeClass);
    document.body.dataset.uiTheme = uiTheme.key;
    document.body.dataset.colorScheme = colorScheme;

    const backgroundUrl = this.backgroundUrl();
    document.documentElement.classList.toggle('has-background', !!backgroundUrl);
    document.body.classList.toggle('has-background', !!backgroundUrl);
    this.applyBackground(backgroundUrl);

    document.body.dataset.board = state.boardTheme;
    document.body.dataset.soundSet = state.soundSet;
    document.body.dataset.musicSet = state.musicSet;
    this.applyBoardTheme(state.boardTheme);
    this.applyBoardSettings();
    this.applyPieceSet(state.pieceSet);
    site.sound.changeSoundSet(state.soundSet);
    site.sound.changeMusicSet(state.musicSet);
    pubsub.emit('theme', colorScheme);
    pubsub.emit('board.change');
  }

  private readonly applyBoardSettings = (): void => {
    const settings = this.current.board;
    for (const [key, value] of Object.entries(settings))
      document.body.style.setProperty(`---board-${key}`, String(value));
    document.body.classList.toggle(
      'simple-board',
      settings.brightness === 100 &&
        settings.contrast === 100 &&
        settings.saturation === 100 &&
        settings.opacity === 100 &&
        settings.hue === 0,
    );
  };

  private readonly applyBoardTheme = (key: string): void => {
    const board = this.data.boards.find(candidate => candidate.key === key)!;
    document.body.style.setProperty(
      '---board-image',
      `url(${site.asset.url(`images/board/${board.file}`, { pathOnly: true })})`,
    );
    document.body.style.setProperty('---cg-ccw', board.coordinateLight);
    document.body.style.setProperty('---cg-ccb', board.coordinateDark);
    document.body.style.setProperty('---cg-cs', 'none');
  };

  private readonly applyPieceSet = (key: string): void => {
    const pieceSet = this.data.pieceSets.find(candidate => candidate.key === key)!;
    const assets = Object.fromEntries(
      Object.entries(pieceSet.assets).map(([variable, path]) => [variable, `url(${site.asset.url(path)})`]),
    );
    void site.pieceImages.set(assets, key).catch(console.error);
  };

  private readonly backgroundUrl = (): string | undefined => {
    if (this.current.background === customBackground) return this.current.backgroundUrl || undefined;
    return (
      this.data.backgrounds.find(background => background.key === this.current.background)?.image || undefined
    );
  };

  private readonly applyBackground = (source?: string): void => {
    let style = document.getElementById('bg-data');
    if (!source) {
      style?.remove();
      return;
    }
    if (!style) {
      style = document.createElement('style');
      style.id = 'bg-data';
      document.head.append(style);
    }
    style.textContent = `html.has-background::before{background-image:url(${JSON.stringify(assetPath(source))});}`;
  };

  private readonly debouncedPost = (field: string, value: string): void => {
    let post = this.settingPosts.get(field);
    if (!post) {
      post = debounce((next: string, version: number) => {
        if (version === this.selectionVersion) this.post(field, next);
      }, 450);
      this.settingPosts.set(field, post);
    }
    post(value, this.selectionVersion);
  };

  private readonly post = (field: string, value: string): void => {
    this.saveQueue = this.saveQueue
      .catch(() => undefined)
      .then(() =>
        xhrText(`/pref/${field}`, {
          method: 'post',
          body: xhrForm({ [field]: value }),
        }),
      )
      .catch(() => this.saveFailed(field));
  };

  private readonly saveFailed = (field: string): void =>
    site.announce({ msg: i18n.site.failedToSaveAppearancePreference(field) });

  private readonly catalogName = (item: CatalogItem): string => {
    switch (item.key) {
      case 'dark':
        return i18n.site.dark;
      case 'light':
        return i18n.site.light;
      case 'system':
        return i18n.site.deviceTheme;
      case 'none':
        return i18n.site.themeDefault;
      case 'standard':
        return i18n.site.standard;
      default:
        return item.name;
    }
  };
}

export class UiThemeCtrl extends PaneCtrl {
  render = (): VNode =>
    hl('div.sub.ui-theme', [header(i18n.site.uiTheme, this.close), ...this.root.appearance.renderUiTheme()]);
}

export class BoardStyleCtrl extends PaneCtrl {
  render = (): VNode =>
    hl('div.sub.board-style', [
      header(i18n.site.boardStyle, this.close),
      ...this.root.appearance.renderBoardStyle(),
    ]);
}

export class BoardPiecesCtrl extends PaneCtrl {
  render = (): VNode =>
    hl('div.sub.board-pieces', [
      header(i18n.site.boardPieces, this.close),
      ...this.root.appearance.renderBoardPieces(),
    ]);
}

const assetPath = (path: string): string =>
  path.startsWith('/assets/') ? site.asset.url(path.slice('/assets/'.length)) : path;

const isBackgroundUrl = (url: string): boolean =>
  url.startsWith('https://') || url.startsWith('//') || url.startsWith('/assets/');

const capitalize = (value: string): string => value[0].toUpperCase() + value.slice(1);

const readCssNumber = (name: string, fallback: number): number => {
  const value = parseInt(window.getComputedStyle(document.body).getPropertyValue(`---${name}`));
  return Number.isFinite(value) ? value : fallback;
};
