import { randomToken } from './algo';
import { browserId } from './browserId';
import { pubsub } from './pubsub';
import { storage, tempStorage } from './storage';
import { AttentionClock, type AttentionState } from './traffic/clock';
import {
  addSelectionTime,
  finishSelection,
  readSelections,
  type SelectionEpisodes,
} from './traffic/selection';

export type TrafficDimensions = Record<string, string>;
type Values = Record<string, number>;
interface TrafficEvent {
  id: string;
  kind: string;
  at: number;
  visit: string;
  session: string;
  attempt?: string;
  dimensions: TrafficDimensions;
  values: Values;
}
interface Owner {
  tab: string;
  at: number;
}
interface Session {
  id: string;
  at: number;
}

let collector: TrafficCollector | undefined;
const earlyEvents: Array<[string, TrafficDimensions, Values, string | undefined]> = [];
let activity = 'browse';
let currentAttempt: string | undefined;
let context: TrafficDimensions = {};
let musicPlaying = false;
const appearanceFields: Record<string, string> = {
  board: 'board',
  pieces: 'pieceSet',
  uiTheme: 'uiTheme',
  background: 'background',
  sound: 'soundSet',
  music: 'musicSet',
};

export const trafficAttemptId = (): string => randomToken() + randomToken();

export function trackTraffic(
  kind: string,
  dimensions: TrafficDimensions = {},
  values: Values = {},
  attempt?: string,
): void {
  if (collector) collector.event(kind, dimensions, values, attempt);
  else if (earlyEvents.length < 20) earlyEvents.push([kind, dimensions, values, attempt]);
}

export function trafficActivity(next: string, attempt?: string, dimensions: TrafficDimensions = {}): void {
  collector?.boundary();
  activity = next;
  currentAttempt = attempt;
  context = dimensions;
  collector?.refresh();
}

export function trafficNavigate(page: string): void {
  collector?.navigate(page);
}

export function trafficMusicPlaying(playing: boolean): void {
  if (musicPlaying === playing) return;
  collector?.boundary();
  musicPlaying = playing;
  collector?.refresh();
}

/** Call before a preference/audio mutation so pending time belongs to the previous state. */
export function trafficBoundary(): void {
  collector?.boundary();
  queueMicrotask(() => collector?.refresh());
}

export function initTraffic(): void {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  if (
    collector ||
    document.body.dataset.traffic !== 'true' ||
    nav.globalPrivacyControl ||
    navigator.doNotTrack === '1' ||
    storage.get('traffic.optOut') === '1'
  )
    return;
  collector = new TrafficCollector();
  for (const event of earlyEvents.splice(0)) collector.event(...event);
}

class TrafficCollector {
  private readonly browser = browserId();
  private readonly tab = trafficAttemptId();
  private visit = trafficAttemptId();
  private session = this.sessionId();
  private page = document.body.dataset.trafficPage || 'unknown';
  private readonly clock = new AttentionClock(performance.now());
  private state: AttentionState;
  private dimensions: TrafficDimensions;
  private totals: Values = {};
  private readonly account = document.body.dataset.user || 'anonymous';
  private queue: TrafficEvent[] = this.restoreQueue();
  private sending = false;
  private nextSend = 0;
  private lastFlush = performance.now();
  private lastInteraction = 0;
  private errors = 0;
  private failures = 0;
  private visitVisibleMs = 0;
  private meaningfulVisit = false;
  private closedVisit = false;
  private acquisition = this.acquisitionContext();
  private episodes: SelectionEpisodes = readSelections(this.read('traffic.selections.' + this.account));

  constructor() {
    this.claim();
    this.state = this.readState();
    this.dimensions = this.readDimensions();
    addSelectionTime(this.episodes, this.choices(), {});
    this.event('page');
    setInterval(() => {
      this.claim();
      this.tick();
      if (document.visibilityState === 'visible' && performance.now() - this.lastFlush >= 60_000)
        this.boundary();
    }, 5000);
    for (const name of ['pointerdown', 'pointermove', 'keydown', 'scroll', 'touchstart'])
      document.addEventListener(name, this.interact, { passive: true });
    document.addEventListener('visibilitychange', () => {
      this.boundary();
      if (document.hidden) this.flush(true);
      else this.interact();
      this.state = this.readState();
    });
    window.addEventListener('pagehide', () => {
      this.closeVisit();
      this.flush(true);
    });
    window.addEventListener('pageshow', event => {
      if (event.persisted) {
        this.beginVisit();
        this.event('page');
        this.interact();
      }
    });
    window.addEventListener('focus', this.interact);
    window.addEventListener('storage', event => {
      if (event.key === 'traffic.optOut' && event.newValue === '1') {
        this.queue = [];
        tempStorage.remove('traffic.outbox');
      }
    });
    this.observeActions();
    this.observePerformance();
    this.flush(); // Establish attribution before fast server-side outcomes arrive.
  }

