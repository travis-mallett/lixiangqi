import { requestXiangqi } from '../api';
import { render } from './explorerView';
import type {
  ExplorerColor,
  ExplorerConfig,
  ExplorerData,
  ExplorerDb,
  ExplorerGame,
  ExplorerPosition,
} from './interfaces';

const STORAGE_KEY = 'lixiangqi.analysis.explorer.v1';

export default class ExplorerCtrl {
  data?: ExplorerData;
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
  ) {
    this.config = this.loadConfig();
    this.toggleButton.addEventListener('click', () => this.toggle());
    this.render();
  }

  get enabled(): boolean {
    return this.enabledValue;
  }

  setPosition(position: ExplorerPosition): void {
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

  selectDb(db: ExplorerDb): void {
    this.config.db = db;
    this.configOpen = db === 'player' && !this.config.player;
    this.saveConfig();
    if (!this.configOpen) void this.fetch();
    this.render();
  }

  toggleConfig(): void {
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
    if (!this.position || !this.enabledValue || (this.config.db === 'player' && !this.config.player)) {
      this.data = undefined;
      this.render();
      return;
    }
    this.controller?.abort();
    this.controller = new AbortController();
    const signal = this.controller.signal;
    this.loading = true;
    this.render();
    try {
      this.data = await requestXiangqi<ExplorerData>(
        `${this.endpoint.replace(/\/$/, '')}/explorer`,
        {
          ...this.position,
          database: this.config.db,
          player: this.config.db === 'player' ? this.config.player : undefined,
          color: this.config.color,
          since: this.config.since || undefined,
          until: this.config.until || undefined,
        },
        signal,
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
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
    const fallback: ExplorerConfig = { db: 'masters', since: '', until: '', player: '', color: 'red' };
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Partial<ExplorerConfig>;
      return {
        db: ['masters', 'lixiangqi', 'player'].includes(stored.db || '') ? stored.db! : fallback.db,
        since: stored.since || '',
        until: stored.until || '',
        player: stored.player || '',
        color: stored.color === 'black' ? 'black' : 'red',
      };
    } catch {
      return fallback;
    }
  }

  private saveConfig(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.config));
  }
}
