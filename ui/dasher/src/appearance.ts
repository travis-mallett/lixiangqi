import { type Prop, prop } from 'lib';
import { debounce } from 'lib/async';
import { prefersLightThemeQuery } from 'lib/device';
import { licon } from 'lib/licon';
import { pubsub } from 'lib/pubsub';
import { bind, dataIcon, hl, onInsert, snabDialog, type VNode } from 'lib/view';
import { form as xhrForm, text as xhrText } from 'lib/xhr';

import type { DasherCtrl } from '@/ctrl';
import type {
  AppearanceState,
  BackgroundData,
  BoardThemeData,
  CatalogItem,
  PieceSetData,
  ThemePackData,
} from '@/interfaces';

import { PaneCtrl } from './interfaces';
import { header } from './util';

type AppearanceTab = 'ui' | 'background' | 'board' | 'pieces';
type BoardSetting = keyof AppearanceState['board'];
type Range = { min: number; max: number; step: number };

const customPack = 'custom';
const customBackground = 'custom';
const none = 'none';

export class AppearanceCtrl extends PaneCtrl {
  private dialogOpen = false;
  private readonly tab: Prop<AppearanceTab> = prop('ui');
  private sliderKey = Date.now();
  private selectionVersion = 0;
  private backgroundVersion = 0;
  private readonly settingPosts = new Map<string, (value: string, version: number) => void>();
  private saveQueue: Promise<unknown> = Promise.resolve();

  constructor(root: DasherCtrl) {
    super(root);
    this.apply();
  }

  render = (): VNode =>
    hl('div.sub.appearance', [
      header(i18n.site.theme, this.close),
      hl(
        'div.theme-pack-list',
        this.data.packs.map(pack => this.packCard(pack)),
      ),
      hl(
        'button.text.custom-combination',
        {
          attrs: { ...dataIcon(licon.Gear), type: 'button' },
          class: { active: this.current.pack === customPack },
          hook: bind('click', this.openDialog),
        },
        [
          hl('span', i18n.site.customCombination),
          hl('small', this.current.pack === customPack ? i18n.site.active : i18n.site.mixAppearanceOptions),
        ],
      ),
      this.dialogOpen ? this.dialog() : null,
    ]);

  selectPack = (key: string): void => {
    const pack = this.data.packs.find(candidate => candidate.key === key);
    if (pack) this.setPack(pack);
  };