  event(kind: string, extra: TrafficDimensions = {}, values: Values = {}, attempt = currentAttempt): void {
    if (storage.get('traffic.optOut') === '1') return;
    if (!['page', 'attention', 'performance', 'client.error', 'cta.exposed', 'visit.closed'].includes(kind))
      this.meaningfulVisit = true;
    const dimensions = { ...this.readDimensions(), ...extra };
    if (kind === 'appearance.changed' && extra.component && extra.previous) {
      const used = finishSelection(
        this.episodes,
        extra.component,
        extra.previous,
        dimensions[extra.component],
      );
      if (used !== undefined) values = { ...values, selectedUseMs: used, selectionEpisodes: 1 };
      this.saveSelections();
    }
    for (const [key, value] of Object.entries(dimensions))
      if (!/^[a-zA-Z0-9_.:+@/\-]{1,100}$/.test(value)) delete dimensions[key];
    if (this.queue.length >= 100) {
      // Keep the oldest acknowledged-retry candidates. The health event makes local loss observable.
      if (this.errors++ === 0)
        this.queue[99] = this.make('client.error', { error: 'collector-overflow' }, {});
      return;
    }
    this.queue.push(this.make(kind, dimensions, values, attempt));
    if (
      this.queue.length >= 20 ||
      ['search.clicked', 'puzzle.started', 'room.entered', 'notation.started'].includes(kind)
    )
      this.flush();
  }

  boundary(): void {
    this.tick();
    if (
      storage.get('traffic.optOut') !== '1' &&
      this.queue.length < 100 &&
      Object.values(this.totals).some(value => value > 0)
    ) {
      this.queue.push(this.make('attention', this.dimensions, this.totals, currentAttempt));
    }
    this.totals = {};
    this.dimensions = this.readDimensions();
    this.lastFlush = performance.now();
    this.saveSelections();
    this.flush();
  }

  refresh(): void {
    this.state = this.readState();
    this.dimensions = this.readDimensions();
  }

  navigate(page: string): void {
    this.closeVisit();
    const previousPage = this.page;
    this.page = page;
    this.beginVisit();
    this.event('page', { previousPage });
    this.dimensions = this.readDimensions();
  }

  private make(kind: string, dimensions: TrafficDimensions, values: Values, attempt?: string): TrafficEvent {
    return {
      id: trafficAttemptId(),
      kind,
      at: Date.now(),
      visit: this.visit,
      session: this.session,
      attempt,
      dimensions,
      values,
    };
  }

  private tick(): void {
    const now = performance.now();
    const elapsed = this.clock.read(now, this.state);
    const choices = Object.fromEntries(
      Object.keys(appearanceFields).flatMap(key =>
        this.dimensions[key] ? [[key, this.dimensions[key]]] : [],
      ),
    );
    addSelectionTime(this.episodes, choices, elapsed);
    this.visitVisibleMs += elapsed.visibleMs || 0;
    for (const [key, value] of Object.entries(elapsed))
      this.totals[key] = Math.min(120_000, (this.totals[key] || 0) + value);
    this.state = this.readState();
  }

  private closeVisit(): void {
    if (this.closedVisit) return;
    this.boundary();
    this.event(
      'visit.closed',
      {},
      {
        durationMs: Math.min(86_400_000, this.visitVisibleMs),
        quickExit: this.visitVisibleMs < 10_000 && !this.meaningfulVisit ? 1 : 0,
      },
    );
    this.closedVisit = true;
  }

  private beginVisit(): void {
    this.visit = trafficAttemptId();
    this.visitVisibleMs = 0;
    this.meaningfulVisit = false;
    this.closedVisit = false;
  }

