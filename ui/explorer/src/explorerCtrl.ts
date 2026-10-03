import { requestXiangqi } from 'lib/game/xiangqiApi';

import { render } from './explorerView';
import type {
  BookData,
  ExplorerColor,
  ExplorerConfig,
  ExplorerData,
  ExplorerDb,
  ExplorerGame,
  ExplorerPosition,
} from './interfaces';

const STORAGE_KEY = 'lixiangqi.analysis.explorer.v2';

export interface ExplorerCtrlOptions {
  gameActions?: (game: ExplorerGame) => { label: string; run: () => void }[];
  onHover?: (move?: string) => void;
  lockedPlayer?: string;
  lockedEvent?: string;
  initialColor?: ExplorerColor;
  initiallyEnabled?: boolean;
  configurationEnabled?: boolean;
  persistPreferences?: boolean;
}

export default class ExplorerCtrl {
  data?: ExplorerData;
  book?: BookData;
  error?: string;
  loading = false;
  configOpen = false;
  config: ExplorerConfig;
  private enabledValue = false;
  private position?: ExplorerPosition;
  private controller?: AbortController;

  constructor(
    readonly element: HTMLElement,
    private readonly toggleButton: HTMLButtonElement,
    readonly play: (move: string) => void,
    readonly loadGame: (game: ExplorerGame) => void,
    private readonly endpoint: string,
    readonly options: ExplorerCtrlOptions = {},
  ) {
    this.config = this.loadConfig();
    if (this.options.lockedPlayer?.trim()) {
      this.config.db = 'player';
      this.config.player = this.options.lockedPlayer.trim();
      this.config.color = this.options.initialColor === 'black' ? 'black' : 'red';
    } else if (this.options.lockedEvent?.trim()) {
      this.config.db = 'event';
      this.config.event = this.options.lockedEvent.trim();
    }
    this.enabledValue = this.options.initiallyEnabled ?? false;
    this.element.hidden = !this.enabledValue;
    this.toggleButton.classList.toggle('active', this.enabledValue);
    this.toggleButton.setAttribute('aria-pressed', String(this.enabledValue));
    this.toggleButton.addEventListener('click', this.onToggle);
    this.render();
    if (this.enabledValue) void this.fetch();
  }

  private readonly onToggle = () => this.toggle();

  destroy(): void {
    this.controller?.abort();
    this.toggleButton.removeEventListener('click', this.onToggle);
  }

  get enabled(): boolean {
    return this.enabledValue;
  }

  setPosition(position: ExplorerPosition): void {
    if (JSON.stringify(this.position) === JSON.stringify(position)) return;
    this.position = position;
    if (this.enabledValue) void this.fetch();
  }

  toggle(): void {
    this.enabledValue = !this.enabledValue;
    this.element.hidden = !this.enabledValue;
    this.toggleButton.classList.toggle('active', this.enabledValue);
    this.toggleButton.setAttribute('aria-pressed', String(this.enabledValue));
    if (this.enabledValue) void this.fetch();
    else this.controller?.abort();
  }

  selectMode(mode: ExplorerConfig['mode']): void {
    this.config.mode = mode;
    this.configOpen = false;
    this.saveConfig();
    void this.fetch();
    this.render();
  }

  selectMetric(metric: ExplorerConfig['metric']): void {
    this.config.metric = metric;
    this.saveConfig();
    void this.fetch();
  }

  selectDb(db: ExplorerDb): void {
    if (this.options.lockedPlayer || this.options.lockedEvent) return;
    this.config.db = db;
    this.config.mode = 'games';
    this.configOpen = db === 'player' && !this.config.player;
    this.saveConfig();
    if (!this.configOpen) void this.fetch();
    this.render();
  }

  toggleConfig(): void {
    if (this.options.configurationEnabled === false) return;
    this.configOpen = !this.configOpen;
    this.render();
  }

  toggleColor(): void {
    this.setColor(this.config.color === 'red' ? 'black' : 'red');
    void this.fetch();
  }

  setColor(color: ExplorerColor): void {
    this.config.color = color;
    this.render();
  }

  selectColor(color: ExplorerColor): void {
    if (this.config.color === color) return;
    this.config.color = color;
    if (!this.options.lockedPlayer && !this.options.lockedEvent) this.saveConfig();
    void this.fetch();
    this.render();
  }

  setPlayer(player: string): void {
    this.config.player = player.trim();
    this.render();
  }

  setDate(field: 'since' | 'until', value: string): void {
    this.config[field] = value;
  }

  applyConfig(): void {
    this.saveConfig();
    this.configOpen = false;
    void this.fetch();
    this.render();
  }

  private async fetch(): Promise<void> {
    if (
      !this.position ||
      !this.enabledValue ||
      (this.config.mode === 'games' &&
        ((this.config.db === 'player' && !this.config.player) ||
          (this.config.db === 'event' && !this.config.event)))
    ) {
      this.data = undefined;
      this.render();
      return;
    }
    this.controller?.abort();
    this.controller = new AbortController();
    const signal = this.controller.signal;
    this.loading = true;
    this.error = undefined;
    this.render();
    try {
      if (this.config.mode !== 'games') {
        this.book = await requestXiangqi<BookData>(
          '/api/analysis/book',
          { ...this.position, metric: this.config.metric, endgame: this.config.mode === 'tablebase' },
          signal,
        );
        return;
      }
      this.data = await requestXiangqi<ExplorerData>(
        `${this.endpoint.replace(/\/$/, '')}/explorer`,
        {
          ...this.position,
          database: this.config.db,
          player: this.config.db === 'player' ? this.config.player : undefined,
          event: this.config.db === 'event' ? this.config.event : undefined,
          color: this.config.color,
          since: this.config.since || undefined,
          until: this.config.until || undefined,
        },
        signal,
      );
    } catch (error) {
      if (signal.aborted) return;
      this.error = error instanceof Error ? error.message : String(error);
      this.data = {
        available: false,
        database: this.config.db,
        source: '',
        sourceUrl: '',
        fen: '',
        red: 0,
        draws: 0,
        black: 0,
        moves: [],
        topGames: [],
        recentGames: [],
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      if (!signal.aborted) {
        this.loading = false;
        this.render();
      }
    }
  }

  private render(): void {
    render(this);
  }

  private loadConfig(): ExplorerConfig {
    const fallback: ExplorerConfig = {
      db: 'masters',
      mode: 'games',
      metric: 'dtm',
      since: '',
      until: '',
      player: '',
      event: '',
      color: 'red',
    };
    if (this.options.persistPreferences === false) return fallback;
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Partial<ExplorerConfig>;
      const storedDb = stored.db;
      return {
        db: ['masters', 'all', 'dpxq', 'gdchess', 'xqdao', 'player'].includes(storedDb || '')
          ? storedDb!
          : fallback.db,
        mode: stored.mode === 'book' || stored.mode === 'tablebase' ? stored.mode : 'games',
        metric: stored.metric === 'dtc' ? 'dtc' : 'dtm',
        since: stored.since || '',
        until: stored.until || '',
        player: stored.player || '',
        event: '',
        color: stored.color === 'black' ? 'black' : 'red',
      };
    } catch {
      return fallback;
    }
  }

  private saveConfig(): void {
    if (this.options.persistPreferences !== false)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.config));
  }
}