  selectMusicSet = (key: string): void => {
    if (this.data.musicSets.some(track => track.key === key) && key !== this.current.musicSet)
      this.setComponent('musicSet', key);
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

  private readonly normalize = (candidate: AppearanceState): AppearanceState => {
    const pack = this.data.packs.find(({ appearance }) => sameCombination(appearance, candidate));
    return pack ? copyAppearance(pack.appearance) : { ...candidate, pack: customPack };
  };

  private readonly packCard = (pack: ThemePackData): VNode =>
    hl(
      'button.theme-pack-card',
      {
        key: pack.key,
        attrs: { type: 'button', title: this.packDescription(pack) },
        class: { active: this.current.pack === pack.key },
        hook: bind('click', () => this.setPack(pack)),
      },
      [
        hl(
          `span.theme-pack-preview.${pack.appearance.uiTheme}`,
          {
            attrs: this.packPreviewStyle(pack.appearance),
          },
          [
            hl(
              'span.board-preview',
              {
                attrs: this.boardPreviewStyle(pack.appearance.boardTheme),
              },
              [
                hl('span.piece-marker', {
                  attrs: {
                    style: `background-image:url(${this.pieceAsset(
                      pack.appearance.pieceSet,
                      '---red-horse',
                    )})`,
                  },
                }),
              ],
            ),
            hl('span.panel-preview'),
            hl('span.button-preview'),
          ],
        ),
        hl('strong', this.packName(pack)),
        hl('small', this.packDescription(pack)),
      ],
    );

  private readonly packPreviewStyle = (appearance: AppearanceState): Record<string, string> => {
    const background = this.data.backgrounds.find(item => item.key === appearance.background)?.image;
    const uiTheme = this.data.uiThemes.find(item => item.key === appearance.uiTheme)!;
    const properties = [
      `--preview-bg:${uiTheme.previewBackground}`,
      `--preview-panel:${uiTheme.previewPanel}`,
      `--preview-panel-low:${uiTheme.previewPanelLow}`,
      `--preview-accent:${uiTheme.previewAccent}`,
    ];
    if (background) properties.push(`background-image:url(${assetPath(background)})`);
    return { style: properties.join(';') };
  };

  private readonly boardPreviewStyle = (key: string): Record<string, string> => {
    const board = this.data.boards.find(candidate => candidate.key === key)!;
    return { style: `background-image:url(${site.asset.url(`images/board/${board.file}`)})` };
  };

  private readonly pieceAsset = (key: string, variable: string): string => {
    const pieceSet = this.data.pieceSets.find(candidate => candidate.key === key)!;
    return site.asset.url(pieceSet.assets[variable]);
  };

  private readonly packName = (pack: ThemePackData): string =>
    pack.key === 'dark' ? i18n.site.dark : pack.key === 'light' ? i18n.site.light : pack.name;

  private readonly packDescription = (pack: ThemePackData): string =>
    pack.key === 'dark'
      ? i18n.site.darkThemeDescription
      : pack.key === 'light'
        ? i18n.site.lightThemeDescription
        : pack.description;

  private readonly setPack = (pack: ThemePackData): void => {
    this.selectionVersion++;
    this.backgroundVersion++;
    this.current = copyAppearance(pack.appearance);
    this.apply();
    this.post('appearancePack', pack.key);
    this.redraw();
  };

  private readonly openDialog = (): void => {
    this.dialogOpen = true;
    this.redraw();
  };

  private readonly dialog = (): VNode =>
    snabDialog({
      class: 'appearance-dialog',
      attrs: { dialog: { 'aria-labelledby': 'appearance-dialog-title' } },
      modal: true,
      easyClose: 'clickOutside',
      onClose: () => {
        this.dialogOpen = false;
        this.redraw();
      },
      vnodes: [
        hl('div.appearance-dialog__header', [
          hl('h2#appearance-dialog-title', i18n.site.customCombination),
          hl('p', i18n.site.chooseAppearanceParts),
        ]),
        hl(
          'div.appearance-dialog__tabs',
          {
            attrs: { role: 'tablist', 'aria-label': i18n.site.appearanceCategories },
          },
          (
            [
              ['ui', i18n.site.uiTheme],
              ['background', i18n.site.background],
              ['board', i18n.site.board],
              ['pieces', i18n.site.pieceSet],
            ] as const
          ).map(([key, label]) =>
            hl(
              'button',
              {
                attrs: {
                  type: 'button',
                  role: 'tab',
                  'aria-selected': this.tab() === key ? 'true' : 'false',
                },
                class: { active: this.tab() === key },
                hook: bind('click', () => {
                  this.tab(key);
                  this.redraw();
                }),
              },
              label,
            ),
          ),
        ),
        hl('div.appearance-dialog__content', { attrs: { role: 'tabpanel' } }, this.renderTab()),
      ],
    });

  private renderTab(): VNode[] {
    switch (this.tab()) {
      case 'ui':
        return [
          this.optionGrid(this.data.uiThemes, this.current.uiTheme, item =>
            this.setComponent('uiTheme', item.key),
          ),
        ];
      case 'background':
        return this.backgroundTab();
      case 'board':
        return this.boardTab();
      case 'pieces':
        return [this.pieceGrid()];
    }
  }

  private readonly backgroundTab = (): VNode[] => [
    hl(
      'div.background-grid',
      this.data.backgrounds.map(background => this.backgroundCard(background)),
    ),
    hl('div.custom-background', [
      hl('label', { attrs: { for: 'appearance-background-url' } }, i18n.site.customImageUrl),
      hl('input#appearance-background-url', {
        attrs: {
          type: 'url',
          inputmode: 'url',
          placeholder: 'https://',
          value: this.current.background === customBackground ? this.current.backgroundUrl || '' : '',
        },
        hook: onInsert<HTMLInputElement>(input => {
          const save = debounce((url: string, version: number) => {
            if (version === this.backgroundVersion && isBackgroundUrl(url)) this.setBackgroundUrl(url);
          }, 350);
          input.addEventListener('input', () => save(input.value.trim(), this.backgroundVersion));
        }),
      }),
    ]),
  ];

  private readonly backgroundCard = (background: BackgroundData): VNode =>
    hl(
      'button.background-card',
      {
        key: background.key,
        attrs: { type: 'button', title: background.name },
        class: { active: this.current.background === background.key },
        hook: bind('click', () => this.setBackground(background)),
      },
      [
        background.image
          ? hl('img', { attrs: { src: assetPath(background.image), alt: '' } })
          : hl('span.no-background-preview', { attrs: dataIcon(licon.X) }),
        hl('strong', this.catalogName(background)),
      ],
    );

  private readonly setBackground = (background: BackgroundData): void => {
    this.backgroundVersion++;
    this.current = this.normalize({
      ...this.current,
      background: background.key,
      backgroundUrl: undefined,
    });
    this.apply();
    this.post('background', background.key);
    this.redraw();
  };

  private readonly setBackgroundUrl = (url: string): void => {
    this.current = this.normalize({
      ...this.current,
      background: customBackground,
      backgroundUrl: url,
    });
    this.apply();
    this.post('backgroundUrl', url);
    this.redraw();
  };

  private readonly boardTab = (): VNode[] => [
    hl('div.board-settings', [
      this.sizeSlider(),
      this.boardSlider('brightness', i18n.site.brightness, { min: 20, max: 140, step: 1 }),
      this.boardSlider('contrast', i18n.site.contrast, { min: 40, max: 200, step: 2 }),
      this.boardSlider('hue', i18n.site.hue, { min: 0, max: 100, step: 1 }, value => `${value * 3.6}°`),
      this.boardSlider('opacity', i18n.site.opacity, { min: 0, max: 100, step: 1 }),
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
      'div.board-grid.d2',
      this.data.boards.map(board => this.boardCard(board)),
    ),
  ];

  private readonly boardCard = (board: BoardThemeData): VNode =>
    hl(
      'button',
      {
        key: board.key,
        attrs: {
          type: 'button',
          title: board.name,
        },
        class: { active: this.current.boardTheme === board.key },
        hook: bind('click', () => this.setComponent('boardTheme', board.key)),
      },
      [hl('span', { attrs: this.boardPreviewStyle(board.key) }), hl('strong', board.name)],
    );

  private readonly pieceGrid = (): VNode =>
    hl(
      'div.piece-grid',
      this.data.pieceSets.map(pieceSet => this.pieceCard(pieceSet)),
    );

  private readonly pieceCard = (pieceSet: PieceSetData): VNode =>
    hl(
      'button',
      {
        key: pieceSet.key,
        attrs: { type: 'button', title: pieceSet.name },
        class: { active: this.current.pieceSet === pieceSet.key },
        hook: bind('click', () => this.setComponent('pieceSet', pieceSet.key)),
      },
      [
        hl('span.piece-preview', {
          attrs: {
            style: `background-image:url(${site.asset.url(pieceSet.assets['---red-horse'])})`,
          },
        }),
        hl('strong', pieceSet.name),
      ],
    );

  private readonly optionGrid = (
    items: CatalogItem[],
    selected: string,
    select: (item: CatalogItem) => void,
  ): VNode =>
    hl(
      'div.appearance-option-grid',
      items.map(item =>
        hl(
          'button',
          {
            key: item.key,
            attrs: { ...dataIcon(licon.Checkmark), type: 'button' },
            class: { active: selected === item.key },
            hook: bind('click', () => select(item)),
          },
          this.catalogName(item),
        ),
      ),
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
        this.current = this.normalize({
          ...this.current,
          board: { ...this.current.board, [setting]: value },
        });
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
      hl('output', String(value)),
      hl('input.range', {
        key: this.sliderKey + key,
        attrs: {
          id: `appearance-${key}`,
          type: 'range',
          value,
          ...range,
        },
        hook: onInsert<HTMLInputElement>(input => {
          const set = (next: number) => {
            if (next < range.min || next > range.max) return;
            update(next);
            const output = input.parentElement?.querySelector('output');
            if (output) output.textContent = String(next);
          };
          input.addEventListener('input', () => set(parseInt(input.value)));
          input.addEventListener('change', this.redraw);
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
    this.current = this.normalize({
      ...this.current,
      board: { brightness: 100, contrast: 100, opacity: 100, hue: 0 },
    });
    this.applyBoardSettings();
    this.sliderKey = Date.now();
    for (const [field, value] of [
      ['boardBrightness', '100'],
      ['boardContrast', '100'],
      ['boardOpacity', '100'],
      ['boardHue', '0'],
    ]) {
      this.post(field, value);
    }
    this.redraw();
  };

  private readonly setComponent = (
    field: 'uiTheme' | 'boardTheme' | 'pieceSet' | 'soundSet' | 'musicSet',
    value: string,
  ): void => {
    this.current = this.normalize({ ...this.current, [field]: value });
    if (value === none) {
      if (field === 'soundSet') site.sound.setSoundEnabled(false);
      else if (field === 'musicSet') site.sound.setMusicEnabled(false);
    }
    this.apply();
    this.post(field, value);
    this.redraw();
  };

  private apply(): void {
    const state = this.current;
    const uiTheme = this.data.uiThemes.find(theme => theme.key === state.uiTheme)!;
    const colorScheme =
      uiTheme.key === 'system' ? (prefersLightThemeQuery().matches ? 'light' : 'dark') : uiTheme.colorScheme;
    const themeClass = uiTheme.key === 'system' ? colorScheme : uiTheme.key;

    for (const theme of this.data.uiThemes) {
      if (theme.key !== 'system') document.documentElement.classList.remove(theme.key);
    }
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(themeClass);
    document.body.dataset.uiTheme = uiTheme.key;
    document.body.dataset.colorScheme = colorScheme;

    const backgroundUrl = this.backgroundUrl();
    document.documentElement.classList.toggle('has-background', !!backgroundUrl);
    document.body.classList.toggle('has-background', !!backgroundUrl);
    this.applyBackground(backgroundUrl);

    document.body.dataset.board = state.boardTheme;
    document.body.dataset.pieceSet = state.pieceSet;
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
    for (const [key, value] of Object.entries(settings)) {
      document.body.style.setProperty(`---board-${key}`, String(value));
    }
    document.body.classList.toggle(
      'simple-board',
      settings.brightness === 100 &&
        settings.contrast === 100 &&
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
    for (const [variable, path] of Object.entries(pieceSet.assets)) {
      document.body.style.setProperty(variable, `url(${site.asset.url(path, { pathOnly: true })})`);
    }
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
        return i18n.site.none;
      case 'standard':
        return i18n.site.standard;
      default:
        return item.name;
    }
  };
}

const copyAppearance = (appearance: AppearanceState): AppearanceState => ({
  ...appearance,
  board: { ...appearance.board },
});

const sameCombination = (a: AppearanceState, b: AppearanceState): boolean =>
  a.uiTheme === b.uiTheme &&
  a.background === b.background &&
  (a.backgroundUrl ?? null) === (b.backgroundUrl ?? null) &&
  a.boardTheme === b.boardTheme &&
  a.pieceSet === b.pieceSet &&
  a.soundSet === b.soundSet &&
  a.musicSet === b.musicSet &&
  a.board.brightness === b.board.brightness &&
  a.board.contrast === b.board.contrast &&
  a.board.opacity === b.board.opacity &&
  a.board.hue === b.board.hue;

const assetPath = (path: string): string =>
  path.startsWith('/assets/') ? site.asset.url(path.slice('/assets/'.length)) : path;

const isBackgroundUrl = (url: string): boolean =>
  url.startsWith('https://') || url.startsWith('//') || url.startsWith('/assets/');

const capitalize = (value: string): string => value[0].toUpperCase() + value.slice(1);

const readCssNumber = (name: string, fallback: number): number => {
  const value = parseInt(window.getComputedStyle(document.body).getPropertyValue(`---${name}`));
  return Number.isFinite(value) ? value : fallback;
};