  private readonly interact = (): void => {
    const now = performance.now();
    if (now - this.lastInteraction < 1000 || document.hidden) return;
    this.tick();
    this.lastInteraction = now;
    this.clock.interact(now);
    this.claim();
    this.state = this.readState();
    const session = this.read<Session>('traffic.session');
    if (!session || Date.now() - session.at > 30 * 60_000) {
      this.closeVisit();
      this.session = this.sessionId();
      this.acquisition = this.acquisitionContext();
      this.beginVisit();
      this.event('page');
      this.refresh();
    } else {
      if (this.session !== session.id) {
        this.closeVisit();
        this.session = session.id;
        this.acquisition = this.acquisitionContext();
        this.beginVisit();
        this.event('page');
        this.refresh();
      }
      this.session = session.id;
      storage.set('traffic.session', JSON.stringify({ id: this.session, at: Date.now() }));
    }
  };

  private readState(): AttentionState {
    const sound = site.sound;
    return {
      visible: !document.hidden,
      ownsAttention: this.read<Owner>('traffic.owner')?.tab === this.tab,
      board: !!document.querySelector('.main-board, .round__app__board, .puzzle__board, .notation__board'),
      solving: activity === 'puzzle.solve',
      musicEnabled: sound.isMusicEnabled(),
      effectsEnabled: sound.isSoundEnabled(),
      musicPlaying,
    };
  }

  private readDimensions(): TrafficDimensions {
    const d = document.body.dataset;
    const dimensions: TrafficDimensions = {
      ...this.acquisition,
      ...context,
      page: this.page,
      activity,
      language: document.documentElement.lang || 'unknown',
      device: window.matchMedia('(pointer: coarse)').matches
        ? window.screen.width < 768
          ? 'mobile'
          : 'tablet'
        : 'desktop',
      colorScheme: d.colorScheme || 'unknown',
      musicEnabled: String(site.sound.isMusicEnabled()),
      effectsEnabled: String(site.sound.isSoundEnabled()),
      musicPlaying: String(musicPlaying),
      volume: site.sound.getVolume() === 0 ? 'muted' : 'audible',
    };
    for (const [component, field] of Object.entries(appearanceFields)) {
      if (d[field]) dimensions[component] = d[field];
    }
    return dimensions;
  }

  private claim(): void {
    const owner = this.read<Owner>('traffic.owner');
    if (!document.hidden && (document.hasFocus() || !owner || Date.now() - owner.at > 10_000)) {
      if (owner?.tab !== this.tab && this.episodes)
        this.episodes = readSelections(this.read('traffic.selections.' + this.account));
      storage.set('traffic.owner', JSON.stringify({ tab: this.tab, at: Date.now() }));
    }
  }

  private choices(): TrafficDimensions {
    return Object.fromEntries(
      Object.entries(appearanceFields).flatMap(([key, field]) =>
        document.body.dataset[field] ? [[key, document.body.dataset[field]]] : [],
      ),
    );
  }

  private saveSelections(): void {
    if (this.state.ownsAttention && storage.get('traffic.optOut') !== '1')
      storage.set('traffic.selections.' + this.account, JSON.stringify(this.episodes));
  }

  private read<T>(key: string): T | undefined {
    try {
      return JSON.parse(storage.get(key) || 'null') as T | undefined;
    } catch {
      return undefined;
    }
  }

  private sessionId(): string {
    const previous = this.read<Session>('traffic.session');
    const id = previous && Date.now() - previous.at < 30 * 60_000 ? previous.id : trafficAttemptId();
    storage.set('traffic.session', JSON.stringify({ id, at: Date.now() }));
    return id;
  }

  private acquisitionContext(): TrafficDimensions {
    const result: TrafficDimensions = { referrer: 'direct-or-unknown' };
    try {
      const referrer = new URL(document.referrer);
      if (referrer.hostname !== location.hostname) result.referrer = referrer.hostname;
    } catch {
      /* Missing referrer is an ordinary direct/unknown visit. */
    }
    const params = new URLSearchParams(location.search);
    for (const key of ['source', 'medium', 'campaign']) {
      const value = params.get('utm_' + key);
      if (value && /^[a-zA-Z0-9_.-]{1,80}$/.test(value)) result[key] = value;
    }
    const saved = this.read<{ session: string; dimensions: TrafficDimensions }>('traffic.acquisition');
    if (saved?.session === this.session) return saved.dimensions;
    storage.set('traffic.acquisition', JSON.stringify({ session: this.session, dimensions: result }));
    return result;
  }

  private restoreQueue(): TrafficEvent[] {
    try {
      const stored = JSON.parse(tempStorage.get('traffic.outbox') || 'null') as {
        account: string;
        events: TrafficEvent[];
      } | null;
      return stored?.account === this.account && Array.isArray(stored.events)
        ? stored.events.filter(e => typeof e.id === 'string' && Date.now() - e.at < 86_400_000).slice(0, 100)
        : [];
    } catch {
      return [];
    }
  }

  private saveQueue(): void {
    if (storage.get('traffic.optOut') !== '1')
      tempStorage.set('traffic.outbox', JSON.stringify({ account: this.account, events: this.queue }));
  }

  private flush(beacon = false): void {
    this.queue = this.queue.filter(e => Date.now() - e.at < 86_400_000);
    this.saveQueue();
    if (
      !this.queue.length ||
      (this.sending && !beacon) ||
      storage.get('traffic.optOut') === '1' ||
      Date.now() < this.nextSend
    )
      return;
    const events = this.queue.slice(0, 20);
    let body = JSON.stringify({ browser: this.browser, events });
    while (new TextEncoder().encode(body).length > 16_000 && events.length > 1) {
      events.pop();
      body = JSON.stringify({ browser: this.browser, events });
    }
    if (beacon) {
      navigator.sendBeacon('/traffic/events', new Blob([body], { type: 'application/json' }));
      return; // Keep IDs for a retry if this page resumes; a beacon has no persistence acknowledgement.
    }
    this.sending = true;
    void fetch('/traffic/events', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body,
      keepalive: true,
    })
      .then(response => {
        if (response.ok || response.status === 400 || response.status === 413) {
          const sent = new Set(events.map(e => e.id));
          this.queue = this.queue.filter(e => !sent.has(e.id));
          this.failures = 0;
          this.nextSend = 0;
          this.saveQueue();
        } else throw new Error('Traffic collection unavailable');
      })
      .catch(() => {
        this.nextSend = Date.now() + Math.min(300_000, 2000 * 2 ** Math.min(8, ++this.failures));
      })
      .finally(() => {
        this.sending = false;
        if (this.queue.length) this.flush();
      });
  }

  private observeActions(): void {
    document.addEventListener(
      'click',
      event => {
        const target = (event.target as Element | null)?.closest<HTMLElement>('[data-traffic-action]');
        if (target)
          this.event('cta.clicked', {
            placement: target.dataset.trafficAction!,
            ...(target.dataset.trafficPool ? { pool: target.dataset.trafficPool } : {}),
          });
      },
      { passive: true },
    );
    if (!('IntersectionObserver' in window)) return;
    const exposed = new Set<string>();
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries)
          if (entry.isIntersecting) {
            const element = entry.target as HTMLElement;
            const key = `${element.dataset.trafficAction}/${element.dataset.trafficPool || ''}`;
            if (!exposed.has(key)) {
              exposed.add(key);
              this.event('cta.exposed', {
                placement: element.dataset.trafficAction!,
                ...(element.dataset.trafficPool ? { pool: element.dataset.trafficPool } : {}),
              });
            }
            observer.unobserve(element);
          }
      },
      { threshold: 0.5 },
    );
    const observe = () =>
      document.querySelectorAll('[data-traffic-action]').forEach(element => observer.observe(element));
    observe();
    pubsub.on('content-loaded', observe);
    // Snabbdom inserts the home cards after site boot; scan only after relevant user actions.
    document.addEventListener('click', () => requestAnimationFrame(observe), { passive: true });
    requestAnimationFrame(observe);
  }

  private observePerformance(): void {
    if (Math.random() >= 0.1 || !('PerformanceObserver' in window)) return;
    void import('web-vitals')
      .then(({ onLCP, onINP, onCLS }) => {
        const reported = new Set<string>();
        const observe = (key: string, scale: number) => (metric: { id: string; value: number }) => {
          // One first-finalized observation per metric/navigation, including bfcache navigations.
          if (reported.has(key + metric.id)) return;
          reported.add(key + metric.id);
          this.event('performance', {}, { [key]: Math.round(Math.min(100_000, metric.value * scale)) });
          if (document.hidden) this.flush(true);
        };
        onLCP(observe('lcpMs', 1));
        onINP(observe('inpMs', 1));
        onCLS(observe('clsMilli', 1000));
      })
      .catch(() => {
        /* Optional measurement must not affect the page. */
      });
  }
}
